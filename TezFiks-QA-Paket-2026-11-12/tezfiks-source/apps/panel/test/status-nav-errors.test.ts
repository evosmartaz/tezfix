import { describe, expect, it } from 'vitest';
import { ApiError } from '@tezfiks/shared';
import { ADMIN_NAV, companyNav, isNavActive, proInviteDeepLink } from '@/lib/nav';
import { STATUS_FAMILIES, statusPresentation, TONE_CLASSES, type StatusFamily } from '@/lib/status';
import { errorMessageKey, isNavigationError, toActionError } from '@/lib/errors';
import { withBase } from '@/lib/utils';

describe('StatusBadge mapping', () => {
  it('covers every value of every status enum with a tone', () => {
    for (const family of Object.keys(STATUS_FAMILIES) as StatusFamily[]) {
      for (const status of STATUS_FAMILIES[family]) {
        const p = statusPresentation(family, status);
        expect(p.labelKey).not.toBe('panel.status.unknown');
        expect(Object.keys(TONE_CLASSES)).toContain(p.tone);
      }
    }
  });

  it('uses common.* labels for families shared with the apps and panel.status.* for the rest', () => {
    expect(statusPresentation('requestStatus', 'SEARCHING')).toEqual({
      labelKey: 'common.requestStatus.SEARCHING',
      tone: 'warning',
    });
    expect(statusPresentation('assignmentStatus', 'EN_ROUTE').labelKey).toBe(
      'common.assignmentStatus.EN_ROUTE',
    );
    expect(statusPresentation('verificationStatus', 'PENDING_REVIEW').labelKey).toBe(
      'common.verificationStatus.PENDING_REVIEW',
    );
    expect(statusPresentation('offerStatus', 'SENT').labelKey).toBe('panel.status.offerStatus.SENT');
    expect(statusPresentation('userStatus', 'BLOCKED').labelKey).toBe('panel.status.userStatus.BLOCKED');
  });

  it('colours by meaning (board 05: completed green, searching amber, cancelled red)', () => {
    expect(statusPresentation('requestStatus', 'COMPLETED').tone).toBe('success');
    expect(statusPresentation('requestStatus', 'SEARCHING').tone).toBe('warning');
    expect(statusPresentation('requestStatus', 'CANCELLED').tone).toBe('danger');
    expect(statusPresentation('verificationStatus', 'APPROVED').tone).toBe('success');
    expect(statusPresentation('verificationStatus', 'BLOCKED').tone).toBe('danger');
    expect(statusPresentation('assignmentStatus', 'NO_SHOW').tone).toBe('danger');
    expect(statusPresentation('paymentStatus', 'SUCCEEDED').tone).toBe('success');
    expect(statusPresentation('payoutStatus', 'PENDING').tone).toBe('warning');
  });

  it('falls back to a neutral "unknown" badge for values the panel does not know yet', () => {
    expect(statusPresentation('requestStatus', 'SOMETHING_NEW')).toEqual({
      labelKey: 'panel.status.unknown',
      tone: 'neutral',
    });
    expect(statusPresentation('requestStatus', 'toString')).toEqual({
      labelKey: 'panel.status.unknown',
      tone: 'neutral',
    });
  });
});

describe('navigation', () => {
  it('lists the 13 admin sections of the spec', () => {
    expect(ADMIN_NAV.map((i) => i.href)).toEqual([
      '/admin',
      '/admin/orders',
      '/admin/handymen',
      '/admin/companies',
      '/admin/customers',
      '/admin/payments',
      '/admin/cases',
      '/admin/projects',
      '/admin/categories',
      '/admin/map',
      '/admin/settings',
      '/admin/audit',
      '/admin/demo',
    ]);
  });

  it('builds the company sections under the company id', () => {
    expect(companyNav('c1').map((i) => i.href)).toEqual([
      '/company/c1',
      '/company/c1/dispatch',
      '/company/c1/orders',
      '/company/c1/workers',
      '/company/c1/balance',
      '/company/c1/projects',
      '/company/c1/settings',
    ]);
  });

  it('highlights the dashboard only on its exact path and sections on sub-pages', () => {
    const [dashboard, orders] = ADMIN_NAV;
    expect(isNavActive(dashboard, '/admin')).toBe(true);
    expect(isNavActive(dashboard, '/admin/')).toBe(true);
    expect(isNavActive(dashboard, '/admin/orders')).toBe(false);
    expect(isNavActive(orders, '/admin/orders')).toBe(true);
    expect(isNavActive(orders, '/admin/orders/123')).toBe(true);
    expect(isNavActive(orders, '/admin/ordersx')).toBe(false);
  });

  it('deep-links invites into the pro app', () => {
    expect(proInviteDeepLink('AbC123xyz_-9')).toBe('tezfiksusta://join/AbC123xyz_-9');
    expect(proInviteDeepLink('a/b')).toBe('tezfiksusta://join/a%2Fb');
  });
});

describe('withBase (Base UI className merge)', () => {
  it('merges base classes into string and state-function classNames', () => {
    expect(withBase('px-2', 'px-4 py-1')).toBe('py-1 px-2');
    expect(withBase(undefined, 'a', false && 'b')).toBe('a');
    const fn = withBase((s: { active: boolean }) => (s.active ? 'text-white' : undefined), 'text-black');
    expect(typeof fn).toBe('function');
    expect((fn as (s: { active: boolean }) => string)({ active: true })).toBe('text-white');
    expect((fn as (s: { active: boolean }) => string)({ active: false })).toBe('text-black');
  });
});

describe('action errors', () => {
  const t = (key: string) => `T(${key})`;

  it('maps codes to common.errors keys, unknown codes to INTERNAL', () => {
    expect(errorMessageKey('OTP_INVALID')).toBe('errors.OTP_INVALID');
    expect(errorMessageKey('NETWORK')).toBe('errors.NETWORK');
    expect(errorMessageKey('CONTRACT_MISMATCH')).toBe('errors.INTERNAL');
  });

  it('keeps the API-localized message for API errors', () => {
    expect(
      toActionError(new ApiError(409, 'INVALID_STATE', 'Bu mərhələdə mümkün deyil', { a: 1 }), t),
    ).toEqual({
      ok: false,
      code: 'INVALID_STATE',
      message: 'Bu mərhələdə mümkün deyil',
      details: { a: 1 },
    });
  });

  it('translates transport and unknown failures', () => {
    expect(toActionError(new ApiError(0, 'TIMEOUT', 'aborted'), t).message).toBe('T(errors.TIMEOUT)');
    expect(toActionError(new ApiError(200, 'CONTRACT_MISMATCH', 'raw'), t)).toMatchObject({
      code: 'CONTRACT_MISMATCH',
      message: 'T(errors.INTERNAL)',
    });
    expect(toActionError(new Error('boom'), t)).toMatchObject({
      code: 'INTERNAL',
      message: 'T(errors.INTERNAL)',
    });
  });

  it('recognises Next.js navigation throws', () => {
    expect(isNavigationError({ digest: 'NEXT_REDIRECT;replace;/admin;307;' })).toBe(true);
    expect(isNavigationError({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })).toBe(true);
    expect(isNavigationError(new Error('x'))).toBe(false);
  });
});
