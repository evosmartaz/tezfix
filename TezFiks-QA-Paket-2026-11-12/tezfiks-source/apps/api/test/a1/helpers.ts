import sharp from 'sharp';
import { latLngToCell } from 'h3-js';
import { api, type FileKind, type FileRef } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';
import { BAKU, categoryId, type CreatedCustomer, type CreatedHandyman } from '../helpers/factories';

/** Valid, distinct Azerbaijani mobile numbers: +99450555xxxx. */
export function azPhone(i: number): string {
  return `+99450555${String(i % 10_000).padStart(4, '0')}`;
}

/** A solid-colour PNG generated with sharp. */
export function pngBuffer(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 169, b: 113 } } })
    .png()
    .toBuffer();
}

/** Multipart upload through the typed client. */
export async function upload(
  t: TestApp,
  token: string,
  kind: FileKind,
  data?: { buffer?: Buffer; type?: string; name?: string },
): Promise<FileRef> {
  const buffer = data?.buffer ?? (await pngBuffer());
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([new Uint8Array(buffer)], { type: data?.type ?? 'image/png' }), data?.name ?? 'photo.png');
  return t.client(token).call(api.files.upload, { formData: fd });
}

/** Rewrites a signed FileRef URL (built on PUBLIC_API_URL) to the test server. */
export function localUrl(t: TestApp, url: string): string {
  const u = new URL(url);
  return `${t.origin}${u.pathname}${u.search}`;
}

/** Full OTP login through HTTP (console channel with OTP_DEV_ECHO=true in tests). */
export async function otpLogin(
  t: TestApp,
  phone: string,
  app: 'CUSTOMER' | 'PRO' | 'PANEL' = 'CUSTOMER',
  headers?: Record<string, string>,
) {
  const req = await t.client().call(api.auth.otpRequest, { body: { phone, app }, headers });
  return t.client().call(api.auth.otpVerify, {
    body: { challengeId: req.challengeId, code: req.devCode!, deviceId: 'device-a1-0001', app },
    headers,
  });
}

/** A request with one slot and an assignment in `status` between the customer and the handyman. */
export async function createAssignment(
  t: TestApp,
  customer: CreatedCustomer,
  handyman: CreatedHandyman,
  status: 'ACCEPTED' | 'EN_ROUTE' | 'ARRIVED' | 'PRICE_PROPOSED' | 'PRICE_DISPUTED' | 'COMPLETED',
): Promise<{ requestId: string; assignmentId: string }> {
  const now = t.clock.now();
  const done = status === 'COMPLETED';
  const request = await t.prisma.serviceRequest.create({
    data: {
      customerAccountId: customer.accountId,
      createdByUserId: customer.userId,
      categoryId: await categoryId(t, 'plumbing'),
      vertical: 'HOME',
      description: 'Mətbəxdə kran axır',
      timing: 'NOW',
      lat: BAKU.center.lat,
      lng: BAKU.center.lng,
      cell7: latLngToCell(BAKU.center.lat, BAKU.center.lng, 7),
      cell9: latLngToCell(BAKU.center.lat, BAKU.center.lng, 9),
      formatted: 'Nizami küçəsi 10, Bakı',
      status: done ? 'COMPLETED' : 'ASSIGNED',
      isSearching: false,
    },
  });
  const slot = await t.prisma.requestSlot.create({ data: { requestId: request.id, index: 0, status: done ? 'DONE' : 'FILLED' } });
  const assignment = await t.prisma.assignment.create({
    data: {
      requestId: request.id,
      slotId: slot.id,
      providerType: 'SOLO',
      handymanId: handyman.handymanId,
      acceptedByUserId: handyman.userId,
      status,
      acceptedAt: now,
      freeCancelUntil: new Date(now.getTime() + 300_000),
      completedAt: done ? now : null,
      endedAt: done ? now : null,
    },
  });
  return { requestId: request.id, assignmentId: assignment.id };
}
