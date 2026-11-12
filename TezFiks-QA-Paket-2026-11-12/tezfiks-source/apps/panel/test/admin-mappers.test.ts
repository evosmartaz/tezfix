import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Category } from '@tezfiks/shared';
import {
  adminUserPatch,
  approveBody,
  auditQuery,
  bakuDayBounds,
  bakuLocalToIso,
  decimalText,
  buildCategoryTree,
  casesQuery,
  categoryBody,
  categoryToForm,
  customersQuery,
  dashboardKpis,
  demoRequestBody,
  demoSpawnBody,
  feePerOrder,
  handymanMapState,
  handymenQuery,
  hrefWith,
  instantServices,
  jsonPreview,
  kycImages,
  ledgerQuery,
  liveMapLayers,
  longDate,
  markerHref,
  MAP_COLORS,
  moneyInput,
  parentOptions,
  parseMoneyInput,
  paymentsQuery,
  paymentsTab,
  requestsQuery,
  resolveCaseBody,
  resolveOutcomesFor,
  SETTING_FIELDS,
  settingsPatch,
  settingsToForm,
  signedPercent,
  sortTimeline,
  timelineKey,
  walletAdjustBody,
} from '@/features/admin/mappers';

const UUID = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const UUID2 = '7a1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5c';

describe('URL search params -> contract queries', () => {
  it('keeps valid enum filters and the search text, drops unknown values', () => {
    expect(requestsQuery({ status: 'SEARCHING', q: ' İsmayıl ', junk: 'x' })).toEqual({ status: 'SEARCHING', q: 'İsmayıl' });
    expect(requestsQuery({ status: 'NOPE' })).toEqual({});
    expect(handymenQuery({ tab: 'pending', q: 'ismayil' })).toEqual({ tab: 'pending', q: 'ismayil' });
    expect(handymenQuery({ tab: 'deleted' })).toEqual({});
    expect(customersQuery({ type: 'COMPANY' })).toEqual({ type: 'COMPANY' });
    expect(casesQuery({ status: 'OPEN', type: 'PRICE_DISPUTE' })).toEqual({ status: 'OPEN', type: 'PRICE_DISPUTE' });
    expect(paymentsQuery({ status: 'SUCCEEDED', purpose: 'WALLET_TOPUP' })).toEqual({
      status: 'SUCCEEDED',
      purpose: 'WALLET_TOPUP',
    });
    expect(ledgerQuery({ kind: 'TOPUP', ownerType: 'HANDYMAN', ownerId: 'not-a-uuid' })).toEqual({
      kind: 'TOPUP',
      ownerType: 'HANDYMAN',
    });
    expect(auditQuery({ entityType: 'HandymanProfile', entityId: UUID })).toEqual({
      entityType: 'HandymanProfile',
      entityId: UUID,
    });
  });

  it('takes the first value of repeated params and ignores empty strings', () => {
    expect(requestsQuery({ status: ['COMPLETED', 'CANCELLED'], q: '   ' })).toEqual({ status: 'COMPLETED' });
  });

  it('turns from/to dates into Baku day bounds', () => {
    expect(requestsQuery({ from: '2026-10-01', to: '2026-10-25' })).toEqual({
      from: '2026-10-01T00:00:00.000+04:00',
      to: '2026-10-25T23:59:59.999+04:00',
    });
    expect(bakuDayBounds('2026-02-30')).toBeNull();
    expect(bakuDayBounds('25.10.2026')).toBeNull();
    expect(requestsQuery({ from: 'yesterday' })).toEqual({});
  });

  it('selects the payments tab with ledger as the default', () => {
    expect(paymentsTab({ tab: 'payouts' })).toBe('payouts');
    expect(paymentsTab({ tab: 'x' })).toBe('ledger');
    expect(paymentsTab(undefined)).toBe('ledger');
  });

  it('builds filter links that reset the cursor and drop empty values', () => {
    expect(hrefWith('/admin/handymen', { tab: 'all', q: 'elvin', cursor: 'abc' }, { tab: 'pending' })).toBe(
      '/admin/handymen?tab=pending&q=elvin',
    );
    expect(hrefWith('/admin/handymen', { q: 'elvin' }, { q: '' })).toBe('/admin/handymen');
    expect(hrefWith('/admin/orders', {}, { q: 'Əli Şəkər' })).toBe('/admin/orders?q=%C6%8Fli+%C5%9E%C9%99k%C9%99r');
  });
});

describe('dashboard KPIs (board 05)', () => {
  const base = {
    ordersToday: 142,
    ordersDeltaPct: 12,
    activeHandymen: 87,
    onlineHandymen: 34,
    feeRevenueToday: 142_000,
    feeOrdersToday: 142,
    cancelRate: 0.063,
    cancelRateDelta: -0.011,
  };

  it('formats the deltas and rates like the board', () => {
    const k = dashboardKpis(base, 'az', 1000);
    expect(k.ordersDelta).toBe('+12%');
    expect(k.ordersDeltaTone).toBe('up');
    expect(k.cancelRate).toBe('6,3%');
    expect(k.cancelRateDelta).toBe('-1,1%');
    expect(k.feePerOrder).toBe(1000);
    expect(dashboardKpis(base, 'en', 1000).cancelRate).toBe('6.3%');
  });

  it('handles missing deltas (no orders yesterday)', () => {
    const k = dashboardKpis({ ...base, ordersDeltaPct: null, cancelRateDelta: null }, 'az');
    expect(k.ordersDelta).toBe('—');
    expect(k.ordersDeltaTone).toBe('flat');
    expect(k.cancelRateDelta).toBe('—');
    expect(dashboardKpis({ ...base, ordersDeltaPct: -5 }, 'az').ordersDeltaTone).toBe('down');
  });

  it('derives the fee per order when the request fee is unknown', () => {
    expect(feePerOrder(142_000, 142, null)).toBe(1000);
    expect(feePerOrder(0, 0)).toBe(0);
    expect(feePerOrder(3000, 2, 1000)).toBe(1000);
  });

  it('localizes decimals', () => {
    expect(decimalText(1.5, 'az')).toBe('1,5');
    expect(decimalText(1.5, 'en')).toBe('1.5');
    expect(decimalText(12.345, 'ru', 2)).toBe('12,35');
  });

  it('signs percentages and writes long dates with i18n month names', () => {
    expect(signedPercent(0, 'az')).toBe('0%');
    expect(signedPercent(2.25, 'ru', 1)).toBe('+2,3%');
    const months = ['', 'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
    expect(longDate('2026-09-01', (m) => months[m])).toBe('01 Sentyabr 2026');
    expect(longDate('garbage', (m) => months[m])).toBe('garbage');
  });
});

describe('request timeline', () => {
  it('sorts oldest first and keeps the order of equal timestamps', () => {
    const items = [
      { at: '2026-10-25T10:05:00.000Z', event: 'accepted', actor: null, details: null },
      { at: '2026-10-25T10:00:00.000Z', event: 'created', actor: null, details: null },
      { at: '2026-10-25T10:05:00.000Z', event: 'contact.unlocked', actor: null, details: null },
    ];
    expect(sortTimeline(items).map((i) => i.event)).toEqual(['created', 'accepted', 'contact.unlocked']);
    expect(items[0].event).toBe('accepted');
  });

  it('maps event names to translation keys', () => {
    expect(timelineKey('offers.sent')).toBe('offers_sent');
    expect(timelineKey('EN_ROUTE')).toBe('EN_ROUTE');
  });
});

describe('KYC review', () => {
  const file = (id: string, contentType = 'image/jpeg') => ({
    id,
    kind: 'KYC_ID_FRONT',
    url: `https://api.test/tezfix/api/files/${id}?exp=1&sig=abc&admin=1`,
    contentType,
    width: 100,
    height: 100,
  });

  it('orders documents for side-by-side review and keeps the signed admin URLs', () => {
    const out = kycImages({
      idFront: file('f'),
      idBack: file('b'),
      selfieFront: file('s1'),
      selfieTurn: file('s2'),
      selfieBlink: file('s3'),
      tradeProofs: [file('t1'), file('t2', 'application/pdf')],
      companyDocs: [file('c1')],
    });
    expect(out.id.map((i) => i.key)).toEqual(['idFront', 'idBack']);
    expect(out.id[0].file.url).toBe('https://api.test/tezfix/api/files/f?exp=1&sig=abc&admin=1');
    expect(out.selfies.map((i) => i.key)).toEqual(['selfieFront', 'selfieTurn', 'selfieBlink']);
    expect(out.other.map((i) => `${i.key}${i.index}`)).toEqual(['tradeProof1', 'tradeProof2', 'companyDoc1']);
    expect(out.other[1].isPdf).toBe(true);
  });

  it('sends only the extracted fields that were filled in', () => {
    expect(approveBody({ docNumberLast4: '', birthDate: '', expiry: '' })).toEqual({});
    expect(approveBody({ docNumberLast4: 'ab12', birthDate: '1990-05-01', expiry: ' ' })).toEqual({
      extracted: { docNumberLast4: 'AB12', birthDate: '1990-05-01' },
    });
  });
});

describe('money inputs', () => {
  it('parses AZN text into integer qəpik', () => {
    expect(parseMoneyInput('10')).toBe(1000);
    expect(parseMoneyInput('12,5')).toBe(1250);
    expect(parseMoneyInput('0.01')).toBe(1);
    expect(parseMoneyInput('1.234')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('')).toBeNull();
    expect(moneyInput(1250)).toBe('12.50');
    expect(moneyInput(-5)).toBe('-0.05');
  });

  it('builds a signed wallet adjustment', () => {
    const owner = { type: 'HANDYMAN' as const, id: UUID };
    expect(walletAdjustBody({ direction: 'credit', amount: '25', account: 'WALLET', reason: 'Bonus' }, owner)).toEqual({
      ok: true,
      body: { owner, account: 'WALLET', amount: 2500, reason: 'Bonus' },
    });
    expect(
      walletAdjustBody({ direction: 'debit', amount: '2,50', account: 'EARNINGS', reason: 'Düzəliş' }, owner),
    ).toEqual({ ok: true, body: { owner, account: 'EARNINGS', amount: -250, reason: 'Düzəliş' } });
  });

  it('forces the WALLET account for customers and rejects bad amounts or reasons', () => {
    const customer = { type: 'CUSTOMER_ACCOUNT' as const, id: UUID };
    const out = walletAdjustBody({ direction: 'credit', amount: '5', account: 'EARNINGS', reason: 'Kompensasiya' }, customer);
    expect(out.ok && out.body.account).toBe('WALLET');
    expect(walletAdjustBody({ direction: 'credit', amount: '0', account: 'WALLET', reason: 'abc' }, customer)).toEqual({
      ok: false,
      field: 'amount',
    });
    expect(walletAdjustBody({ direction: 'credit', amount: '100001', account: 'WALLET', reason: 'abc' }, customer)).toEqual({
      ok: false,
      field: 'amount',
    });
    expect(walletAdjustBody({ direction: 'credit', amount: '5', account: 'WALLET', reason: ' a ' }, customer)).toEqual({
      ok: false,
      field: 'reason',
    });
  });
});

describe('case resolution', () => {
  it('offers price outcomes only for price disputes', () => {
    expect(resolveOutcomesFor('PRICE_DISPUTE')).toEqual(['RESOLVED', 'COMPLETE_CASH', 'REPROPOSE_PRICE', 'CANCEL_ASSIGNMENT']);
    expect(resolveOutcomesFor('GUARANTEE')).toEqual(['RESOLVED']);
  });

  it('requires a note and a price for REPROPOSE_PRICE', () => {
    expect(resolveCaseBody({ outcome: 'RESOLVED', note: '  ', labor: '', materials: '' })).toEqual({ ok: false, field: 'note' });
    expect(resolveCaseBody({ outcome: 'COMPLETE_CASH', note: 'Nağd', labor: '99', materials: '' })).toEqual({
      ok: true,
      body: { note: 'Nağd', outcome: 'COMPLETE_CASH' },
    });
    expect(resolveCaseBody({ outcome: 'REPROPOSE_PRICE', note: 'Yeni qiymət', labor: '', materials: '' })).toEqual({
      ok: false,
      field: 'labor',
    });
    expect(resolveCaseBody({ outcome: 'REPROPOSE_PRICE', note: 'Yeni qiymət', labor: '40', materials: '12,50' })).toEqual({
      ok: true,
      body: { note: 'Yeni qiymət', outcome: 'REPROPOSE_PRICE', price: { labor: 4000, materials: 1250 } },
    });
    expect(resolveCaseBody({ outcome: 'REPROPOSE_PRICE', note: 'x', labor: '40', materials: 'abc' })).toEqual({
      ok: false,
      field: 'materials',
    });
  });
});

describe('platform settings form', () => {
  it('covers every platform setting exactly once', () => {
    const keys = SETTING_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('shows money in AZN and sends only changed fields in qəpik', () => {
    const form = settingsToForm(DEFAULT_SETTINGS);
    expect(form.requestFee).toBe('10.00');
    expect(form.offerTtlSec).toBe('30');
    expect(settingsPatch(form, DEFAULT_SETTINGS)).toEqual({ ok: true, patch: {} });
    const changed = { ...form, requestFee: '12,5', offerTtlSec: '20', vatRatePercent: '18' };
    expect(settingsPatch(changed, DEFAULT_SETTINGS)).toEqual({ ok: true, patch: { requestFee: 1250, offerTtlSec: 20 } });
  });

  it('reports invalid and out-of-range fields', () => {
    const form = settingsToForm(DEFAULT_SETTINGS);
    expect(settingsPatch({ ...form, offerTtlSec: '2', maxSlots: 'x', ringStepSec: '1.5' }, DEFAULT_SETTINGS)).toEqual({
      ok: false,
      errors: ['ringStepSec', 'maxSlots'],
    });
    const out = settingsPatch({ ...form, offerTtlSec: '2' }, DEFAULT_SETTINGS);
    expect(out).toEqual({ ok: false, errors: ['offerTtlSec'] });
  });
});

function category(over: Partial<Category>): Category {
  return {
    id: UUID,
    slug: 'santexnik',
    parentId: null,
    vertical: 'HOME',
    kind: 'SERVICE',
    name: 'Santexnik',
    names: { az: 'Santexnik', ru: 'Сантехник', en: 'Plumber' },
    icon: 'water-pump',
    featured: true,
    flow: 'INSTANT',
    emergencyAllowed: true,
    sortOrder: 1,
    active: true,
    keywords: ['kran', 'su'],
    ...over,
  };
}

describe('categories', () => {
  const group = category({ id: UUID2, slug: 'ev', kind: 'GROUP', name: 'Ev', sortOrder: 0 });
  const plumber = category({ parentId: UUID2, sortOrder: 2 });
  const electric = category({
    id: '8a1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5d',
    slug: 'elektrik',
    name: 'Elektrik',
    parentId: UUID2,
    sortOrder: 1,
    flow: 'QUOTE',
  });
  const orphan = category({ id: '9a1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5e', slug: 'x', name: 'X', parentId: UUID, sortOrder: 5 });

  it('builds the tree sorted by sortOrder', () => {
    const tree = buildCategoryTree([plumber, group, electric]);
    expect(tree).toHaveLength(1);
    expect(tree[0].category.slug).toBe('ev');
    expect(tree[0].children.map((c) => c.category.slug)).toEqual(['elektrik', 'santexnik']);
  });

  it('nests under any existing parent and puts orphans at the root', () => {
    const lonely = category({ id: 'aa1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5f', slug: 'y', name: 'Y', parentId: 'ba1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a50' });
    const tree = buildCategoryTree([group, lonely]);
    expect(tree.map((n) => n.category.slug)).toEqual(['ev', 'y']);
    expect(buildCategoryTree([orphan]).map((n) => n.category.slug)).toEqual(['x']);
  });

  it('round-trips the form and normalizes keywords', () => {
    const form = categoryToForm(plumber);
    expect(form.keywords).toBe('kran, su');
    expect(categoryBody({ ...form, keywords: 'kran, su,\n su ,boru', slug: ' Santexnik ', icon: ' ' })).toEqual({
      slug: 'santexnik',
      parentId: UUID2,
      vertical: 'HOME',
      kind: 'SERVICE',
      names: { az: 'Santexnik', ru: 'Сантехник', en: 'Plumber' },
      icon: null,
      featured: true,
      flow: 'INSTANT',
      emergencyAllowed: true,
      sortOrder: 2,
      active: true,
      keywords: ['kran', 'su', 'boru'],
    });
    expect(categoryBody(categoryToForm(null)).parentId).toBeNull();
  });

  it('lists parent groups of the same vertical and instant services for demo requests', () => {
    const autoGroup = category({ id: 'ca1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a51', kind: 'GROUP', vertical: 'AUTO', name: 'Avto' });
    expect(parentOptions([group, autoGroup, plumber], 'HOME').map((c) => c.slug)).toEqual(['ev']);
    expect(parentOptions([group], 'HOME', UUID2)).toEqual([]);
    const inactive = category({ id: 'da1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a52', active: false, name: 'Z' });
    expect(instantServices([group, plumber, electric, inactive]).map((c) => c.slug)).toEqual(['santexnik']);
  });
});

describe('live map layers', () => {
  const map = {
    handymen: [
      { id: 'h1', name: 'Elvin M.', lat: 40.4, lng: 49.8, isOnline: true, busy: false, isBot: false, companyName: null },
      { id: 'h2', name: 'Rauf H.', lat: 40.41, lng: 49.81, isOnline: true, busy: true, isBot: false, companyName: 'FixPro MMC' },
      { id: 'h3', name: 'Bot 1', lat: 40.42, lng: 49.82, isOnline: true, busy: false, isBot: true, companyName: null },
      { id: 'h4', name: 'Samir Q.', lat: 40.43, lng: 49.83, isOnline: false, busy: false, isBot: false, companyName: null },
    ],
    requests: [
      { id: 'r1', number: 2847, lat: 40.39, lng: 49.85, isSearching: true, categoryName: 'Santexnik', cells: ['c1', 'c2', 'bad'] },
      { id: 'r2', number: 2846, lat: 40.38, lng: 49.86, isSearching: false, categoryName: 'Elektrik', cells: ['c3'] },
    ],
  };
  const boundary = (cell: string): Array<[number, number]> => {
    if (cell === 'bad') throw new Error('invalid cell');
    return [
      [40, 49],
      [40.01, 49],
      [40.01, 49.01],
    ];
  };

  it('colours handymen by state and draws hexagons only for searching requests', () => {
    const layers = liveMapLayers(map, boundary);
    expect(layers.counts).toEqual({ online: 1, busy: 1, bot: 1, offline: 1, requests: 2, searching: 1 });
    expect(layers.markers.find((m) => m.id === 'h:h2')).toMatchObject({ color: MAP_COLORS.busy, label: 'Rauf H. · FixPro MMC' });
    expect(layers.markers.find((m) => m.id === 'r:r1')).toMatchObject({ label: '#2847 · Santexnik', color: MAP_COLORS.request });
    expect(layers.polygons.map((p) => p.id)).toEqual(['r1:c1', 'r1:c2']);
    expect(layers.polygons[0].points[1]).toEqual({ lat: 40.01, lng: 49 });
  });

  it('routes marker clicks and classifies states', () => {
    expect(markerHref('h:abc')).toBe('/admin/handymen/abc');
    expect(markerHref('r:abc')).toBe('/admin/orders/abc');
    expect(markerHref('zzz')).toBeNull();
    expect(handymanMapState({ isOnline: true, busy: true, isBot: true })).toBe('busy');
    expect(handymanMapState({ isOnline: false, busy: false, isBot: true })).toBe('offline');
  });
});

describe('demo test request', () => {
  const form = { categoryId: UUID, timing: 'NOW' as const, slots: '2', scheduledAt: '', description: '  Kran axır ' };

  it('needs a map point, a category and 1..10 handymen', () => {
    expect(demoRequestBody(form, null)).toEqual({ ok: false, field: 'point' });
    expect(demoRequestBody({ ...form, categoryId: '' }, { lat: 40, lng: 49 })).toEqual({ ok: false, field: 'categoryId' });
    expect(demoRequestBody({ ...form, slots: '11' }, { lat: 40, lng: 49 })).toEqual({ ok: false, field: 'slots' });
    expect(demoRequestBody(form, { lat: 40.1234567891, lng: 49.87654321 })).toEqual({
      ok: true,
      body: { categoryId: UUID, lat: 40.123457, lng: 49.876543, timing: 'NOW', slots: 2, description: 'Kran axır' },
    });
  });

  it('converts the scheduled time from Baku wall time', () => {
    expect(bakuLocalToIso('2026-10-25T18:30')).toBe('2026-10-25T18:30:00.000+04:00');
    expect(bakuLocalToIso('2026-10-25')).toBeNull();
    expect(demoRequestBody({ ...form, timing: 'SCHEDULED' }, { lat: 40, lng: 49 })).toEqual({ ok: false, field: 'scheduledAt' });
    const out = demoRequestBody({ ...form, timing: 'SCHEDULED', scheduledAt: '2026-10-26T09:00' }, { lat: 40, lng: 49 });
    expect(out.ok && out.body.scheduledAt).toBe('2026-10-26T09:00:00.000+04:00');
  });
});

describe('admins and audit', () => {
  it('patches only changed admin fields', () => {
    const current = { name: 'Aysel', role: 'OPERATOR', active: true };
    expect(adminUserPatch({ name: 'Aysel', role: 'OPERATOR', active: true, password: '' }, current)).toEqual({});
    expect(adminUserPatch({ name: ' Aysel Q. ', role: 'ADMIN', active: false, password: 'new-secret-123' }, current)).toEqual({
      name: 'Aysel Q.',
      role: 'ADMIN',
      active: false,
      password: 'new-secret-123',
    });
  });

  it('pretty-prints and truncates audit snapshots', () => {
    expect(jsonPreview(null)).toBe('—');
    expect(jsonPreview({ status: 'APPROVED' })).toBe('{\n  "status": "APPROVED"\n}');
    expect(jsonPreview({ a: 'x'.repeat(50) }, 10)).toHaveLength(11);
  });
});

describe('demoSpawnBody', () => {
  const center = { lat: 40.38, lng: 49.84 };
  const form = { count: '8', radius: '3', tradeId: '', companyId: '' };
  const trade = '0a1b2c3d-9999-4999-8999-000000000001';
  const company = '0a1b2c3d-4444-4444-8444-000000000001';

  it('sends only count, radius and center when no trade or company is chosen', () => {
    expect(demoSpawnBody(form, center)).toEqual({ ok: true, body: { count: 8, radiusKm: 3, center } });
    const r = demoSpawnBody(form, center);
    expect(r.ok && Object.keys(r.body)).toEqual(['count', 'radiusKm', 'center']);
  });

  it('adds tradeIds and companyId (bots as company workers) when chosen', () => {
    expect(demoSpawnBody({ ...form, radius: '2,5', tradeId: trade, companyId: company }, center)).toEqual({
      ok: true,
      body: { count: 8, radiusKm: 2.5, center, tradeIds: [trade], companyId: company },
    });
  });

  it('rejects values outside the contract limits', () => {
    expect(demoSpawnBody({ ...form, count: '0' }, center)).toEqual({ ok: false, field: 'count' });
    expect(demoSpawnBody({ ...form, count: '51' }, center)).toEqual({ ok: false, field: 'count' });
    expect(demoSpawnBody({ ...form, count: '2.5' }, center)).toEqual({ ok: false, field: 'count' });
    expect(demoSpawnBody({ ...form, count: '' }, center)).toEqual({ ok: false, field: 'count' });
    expect(demoSpawnBody({ ...form, radius: '0.2' }, center)).toEqual({ ok: false, field: 'radius' });
    expect(demoSpawnBody({ ...form, radius: '21' }, center)).toEqual({ ok: false, field: 'radius' });
    expect(demoSpawnBody({ ...form, radius: '' }, center)).toEqual({ ok: false, field: 'radius' });
    expect(demoSpawnBody({ ...form, tradeId: 'x' }, center)).toEqual({ ok: false, field: 'tradeId' });
    expect(demoSpawnBody({ ...form, companyId: 'not-a-uuid' }, center)).toEqual({ ok: false, field: 'companyId' });
  });
});
