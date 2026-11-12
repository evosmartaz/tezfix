import sharp from 'sharp';
import { cellToLatLng, gridRing, latLngToCell } from 'h3-js';
import { api, type AddressInput, type CreateRequestBody, type FileKind, type FileRef, type LatLng, type PlatformSettings } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';
import { BAKU, categoryId, type CreatedCustomer } from '../helpers/factories';
import { PresenceService } from '../../src/modules/realtime/presence.service';
import { CancellationService } from '../../src/modules/requests/cancellation.service';
import { DispatchService } from '../../src/modules/requests/dispatch/dispatch.service';
import { FeesService } from '../../src/modules/requests/fees.service';
import { RequestViews } from '../../src/modules/requests/views/request-views.service';
import { LogPushSender } from '../../src/modules/notifications/push/log.sender';

export const presence = (t: TestApp) => t.app.get(PresenceService);
export const cancellations = (t: TestApp) => t.app.get(CancellationService);
export const dispatch = (t: TestApp) => t.app.get(DispatchService);
export const fees = (t: TestApp) => t.app.get(FeesService);
export const views = (t: TestApp) => t.app.get(RequestViews);
export const pushLog = (t: TestApp) => t.app.get(LogPushSender);

/** Puts a handyman online in the presence store at `loc` (fresh at the current Clock time). */
export async function goOnline(t: TestApp, handymanId: string, loc: LatLng = BAKU.center): Promise<void> {
  await t.prisma.handymanProfile.update({ where: { id: handymanId }, data: { isOnline: true, onlineSince: t.clock.now() } });
  const st = await presence(t).setOnline(handymanId, loc);
  if (!st?.online) throw new Error(`could not put ${handymanId} online`);
}

/** Refreshes presence of the given handymen at their current location (after moving the Clock). */
export async function touch(t: TestApp, ...handymanIds: string[]): Promise<void> {
  for (const id of handymanIds) await presence(t).touch(id);
}

/** Centre of some res-7 cell exactly `k` rings away from the cell of `center`. */
export function pointInRing(center: LatLng, k: number, index = 0): LatLng {
  const c = latLngToCell(center.lat, center.lng, 7);
  const cell = k === 0 ? c : gridRing(c, k)[index]!;
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

/** Request address with flat details (they must never reach offers). */
export function addressAt(loc: LatLng = BAKU.center, extra: Partial<AddressInput> = {}): AddressInput {
  return {
    lat: loc.lat,
    lng: loc.lng,
    formatted: 'Nizami küçəsi 10, Bakı',
    district: 'Səbail rayonu',
    street: 'Nizami küçəsi',
    building: '10',
    entrance: '2-ci giriş',
    floor: '7',
    apartment: 'mənzil 45',
    intercom: 'domofon 45#',
    note: 'Qapını döymək lazımdır',
    ...extra,
  };
}

export async function requestBody(t: TestApp, overrides: Partial<CreateRequestBody> & { slug?: string; at?: LatLng } = {}): Promise<CreateRequestBody> {
  const { slug, at, ...rest } = overrides;
  return {
    categoryId: await categoryId(t, slug ?? 'plumbing'),
    description: 'Mətbəxdə kran axır, təcili baxmaq lazımdır',
    timing: 'NOW',
    address: addressAt(at ?? BAKU.center),
    ...rest,
  };
}

/** Creates a request through the API. */
export async function createRequest(t: TestApp, customer: CreatedCustomer, overrides: Partial<CreateRequestBody> & { slug?: string; at?: LatLng } = {}) {
  return t.client(customer.token).call(api.requests.create, { body: await requestBody(t, overrides) });
}

/** Settings that make ring tests deterministic (no fast-forward unless asked). */
export async function setSettings(t: TestApp, patch: Partial<PlatformSettings>): Promise<void> {
  await t.settings.update(patch, null);
}

/** Moves the Clock and runs every due job. */
export async function advance(t: TestApp, ms: number): Promise<number> {
  t.clock.advance(ms);
  return t.jobs.runDue();
}

export async function balanceOf(t: TestApp, accountId: string) {
  return t.ledger.balance(accountId);
}

export async function expectLedgerSound(t: TestApp): Promise<void> {
  const sum = await t.ledger.globalSum();
  const bad = await t.ledger.verifyIntegrity();
  if (sum !== 0 || bad.length) throw new Error(`ledger unsound: sum=${sum} mismatches=${JSON.stringify(bad)}`);
}

export async function offersOf(t: TestApp, requestId: string) {
  return t.prisma.offer.findMany({ where: { requestId }, orderBy: { sentAt: 'asc' } });
}

export function pngBuffer(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 169, b: 113 } } })
    .png()
    .toBuffer();
}

export async function upload(t: TestApp, token: string, kind: FileKind = 'REQUEST_PHOTO'): Promise<FileRef> {
  const buffer = await pngBuffer();
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'photo.png');
  return t.client(token).call(api.files.upload, { formData: fd });
}

/** Registers a push device so pushes to this user are recorded by the log sender. */
export async function addDevice(t: TestApp, userId: string, app: 'CUSTOMER' | 'PRO' = 'PRO'): Promise<void> {
  await t.prisma.device.create({
    data: { userId, deviceId: `dev-${userId.slice(0, 8)}-${app}`, app, platform: 'android', pushToken: `ExponentPushToken[${userId.slice(0, 12)}]`, pushProvider: 'EXPO' },
  });
}

/** The single assignment of a request (throws when there is not exactly one). */
export async function onlyAssignment(t: TestApp, requestId: string) {
  const rows = await t.prisma.assignment.findMany({ where: { requestId } });
  if (rows.length !== 1) throw new Error(`expected one assignment, got ${rows.length}`);
  return rows[0]!;
}
