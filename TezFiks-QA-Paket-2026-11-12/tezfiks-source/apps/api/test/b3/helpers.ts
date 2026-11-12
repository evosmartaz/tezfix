import { expect } from 'vitest';
import { api, pointAlong, type LatLng, type PlatformSettings } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';
import {
  BAKU,
  adminToken,
  createCompany,
  createCustomer,
  createSoloHandyman,
  type CreatedCompany,
  type CreatedCustomer,
  type CreatedHandyman,
} from '../helpers/factories';
import { addDevice, createRequest, goOnline, pushLog } from '../b1/helpers';
import { CompletionService } from '../../src/modules/assignments/completion.service';
import { ProviderBlockService } from '../../src/modules/assignments/provider-block.service';
import { TrackingService } from '../../src/modules/assignments/tracking.service';
import { GeoService } from '../../src/modules/geo/geo.service';
import { PresenceService } from '../../src/modules/realtime/presence.service';

export { addDevice, createRequest, goOnline, pushLog };

export const OK_CARD = '4242 4242 4242 4242';
export const DECLINED_CARD = '4000 0000 0000 0002';

export const completion = (t: TestApp) => t.app.get(CompletionService);
export const tracking = (t: TestApp) => t.app.get(TrackingService);
export const blocks = (t: TestApp) => t.app.get(ProviderBlockService);
export const geo = (t: TestApp) => t.app.get(GeoService);
export const presence = (t: TestApp) => t.app.get(PresenceService);

export async function setSettings(t: TestApp, patch: Partial<PlatformSettings>): Promise<void> {
  await t.settings.update(patch, null);
}

/** Moves the Clock and runs every due job. */
export async function advance(t: TestApp, ms: number): Promise<number> {
  t.clock.advance(ms);
  return t.jobs.runDue();
}

export async function expectLedgerSound(t: TestApp): Promise<void> {
  expect(await t.ledger.globalSum()).toBe(0);
  expect(await t.ledger.verifyIntegrity()).toEqual([]);
}

export async function bal(t: TestApp, accountId: string) {
  return t.ledger.balance(accountId);
}

export async function platform(t: TestApp, kind: 'REVENUE' | 'PROMO' | 'EXTERNAL'): Promise<number> {
  return (await t.ledger.balance(await t.ledger.platformAccountId(kind))).posted;
}

// ------------------------------------------------------------------ checkout

/** The checkout URL points at PUBLIC_BASE_URL; tests talk to the random-port test server instead. */
export function localUrl(t: TestApp, publicUrl: string): string {
  const u = new URL(publicUrl);
  return `${t.origin}${u.pathname}${u.search}`;
}

/** Opens the hosted test checkout page and pays with `card` like a browser (urlencoded form, no redirect following). */
export async function payWithCard(t: TestApp, checkoutUrl: string, card = OK_CARD): Promise<Response> {
  const page = await fetch(localUrl(t, checkoutUrl), { headers: { 'Accept-Language': 'az' } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('name="card"');
  const u = new URL(checkoutUrl);
  const body = new URLSearchParams({
    t: u.searchParams.get('t') ?? '',
    card,
    exp: '12/30',
    cvc: '123',
    name: 'Nizami Talıbov',
    action: 'pay',
  });
  return fetch(`${t.origin}${u.pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'az' },
    body: body.toString(),
    redirect: 'manual',
  });
}

// ------------------------------------------------------------------ fixtures

export interface SoloJob {
  c: CreatedCustomer;
  h: CreatedHandyman;
  requestId: string;
  requestNumber: number;
  assignmentId: string;
}

/** A customer, an online solo pro at `at`, a NOW request at the centre and the accepted assignment. */
export async function soloJob(
  t: TestApp,
  opts: { customerBalance?: number; proBalance?: number; emergency?: boolean; at?: LatLng; slug?: string } = {},
): Promise<SoloJob> {
  const c = await createCustomer(t, { balance: opts.customerBalance ?? 0 });
  const h = await createSoloHandyman(t, { balance: opts.proBalance ?? 2000, trades: [opts.slug ?? 'plumbing'] });
  await goOnline(t, h.handymanId, opts.at ?? BAKU.center);
  const req = await createRequest(t, c, { ...(opts.emergency ? { timing: 'EMERGENCY' as const } : {}), slug: opts.slug ?? 'plumbing' });
  const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: h.handymanId } });
  const res = await t.client(h.token).call(api.pro.acceptOffer, { params: { id: offer.id } });
  return { c, h, requestId: req.id, requestNumber: req.number, assignmentId: res.assignment.id };
}

/**
 * Puts the pro's server-side position (presence, fresh at the current Clock time) at `loc`, as the app's location stream
 * would, without running the tracking handlers. Outside the demo "Yola çıxdım" routes from this position and "arrived"
 * needs it near the address.
 */
export async function placeAt(t: TestApp, handymanId: string, loc: LatLng): Promise<void> {
  const st = await presence(t).setOnline(handymanId, loc);
  if (!st) throw new Error(`could not place ${handymanId}`);
}

/** Drives a job to ARRIVED: the pro is at `from` and goes en route, then reaches the address and marks arrived. */
export async function toArrived(t: TestApp, job: Pick<SoloJob, 'h' | 'assignmentId' | 'requestId'>, from: LatLng = BAKU.narimanov): Promise<void> {
  await placeAt(t, job.h.handymanId, from);
  await t.client(job.h.token).call(api.pro.enRoute, { params: { id: job.assignmentId }, body: { location: from } });
  const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: job.requestId }, select: { lat: true, lng: true } });
  await placeAt(t, job.h.handymanId, { lat: r.lat, lng: r.lng });
  await t.client(job.h.token).call(api.pro.arrived, { params: { id: job.assignmentId } });
}

/** Drives a solo job to PRICE_PROPOSED with the given labour + materials. */
export async function toPriceProposed(t: TestApp, job: SoloJob, labor = 4000, materials = 1000): Promise<void> {
  await toArrived(t, job);
  await t.client(job.h.token).call(api.pro.enterPrice, { params: { id: job.assignmentId }, body: { labor, materials } });
}

export interface CompanyJob {
  c: CreatedCustomer;
  co: CreatedCompany;
  requestId: string;
  requestNumber: number;
  assignmentId: string;
  worker: CreatedCompany['workers'][number];
}

/** A company with online workers, a NOW request and a manager-accepted assignment for worker 0. */
export async function companyJob(
  t: TestApp,
  opts: { finalPriceEntry?: 'WORKER' | 'MANAGER'; workers?: number; balance?: number; customerBalance?: number } = {},
): Promise<CompanyJob> {
  const c = await createCustomer(t, { balance: opts.customerBalance ?? 0 });
  const co = await createCompany(t, {
    trades: ['plumbing'],
    workers: opts.workers ?? 2,
    balance: opts.balance ?? 5000,
    finalPriceEntry: opts.finalPriceEntry ?? 'WORKER',
  });
  for (const w of co.workers) await goOnline(t, w.handymanId, BAKU.center);
  const req = await createRequest(t, c, { slug: 'plumbing' });
  const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, companyId: co.companyId } });
  const worker = co.workers[0]!;
  const res = await t.client(co.manager.token).call(api.company.acceptOffer, {
    params: { companyId: co.companyId, offerId: offer.id },
    body: { workerIds: [worker.handymanId] },
  });
  return { c, co, requestId: req.id, requestNumber: req.number, assignmentId: res.assignments[0]!.id, worker };
}

export async function admin(t: TestApp) {
  return adminToken(t);
}

/** A point at `fraction` of the straight line from `a` to `b`. */
export function along(a: LatLng, b: LatLng, fraction: number): LatLng {
  return pointAlong([a, b], fraction);
}

export async function assignmentRow(t: TestApp, id: string) {
  return t.prisma.assignment.findUniqueOrThrow({ where: { id } });
}

/** Every rejected result must be a domain error from `allowed`, never a 500. */
export function expectDomainRejections(results: PromiseSettledResult<unknown>[], allowed: string[]): void {
  for (const r of results) {
    if (r.status === 'rejected') {
      const reason = r.reason as { code?: string; status?: number; message?: string };
      expect(reason.status, `unexpected failure: ${reason.code} ${reason.message}`).not.toBe(500);
      expect(allowed).toContain(reason.code);
    }
  }
}
