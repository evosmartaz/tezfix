import { CreateProjectBodySchema } from '@tezfiks/shared';
import { accountFormFromAccount } from '../src/lib/accountForm';
import { applyPin, emptyAddressDraft } from '../src/lib/address';
import { categoryFormHref, findCategory } from '../src/lib/categories';
import { createKeyRegistry } from '../src/lib/idempotency';
import { badgeText, notificationHref, notificationIcon } from '../src/lib/notifications';
import { deleteConfirmMatches, profilePatch, validateNames } from '../src/lib/profile';
import {
  buildCreateProjectBody,
  canAcceptQuote,
  cheapestQuoteId,
  firstProjectError,
  formatDay,
  isActiveProject,
  latestProgress,
  quotePerWorkerDay,
  sortQuotes,
  validateProjectForm,
  workDays,
  type ProjectFormValues,
} from '../src/lib/projects';
import { IDS, account, categories } from './fixtures';
import { M3, companyQuote, notification, project, quote, report } from './fixtures-m3';

const NOW = new Date('2099-10-10T08:00:00.000Z');

function form(over: Partial<ProjectFormValues> = {}): ProjectFormValues {
  return {
    categoryId: IDS.brigade,
    title: '  Ofisin təmiri ',
    scope: ' ≈ 450 m² (3 mərtəbə, 12 otaq) ',
    dateFrom: '2099-10-15',
    dateTo: '2099-10-19',
    workersNeeded: 3,
    description: '  Ofis divarlarının rənglənməsi ',
    photoFileIds: [],
    address: { ...applyPin(emptyAddressDraft(), 40.4, 49.86), formatted: 'Nizami küç. 203', entrance: '2' },
    ...over,
  };
}

describe('B2B project form', () => {
  const brigade = findCategory(categories(), IDS.brigade);
  const plumbing = findCategory(categories(), IDS.plumbing);

  it('work days are an inclusive calendar span', () => {
    expect(workDays('2099-10-15', '2099-10-19')).toBe(5);
    expect(workDays('2099-10-15', '2099-10-15')).toBe(1);
    expect(workDays('2099-10-31', '2099-11-01')).toBe(2);
    expect(workDays('2099-10-19', '2099-10-15')).toBe(0);
    expect(workDays(null, '2099-10-15')).toBe(0);
    expect(workDays('15.10.2099', '2099-10-15')).toBe(0);
  });

  it('a valid form builds a contract-valid body with trimmed Azerbaijani text', () => {
    expect(validateProjectForm(form(), { category: brigade, now: NOW })).toEqual({});
    const body = buildCreateProjectBody(form());
    expect(CreateProjectBodySchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      categoryId: IDS.brigade,
      title: 'Ofisin təmiri',
      scope: '≈ 450 m² (3 mərtəbə, 12 otaq)',
      dateFrom: '2099-10-15',
      dateTo: '2099-10-19',
      workersNeeded: 3,
      description: 'Ofis divarlarının rənglənməsi',
      address: { lat: 40.4, lng: 49.86, formatted: 'Nizami küç. 203', entrance: '2' },
    });
    expect('title' in buildCreateProjectBody(form({ title: '   ' }))).toBe(false);
  });

  it('reports every invalid field', () => {
    const e = validateProjectForm(
      form({ categoryId: null, scope: 'x', dateFrom: null, dateTo: null, workersNeeded: 0, description: 'ab', address: emptyAddressDraft(), title: 'x'.repeat(121) }),
      { category: null, now: NOW },
    );
    expect(e).toEqual({
      category: 'project.errors.categoryRequired',
      scope: 'project.errors.scopeRequired',
      dateFrom: 'project.errors.datesRequired',
      dateTo: 'project.errors.datesRequired',
      workersNeeded: 'project.errors.workersRange',
      description: 'project.errors.descriptionTooShort',
      address: 'request.errors.addressRequired',
      title: 'project.errors.titleTooLong',
    });
    expect(firstProjectError(e)).toEqual({ field: 'category', key: 'project.errors.categoryRequired' });
  });

  it('only quote-only services; no past start (Baku day); end not before start', () => {
    expect(validateProjectForm(form({ categoryId: IDS.plumbing }), { category: plumbing, now: NOW }).category).toBe('project.errors.categoryNotQuote');
    expect(validateProjectForm(form({ dateFrom: '2099-10-09' }), { category: brigade, now: NOW }).dateFrom).toBe('project.errors.dateInPast');
    // 2099-10-09T21:00Z is already 10 Oct in Baku.
    expect(validateProjectForm(form({ dateFrom: '2099-10-10', dateTo: '2099-10-10' }), { category: brigade, now: new Date('2099-10-09T21:00:00.000Z') })).toEqual({});
    expect(validateProjectForm(form({ dateTo: '2099-10-14' }), { category: brigade, now: NOW }).dateTo).toBe('project.errors.dateOrder');
    expect(validateProjectForm(form({ workersNeeded: 101 }), { category: brigade, now: NOW }).workersNeeded).toBe('project.errors.workersRange');
  });
});

describe('quotes comparison', () => {
  it('sorts open quotes by price or rating; closed ones last', () => {
    const withdrawn = quote({ id: M3.quoteThird, status: 'WITHDRAWN', totalAmount: 100 });
    const list = [quote(), companyQuote(), withdrawn];
    expect(sortQuotes(list, 'price').map((q) => q.id)).toEqual([M3.quoteCompany, M3.quoteSolo, M3.quoteThird]);
    expect(sortQuotes(list, 'rating').map((q) => q.id)).toEqual([M3.quoteSolo, M3.quoteCompany, M3.quoteThird]);
    expect(cheapestQuoteId(list)).toBe(M3.quoteCompany);
    expect(cheapestQuoteId([withdrawn])).toBeNull();
  });

  it('price per worker-day and acceptance rules', () => {
    expect(quotePerWorkerDay(quote())).toBe(30000);
    expect(quotePerWorkerDay(companyQuote())).toBe(24375);
    expect(canAcceptQuote(project(), quote())).toBe(true);
    expect(canAcceptQuote(project({ status: 'AWARDED' }), quote())).toBe(false);
    expect(canAcceptQuote(project(), quote({ status: 'WITHDRAWN' }))).toBe(false);
  });

  it('progress from the newest report; active statuses; Baku day format', () => {
    expect(latestProgress(project())).toBe(0);
    expect(latestProgress(project({ reports: [report({ id: 'a', reportDate: '2099-10-16', progressPercent: 40 }), report({ id: 'b', reportDate: '2099-10-17', progressPercent: 70 })] }))).toBe(70);
    expect(isActiveProject('INVOICED')).toBe(true);
    expect(isActiveProject('PAID')).toBe(false);
    expect(formatDay('2099-10-05')).toBe('05.10.2099');
  });
});

describe('quote-only services route to the business form', () => {
  it('categoryFormHref', () => {
    expect(categoryFormHref(findCategory(categories(), IDS.brigade)!)).toEqual({ pathname: '/project/new', params: { categoryId: IDS.brigade } });
    expect(categoryFormHref(findCategory(categories(), IDS.plumbing)!, { description: 'x' })).toEqual({ pathname: '/request/new', params: { categoryId: IDS.plumbing, description: 'x' } });
  });
});

describe('notifications', () => {
  it('opens what the notification is about', () => {
    expect(notificationHref(notification())).toBe(`/assignment/${IDS.assignment}`);
    expect(notificationHref(notification({ type: 'CHAT_MESSAGE' }))).toBe(`/assignment/${IDS.assignment}/chat`);
    expect(notificationHref(notification({ type: 'PRICE_PROPOSED' }))).toBe(`/assignment/${IDS.assignment}/pay`);
    expect(notificationHref(notification({ type: 'QUOTE_RECEIVED', data: { projectId: M3.project } }))).toBe(`/project/${M3.project}`);
    expect(notificationHref(notification({ type: 'REQUEST_EXPIRED', data: { requestId: IDS.request } }))).toBe(`/request/${IDS.request}`);
    expect(notificationHref(notification({ type: 'WALLET_TOPUP', data: {} }))).toBe('/wallet');
    expect(notificationHref(notification({ type: 'CASE_UPDATED', data: { caseId: M3.case } }))).toBe('/cases');
    expect(notificationHref(notification({ type: 'GENERIC', data: {} }))).toBeNull();
    expect(notificationHref(notification({ type: 'CHAT_MESSAGE', data: {} }))).toBeNull();
  });

  it('badge text and icons', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(3)).toBe('3');
    expect(badgeText(12)).toBe('9+');
    expect(notificationIcon('QUOTE_RECEIVED')).toBe('briefcase-outline');
    expect(notificationIcon('WALLET_LOW')).toBe('wallet-outline');
    expect(notificationIcon('CHAT_MESSAGE')).toBe('chatbubble-outline');
  });
});

describe('profile', () => {
  it('names: required, at most 60, Azerbaijani letters kept', () => {
    expect(validateNames('İlkin', 'Əliyev')).toEqual({});
    expect(validateNames(' ', '')).toEqual({ firstName: 'auth.firstNameRequired', lastName: 'auth.lastNameRequired' });
    expect(validateNames('a'.repeat(61), 'b')).toEqual({ firstName: 'profile.nameTooLong' });
  });

  it('PATCH /me sends only what changed', () => {
    expect(profilePatch({ firstName: 'Nizami', lastName: 'Tağızadə' }, { firstName: ' Nizami ', lastName: 'Tağızadə' })).toBeNull();
    expect(profilePatch({ firstName: 'Nizami', lastName: 'Tağızadə' }, { firstName: 'Nizami', lastName: 'Talıbov' })).toEqual({ lastName: 'Talıbov' });
    expect(profilePatch({ firstName: 'N', lastName: 'T' }, { firstName: 'N', lastName: 'T', photoFileId: null })).toEqual({ photoFileId: null });
  });

  it('delete confirmation folds case and dotted/dotless i', () => {
    expect(deleteConfirmMatches('SİL', 'SİL')).toBe(true);
    expect(deleteConfirmMatches('sil', 'SİL')).toBe(true);
    expect(deleteConfirmMatches('SIL ', 'SİL')).toBe(true);
    expect(deleteConfirmMatches('', 'SİL')).toBe(false);
    expect(deleteConfirmMatches('SAL', 'SİL')).toBe(false);
    expect(deleteConfirmMatches('удалить', 'УДАЛИТЬ')).toBe(true);
  });

  it('company form prefilled from the account', () => {
    expect(accountFormFromAccount(account({ type: 'COMPANY', companyName: 'Kontur MMC', voen: '1234567890', legalForm: 'MMC', contactPerson: null }), 'Nizami')).toEqual({
      type: 'COMPANY',
      companyName: 'Kontur MMC',
      voen: '1234567890',
      legalForm: 'MMC',
      contactPerson: 'Nizami',
    });
    expect(accountFormFromAccount(null).type).toBe('INDIVIDUAL');
  });
});

describe('idempotency keys per action', () => {
  it('reuses the key after a connectivity failure, frees it after success or a business error', () => {
    let n = 0;
    const keys = createKeyRegistry(() => `k${++n}`);
    expect(keys.get('cancel')).toBe('k1');
    keys.settle('cancel', { code: 'NETWORK' });
    expect(keys.get('cancel')).toBe('k1');
    keys.settle('cancel', { code: 'INTERNAL', status: 500 });
    expect(keys.get('cancel')).toBe('k1');
    keys.settle('cancel', { code: 'CANCEL_NOT_ALLOWED' });
    expect(keys.peek('cancel')).toBeNull();
    expect(keys.get('cancel')).toBe('k2');
    keys.settle('cancel');
    expect(keys.get('cancel')).toBe('k3');
    expect(keys.get('topup')).toBe('k4');
  });
});
