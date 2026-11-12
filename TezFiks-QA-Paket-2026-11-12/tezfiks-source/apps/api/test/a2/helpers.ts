import { expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import type { TestApp } from '../helpers/app';
import { BAKU, categoryId, type CreatedCustomer } from '../helpers/factories';

/** The checkout URL points at PUBLIC_BASE_URL; tests talk to the random-port test server instead. */
export function localUrl(t: TestApp, publicUrl: string): string {
  const u = new URL(publicUrl);
  return `${t.origin}${u.pathname}${u.search}`;
}

export function tokenOf(checkoutUrl: string): string {
  return new URL(checkoutUrl).searchParams.get('t') ?? '';
}

/** GET the hosted checkout page. */
export async function openCheckout(t: TestApp, checkoutUrl: string, locale = 'az'): Promise<Response> {
  return fetch(localUrl(t, checkoutUrl), { headers: { 'Accept-Language': locale } });
}

/** POST the checkout form like a browser (urlencoded), without following redirects. */
export async function submitCheckout(
  t: TestApp,
  checkoutUrl: string,
  form: { card?: string; action?: 'pay' | 'cancel'; t?: string },
  locale = 'az',
): Promise<Response> {
  const u = new URL(checkoutUrl);
  const body = new URLSearchParams({
    t: form.t ?? tokenOf(checkoutUrl),
    card: form.card ?? '',
    exp: '12/30',
    cvc: '123',
    name: 'Nizami Talıbov',
    action: form.action ?? 'pay',
  });
  return fetch(`${t.origin}${u.pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': locale },
    body: body.toString(),
    redirect: 'manual',
  });
}

/** Opens the page (must show the form), then pays with the given card. */
export async function payWithCard(t: TestApp, checkoutUrl: string, card: string): Promise<Response> {
  const page = await openCheckout(t, checkoutUrl);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('name="card"');
  return submitCheckout(t, checkoutUrl, { card });
}

export async function expectLedgerClean(t: TestApp): Promise<void> {
  expect(await t.ledger.globalSum()).toBe(0);
  expect(await t.ledger.verifyIntegrity()).toEqual([]);
}

/** Inserts a service request (and its slot) for ledger references and assignment fixtures. */
export async function createRequestRow(t: TestApp, customer: CreatedCustomer, slug = 'plumbing') {
  const catId = await categoryId(t, slug);
  const { lat, lng } = BAKU.center;
  const req = await t.prisma.serviceRequest.create({
    data: {
      customerAccountId: customer.accountId,
      createdByUserId: customer.userId,
      categoryId: catId,
      vertical: 'HOME',
      description: 'Mətbəxdə kran axır',
      timing: 'NOW',
      lat,
      lng,
      cell7: latLngToCell(lat, lng, 7),
      cell9: latLngToCell(lat, lng, 9),
      formatted: 'Nizami küçəsi 10, Bakı',
      status: 'COMPLETED',
      isSearching: false,
    },
  });
  const slot = await t.prisma.requestSlot.create({ data: { requestId: req.id, index: 0, status: 'DONE' } });
  return { request: req, slot };
}

/** A COMPLETED assignment for earnings statistics. */
export async function createCompletedAssignment(
  t: TestApp,
  data: {
    customer: CreatedCustomer;
    handymanId: string;
    acceptedByUserId: string;
    companyId?: string | null;
    paymentMethod: 'CARD' | 'CASH';
    total: number;
    completedAt: Date;
    tip?: number | null;
  },
) {
  const { request, slot } = await createRequestRow(t, data.customer);
  const acceptedAt = new Date(data.completedAt.getTime() - 3600_000);
  return t.prisma.assignment.create({
    data: {
      requestId: request.id,
      slotId: slot.id,
      providerType: data.companyId ? 'COMPANY' : 'SOLO',
      handymanId: data.handymanId,
      companyId: data.companyId ?? null,
      acceptedByUserId: data.acceptedByUserId,
      status: 'COMPLETED',
      acceptedAt,
      freeCancelUntil: new Date(acceptedAt.getTime() + 300_000),
      completedAt: data.completedAt,
      endedAt: data.completedAt,
      feeAmount: 1000n,
      feeCaptured: true,
      laborAmount: BigInt(data.total),
      materialsAmount: 0n,
      totalAmount: BigInt(data.total),
      paymentMethod: data.paymentMethod,
      tipAmount: data.tip != null ? BigInt(data.tip) : null,
    },
  });
}
