'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { AdminLoginBodySchema, api, LocaleSchema, type Locale } from '@tezfiks/shared';
import { secureCookies } from '../env';
import { toActionError, type ActionResult } from '../errors';
import { localeCookie, loginPathFor, safeNextPath } from '../session/cookies';
import {
  clearSessionCookies,
  currentKind,
  currentRefreshToken,
  ensureDeviceId,
  getRequestLocale,
  getSession,
  managedCompanies,
  serverApi,
  setSessionCookies,
} from '../session/server';

async function fail(err: unknown) {
  const t = await getTranslations({ locale: await getRequestLocale(), namespace: 'common' });
  return toActionError(err, (key) => t(key));
}

/**
 * Best-effort revocation of the session this browser already holds (e.g. an admin who now logs into the company
 * panel): the cookies are about to be overwritten, so the old refresh session would otherwise stay valid at the API.
 */
async function revokeExistingSession(): Promise<void> {
  const session = await getSession();
  const refreshToken = await currentRefreshToken();
  if (!session || !refreshToken) return;
  try {
    const client = await serverApi(session);
    await client.call(api.auth.logout, { body: { refreshToken } });
  } catch {
    // Already revoked or API hiccup: the new login still succeeds.
  }
}

/** VALIDATION_FAILED result with the translated message of `messageCode` (common.errors.*). */
async function validationFailed(messageCode: string): Promise<Extract<ActionResult, { ok: false }>> {
  const t = await getTranslations({ locale: await getRequestLocale(), namespace: 'common' });
  return { ok: false, code: 'VALIDATION_FAILED', message: t(`errors.${messageCode}`) };
}

const AdminLoginInput = AdminLoginBodySchema.extend({ next: z.string().max(500).optional() });

/** TezFiks admin login (email + password). On success sets the session cookies and redirects into /admin. */
export async function adminLoginAction(input: z.input<typeof AdminLoginInput>): Promise<ActionResult> {
  const parsed = AdminLoginInput.safeParse(input);
  if (!parsed.success) return validationFailed('VALIDATION_FAILED');
  try {
    const client = await serverApi(null);
    const out = await client.call(api.auth.adminLogin, {
      body: { email: parsed.data.email, password: parsed.data.password },
    });
    await revokeExistingSession();
    await setSessionCookies(out.tokens, 'admin');
  } catch (err) {
    return fail(err);
  }
  redirect(safeNextPath(parsed.data.next, 'admin'));
}

export interface OtpChallenge {
  challengeId: string;
  phone: string;
  expiresAt: string;
  resendAfterSec: number;
  devCode: string | null;
}

const OtpRequestInput = z.object({ phone: z.string().trim().min(5).max(32) });

/** Company panel login step 1: sends the code (app PANEL). */
export async function companyOtpRequestAction(
  input: z.input<typeof OtpRequestInput>,
): Promise<ActionResult<OtpChallenge>> {
  const parsed = OtpRequestInput.safeParse(input);
  if (!parsed.success) return validationFailed('PHONE_INVALID');
  try {
    const locale = await getRequestLocale();
    const client = await serverApi(null);
    const out = await client.call(api.auth.otpRequest, {
      body: { phone: parsed.data.phone, app: 'PANEL', locale },
    });
    return {
      ok: true,
      data: {
        challengeId: out.challengeId,
        phone: out.phone,
        expiresAt: out.expiresAt,
        resendAfterSec: out.resendAfterSec,
        devCode: out.devCode ?? null,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

const OtpVerifyInput = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  next: z.string().max(500).optional(),
});

/**
 * Company panel login step 2: verifies the code, stores the session and goes to the managed company
 * (directly when there is exactly one, otherwise to the company chooser).
 */
export async function companyOtpVerifyAction(input: z.input<typeof OtpVerifyInput>): Promise<ActionResult> {
  const parsed = OtpVerifyInput.safeParse(input);
  if (!parsed.success) return validationFailed('OTP_INVALID');
  let target: string;
  try {
    const deviceId = await ensureDeviceId();
    const client = await serverApi(null);
    const out = await client.call(api.auth.otpVerify, {
      body: { challengeId: parsed.data.challengeId, code: parsed.data.code, deviceId, app: 'PANEL' },
    });
    await revokeExistingSession();
    await setSessionCookies(out.tokens, 'company');
    const managed = managedCompanies(out.me);
    const next = safeNextPath(parsed.data.next, 'company');
    if (next !== '/company') target = next;
    else target = managed.length === 1 ? `/company/${managed[0].companyId}` : '/company';
  } catch (err) {
    return fail(err);
  }
  redirect(target);
}

/** Ends the session at the API (best effort) and clears the cookies. */
export async function logoutAction(): Promise<void> {
  const kind = (await currentKind()) ?? 'admin';
  const session = await getSession();
  const refreshToken = await currentRefreshToken();
  if (session) {
    try {
      const client = await serverApi(session);
      await client.call(api.auth.logout, { body: { refreshToken } });
    } catch {
      // The session may already be revoked; the cookies are cleared anyway.
    }
  }
  await clearSessionCookies();
  redirect(loginPathFor(kind));
}

/** Language switcher (az / ru / en): stored in the `locale` cookie. */
export async function setLocaleAction(locale: Locale): Promise<ActionResult> {
  const parsed = LocaleSchema.safeParse(locale);
  if (!parsed.success) return validationFailed('VALIDATION_FAILED');
  const c = localeCookie(parsed.data, secureCookies());
  (await cookies()).set(c.name, c.value, c.options);
  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}
