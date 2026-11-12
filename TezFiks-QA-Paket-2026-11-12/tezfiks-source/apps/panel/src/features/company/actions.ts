'use server';

/**
 * Server Actions of the company panel (BFF, lane P2). Every action checks that the session user is a MANAGER of the
 * company (404 otherwise), validates its input with the contract schema, calls the API server-to-server with the
 * session token (never exposed to the browser) and returns a serializable ActionResult. Mutations revalidate the
 * affected company pages.
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { api, ApiError, PageQuery, type ApiClient } from '@tezfiks/shared';
import { isNavigationError, toActionError, type ActionResult } from '@/lib/errors';
import { getRequestLocale, requireManager } from '@/lib/session/server';
import { topupReturnUrl } from './mappers';

const IdSchema = z.uuid();
const KeySchema = z.string().min(8).max(200);

type Fail = Extract<ActionResult, { ok: false }>;

async function invalid(details?: unknown): Promise<Fail> {
  const locale = await getRequestLocale();
  const t = await getTranslations({ locale, namespace: 'common' });
  return { ok: false, code: 'VALIDATION_FAILED', message: t('errors.VALIDATION_FAILED'), details };
}

async function check<S extends z.ZodType>(
  schema: S,
  input: unknown,
): Promise<{ ok: true; value: z.output<S> } | { ok: false; error: Fail }> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: await invalid(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))),
  };
}

function pagesOf(companyId: string, sections: string[]): string[] {
  const base = `/company/${companyId}`;
  return sections.map((s) => (s ? `${base}/${s}` : base));
}

/**
 * Runs `fn` for a validated company id with the manager's API client. A revoked session goes to the login; other
 * failures become `{ ok: false, code, message }` (message localized by the API or the panel).
 */
async function run<T>(
  companyId: unknown,
  fn: (client: ApiClient, companyId: string) => Promise<T>,
  sections: string[] = [],
): Promise<ActionResult<T>> {
  const id = await check(IdSchema, companyId);
  if (!id.ok) return id.error;
  const { api: client, locale } = await requireManager(id.value);
  try {
    const data = await fn(client, id.value);
    for (const p of pagesOf(id.value, sections)) revalidatePath(p);
    return { ok: true, data };
  } catch (err) {
    if (isNavigationError(err)) throw err;
    if (err instanceof ApiError && (err.status === 401 || err.code === 'SESSION_REVOKED')) {
      redirect('/company/login?expired=1');
    }
    const t = await getTranslations({ locale, namespace: 'common' });
    return toActionError(err, (key) => t(key));
  }
}

// ----------------------------------------------------------------------------------------------- dispatch ---

/** Current offers of the company (dispatch board poll). */
export async function companyOffersAction(companyId: string) {
  return run(companyId, (c, cid) => c.call(api.company.offers, { params: { companyId: cid } }));
}

/** "Qəbul et və göndər": one request fee per worker is held on the company wallet. Same key on a retry. */
export async function acceptOfferAction(companyId: string, offerId: string, workerIds: string[], idempotencyKey: string) {
  const o = await check(IdSchema, offerId);
  if (!o.ok) return o.error;
  const b = await check(api.company.acceptOffer.body, { workerIds });
  if (!b.ok) return b.error;
  if (new Set(b.value.workerIds).size !== b.value.workerIds.length) return invalid([{ path: 'workerIds', message: 'duplicate' }]);
  const k = await check(KeySchema, idempotencyKey);
  if (!k.ok) return k.error;
  return run(
    companyId,
    (c, cid) =>
      c.call(api.company.acceptOffer, {
        params: { companyId: cid, offerId: o.value },
        body: b.value,
        idempotencyKey: k.value,
      }),
    ['dispatch', 'orders', ''],
  );
}

export async function declineOfferAction(companyId: string, offerId: string) {
  const o = await check(IdSchema, offerId);
  if (!o.ok) return o.error;
  return run(companyId, (c, cid) => c.call(api.company.declineOffer, { params: { companyId: cid, offerId: o.value } }), [
    'dispatch',
  ]);
}

/** Active jobs for the dispatch board (first 100). */
export async function activeAssignmentsAction(companyId: string) {
  return run(companyId, (c, cid) =>
    c.call(api.company.assignments, { params: { companyId: cid }, query: { scope: 'active', limit: 100 } }),
  );
}

/** Live positions of the workers (dispatch map). */
export async function workersLiveAction(companyId: string) {
  return run(companyId, (c, cid) => c.call(api.company.workersLive, { params: { companyId: cid } }));
}

// ----------------------------------------------------------------------------------------------- orders ---

const AssignmentsQuery = PageQuery.extend({ scope: z.enum(['active', 'history']).optional() });

export async function listAssignmentsAction(companyId: string, query: z.input<typeof AssignmentsQuery>) {
  const q = await check(AssignmentsQuery, query ?? {});
  if (!q.ok) return q.error;
  return run(companyId, (c, cid) => c.call(api.company.assignments, { params: { companyId: cid }, query: q.value }));
}

/** Manager price entry (only when the company setting finalPriceEntry = MANAGER; the API enforces it). */
export async function enterPriceAction(
  companyId: string,
  assignmentId: string,
  body: z.input<typeof api.company.enterPrice.body>,
  idempotencyKey: string,
) {
  const a = await check(IdSchema, assignmentId);
  if (!a.ok) return a.error;
  const b = await check(api.company.enterPrice.body, body);
  if (!b.ok) return b.error;
  const k = await check(KeySchema, idempotencyKey);
  if (!k.ok) return k.error;
  return run(
    companyId,
    (c, cid) =>
      c.call(api.company.enterPrice, { params: { companyId: cid, id: a.value }, body: b.value, idempotencyKey: k.value }),
    [`orders/${a.value}`, 'orders', 'dispatch'],
  );
}

export async function reassignAction(companyId: string, assignmentId: string, workerId: string) {
  const a = await check(IdSchema, assignmentId);
  if (!a.ok) return a.error;
  const b = await check(api.company.reassign.body, { workerId });
  if (!b.ok) return b.error;
  return run(
    companyId,
    (c, cid) => c.call(api.company.reassign, { params: { companyId: cid, id: a.value }, body: b.value }),
    [`orders/${a.value}`, 'orders', 'dispatch'],
  );
}

export async function cancelAssignmentAction(
  companyId: string,
  assignmentId: string,
  reason: string | undefined,
  idempotencyKey: string,
) {
  const a = await check(IdSchema, assignmentId);
  if (!a.ok) return a.error;
  const text = reason?.trim();
  const b = await check(api.company.cancelAssignment.body, text ? { reason: text } : {});
  if (!b.ok) return b.error;
  const k = await check(KeySchema, idempotencyKey);
  if (!k.ok) return k.error;
  return run(
    companyId,
    (c, cid) =>
      c.call(api.company.cancelAssignment, {
        params: { companyId: cid, id: a.value },
        body: b.value,
        idempotencyKey: k.value,
      }),
    [`orders/${a.value}`, 'orders', 'dispatch', ''],
  );
}

// ---------------------------------------------------------------------------------------------- members ---

export async function updateMemberAction(
  companyId: string,
  userId: string,
  body: z.input<typeof api.company.updateMember.body>,
) {
  const u = await check(IdSchema, userId);
  if (!u.ok) return u.error;
  const b = await check(api.company.updateMember.body, body);
  if (!b.ok) return b.error;
  if (b.value.role === undefined && b.value.tradeIds === undefined) return invalid([{ path: '', message: 'empty' }]);
  return run(
    companyId,
    (c, cid) => c.call(api.company.updateMember, { params: { companyId: cid, userId: u.value }, body: b.value }),
    ['workers'],
  );
}

export async function removeMemberAction(companyId: string, userId: string) {
  const u = await check(IdSchema, userId);
  if (!u.ok) return u.error;
  return run(companyId, (c, cid) => c.call(api.company.removeMember, { params: { companyId: cid, userId: u.value } }), [
    'workers',
    '',
  ]);
}

export async function createInviteAction(companyId: string, body: z.input<typeof api.company.createInvite.body>) {
  const b = await check(api.company.createInvite.body, body);
  if (!b.ok) return b.error;
  return run(companyId, (c, cid) => c.call(api.company.createInvite, { params: { companyId: cid }, body: b.value }), [
    'workers',
  ]);
}

export async function revokeInviteAction(companyId: string, inviteId: string) {
  const i = await check(IdSchema, inviteId);
  if (!i.ok) return i.error;
  return run(companyId, (c, cid) => c.call(api.company.revokeInvite, { params: { companyId: cid, inviteId: i.value } }), [
    'workers',
  ]);
}

// ---------------------------------------------------------------------------------------------- balance ---

export async function listTransactionsAction(companyId: string, query: z.input<typeof PageQuery>) {
  const q = await check(PageQuery, query ?? {});
  if (!q.ok) return q.error;
  return run(companyId, (c, cid) => c.call(api.company.walletTransactions, { params: { companyId: cid }, query: q.value }));
}

async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    const origin = h.get('origin');
    if (origin && origin !== 'null') return origin;
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return null;
    const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]!.trim();
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/** Test-mode top-up of the company wallet: returns the checkout URL (opened in a new tab). */
export async function topupAction(companyId: string, amount: number, idempotencyKey: string) {
  const k = await check(KeySchema, idempotencyKey);
  if (!k.ok) return k.error;
  const id = await check(IdSchema, companyId);
  if (!id.ok) return id.error;
  const returnUrl = topupReturnUrl(await requestOrigin(), id.value);
  const b = await check(api.company.topup.body, returnUrl ? { amount, returnUrl } : { amount });
  if (!b.ok) return b.error;
  return run(id.value, (c, cid) =>
    c.call(api.company.topup, { params: { companyId: cid }, body: b.value, idempotencyKey: k.value }),
  );
}

export async function setPayoutMethodAction(companyId: string, body: z.input<typeof api.company.setPayoutMethod.body>) {
  const b = await check(api.company.setPayoutMethod.body, body);
  if (!b.ok) return b.error;
  return run(companyId, (c, cid) => c.call(api.company.setPayoutMethod, { params: { companyId: cid }, body: b.value }), [
    'balance',
  ]);
}

// --------------------------------------------------------------------------------------------- settings ---

export async function updateSettingsAction(companyId: string, body: z.input<typeof api.company.updateSettings.body>) {
  const b = await check(api.company.updateSettings.body, body);
  if (!b.ok) return b.error;
  return run(companyId, (c, cid) => c.call(api.company.updateSettings, { params: { companyId: cid }, body: b.value }), [
    'settings',
    '',
  ]);
}

// --------------------------------------------------------------------------------------------- projects ---

/** The company quotes as itself: `companyId` in the body must be this company. */
function actingAs<T extends { companyId?: string }>(body: T, companyId: string): T {
  return { ...body, companyId };
}

export async function submitQuoteAction(
  companyId: string,
  projectId: string,
  body: z.input<typeof api.providerProjects.submitQuote.body>,
  idempotencyKey: string,
) {
  const p = await check(IdSchema, projectId);
  if (!p.ok) return p.error;
  const b = await check(api.providerProjects.submitQuote.body, actingAs(body, companyId));
  if (!b.ok) return b.error;
  const k = await check(KeySchema, idempotencyKey);
  if (!k.ok) return k.error;
  return run(
    companyId,
    (c) => c.call(api.providerProjects.submitQuote, { params: { id: p.value }, body: b.value, idempotencyKey: k.value }),
    [`projects/${p.value}`, 'projects', 'balance'],
  );
}

export async function withdrawQuoteAction(companyId: string, quoteId: string, projectId: string) {
  const q = await check(IdSchema, quoteId);
  if (!q.ok) return q.error;
  const p = await check(IdSchema, projectId);
  if (!p.ok) return p.error;
  return run(companyId, (c) => c.call(api.providerProjects.withdrawQuote, { params: { id: q.value } }), [
    `projects/${p.value}`,
    'projects',
    'balance',
  ]);
}

export async function addReportAction(
  companyId: string,
  projectId: string,
  body: z.input<typeof api.providerProjects.addReport.body>,
) {
  const p = await check(IdSchema, projectId);
  if (!p.ok) return p.error;
  const b = await check(api.providerProjects.addReport.body, actingAs(body, companyId));
  if (!b.ok) return b.error;
  return run(companyId, (c) => c.call(api.providerProjects.addReport, { params: { id: p.value }, body: b.value }), [
    `projects/${p.value}`,
  ]);
}

export async function completeProjectAction(
  companyId: string,
  projectId: string,
  body: z.input<typeof api.providerProjects.complete.body>,
  idempotencyKey: string,
) {
  const p = await check(IdSchema, projectId);
  if (!p.ok) return p.error;
  const b = await check(api.providerProjects.complete.body, actingAs(body, companyId));
  if (!b.ok) return b.error;
  const k = await check(KeySchema, idempotencyKey);
  if (!k.ok) return k.error;
  return run(
    companyId,
    (c) => c.call(api.providerProjects.complete, { params: { id: p.value }, body: b.value, idempotencyKey: k.value }),
    [`projects/${p.value}`, 'projects'],
  );
}
