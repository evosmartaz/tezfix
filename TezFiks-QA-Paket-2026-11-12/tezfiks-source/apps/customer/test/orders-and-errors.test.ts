import { ApiError } from '@tezfiks/shared';
import {
  isActiveRequest,
  isLiveSearch,
  liveAssignmentId,
  mergePages,
  pickBannerRequest,
  reachKmForRing,
  requestHref,
  requestStatusTone,
  slotStatusTone,
  assignmentStatusTone,
} from '../src/lib/orders';
import { isRetryableWithSameKey, requestErrorInfo } from '../src/lib/requestErrors';
import { confidentPick, suggestionsFrom } from '../src/lib/photoClassify';
import { IDS, assignment, categories, detail, summary } from './fixtures';

describe('orders helpers', () => {
  it('active statuses', () => {
    expect(['SEARCHING', 'ASSIGNED', 'IN_PROGRESS'].every((s) => isActiveRequest(s as never))).toBe(true);
    expect(['COMPLETED', 'CANCELLED', 'EXPIRED'].some((s) => isActiveRequest(s as never))).toBe(false);
  });

  it('a live search opens the searching screen; scheduled and assigned requests open the detail', () => {
    expect(requestHref(summary())).toBe(`/request/${IDS.request}/searching`);
    expect(isLiveSearch(summary({ timing: 'EMERGENCY' }))).toBe(true);
    expect(requestHref(summary({ timing: 'SCHEDULED' }))).toBe(`/request/${IDS.request}`);
    expect(requestHref(summary({ status: 'ASSIGNED' }))).toBe(`/request/${IDS.request}`);
    expect(requestHref(summary({ isSearching: false }))).toBe(`/request/${IDS.request}`);
  });

  it('banner: in progress first, then assigned, then searching; newest first; none when nothing is active', () => {
    const a = summary({ id: 'a', status: 'SEARCHING', createdAt: '2026-10-25T10:00:00.000Z' });
    const b = summary({ id: 'b', status: 'SEARCHING', createdAt: '2026-10-25T11:00:00.000Z' });
    const c = summary({ id: 'c', status: 'ASSIGNED', createdAt: '2026-10-25T09:00:00.000Z' });
    const d = summary({ id: 'd', status: 'IN_PROGRESS', createdAt: '2026-10-25T08:00:00.000Z' });
    const done = summary({ id: 'e', status: 'COMPLETED' });
    expect(pickBannerRequest([a, b])?.id).toBe('b');
    expect(pickBannerRequest([a, c, b])?.id).toBe('c');
    expect(pickBannerRequest([a, c, d])?.id).toBe('d');
    expect(pickBannerRequest([done])).toBeNull();
    expect(pickBannerRequest(undefined)).toBeNull();
  });

  it('merges cursor pages without duplicates', () => {
    const p1 = { items: [summary({ id: '1' }), summary({ id: '2' })] };
    const p2 = { items: [summary({ id: '2' }), summary({ id: '3' })] };
    expect(mergePages([p1, p2]).map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(mergePages(undefined)).toEqual([]);
  });

  it('status tones', () => {
    expect(requestStatusTone('SEARCHING')).toBe('warning');
    expect(requestStatusTone('COMPLETED')).toBe('success');
    expect(requestStatusTone('EXPIRED')).toBe('danger');
    expect(slotStatusTone('UNFILLED')).toBe('danger');
    expect(slotStatusTone('FILLED')).toBe('info');
    expect(assignmentStatusTone('NO_SHOW')).toBe('danger');
    expect(assignmentStatusTone('PRICE_PROPOSED')).toBe('warning');
  });

  it('ring reach in Baku per spec 5 (k0 1.2 km ... k5 11.4 km, clamped)', () => {
    expect([0, 1, 2, 3, 4, 5].map(reachKmForRing)).toEqual([1.2, 2.9, 5.1, 7.1, 9.3, 11.4]);
    expect(reachKmForRing(9)).toBe(11.4);
    expect(reachKmForRing(-1)).toBe(1.2);
  });

  it('liveAssignmentId: the one working handyman of an assigned request (spec B4 → B5), otherwise null', () => {
    const second = '50000000-0000-4000-a000-000000000002';
    const assigned = (over: Parameters<typeof detail>[0] = {}) =>
      detail({ status: 'ASSIGNED', isSearching: false, search: null, slotsFilled: 1, slots: [{ index: 0, status: 'FILLED', assignmentId: IDS.assignment }], assignments: [assignment()], ...over });
    expect(liveAssignmentId(assigned())).toBe(IDS.assignment);
    expect(liveAssignmentId(assigned({ status: 'IN_PROGRESS', assignments: [assignment({ status: 'PRICE_PROPOSED' })] }))).toBe(IDS.assignment);
    // A re-dispatch after a no-show: the old assignment is over, the new one is live.
    expect(liveAssignmentId(assigned({ assignments: [assignment({ id: second, status: 'NO_SHOW' }), assignment()] }))).toBe(IDS.assignment);
    // Two handymen at work, or the search for more still running: the request overview is the right place.
    expect(liveAssignmentId(assigned({ assignments: [assignment(), assignment({ id: second, slotIndex: 1, status: 'EN_ROUTE' })] }))).toBeNull();
    expect(liveAssignmentId(assigned({ isSearching: true, slotsRequested: 2 }))).toBeNull();
    // Not (or no longer) assigned.
    expect(liveAssignmentId(detail())).toBeNull();
    expect(liveAssignmentId(assigned({ status: 'COMPLETED', assignments: [assignment({ status: 'COMPLETED' })] }))).toBeNull();
    expect(liveAssignmentId(assigned({ status: 'CANCELLED', assignments: [assignment({ status: 'CANCELLED_BY_CUSTOMER' })] }))).toBeNull();
    expect(liveAssignmentId(assigned({ assignments: [] }))).toBeNull();
  });
});

describe('request API error mapping', () => {
  it('debt and short balance offer a top-up', () => {
    expect(requestErrorInfo(new ApiError(409, 'CUSTOMER_IN_DEBT', 'x'))).toEqual({
      code: 'CUSTOMER_IN_DEBT',
      messageKey: 'common:errors.CUSTOMER_IN_DEBT',
      action: 'topUp',
      field: null,
    });
    expect(requestErrorInfo(new ApiError(402, 'INSUFFICIENT_BALANCE', 'x'))).toMatchObject({ action: 'topUp', field: 'timing' });
  });

  it('maps field errors and quote-only categories', () => {
    expect(requestErrorInfo(new ApiError(422, 'SCHEDULE_TOO_SOON', 'x'))).toMatchObject({ field: 'scheduledAt', action: null });
    expect(requestErrorInfo(new ApiError(422, 'SCHEDULE_TOO_FAR', 'x'))).toMatchObject({ field: 'scheduledAt' });
    expect(requestErrorInfo(new ApiError(422, 'EMERGENCY_NOT_ALLOWED', 'x'))).toMatchObject({ field: 'timing' });
    expect(requestErrorInfo(new ApiError(422, 'CATEGORY_REQUIRES_QUOTE', 'x'))).toMatchObject({ field: 'category', action: 'business' });
    expect(requestErrorInfo(new ApiError(403, 'FILE_NOT_OWNED', 'x'))).toMatchObject({ field: 'photos' });
  });

  it('connectivity errors offer a retry with the same idempotency key; unknown errors are INTERNAL', () => {
    expect(requestErrorInfo(new ApiError(0, 'NETWORK', 'x'))).toMatchObject({ action: 'retry', messageKey: 'common:errors.NETWORK' });
    expect(isRetryableWithSameKey(new ApiError(0, 'TIMEOUT', 'x'))).toBe(true);
    expect(isRetryableWithSameKey(new ApiError(409, 'CUSTOMER_IN_DEBT', 'x'))).toBe(false);
    expect(requestErrorInfo(new Error('boom'))).toMatchObject({ code: 'INTERNAL', messageKey: 'common:errors.INTERNAL' });
    expect(requestErrorInfo(new ApiError(500, 'HTTP_500', 'x')).messageKey).toBe('common:errors.INTERNAL');
    expect(requestErrorInfo(new ApiError(418, 'SOME_NEW_CODE', 'x')).messageKey).toBe('common:errors.INTERNAL');
  });
});

describe('find by photo result handling', () => {
  const items = categories();
  it('opens the form directly only for a confident pick of an active service', () => {
    const ok = { status: 'ok' as const, categoryId: IDS.plumbing, slug: 'plumbing', confidence: 'high' as const, candidates: [] };
    expect(confidentPick(ok, items)?.slug).toBe('plumbing');
    expect(confidentPick({ ...ok, status: 'unsure' }, items)).toBeNull();
    expect(confidentPick({ ...ok, categoryId: IDS.inactive }, items)).toBeNull();
    expect(confidentPick({ ...ok, categoryId: IDS.homeSystems }, items)).toBeNull();
    expect(confidentPick(null, items)).toBeNull();
  });

  it('suggests the pick and candidates, de-duplicated, services only', () => {
    const res = {
      status: 'unsure' as const,
      categoryId: null,
      slug: null,
      confidence: 'low' as const,
      candidates: [
        { categoryId: IDS.plumbing, slug: 'plumbing', name: 'Santexnik' },
        { categoryId: IDS.heating, slug: 'heating', name: 'Kombi' },
        { categoryId: IDS.plumbing, slug: 'plumbing', name: 'Santexnik' },
        { categoryId: '99999999-0000-4000-a000-000000000000', slug: 'gone', name: 'Gone' },
      ],
    };
    expect(suggestionsFrom(res, items).map((c) => c.slug)).toEqual(['plumbing', 'heating']);
    expect(suggestionsFrom(null, items)).toEqual([]);
  });
});
