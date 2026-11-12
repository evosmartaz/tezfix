import { Injectable, Logger, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import sharp from 'sharp';
import { CreateRequestBodySchema, bakuDayKey, type FileKind, type LatLng, type RequestTiming } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { SettingsService } from '../../common/settings/settings.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { hashPassword } from '../../common/auth/password';
import { LedgerService } from '../ledger/ledger.service';
import { CustomerService } from '../customer/customer.service';
import { FilesService } from '../files/files.service';
import { ProService } from '../pro/pro.service';
import { KycService } from '../kyc/kyc.service';
import { ProviderReviewService } from '../kyc/provider-review.service';
import { CompanyService } from '../company/company.service';
import { InvitesService } from '../invites/invites.service';
import { RequestsService } from '../requests/requests.service';
import { OffersService } from '../requests/offers.service';
import { ProviderActionsService } from '../assignments/provider-actions.service';
import { CustomerActionsService } from '../assignments/customer-actions.service';
import { PaymentsService } from '../payments/payments.service';
import { CasesService } from '../cases/cases.service';
import { ProjectsService } from '../projects/projects.service';
import { ProviderProjectsService } from '../projects/provider-projects.service';
import { DemoRequestsService } from './demo-requests.service';
import { DEMO_SEED_KEY } from './demo.constants';
import {
  CUSTOMER_FUNDING,
  DEMO_LOGINS,
  FINAL_BALANCES,
  FIXPRO,
  KONTUR,
  SEED_PEOPLE,
  SEED_PLACES,
  type DemoLogin,
  type SeedPersonKey,
} from './demo-seed.data';

const SEED_VERSION = 1;
const STEPS = ['accounts', 'history', 'inProgress', 'project', 'guaranteeCase', 'balances'] as const;
type Step = (typeof STEPS)[number];

interface SeedMarker {
  version: number;
  steps: Partial<Record<Step, string>>;
  data: { cardAssignmentId?: string; inProgressAssignmentId?: string; projectId?: string; caseId?: string };
  completedAt?: string;
}

export interface DemoSeedResult {
  /** True when the database was already seeded (the run changed nothing). */
  skipped: boolean;
  logins: DemoLogin[];
  marker: SeedMarker;
}

interface Place extends LatLng {
  street?: string;
  building?: string;
  district?: string;
}

const KYC_POLICY_VERSION = 'kyc-consent-2026-10';

/**
 * Demo seed (spec 17, plan lane B6): FixPro MMC with its manager and workers, solo handymen (approved / pending / blocked),
 * customers, historical requests in every status, a B2B project with two quotes and an open guarantee case. Everything goes
 * through the real services (onboarding, KYC + admin review, invites, requests, dispatch, offers, the assignment lifecycle,
 * payments, cases, projects); money moves only through LedgerService with idempotency keys, so the ledger balances.
 * History is played with the Clock moved two days back and manual jobs (JobsService in manual mode), then the Clock is restored.
 * Progress is stored in PlatformSetting `demo.seed`: a finished seed is a no-op, an interrupted one resumes at the failed step.
 */
@Injectable()
export class DemoSeedService {
  private readonly log = new Logger('DemoSeed');
  private out: (line: string) => void = () => undefined;
  /** Clock offset (ms) when the run started; the history moves the Clock back and restores it. */
  private offset = 0;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly i18n: I18nService,
    private readonly ledger: LedgerService,
    private readonly customers: CustomerService,
    private readonly demoRequests: DemoRequestsService,
  ) {}

  private svc<T>(type: Type<T>): T {
    return this.moduleRef.get(type, { strict: false });
  }

  // ------------------------------------------------------------------ marker

  async marker(): Promise<SeedMarker | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: DEMO_SEED_KEY } });
    return (row?.value as SeedMarker | undefined) ?? null;
  }

  private async save(m: SeedMarker): Promise<void> {
    await this.prisma.platformSetting.upsert({
      where: { key: DEMO_SEED_KEY },
      create: { key: DEMO_SEED_KEY, value: m as never },
      update: { value: m as never },
    });
  }

  logins(): DemoLogin[] {
    return DEMO_LOGINS;
  }

  // --------------------------------------------------------------------- run

  async run(opts: { log?: (line: string) => void } = {}): Promise<DemoSeedResult> {
    this.out = opts.log ?? ((line) => this.log.log(line));
    if (this.jobs.mode !== 'manual') throw new Error('The demo seed drives timers itself: run it with JOBS_MODE=manual (prisma/seed/demo.ts does).');
    const existing = await this.marker();
    if (existing?.completedAt) {
      this.out(`Demo data already seeded at ${existing.completedAt}: nothing to do.`);
      return { skipped: true, logins: DEMO_LOGINS, marker: existing };
    }
    const m: SeedMarker = existing ?? { version: SEED_VERSION, steps: {}, data: {} };
    const offset = this.clock.nowMs() - Date.now();
    this.offset = offset;
    try {
      for (const step of STEPS) {
        if (m.steps[step]) continue;
        this.out(`- ${step}`);
        await this.runStep(step, m);
        m.steps[step] = new Date().toISOString();
        await this.save(m);
      }
    } finally {
      this.clock.set(new Date(Date.now() + offset));
    }
    m.completedAt = new Date().toISOString();
    await this.save(m);
    return { skipped: false, logins: DEMO_LOGINS, marker: m };
  }

  private async runStep(step: Step, m: SeedMarker): Promise<void> {
    switch (step) {
      case 'accounts':
        return this.accounts();
      case 'history':
        m.data.cardAssignmentId = await this.history();
        return;
      case 'inProgress':
        m.data.inProgressAssignmentId = await this.inProgress();
        return;
      case 'project':
        m.data.projectId = await this.project();
        return;
      case 'guaranteeCase':
        m.data.caseId = await this.guaranteeCase(m.data.cardAssignmentId);
        return;
      case 'balances':
        return this.balances();
    }
  }

  // ----------------------------------------------------------------- helpers

  private async user(key: SeedPersonKey): Promise<string> {
    const p = SEED_PEOPLE[key];
    const u = await this.prisma.user.findUnique({ where: { phone: p.phone } });
    if (u) return u.id;
    const created = await this.prisma.user.create({
      data: { phone: p.phone, firstName: p.firstName, lastName: p.lastName, locale: 'az', createdAt: this.clock.now() },
    });
    return created.id;
  }

  private async profile(key: SeedPersonKey) {
    const userId = await this.user(key);
    return this.prisma.handymanProfile.findUniqueOrThrow({ where: { userId } });
  }

  private async fixpro() {
    return this.prisma.company.findUniqueOrThrow({ where: { voen: FIXPRO.voen } });
  }

  private async categoryId(slug: string): Promise<string> {
    return (await this.prisma.category.findUniqueOrThrow({ where: { slug } })).id;
  }

  /** The admin the seed's review decisions are recorded under: the first active ADMIN, else an inactive "demo seed" admin. */
  private async adminId(): Promise<string> {
    const admin = await this.prisma.adminUser.findFirst({ where: { active: true, role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (admin) return admin.id;
    const email = 'demo-seed@tezfiks.invalid';
    const seed = await this.prisma.adminUser.findUnique({ where: { email } });
    if (seed) return seed.id;
    const password = (await import('node:crypto')).randomBytes(24).toString('base64url');
    const created = await this.prisma.adminUser.create({
      data: { email, name: 'Demo seed', role: 'ADMIN', active: false, passwordHash: await hashPassword(password) },
    });
    return created.id;
  }

  /** A placeholder JPEG uploaded through FilesService (re-encoded like any upload). */
  private async placeholder(userId: string, kind: FileKind, label: string): Promise<string> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="100%" height="100%" fill="#0B1B2B"/><text x="50%" y="50%" fill="#00A971" font-family="sans-serif" font-size="36" text-anchor="middle">TezFiks demo - ${label}</text></svg>`;
    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer();
    const ref = await this.svc(FilesService).upload(userId, kind, { buffer, mimetype: 'image/jpeg', size: buffer.length });
    return ref.id;
  }

  private async submitKyc(userId: string, companyId?: string): Promise<void> {
    const [front, back, selfie, turn, blink] = [
      await this.placeholder(userId, 'KYC_ID_FRONT', 'ID front'),
      await this.placeholder(userId, 'KYC_ID_BACK', 'ID back'),
      await this.placeholder(userId, 'KYC_SELFIE', 'selfie'),
      await this.placeholder(userId, 'KYC_SELFIE_TURN', 'selfie turn'),
      await this.placeholder(userId, 'KYC_SELFIE_BLINK', 'selfie blink'),
    ];
    const docs = companyId ? [await this.placeholder(userId, 'COMPANY_DOC', 'company document')] : [];
    await this.svc(KycService).submit(
      userId,
      {
        subject: companyId ? 'COMPANY' : 'HANDYMAN',
        ...(companyId ? { companyId } : {}),
        idFrontFileId: front!,
        idBackFileId: back!,
        selfie: { frontFileId: selfie!, turnFileId: turn!, blinkFileId: blink! },
        selfieChecks: null,
        tradeProofFileIds: [],
        companyDocFileIds: docs,
        consent: { policyVersion: KYC_POLICY_VERSION, locale: 'az', accepted: true },
      },
      null,
    );
  }

  /** Test-mode top-up from the platform EXTERNAL account, once per key. */
  private async topUp(accountId: string, amount: number, key: string): Promise<void> {
    const external = await this.ledger.platformAccountId('EXTERNAL');
    await this.ledger.post({
      kind: 'TOPUP',
      idempotencyKey: `demo-seed:topup:${key}`,
      entries: [
        { accountId: external, amount: -amount },
        { accountId, amount },
      ],
      memo: 'demo seed top-up',
      actor: { type: 'SYSTEM' },
      metadata: { demo: true },
    });
  }

  private async ensureCustomer(key: 'nizami' | 'aysel' | 'kontur'): Promise<{ userId: string; walletAccountId: string }> {
    const userId = await this.user(key);
    let acc = await this.customers.findAccount(userId);
    if (!acc) {
      if (key === 'kontur') await this.customers.upsertAccount(userId, { type: 'COMPANY', ...KONTUR });
      else await this.customers.upsertAccount(userId, { type: 'INDIVIDUAL' });
      acc = await this.customers.requireAccount(userId);
    }
    await this.topUp(acc.walletAccountId, CUSTOMER_FUNDING[key], key);
    return { userId, walletAccountId: acc.walletAccountId };
  }

  private async soloProfile(key: 'elvin' | 'samir' | 'vuqar', trades: string[], base: LatLng) {
    const userId = await this.user(key);
    let p = await this.prisma.handymanProfile.findUnique({ where: { userId } });
    if (!p) {
      const tradeIds = await Promise.all(trades.map((s) => this.categoryId(s)));
      const person = SEED_PEOPLE[key];
      await this.svc(ProService).onboardSolo(
        userId,
        { firstName: person.firstName, lastName: person.lastName, tradeIds, serviceRadiusKm: 10, base },
        'az',
      );
      p = await this.prisma.handymanProfile.findUniqueOrThrow({ where: { userId } });
    }
    if (p.status === 'DRAFT') {
      await this.submitKyc(userId);
      p = await this.prisma.handymanProfile.findUniqueOrThrow({ where: { userId } });
    }
    return { userId, profile: p };
  }

  // ---------------------------------------------------------------- accounts

  private async accounts(): Promise<void> {
    const adminId = await this.adminId();
    const review = this.svc(ProviderReviewService);
    for (const key of ['nizami', 'aysel', 'kontur'] as const) await this.ensureCustomer(key);
    await this.demoRequests.ensureDemoCustomer();

    // Solo handymen: Elvin approved (34 AZN at the end), Samir pending review, Vüqar blocked.
    const elvin = await this.soloProfile('elvin', ['plumbing', 'heating', 'renovation-crew'], SEED_PLACES.elvinBase);
    if (elvin.profile.status === 'PENDING_REVIEW') await review.approveHandyman(adminId, elvin.profile.id, { docNumberLast4: '4821' }, null);
    await this.topUp(elvin.profile.walletAccountId!, 10_000, 'elvin');
    await this.soloProfile('samir', ['electrical', 'tv-electronics'], { lat: 40.4093, lng: 49.8671 });
    const vuqar = await this.soloProfile('vuqar', ['painting', 'wallpaper'], { lat: 40.3667, lng: 49.8352 });
    if (vuqar.profile.status === 'PENDING_REVIEW') await review.approveHandyman(adminId, vuqar.profile.id, { docNumberLast4: '7710' }, null);
    const v = await this.prisma.handymanProfile.findUniqueOrThrow({ where: { id: vuqar.profile.id } });
    if (v.status !== 'BLOCKED') await review.blockHandyman(adminId, v.id, this.i18n.t('az', 'server.demo.seedBlockReason'), null);

    // FixPro MMC: Rauf registers the company (manager), KYC, admin approval; Tural and Kamran join through invite links.
    const raufId = await this.user('rauf');
    let company = await this.prisma.company.findUnique({ where: { voen: FIXPRO.voen } });
    if (!company) {
      const tradeIds = await Promise.all(FIXPRO.trades.map((s) => this.categoryId(s)));
      await this.svc(ProService).onboardCompany(
        raufId,
        {
          firstName: SEED_PEOPLE.rauf.firstName,
          lastName: SEED_PEOPLE.rauf.lastName,
          company: {
            name: FIXPRO.name,
            legalForm: FIXPRO.legalForm,
            voen: FIXPRO.voen,
            isVatPayer: true,
            tradeIds,
            serviceRadiusKm: FIXPRO.serviceRadiusKm,
            base: SEED_PLACES.fixproBase,
            baseAddress: FIXPRO.baseAddress,
          },
        },
        'az',
      );
      company = await this.fixpro();
    }
    if (company.status === 'DRAFT') {
      await this.submitKyc(raufId, company.id);
      company = await this.fixpro();
    }
    if (company.status === 'PENDING_REVIEW') await review.approveCompany(adminId, company.id, null);
    await this.topUp(company.walletAccountId, 50_000, 'fixpro');
    for (const key of ['tural', 'kamran'] as const) {
      const userId = await this.user(key);
      const member = await this.prisma.companyMember.findFirst({ where: { userId, companyId: company.id, status: 'ACTIVE' } });
      if (member) continue;
      const invite = await this.svc(CompanyService).createInvite(raufId, company.id, { role: 'WORKER', maxUses: 1, expiresInDays: 1 });
      await this.svc(InvitesService).accept(userId, invite.token, {}, 'az');
    }
  }

  // ----------------------------------------------------------------- history

  private async online(key: SeedPersonKey, at: LatLng): Promise<void> {
    await this.svc(ProService).setOnline(await this.user(key), { online: true, location: at });
  }

  private async allOnline(): Promise<void> {
    await this.online('elvin', SEED_PLACES.elvinBase);
    await this.online('tural', SEED_PLACES.turalStart);
    await this.online('kamran', SEED_PLACES.kamranStart);
  }

  private async allOffline(): Promise<void> {
    for (const key of ['elvin', 'tural', 'kamran'] as const) {
      await this.svc(ProService).setOnline(await this.user(key), { online: false });
    }
  }

  private async advance(ms: number): Promise<void> {
    this.clock.advance(ms);
    await this.jobs.runDue();
  }

  private async request(
    customer: 'nizami' | 'aysel' | 'kontur',
    slug: string,
    place: Place,
    descriptionKey: string,
    timing: RequestTiming = 'NOW',
  ): Promise<string> {
    const userId = await this.user(customer);
    const formatted = [place.street, place.building, place.district].filter(Boolean).join(', ') || `${place.lat}, ${place.lng}`;
    const body = CreateRequestBodySchema.parse({
      categoryId: await this.categoryId(slug),
      description: this.i18n.t('az', `server.demo.seed.${descriptionKey}`),
      timing,
      slots: 1,
      address: {
        lat: place.lat,
        lng: place.lng,
        formatted,
        ...(place.street ? { street: place.street } : {}),
        ...(place.building ? { building: place.building } : {}),
        ...(place.district ? { district: place.district } : {}),
      },
    });
    const detail = await this.svc(RequestsService).create(userId, body, 'az');
    return detail.id;
  }

  /** Waits (moving the Clock through the dispatch rings) until `target` holds a SENT offer for the request. */
  private async offerFor(requestId: string, target: { handymanId: string } | { companyId: string }): Promise<string> {
    for (let i = 0; i < 60; i++) {
      const offer = await this.prisma.offer.findFirst({ where: { requestId, status: 'SENT', ...target }, select: { id: true } });
      if (offer) return offer.id;
      await this.allOnline();
      await this.advance(3_000);
    }
    throw new Error(`demo seed: no offer for ${JSON.stringify(target)} on request ${requestId}`);
  }

  private async passFreeWindow(): Promise<void> {
    const s = await this.settings.get();
    await this.advance((s.freeCancelSec + 5) * 1000);
  }

  /** Accepted -> en route -> arrived -> price proposed, by the doer (`doer` user id), with realistic pauses. */
  private async work(doerUserId: string, assignmentId: string, from: LatLng, price: { labor: number; materials: number }): Promise<void> {
    const actions = this.svc(ProviderActionsService);
    await actions.enRoute(doerUserId, assignmentId, from, 'az');
    await this.advance(7 * 60_000);
    await actions.arrived(doerUserId, assignmentId, 'az');
    await this.advance(45 * 60_000);
    await actions.enterPrice(doerUserId, assignmentId, price, 'az', null);
    await this.advance(2 * 60_000);
  }

  /** Plays the finished history two days back; returns the card-paid assignment (guarantee case target). */
  private async history(): Promise<string> {
    const offers = this.svc(OffersService);
    const customer = this.svc(CustomerActionsService);
    const provider = this.svc(ProviderActionsService);
    const requests = this.svc(RequestsService);
    const payments = this.svc(PaymentsService);
    const elvin = await this.profile('elvin');
    const company = await this.fixpro();
    const tural = await this.profile('tural');
    const ids = {
      nizami: await this.user('nizami'),
      aysel: await this.user('aysel'),
      elvin: await this.user('elvin'),
      tural: await this.user('tural'),
      rauf: await this.user('rauf'),
    };
    this.clock.set(new Date(Date.now() - 2 * 86_400_000));
    await this.allOnline();

    // 1. Completed, cash: Nizami's leaking tap, Elvin.
    const r1 = await this.request('nizami', 'plumbing', SEED_PLACES.nizamiHome, 'leakingTap');
    const a1 = (await offers.acceptSolo(ids.elvin, await this.offerFor(r1, { handymanId: elvin.id }), 'az')).assignment.id;
    await this.passFreeWindow();
    await this.work(ids.elvin, a1, SEED_PLACES.elvinBase, { labor: 4000, materials: 1500 });
    await customer.confirmPrice(ids.nizami, a1, { method: 'CASH' }, 'az');
    await customer.rate(ids.nizami, a1, { stars: 5, comment: this.i18n.t('az', 'server.demo.seed.ratingComment') });
    await provider.rateCustomer(ids.elvin, a1, { stars: 5 });
    await this.advance(3 * 3600_000);

    // 2. Completed, card (guarantee) + tip: Aysel's sockets, FixPro MMC / Tural.
    await this.allOnline();
    const r2 = await this.request('aysel', 'electrical', SEED_PLACES.ayselHome, 'sockets');
    const accepted = await offers.acceptCompany(ids.rauf, company.id, await this.offerFor(r2, { companyId: company.id }), [tural.id], 'az');
    const a2 = accepted.assignments[0]!.id;
    await this.passFreeWindow();
    await this.work(ids.tural, a2, SEED_PLACES.turalStart, { labor: 6000, materials: 2000 });
    const card = await customer.confirmPrice(ids.aysel, a2, { method: 'CARD' }, 'az');
    if (!card.payment) throw new Error('demo seed: card payment was not created');
    await payments.settle(card.payment.paymentIntentId, 'SUCCEEDED');
    const tip = await customer.tip(ids.aysel, a2, { amount: 500 });
    await payments.settle(tip.paymentIntentId, 'SUCCEEDED');
    await customer.rate(ids.aysel, a2, { stars: 5, comment: this.i18n.t('az', 'server.demo.seed.ratingComment') });
    await provider.rateCustomer(ids.rauf, a2, { stars: 5 });
    await this.advance(5 * 3600_000);

    // 3. Cancelled free (inside the 5-minute window): Nizami, Elvin.
    await this.allOnline();
    const r3 = await this.request('nizami', 'plumbing', SEED_PLACES.nizamiHome, 'toilet');
    await offers.acceptSolo(ids.elvin, await this.offerFor(r3, { handymanId: elvin.id }), 'az');
    await this.advance(60_000);
    await requests.cancel(ids.nizami, r3, this.i18n.t('az', 'server.demo.seed.cancelReason'), 'az');
    await this.advance(4 * 3600_000);

    // 4. Cancelled late with the penalty (after the window, Elvin already on the way): Aysel.
    await this.allOnline();
    const r4 = await this.request('aysel', 'heating', SEED_PLACES.ayselHome, 'boiler');
    const a4 = (await offers.acceptSolo(ids.elvin, await this.offerFor(r4, { handymanId: elvin.id }), 'az')).assignment.id;
    await this.passFreeWindow();
    await provider.enRoute(ids.elvin, a4, SEED_PLACES.elvinBase, 'az');
    await this.advance(3 * 60_000);
    await requests.cancel(ids.aysel, r4, this.i18n.t('az', 'server.demo.seed.cancelReason'), 'az');
    await this.advance(6 * 3600_000);

    // 5. Expired: nobody offers commercial refrigeration (Kontur MMC).
    await this.allOnline();
    const r5 = await this.request('kontur', 'commercial-refrigeration', SEED_PLACES.konturOffice, 'refrigeration');
    for (let i = 0; i < 200; i++) {
      const r = await this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: r5 }, select: { status: true } });
      if (r.status === 'EXPIRED') break;
      await this.advance(10_000);
    }
    await this.advance(30 * 60_000);
    await this.allOffline();
    // Back to the present: run whatever the restored Clock makes due (all idempotent no-ops for finished requests).
    this.clock.set(new Date(Date.now() + this.offset));
    await this.jobs.runDue();
    return a2;
  }

  // -------------------------------------------------------------- live state

  /** One job in progress now: Nizami's electrical request, FixPro MMC / Kamran en route. */
  private async inProgress(): Promise<string> {
    const company = await this.fixpro();
    const kamran = await this.profile('kamran');
    const kamranUser = await this.user('kamran');
    await this.online('kamran', SEED_PLACES.kamranStart);
    const r = await this.request('nizami', 'electrical', SEED_PLACES.nizamiHome, 'lights');
    const accepted = await this.svc(OffersService).acceptCompany(
      await this.user('rauf'),
      company.id,
      await this.offerFor(r, { companyId: company.id }),
      [kamran.id],
      'az',
    );
    const id = accepted.assignments[0]!.id;
    await this.svc(ProviderActionsService).enRoute(kamranUser, id, SEED_PLACES.kamranStart, 'az');
    return id;
  }

  /** Kontur MMC's B2B project (renovation crew) with quotes from FixPro MMC and Elvin. */
  private async project(): Promise<string> {
    const kontur = await this.user('kontur');
    const now = this.clock.now();
    const place = SEED_PLACES.konturOffice;
    const p = await this.svc(ProjectsService).create(
      kontur,
      {
        categoryId: await this.categoryId('renovation-crew'),
        title: this.i18n.t('az', 'server.demo.seed.projectTitle'),
        scope: this.i18n.t('az', 'server.demo.seed.projectScope'),
        dateFrom: bakuDayKey(now.getTime() + 2 * 86_400_000),
        dateTo: bakuDayKey(now.getTime() + 8 * 86_400_000),
        workersNeeded: 3,
        description: this.i18n.t('az', 'server.demo.seed.projectDescription'),
        photoFileIds: [],
        address: { lat: place.lat, lng: place.lng, formatted: `${place.street} ${place.building}, ${place.district}`, street: place.street, building: place.building, district: place.district },
      },
      'az',
    );
    const company = await this.fixpro();
    const quotes = this.svc(ProviderProjectsService);
    await quotes.submitQuote(await this.user('rauf'), p.id, {
      companyId: company.id,
      totalAmount: 450_000,
      workers: 3,
      days: 5,
      note: this.i18n.t('az', 'server.demo.seed.quoteFixpro'),
    });
    await quotes.submitQuote(await this.user('elvin'), p.id, {
      totalAmount: 380_000,
      workers: 1,
      days: 4,
      note: this.i18n.t('az', 'server.demo.seed.quoteElvin'),
    });
    return p.id;
  }

  /** Aysel opens a guarantee claim on the card-paid job (an OPEN case for the admin panel). */
  private async guaranteeCase(cardAssignmentId: string | undefined): Promise<string> {
    const aysel = await this.user('aysel');
    let assignmentId = cardAssignmentId;
    if (!assignmentId) {
      const a = await this.prisma.assignment.findFirst({
        where: { paymentMethod: 'CARD', status: 'COMPLETED', request: { customerAccount: { ownerUserId: aysel } } },
        orderBy: { completedAt: 'desc' },
      });
      if (!a) throw new Error('demo seed: no card-paid job for the guarantee case');
      assignmentId = a.id;
    }
    const open = await this.prisma.case.findFirst({ where: { assignmentId, type: 'GUARANTEE', status: { in: ['OPEN', 'IN_REVIEW'] } } });
    if (open) return open.id;
    const photo = await this.placeholder(aysel, 'CASE_PHOTO', 'guarantee');
    const c = await this.svc(CasesService).guaranteeClaim(aysel, assignmentId, {
      description: this.i18n.t('az', 'server.demo.seed.guaranteeClaim'),
      photoFileIds: [photo],
    });
    return c.id;
  }

  /** Final wallets the demo needs: Elvin 34 AZN and FixPro MMC 240 AZN available (admin adjustments, once); pros offline. */
  private async balances(): Promise<void> {
    // Seeded pros start offline: they go online from the pro app (the dispatch waits for a real device).
    await this.allOffline();
    const adminId = await this.adminId();
    const elvin = await this.profile('elvin');
    const company = await this.fixpro();
    const targets: Array<[string, number]> = [
      [elvin.walletAccountId!, FINAL_BALANCES.elvin],
      [company.walletAccountId, FINAL_BALANCES.fixpro],
    ];
    const adjustments = await this.ledger.platformAccountId('ADJUSTMENTS');
    for (const [accountId, target] of targets) {
      const bal = await this.ledger.balance(accountId);
      const diff = target - bal.available;
      if (diff === 0) continue;
      await this.ledger.post({
        kind: 'ADMIN_ADJUSTMENT',
        idempotencyKey: `demo-seed:final-balance:${accountId}`,
        entries: [
          { accountId: adjustments, amount: -diff },
          { accountId, amount: diff },
        ],
        memo: 'demo seed balance',
        actor: { type: 'ADMIN', id: adminId },
        metadata: { demo: true },
      });
    }
  }
}
