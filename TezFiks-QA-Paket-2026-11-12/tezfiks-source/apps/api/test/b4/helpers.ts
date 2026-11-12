import { expect } from 'vitest';
import sharp from 'sharp';
import { api, bakuDayKey, type AddressInput, type CreateProjectBodySchema, type FileKind, type FileRef, type LatLng } from '@tezfiks/shared';
import type { z } from 'zod';
import type { TestApp } from '../helpers/app';
import { BAKU, categoryId, createCompany, createSoloHandyman, tokenFor, type CreatedCustomer } from '../helpers/factories';

export type CreateProjectBody = z.input<typeof CreateProjectBodySchema>;

export const TRADE = 'renovation-crew';

/** Baku calendar day `offset` days from the test Clock's today ("2026-10-26"). */
export function day(t: TestApp, offset = 0): string {
  return bakuDayKey(new Date(t.clock.nowMs() + offset * 24 * 60 * 60_000));
}

/** Site address with flat details (they must only reach the awarded provider). */
export function siteAddress(loc: LatLng = BAKU.center, extra: Partial<AddressInput> = {}): AddressInput {
  return {
    lat: loc.lat,
    lng: loc.lng,
    formatted: 'Nizami küçəsi 10, mənzil 45, Bakı',
    district: 'Səbail rayonu',
    street: 'Nizami küçəsi',
    building: '10',
    entrance: '2-ci giriş',
    floor: '3',
    apartment: 'ofis 45',
    intercom: 'domofon 45#',
    note: 'Mühafizəyə zəng edin',
    ...extra,
  };
}

export async function projectBody(t: TestApp, overrides: Partial<CreateProjectBody> & { slug?: string; at?: LatLng } = {}): Promise<CreateProjectBody> {
  const { slug, at, ...rest } = overrides;
  return {
    categoryId: await categoryId(t, slug ?? TRADE),
    title: 'Ofisin təmiri',
    scope: '≈ 450 m² (3 mərtəbə, 12 otaq)',
    dateFrom: day(t, 1),
    dateTo: day(t, 3),
    workersNeeded: 4,
    description: 'Ofisin divarlarının rənglənməsi, döşəmənin dəyişdirilməsi və işıqlandırma.',
    address: siteAddress(at ?? BAKU.center),
    ...rest,
  };
}

/** Creates a project through the API. */
export async function createProject(t: TestApp, customer: CreatedCustomer, overrides: Partial<CreateProjectBody> & { slug?: string; at?: LatLng } = {}) {
  return t.client(customer.token).call(api.projects.create, { body: await projectBody(t, overrides) });
}

/** Approved solo handyman with the renovation trade at the centre and a funded wallet. */
export function solo(t: TestApp, data: Parameters<typeof createSoloHandyman>[1] = {}) {
  return createSoloHandyman(t, { trades: [TRADE], balance: 100_000, ...data });
}

/** Approved provider company with the renovation trade at the centre and a funded wallet. */
export async function company(t: TestApp, data: Parameters<typeof createCompany>[1] & { vatPayer?: boolean } = {}) {
  const { vatPayer, ...rest } = data;
  const c = await createCompany(t, { trades: [TRADE], balance: 100_000, workers: 1, ...rest });
  if (vatPayer) await t.prisma.company.update({ where: { id: c.companyId }, data: { isVatPayer: true } });
  return c;
}

export async function quote(
  t: TestApp,
  token: string,
  projectId: string,
  body: { totalAmount?: number; workers?: number; days?: number; note?: string; companyId?: string } = {},
  idempotencyKey?: string,
) {
  return t.client(token).call(api.providerProjects.submitQuote, {
    params: { id: projectId },
    body: { totalAmount: 500_000, workers: 4, days: 3, ...body },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

export async function balanceOf(t: TestApp, accountId: string) {
  return t.ledger.balance(accountId);
}

export async function revenue(t: TestApp): Promise<number> {
  return (await t.ledger.balance(await t.ledger.platformAccountId('REVENUE'))).posted;
}

/** Ledger invariants (Review Focus 5): global sum 0 and cached balances equal the entries. */
export async function expectLedgerSound(t: TestApp): Promise<void> {
  expect(await t.ledger.globalSum()).toBe(0);
  expect(await t.ledger.verifyIntegrity()).toEqual([]);
}

export async function notificationsOf(t: TestApp, userId: string, type?: string) {
  return t.prisma.notification.findMany({ where: { userId, ...(type ? { type: type as never } : {}) }, orderBy: { createdAt: 'asc' } });
}

/** Raw GET (no client-side schema stripping), to check that hidden fields are really absent from the JSON. */
export async function rawGet(t: TestApp, token: string, path: string): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(`${t.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

/** Moves the Clock and runs every due job. */
export async function advance(t: TestApp, ms: number): Promise<number> {
  t.clock.advance(ms);
  return t.jobs.runDue();
}

export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;

/** Uploads a small PNG through the files API. */
export async function upload(t: TestApp, token: string, kind: FileKind): Promise<FileRef> {
  const buffer = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 0, g: 169, b: 113 } } })
    .png()
    .toBuffer();
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'photo.png');
  return t.client(token).call(api.files.upload, { formData: fd });
}

/** Fresh access token after the Clock moved past the 15 min access TTL. */
export async function relogin<T extends { userId: string; token: string }>(t: TestApp, who: T, app: 'CUSTOMER' | 'PRO'): Promise<T> {
  who.token = await tokenFor(t, who.userId, app);
  return who;
}
