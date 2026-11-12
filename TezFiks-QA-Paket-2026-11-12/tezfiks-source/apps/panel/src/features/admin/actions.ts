'use server';

/**
 * Server Actions of the TezFiks admin panel (BFF): every action checks the admin session, validates its input with
 * the contract schema, calls the API server-to-server with the session token (never exposed to the browser) and
 * returns a serializable ActionResult. Mutations revalidate the affected admin pages.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import {
  api,
  ApiError,
  type ApiClient,
  type Endpoint,
  type EndpointOutput,
} from '@tezfiks/shared';
import { isNavigationError, toActionError, type ActionResult } from '@/lib/errors';
import { requireAdmin } from '@/lib/session/server';

type QueryOf<E extends { query: z.ZodType }> = z.input<E['query']>;
type BodyOf<E extends { body: z.ZodType }> = z.input<E['body']>;

const IdSchema = z.uuid();

async function run<T>(fn: (client: ApiClient) => Promise<T>, paths: string[] = []): Promise<ActionResult<T>> {
  const { api: client, locale } = await requireAdmin();
  try {
    const data = await fn(client);
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (err) {
    if (isNavigationError(err)) throw err;
    if (err instanceof ApiError && (err.status === 401 || err.code === 'SESSION_REVOKED')) {
      redirect('/admin/login?expired=1');
    }
    const t = await getTranslations({ locale, namespace: 'common' });
    return toActionError(err, (key) => t(key));
  }
}

async function invalid(details?: unknown): Promise<Extract<ActionResult, { ok: false }>> {
  const { locale } = await requireAdmin();
  const t = await getTranslations({ locale, namespace: 'common' });
  return { ok: false, code: 'VALIDATION_FAILED', message: t('errors.VALIDATION_FAILED'), details };
}

/** Validates `input` with `schema`; returns the parsed value or a VALIDATION_FAILED result. */
async function check<S extends z.ZodType>(
  schema: S,
  input: unknown,
): Promise<{ ok: true; value: z.output<S> } | { ok: false; error: Extract<ActionResult, { ok: false }> }> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: await invalid(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))) };
}

async function list<E extends Endpoint & { query: z.ZodType }>(
  endpoint: E,
  query: unknown,
): Promise<ActionResult<EndpointOutput<E>>> {
  const v = await check(endpoint.query, query ?? {});
  if (!v.ok) return v.error;
  return run((client) => client.call(endpoint as Endpoint, { query: v.value } as never) as Promise<EndpointOutput<E>>);
}

async function withId<T>(id: string, fn: (id: string) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const v = await check(IdSchema, id);
  if (!v.ok) return v.error;
  return fn(v.value);
}

// ------------------------------------------------------------------ lists (DataTable pages) ---

export async function listRequestsAction(query: QueryOf<typeof api.admin.requests>) {
  return list(api.admin.requests, query);
}
export async function listHandymenAction(query: QueryOf<typeof api.admin.handymen>) {
  return list(api.admin.handymen, query);
}
export async function listCompaniesAction(query: QueryOf<typeof api.admin.companies>) {
  return list(api.admin.companies, query);
}
export async function listCustomersAction(query: QueryOf<typeof api.admin.customers>) {
  return list(api.admin.customers, query);
}
export async function listLedgerAction(query: QueryOf<typeof api.admin.ledger>) {
  return list(api.admin.ledger, query);
}
export async function listPaymentsAction(query: QueryOf<typeof api.admin.payments>) {
  return list(api.admin.payments, query);
}
export async function listPayoutsAction(query: QueryOf<typeof api.admin.payouts>) {
  return list(api.admin.payouts, query);
}
export async function listInvoicesAction(query: QueryOf<typeof api.admin.invoices>) {
  return list(api.admin.invoices, query);
}
export async function listCasesAction(query: QueryOf<typeof api.admin.cases>) {
  return list(api.admin.cases, query);
}
export async function listProjectsAction(query: QueryOf<typeof api.admin.projects>) {
  return list(api.admin.projects, query);
}
export async function listAuditAction(query: QueryOf<typeof api.admin.audit>) {
  return list(api.admin.audit, query);
}

// ----------------------------------------------------------------------------- requests ---

export async function cancelRequestAction(id: string, body: BodyOf<typeof api.admin.cancelRequest>) {
  return withId(id, async (rid) => {
    const v = await check(api.admin.cancelRequest.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.cancelRequest, { params: { id: rid }, body: v.value }), [
      `/admin/orders/${rid}`,
      '/admin/orders',
      '/admin',
    ]);
  });
}

// ----------------------------------------------------------------------------- handymen ---

const handymanPaths = (id: string) => [`/admin/handymen/${id}`, '/admin/handymen', '/admin'];

export async function approveHandymanAction(id: string, body: BodyOf<typeof api.admin.approveHandyman>) {
  return withId(id, async (hid) => {
    const v = await check(api.admin.approveHandyman.body, body ?? {});
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.approveHandyman, { params: { id: hid }, body: v.value }), handymanPaths(hid));
  });
}

export async function rejectHandymanAction(id: string, body: BodyOf<typeof api.admin.rejectHandyman>) {
  return withId(id, async (hid) => {
    const v = await check(api.admin.rejectHandyman.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.rejectHandyman, { params: { id: hid }, body: v.value }), handymanPaths(hid));
  });
}

export async function blockHandymanAction(id: string, body: BodyOf<typeof api.admin.blockHandyman>) {
  return withId(id, async (hid) => {
    const v = await check(api.admin.blockHandyman.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.blockHandyman, { params: { id: hid }, body: v.value }), handymanPaths(hid));
  });
}

export async function unblockHandymanAction(id: string) {
  return withId(id, (hid) => run((c) => c.call(api.admin.unblockHandyman, { params: { id: hid } }), handymanPaths(hid)));
}

export async function clearStrikesAction(id: string) {
  return withId(id, (hid) => run((c) => c.call(api.admin.clearStrikes, { params: { id: hid } }), handymanPaths(hid)));
}

// ---------------------------------------------------------------------------- companies ---

const companyPaths = (id: string) => [`/admin/companies/${id}`, '/admin/companies', '/admin'];

export async function approveCompanyAction(id: string) {
  return withId(id, (cid) => run((c) => c.call(api.admin.approveCompany, { params: { id: cid } }), companyPaths(cid)));
}

export async function rejectCompanyAction(id: string, body: BodyOf<typeof api.admin.rejectCompany>) {
  return withId(id, async (cid) => {
    const v = await check(api.admin.rejectCompany.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.rejectCompany, { params: { id: cid }, body: v.value }), companyPaths(cid));
  });
}

export async function blockCompanyAction(id: string, body: BodyOf<typeof api.admin.blockCompany>) {
  return withId(id, async (cid) => {
    const v = await check(api.admin.blockCompany.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.blockCompany, { params: { id: cid }, body: v.value }), companyPaths(cid));
  });
}

export async function unblockCompanyAction(id: string) {
  return withId(id, (cid) => run((c) => c.call(api.admin.unblockCompany, { params: { id: cid } }), companyPaths(cid)));
}

// ------------------------------------------------------------------------ users / wallets ---

/** Blocks a user account (all sessions revoked by the API). `revalidate` is the page that shows the user. */
export async function blockUserAction(userId: string, body: BodyOf<typeof api.admin.blockUser>, revalidate?: string) {
  return withId(userId, async (uid) => {
    const v = await check(api.admin.blockUser.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.blockUser, { params: { id: uid }, body: v.value }), [
      '/admin/customers',
      ...(revalidate?.startsWith('/admin') ? [revalidate] : []),
    ]);
  });
}

export async function unblockUserAction(userId: string, revalidate?: string) {
  return withId(userId, (uid) =>
    run((c) => c.call(api.admin.unblockUser, { params: { id: uid } }), [
      '/admin/customers',
      ...(revalidate?.startsWith('/admin') ? [revalidate] : []),
    ]),
  );
}

/**
 * Manual balance correction ("Balans artır" / deduct). `idempotencyKey` is generated once per dialog so a double
 * submit or a retry after a network error posts the adjustment only once.
 */
export async function adjustWalletAction(
  body: BodyOf<typeof api.admin.adjustWallet>,
  idempotencyKey: string,
  revalidate?: string,
) {
  const v = await check(api.admin.adjustWallet.body, body);
  if (!v.ok) return v.error;
  const k = await check(z.string().min(8).max(200), idempotencyKey);
  if (!k.ok) return k.error;
  return run(
    (c) => c.call(api.admin.adjustWallet, { body: v.value, idempotencyKey: k.value }),
    ['/admin/payments', ...(revalidate?.startsWith('/admin') ? [revalidate] : [])],
  );
}

// ----------------------------------------------------------------------------- payments ---

export async function runPayoutsAction() {
  return run((c) => c.call(api.admin.runPayouts), ['/admin/payments']);
}

export async function markPayoutPaidAction(id: string) {
  return withId(id, (pid) => run((c) => c.call(api.admin.markPayoutPaid, { params: { id: pid } }), ['/admin/payments']));
}

export async function markPayoutFailedAction(id: string, body: BodyOf<typeof api.admin.markPayoutFailed>) {
  return withId(id, async (pid) => {
    const v = await check(api.admin.markPayoutFailed.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.markPayoutFailed, { params: { id: pid }, body: v.value }), ['/admin/payments']);
  });
}

export async function markInvoicePaidAction(id: string) {
  return withId(id, (iid) =>
    run((c) => c.call(api.admin.markInvoicePaid, { params: { id: iid } }), ['/admin/payments', '/admin/projects']),
  );
}

// -------------------------------------------------------------------------------- cases ---

const casePaths = (id: string) => [`/admin/cases/${id}`, '/admin/cases', '/admin'];

export async function addCaseNoteAction(id: string, body: BodyOf<typeof api.admin.addCaseNote>) {
  return withId(id, async (cid) => {
    const v = await check(api.admin.addCaseNote.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.addCaseNote, { params: { id: cid }, body: v.value }), casePaths(cid));
  });
}

export async function redispatchCaseAction(id: string, body: BodyOf<typeof api.admin.redispatchCase>) {
  return withId(id, async (cid) => {
    const v = await check(api.admin.redispatchCase.body, body ?? {});
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.redispatchCase, { params: { id: cid }, body: v.value }), casePaths(cid));
  });
}

export async function resolveCaseAction(id: string, body: BodyOf<typeof api.admin.resolveCase>) {
  return withId(id, async (cid) => {
    const v = await check(api.admin.resolveCase.body, body);
    if (!v.ok) return v.error;
    if (v.value.outcome === 'REPROPOSE_PRICE' && !v.value.price) return invalid([{ path: 'price', message: 'required' }]);
    return run((c) => c.call(api.admin.resolveCase, { params: { id: cid }, body: v.value }), casePaths(cid));
  });
}

export async function rejectCaseAction(id: string, body: BodyOf<typeof api.admin.rejectCase>) {
  return withId(id, async (cid) => {
    const v = await check(api.admin.rejectCase.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.rejectCase, { params: { id: cid }, body: v.value }), casePaths(cid));
  });
}

// --------------------------------------------------------------------------- categories ---

export async function createCategoryAction(body: BodyOf<typeof api.adminCategories.create>) {
  const v = await check(api.adminCategories.create.body, body);
  if (!v.ok) return v.error;
  return run((c) => c.call(api.adminCategories.create, { body: v.value }), ['/admin/categories']);
}

export async function updateCategoryAction(id: string, body: BodyOf<typeof api.adminCategories.update>) {
  return withId(id, async (cid) => {
    const v = await check(api.adminCategories.update.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.adminCategories.update, { params: { id: cid }, body: v.value }), ['/admin/categories']);
  });
}

// ---------------------------------------------------------------------- settings / admins ---

export async function updateSettingsAction(body: BodyOf<typeof api.admin.updateSettings>) {
  const v = await check(api.admin.updateSettings.body, body);
  if (!v.ok) return v.error;
  if (Object.keys(v.value).length === 0) return invalid([{ path: '', message: 'no changes' }]);
  return run((c) => c.call(api.admin.updateSettings, { body: v.value }), ['/admin/settings']);
}

export async function createAdminAction(body: BodyOf<typeof api.admin.createAdmin>) {
  const v = await check(api.admin.createAdmin.body, body);
  if (!v.ok) return v.error;
  return run((c) => c.call(api.admin.createAdmin, { body: v.value }), ['/admin/settings']);
}

export async function updateAdminAction(id: string, body: BodyOf<typeof api.admin.updateAdmin>) {
  return withId(id, async (aid) => {
    const v = await check(api.admin.updateAdmin.body, body);
    if (!v.ok) return v.error;
    return run((c) => c.call(api.admin.updateAdmin, { params: { id: aid }, body: v.value }), ['/admin/settings']);
  });
}

// ------------------------------------------------------------------------------ live map ---

export async function liveMapAction() {
  return run((c) => c.call(api.admin.liveMap));
}

// ---------------------------------------------------------------------------------- demo ---

export async function demoStateAction() {
  return run((c) => c.call(api.admin.demoState));
}

export async function demoSpawnBotsAction(body: BodyOf<typeof api.admin.demoSpawnBots>) {
  const v = await check(api.admin.demoSpawnBots.body, body);
  if (!v.ok) return v.error;
  return run((c) => c.call(api.admin.demoSpawnBots, { body: v.value }), ['/admin/demo', '/admin/map']);
}

export async function demoClearBotsAction() {
  return run((c) => c.call(api.admin.demoClearBots), ['/admin/demo', '/admin/map']);
}

export async function demoConfigAction(body: BodyOf<typeof api.admin.demoConfig>) {
  const v = await check(api.admin.demoConfig.body, body);
  if (!v.ok) return v.error;
  return run((c) => c.call(api.admin.demoConfig, { body: v.value }), ['/admin/demo']);
}

export async function demoCreateRequestAction(body: BodyOf<typeof api.admin.demoCreateRequest>) {
  const v = await check(api.admin.demoCreateRequest.body, body);
  if (!v.ok) return v.error;
  return run((c) => c.call(api.admin.demoCreateRequest, { body: v.value }), ['/admin/demo', '/admin/orders', '/admin']);
}
