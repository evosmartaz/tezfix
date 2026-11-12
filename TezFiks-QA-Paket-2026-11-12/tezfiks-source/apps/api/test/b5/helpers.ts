import { expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import type { TestApp } from '../helpers/app';
import { BAKU, categoryId, type CreatedCustomer } from '../helpers/factories';

export {
  admin,
  advance,
  assignmentRow,
  bal,
  companyJob,
  createRequest,
  expectDomainRejections,
  expectLedgerSound,
  goOnline,
  placeAt,
  platform,
  setSettings,
  soloJob,
  toArrived,
  toPriceProposed,
} from '../b3/helpers';

/** Audit rows of one entity, oldest first. */
export async function auditOf(t: TestApp, entityType: string, entityId: string) {
  return t.prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
}

/** Admin events recorded for the admins room. */
export function adminEvents(t: TestApp) {
  return t.realtime.sentTo('admins', 'admin:event').map((e) => e.payload as { type: string; entityId: string | null });
}

/**
 * Inserts a request row directly (KPI seeding: arbitrary creation times and statuses without running dispatch).
 * No ledger rows are written, so ledger invariants are unaffected.
 */
export async function seedRequest(
  t: TestApp,
  c: CreatedCustomer,
  data: {
    createdAt: Date;
    status?: 'SEARCHING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
    isDemo?: boolean;
    slug?: string;
    description?: string;
  },
): Promise<{ id: string; number: number }> {
  const loc = BAKU.center;
  const r = await t.prisma.serviceRequest.create({
    data: {
      customerAccountId: c.accountId,
      createdByUserId: c.userId,
      categoryId: await categoryId(t, data.slug ?? 'plumbing'),
      vertical: 'HOME',
      description: data.description ?? 'Kran axır',
      timing: 'NOW',
      lat: loc.lat,
      lng: loc.lng,
      cell7: latLngToCell(loc.lat, loc.lng, 7),
      cell9: latLngToCell(loc.lat, loc.lng, 9),
      formatted: 'Nizami küçəsi 10, Bakı',
      status: data.status ?? 'COMPLETED',
      isSearching: data.status === 'SEARCHING',
      isDemo: data.isDemo ?? false,
      cancelledAt: data.status === 'CANCELLED' ? data.createdAt : null,
      cancelledBy: data.status === 'CANCELLED' ? 'CUSTOMER' : null,
      createdAt: data.createdAt,
      slots: { create: [{ index: 0, status: data.status === 'COMPLETED' ? 'DONE' : data.status === 'CANCELLED' ? 'CANCELLED' : 'OPEN' }] },
    },
    include: { slots: true },
  });
  return { id: r.id, number: r.number };
}

/** Inserts an assignment row for a seeded request (fee flags only; no ledger rows). */
export async function seedAssignment(
  t: TestApp,
  requestId: string,
  data: {
    handymanId: string;
    userId: string;
    acceptedAt: Date;
    status?: 'ACCEPTED' | 'COMPLETED' | 'CANCELLED_FREE';
    feeAmount?: number;
    feeCaptured?: boolean;
    feeRefunded?: boolean;
  },
) {
  const slot = await t.prisma.requestSlot.findFirstOrThrow({ where: { requestId } });
  const a = await t.prisma.assignment.create({
    data: {
      requestId,
      slotId: slot.id,
      providerType: 'SOLO',
      handymanId: data.handymanId,
      acceptedByUserId: data.userId,
      status: data.status ?? 'COMPLETED',
      acceptedAt: data.acceptedAt,
      freeCancelUntil: new Date(data.acceptedAt.getTime() + 300_000),
      completedAt: (data.status ?? 'COMPLETED') === 'COMPLETED' ? new Date(data.acceptedAt.getTime() + 3_600_000) : null,
      feeAmount: BigInt(data.feeAmount ?? 1000),
      feeCaptured: data.feeCaptured ?? true,
      feeRefunded: data.feeRefunded ?? false,
    },
  });
  await t.prisma.requestSlot.update({ where: { id: slot.id }, data: { currentAssignmentId: a.id } });
  return a;
}

/** Every value of an object tree serialized, for "the phone never appears" checks. */
export function serialized(v: unknown): string {
  return JSON.stringify(v);
}

export function expectNoPhone(payload: unknown, phone: string): void {
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('994') ? digits.slice(3) : digits;
  const flat = serialized(payload).replace(/[\s-]/g, '');
  expect(flat).not.toContain(phone);
  expect(flat).not.toContain(local);
}
