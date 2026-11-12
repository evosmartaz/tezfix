import {
  addCompanyOffer,
  applyCompanyPoll,
  defaultSelection,
  emptyCompanyOffers,
  isSelectableWorker,
  kmLabel,
  openCompanyOffers,
  reassignCandidates,
  reconcileSelection,
  removeCompanyOffer,
  sortCandidates,
  toggleWorker,
} from '../src/lib/company';
import {
  initialQuoteForm,
  projectDays,
  providerPhase,
  quoteFee,
  stepProgress,
  validateQuoteForm,
  validateReportForm,
} from '../src/lib/projects';
import { candidate, ID, member, offer, providerProject } from './fixtures';

const COMPANY = ID(9);
const T = Date.parse('2026-10-25T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function companyOffer(n: number, over: Parameters<typeof offer>[0] = {}) {
  return offer({ id: ID(4000 + n), target: 'COMPANY', companyId: COMPANY, sentAt: iso(T), expiresAt: iso(T + 30_000 + n), ...over });
}

describe('company offer list (manager mode)', () => {
  it('keeps only SENT offers for this company and sorts by deadline', () => {
    let s = emptyCompanyOffers();
    s = addCompanyOffer(s, companyOffer(2), COMPANY);
    s = addCompanyOffer(s, companyOffer(1), COMPANY);
    s = addCompanyOffer(s, offer({ id: 'solo' }), COMPANY); // HANDYMAN target
    s = addCompanyOffer(s, companyOffer(3, { companyId: ID(10) }), COMPANY); // another company
    expect(openCompanyOffers(s, T).map((o) => o.id)).toEqual([ID(4001), ID(4002)]);
    s = addCompanyOffer(s, companyOffer(1, { status: 'CLOSED' }), COMPANY);
    expect(openCompanyOffers(s, T).map((o) => o.id)).toEqual([ID(4002)]);
    expect(openCompanyOffers(s, T + 31_000)).toEqual([]);
  });

  it('a poll replaces the set but keeps offers sent after the poll was requested; dismissed ones never return', () => {
    let s = addCompanyOffer(emptyCompanyOffers(), companyOffer(1), COMPANY);
    s = addCompanyOffer(s, companyOffer(2, { sentAt: iso(T + 5_000) }), COMPANY);
    s = applyCompanyPoll(s, [companyOffer(3)], COMPANY, T + 1_000);
    expect(Object.keys(s.offers).sort()).toEqual([ID(4002), ID(4003)].sort());
    s = removeCompanyOffer(s, ID(4003), { dismiss: true });
    s = applyCompanyPoll(s, [companyOffer(3)], COMPANY);
    expect(Object.keys(s.offers)).toEqual([]);
    expect(removeCompanyOffer(s, 'nope')).toBe(s);
  });
});

describe('"Ustanı seçin" worker picker rules', () => {
  const free1 = candidate(1);
  const free2 = candidate(2);
  const busy = candidate(3, { busy: true });
  const noTrade = candidate(4, { hasTrade: false });

  it('busy workers ("Sifarişdədir") and workers without the trade are disabled', () => {
    expect(isSelectableWorker(free1)).toBe(true);
    expect(isSelectableWorker(busy)).toBe(false);
    expect(isSelectableWorker(noTrade)).toBe(false);
  });

  it('selects at most the open slots; a single slot swaps', () => {
    expect(toggleWorker([], free1, 1)).toEqual([free1.handymanId]);
    expect(toggleWorker([free1.handymanId], free2, 1)).toEqual([free2.handymanId]);
    expect(toggleWorker([free1.handymanId], free2, 2)).toEqual([free1.handymanId, free2.handymanId]);
    expect(toggleWorker([free1.handymanId, free2.handymanId], candidate(5), 2)).toEqual([free1.handymanId, free2.handymanId]);
    expect(toggleWorker([free1.handymanId], free1, 2)).toEqual([]);
    expect(toggleWorker([], busy, 2)).toEqual([]);
    expect(toggleWorker([], noTrade, 2)).toEqual([]);
    expect(toggleWorker([], free1, 0)).toEqual([]);
  });

  it('sorts free workers first by distance and defaults to the nearest free ones', () => {
    const far = candidate(9, { distanceM: 9000 });
    const unknown = candidate(8, { distanceM: null });
    expect(sortCandidates([busy, far, unknown, free2, free1]).map((w) => w.handymanId)).toEqual([
      free1.handymanId,
      free2.handymanId,
      far.handymanId,
      unknown.handymanId,
      busy.handymanId,
    ]);
    expect(defaultSelection([busy, free2, free1], 1)).toEqual([free1.handymanId]);
    expect(defaultSelection([busy, noTrade], 2)).toEqual([]);
  });

  it('drops selections that became unavailable and trims to the open slots', () => {
    expect(reconcileSelection([free1.handymanId, busy.handymanId, 'gone'], [free1, busy], 3)).toEqual([free1.handymanId]);
    expect(reconcileSelection([free1.handymanId, free2.handymanId], [free1, free2], 1)).toEqual([free1.handymanId]);
  });

  it('reassign candidates: active, free workers other than the current one', () => {
    const list = [member(1), member(2, { busy: true }), member(3, { status: 'REMOVED' }), member(4, { handymanId: null }), member(5)];
    expect(reassignCandidates(list, ID(101)).map((m) => m.userId)).toEqual([ID(205)]);
  });

  it('distance labels', () => {
    expect(kmLabel(1800, 'az')).toBe('1,8 km');
    expect(kmLabel(1849, 'en')).toBe('1.8 km');
    expect(kmLabel(null, 'az')).toBeNull();
  });
});

describe('B2B projects (provider side)', () => {
  it('fee preview = fee per worker-day × workers × days', () => {
    expect(quoteFee(1000, 4, 3)).toBe(12000);
    expect(quoteFee(1000, 0, 3)).toBe(0);
    expect(quoteFee(1000, 2.5, 3)).toBe(0);
    expect(projectDays('2026-11-01', '2026-11-03')).toBe(3);
    expect(projectDays('2026-11-01', '2026-11-01')).toBe(1);
  });

  it('prefills the quote form from the project', () => {
    expect(initialQuoteForm(providerProject())).toEqual({ total: '', workers: '4', days: '3', note: '' });
  });

  it('validates the quote form into the contract body', () => {
    expect(validateQuoteForm({ total: '4 500,50', workers: '4', days: '3', note: ' Material daxil ' })).toEqual({
      errors: {},
      body: { totalAmount: 450050, workers: 4, days: 3, note: 'Material daxil' },
    });
    expect(validateQuoteForm({ total: '', workers: '0', days: '400', note: '' }).errors).toEqual({ total: 'required', workers: 'range', days: 'range' });
    expect(validateQuoteForm({ total: '0.5', workers: 'x', days: '', note: 'a'.repeat(1001) }).errors).toEqual({
      total: 'range',
      workers: 'required',
      days: 'required',
      note: 'range',
    });
    expect(validateQuoteForm({ total: '100', workers: '1', days: '1', note: '' }).body).toEqual({ totalAmount: 10000, workers: 1, days: 1 });
  });

  it('validates daily reports', () => {
    expect(validateReportForm({ note: ' 2-ci mərtəbə suvaq bitdi ', progress: 40, photoIds: ['a'] })).toEqual({
      errors: {},
      body: { note: '2-ci mərtəbə suvaq bitdi', progressPercent: 40, photoFileIds: ['a'] },
    });
    expect(validateReportForm({ note: ' ', progress: 101, photoIds: ['1', '2', '3', '4', '5', '6'] }).errors).toEqual({
      note: 'required',
      progress: 'range',
      photos: 'range',
    });
    expect(stepProgress(40, 5)).toBe(45);
    expect(stepProgress(98, 5)).toBe(100);
    expect(stepProgress(3, -5)).toBe(0);
  });

  it('provider phase per project state', () => {
    const now = Date.parse('2026-10-25T10:00:00Z');
    expect(providerPhase(providerProject(), now)).toBe('open');
    expect(providerPhase(providerProject({ quoteDeadline: '2026-10-25T09:00:00Z' }), now)).toBe('closed');
    const quote = {
      id: ID(5000),
      projectId: ID(3000),
      status: 'SUBMITTED' as const,
      provider: { type: 'SOLO' as const, handymanId: ID(1), companyId: null, name: 'Elvin M.', photo: null, ratingAvg: null, ratingCount: 0, completedCount: 0, isVatPayer: false },
      totalAmount: 450000,
      workers: 4,
      days: 3,
      note: null,
      createdAt: '2026-10-25T09:30:00Z',
      feeHeld: 12000,
      feeCaptured: false,
    };
    expect(providerPhase(providerProject({ myQuote: quote }), now)).toBe('quoted');
    // one quote per provider and project (server: CONFLICT ALREADY_QUOTED): a withdrawn quote does not reopen the form
    expect(providerPhase(providerProject({ myQuote: { ...quote, status: 'WITHDRAWN' } }), now)).toBe('closed');
    expect(providerPhase(providerProject({ myQuote: { ...quote, status: 'REJECTED' }, status: 'AWARDED' }), now)).toBe('closed');
    expect(providerPhase(providerProject({ status: 'AWARDED', isAwardedToMe: true, myQuote: { ...quote, status: 'ACCEPTED' } }), now)).toBe('awarded');
    expect(providerPhase(providerProject({ status: 'IN_PROGRESS', isAwardedToMe: true }), now)).toBe('awarded');
    expect(providerPhase(providerProject({ status: 'INVOICED', isAwardedToMe: true }), now)).toBe('invoiced');
  });
});
