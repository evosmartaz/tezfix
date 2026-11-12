import { describe, expect, it } from 'vitest';
import {
  CompanySettingsBodySchema,
  CreateInviteBodySchema,
  PayoutMethodBodySchema,
  PriceInputSchema,
  ReportBodySchema,
  SubmitQuoteBodySchema,
  CompleteProjectBodySchema,
  api,
} from '@tezfiks/shared';
import {
  asScope,
  canEditMember,
  completeBody,
  customerShortName,
  defaultQuoteForm,
  feeState,
  managerCanEnterPrice,
  pageVersion,
  etaMinutes,
  inviteActive,
  inviteBody,
  linesSubtotal,
  memberTradesBody,
  parseCount,
  parseMoney,
  payoutMethodBody,
  personName,
  priceBody,
  priceTotal,
  projectDays,
  quoteBody,
  quoteFeePreview,
  quoteWindowOpen,
  reassignCandidates,
  reportBody,
  requestNo,
  settingsBody,
  settingsFormOf,
  topupBody,
  topupReturnUrl,
} from '@/features/company/mappers';
import { CID, PID, assignment, companyView, electric, invite, member, members, plumbing, providerProject } from './company-fixtures';

describe('money and counts', () => {
  it('parses AZN text into qəpik', () => {
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('12.50')).toBe(1250);
    expect(parseMoney(' 1 200 ')).toBe(120000);
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('-5')).toBeNull();
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseCount('3')).toBe(3);
    expect(parseCount('3.5')).toBeNull();
    expect(parseCount('-1')).toBeNull();
    expect(parseCount(4)).toBe(4);
    expect(requestNo(2851)).toBe('#2851');
    expect(personName({ firstName: 'Rauf', lastName: 'Hüseynov' })).toBe('Rauf Hüseynov');
  });
});

describe('top-up', () => {
  it('builds a contract body within 1..1000 AZN', () => {
    const r = topupBody('50', 'https://tezfiks.az/tezfix/company/x/balance?topup=done');
    expect(r).toEqual({ ok: true, body: { amount: 5000, returnUrl: 'https://tezfiks.az/tezfix/company/x/balance?topup=done' } });
    expect(api.company.topup.body.safeParse((r as { body: unknown }).body).success).toBe(true);
    expect(topupBody('1')).toEqual({ ok: true, body: { amount: 100 } });
    expect(topupBody('0,99')).toEqual({ ok: false, field: 'amount' });
    expect(topupBody('1000.01')).toEqual({ ok: false, field: 'amount' });
    expect(topupBody('x')).toEqual({ ok: false, field: 'amount' });
  });

  it('returns to the company Balans page of the panel', () => {
    expect(topupReturnUrl('https://tezfiks.az', CID)).toBe(`https://tezfiks.az/tezfix/company/${CID}/balance?topup=done`);
    expect(topupReturnUrl('http://127.0.0.1:3120/whatever', CID)).toBe(`http://127.0.0.1:3120/tezfix/company/${CID}/balance?topup=done`);
    expect(topupReturnUrl('javascript:alert(1)', CID)).toBeUndefined();
    expect(topupReturnUrl(null, CID)).toBeUndefined();
    expect(topupReturnUrl('not a url', CID)).toBeUndefined();
  });
});

describe('manager price entry', () => {
  it('labor + materials in qəpik, materials optional', () => {
    const r = priceBody({ labor: '40', materials: '15,50' });
    expect(r).toEqual({ ok: true, body: { labor: 4000, materials: 1550 } });
    expect(PriceInputSchema.safeParse((r as { body: unknown }).body).success).toBe(true);
    expect(priceBody({ labor: '40', materials: '' })).toEqual({ ok: true, body: { labor: 4000, materials: 0 } });
    expect(priceTotal({ labor: '40', materials: '15,50' })).toBe(5550);
    expect(priceTotal({ labor: '', materials: '' })).toBe(0);
    expect(priceTotal({ labor: 'x', materials: '' })).toBeNull();
  });

  it('rejects empty, zero, negative and too large prices', () => {
    expect(priceBody({ labor: '', materials: '10' })).toEqual({ ok: false, field: 'labor' });
    expect(priceBody({ labor: '0', materials: '0' })).toEqual({ ok: false, field: 'labor' });
    expect(priceBody({ labor: '10', materials: '-1' })).toEqual({ ok: false, field: 'materials' });
    expect(priceBody({ labor: '100001', materials: '' })).toEqual({ ok: false, field: 'labor' });
  });
});

describe('reassign candidates', () => {
  it('active members with the trade, except the current worker; busy ones listed but not selectable', () => {
    const list = reassignCandidates(members, assignment());
    expect(list.map((c) => c.handymanId)).toEqual([PID.tural, PID.kamran]);
    expect(list.find((c) => c.handymanId === PID.kamran)!.selectable).toBe(false);
    expect(list[0]!.phone).toBe('+994552223344');
    // Removed members and members without the trade are left out.
    const more = [...members, member({ userId: 'c5555555-5555-4555-8555-aaaaaaaaaaaa', handymanId: 'c5555555-5555-4555-8555-555555555555', status: 'REMOVED' })];
    expect(reassignCandidates(more, assignment()).map((c) => c.handymanId)).toEqual([PID.tural, PID.kamran]);
    expect(reassignCandidates(members, assignment({ category: plumbing })).map((c) => c.handymanId)).toEqual([PID.nijat]);
  });
});

describe('members and invites', () => {
  it('member trades 1..15', () => {
    expect(memberTradesBody([electric.id, electric.id])).toEqual({ ok: true, body: { tradeIds: [electric.id] } });
    expect(memberTradesBody([])).toEqual({ ok: false, field: 'tradeIds' });
  });

  it('the manager cannot edit or remove themselves', () => {
    expect(canEditMember(member(), PID.managerUser)).toBe(true);
    expect(canEditMember(member({ userId: PID.managerUser }), PID.managerUser)).toBe(false);
    expect(canEditMember(member({ status: 'REMOVED' }), PID.managerUser)).toBe(false);
  });

  it('invite form limits', () => {
    const r = inviteBody({ role: 'WORKER', maxUses: '10', expiresInDays: '7' });
    expect(r).toEqual({ ok: true, body: { role: 'WORKER', maxUses: 10, expiresInDays: 7 } });
    expect(CreateInviteBodySchema.safeParse((r as { body: unknown }).body).success).toBe(true);
    expect(inviteBody({ role: 'MANAGER', maxUses: '0', expiresInDays: '7' })).toEqual({ ok: false, field: 'maxUses' });
    expect(inviteBody({ role: 'WORKER', maxUses: '101', expiresInDays: '7' })).toEqual({ ok: false, field: 'maxUses' });
    expect(inviteBody({ role: 'WORKER', maxUses: '5', expiresInDays: '31' })).toEqual({ ok: false, field: 'expiresInDays' });
  });

  it('invite activity', () => {
    const now = Date.parse('2026-10-26T00:00:00.000Z');
    expect(inviteActive(invite, now)).toBe(true);
    expect(inviteActive({ ...invite, revokedAt: '2026-10-25T11:00:00.000Z' }, now)).toBe(false);
    expect(inviteActive({ ...invite, usedCount: 10 }, now)).toBe(false);
    expect(inviteActive(invite, Date.parse('2026-11-02T00:00:00.000Z'))).toBe(false);
  });
});

describe('payout card', () => {
  it('normalizes a card number and the holder name', () => {
    const r = payoutMethodBody({ type: 'CARD', number: '4169 7388 1234 5670', holderName: '  Elvin   Məmmədov ' });
    expect(r).toEqual({ ok: true, body: { type: 'CARD', number: '4169738812345670', holderName: 'Elvin Məmmədov' } });
    expect(PayoutMethodBodySchema.safeParse((r as { body: unknown }).body).success).toBe(true);
  });

  it('accepts an AZ IBAN and rejects malformed numbers', () => {
    expect(payoutMethodBody({ type: 'IBAN', number: 'az21 nabz 0000 0000 1370 1000 1944', holderName: 'FixPro MMC' })).toEqual({
      ok: true,
      body: { type: 'IBAN', number: 'AZ21NABZ00000000137010001944', holderName: 'FixPro MMC' },
    });
    expect(payoutMethodBody({ type: 'CARD', number: '4169 7388', holderName: 'Elvin' })).toEqual({ ok: false, field: 'number' });
    // Luhn check (the API refuses it): 4169738812345678 fails the checksum.
    expect(payoutMethodBody({ type: 'CARD', number: '4169 7388 1234 5678', holderName: 'Elvin' })).toEqual({ ok: false, field: 'number' });
    // IBAN bank code must be 4 letters.
    expect(payoutMethodBody({ type: 'IBAN', number: 'AZ21 0000 0000 0000 1370 1000 1944', holderName: 'Elvin' })).toEqual({ ok: false, field: 'number' });
    expect(payoutMethodBody({ type: 'IBAN', number: '4169738812345678', holderName: 'Elvin' })).toEqual({ ok: false, field: 'number' });
    expect(payoutMethodBody({ type: 'CARD', number: '4169738812345670', holderName: 'El' })).toEqual({ ok: false, field: 'holderName' });
  });
});

describe('company settings', () => {
  it('an unchanged form sends nothing', () => {
    const c = companyView();
    expect(settingsBody(c, settingsFormOf(c))).toEqual({ ok: true, body: {} });
  });

  it('sends only the changed fields (final price entry, VAT, trades, radius, base, Azerbaijani text intact)', () => {
    const c = companyView();
    const form = {
      ...settingsFormOf(c),
      name: ' Şəki Ustaları MMC ',
      finalPriceEntry: 'WORKER' as const,
      isVatPayer: false,
      tradeIds: [electric.id, plumbing.id],
      serviceRadiusKm: '20',
      baseLat: '40,41',
      baseLng: '49.87',
      baseAddress: 'İçərişəhər, Qüllə küç. 3',
    };
    const r = settingsBody(c, form);
    expect(r).toEqual({
      ok: true,
      body: {
        name: 'Şəki Ustaları MMC',
        finalPriceEntry: 'WORKER',
        isVatPayer: false,
        tradeIds: [electric.id, plumbing.id],
        serviceRadiusKm: 20,
        base: { lat: 40.41, lng: 49.87 },
        baseAddress: 'İçərişəhər, Qüllə küç. 3',
      },
    });
    expect(CompanySettingsBodySchema.safeParse((r as { body: unknown }).body).success).toBe(true);
  });

  it('validates name, trades, radius and coordinates', () => {
    const c = companyView();
    const f = settingsFormOf(c);
    expect(settingsBody(c, { ...f, name: 'A' })).toEqual({ ok: false, field: 'name' });
    expect(settingsBody(c, { ...f, tradeIds: [] })).toEqual({ ok: false, field: 'tradeIds' });
    expect(settingsBody(c, { ...f, serviceRadiusKm: '1' })).toEqual({ ok: false, field: 'serviceRadiusKm' });
    expect(settingsBody(c, { ...f, serviceRadiusKm: '51' })).toEqual({ ok: false, field: 'serviceRadiusKm' });
    expect(settingsBody(c, { ...f, baseLat: '91' })).toEqual({ ok: false, field: 'base' });
    expect(settingsBody(c, { ...f, baseLng: '' })).toEqual({ ok: false, field: 'base' });
  });
});

describe('B2B projects', () => {
  it('fee preview = fee per worker-day × workers × days', () => {
    expect(quoteFeePreview(1000, '3', '5')).toBe(15000);
    expect(quoteFeePreview(1000, '0', '5')).toBeNull();
    expect(quoteFeePreview(1000, '3', '')).toBeNull();
  });

  it('default quote form uses the project workers and inclusive day span', () => {
    expect(projectDays('2026-11-01', '2026-11-05')).toBe(5);
    expect(projectDays('2026-11-01', '2026-11-01')).toBe(1);
    expect(defaultQuoteForm(providerProject())).toEqual({ total: '', workers: '3', days: '5', note: '' });
  });

  it('builds the quote body acting as the company', () => {
    const r = quoteBody({ total: '5000', workers: '3', days: '5', note: ' Material daxil deyil ' }, CID);
    expect(r).toEqual({ ok: true, body: { companyId: CID, totalAmount: 500000, workers: 3, days: 5, note: 'Material daxil deyil' } });
    expect(SubmitQuoteBodySchema.safeParse((r as { body: unknown }).body).success).toBe(true);
    expect(quoteBody({ total: '0,5', workers: '3', days: '5', note: '' }, CID)).toEqual({ ok: false, field: 'total' });
    expect(quoteBody({ total: '100', workers: '0', days: '5', note: '' }, CID)).toEqual({ ok: false, field: 'workers' });
    expect(quoteBody({ total: '100', workers: '1', days: '366', note: '' }, CID)).toEqual({ ok: false, field: 'days' });
  });

  it('daily report body', () => {
    const r = reportBody({ note: 'Kabel çəkildi', progress: '40', reportDate: '2026-11-02' }, CID);
    expect(r).toEqual({ ok: true, body: { companyId: CID, note: 'Kabel çəkildi', progressPercent: 40, reportDate: '2026-11-02' } });
    expect(ReportBodySchema.safeParse((r as { body: unknown }).body).success).toBe(true);
    expect(reportBody({ note: ' ', progress: '40', reportDate: '' }, CID)).toEqual({ ok: false, field: 'note' });
    expect(reportBody({ note: 'x', progress: '101', reportDate: '' }, CID)).toEqual({ ok: false, field: 'progress' });
    expect(reportBody({ note: 'x', progress: '10', reportDate: '02.11.2026' }, CID)).toEqual({ ok: false, field: 'reportDate' });
  });

  it('invoice lines: blank -> default line; otherwise every row validated', () => {
    expect(completeBody([{ description: '', amount: '' }], CID)).toEqual({ ok: true, body: { companyId: CID } });
    const r = completeBody(
      [
        { description: 'Elektrik işləri', amount: '4000' },
        { description: '', amount: '' },
        { description: 'Material', amount: '1000,50' },
      ],
      CID,
    );
    expect(r).toEqual({
      ok: true,
      body: { companyId: CID, lines: [{ description: 'Elektrik işləri', amount: 400000 }, { description: 'Material', amount: 100050 }] },
    });
    expect(CompleteProjectBodySchema.safeParse((r as { body: unknown }).body).success).toBe(true);
    expect(completeBody([{ description: 'x', amount: '' }], CID)).toEqual({ ok: false, field: 'lines.0' });
    expect(completeBody([{ description: '', amount: '1' }, { description: '', amount: '5' }], CID)).toEqual({ ok: false, field: 'lines.0' });
    expect(linesSubtotal([{ description: 'a', amount: '10' }, { description: 'b', amount: '' }])).toBe(1000);
    expect(linesSubtotal([{ description: 'a', amount: 'x' }])).toBeNull();
  });

  it('quote window', () => {
    const p = providerProject();
    expect(quoteWindowOpen(p, Date.parse('2026-10-26T09:59:59.000Z'))).toBe(true);
    expect(quoteWindowOpen(p, Date.parse('2026-10-26T10:00:00.000Z'))).toBe(false);
    expect(quoteWindowOpen({ ...p, status: 'AWARDED' }, 0)).toBe(false);
  });
});

describe('misc', () => {
  it('scope and ETA', () => {
    expect(asScope('history')).toBe('history');
    expect(asScope(undefined)).toBe('active');
    expect(asScope(['x'])).toBe('active');
    expect(etaMinutes(null)).toBeNull();
    expect(etaMinutes(20)).toBe(1);
    expect(etaMinutes(720)).toBe(12);
  });
});

describe('job helpers', () => {
  it('customer short name never doubles the dot of the initial', () => {
    expect(customerShortName({ firstName: 'Aysel', lastInitial: 'Q' })).toBe('Aysel Q.');
    expect(customerShortName({ firstName: 'Aysel', lastInitial: 'Q.' })).toBe('Aysel Q.');
    expect(customerShortName({ firstName: 'Aysel', lastInitial: '' })).toBe('Aysel');
    expect(customerShortName({ firstName: 'Aysel', lastInitial: 'Q.', companyName: 'Bina MMC' })).toBe('Bina MMC (Aysel Q.)');
  });

  it('manager price entry only with the MANAGER setting and an arrived worker', () => {
    expect(managerCanEnterPrice(assignment({ status: 'ARRIVED' }), 'MANAGER')).toBe(true);
    expect(managerCanEnterPrice(assignment({ status: 'ARRIVED' }), 'WORKER')).toBe(false);
    expect(managerCanEnterPrice(assignment({ status: 'EN_ROUTE' }), 'MANAGER')).toBe(false);
    expect(managerCanEnterPrice(assignment({ status: 'PRICE_PROPOSED' }), 'MANAGER')).toBe(false);
  });

  it('fee state: held while active, released after a free cancel, captured or refunded', () => {
    expect(feeState(assignment())).toBe('held');
    expect(feeState(assignment({ status: 'CANCELLED_FREE' }))).toBe('released');
    expect(feeState(assignment({ status: 'COMPLETED', fee: { amount: 1000, captured: true, refunded: false } }))).toBe('captured');
    expect(feeState(assignment({ status: 'CANCELLED_BY_CUSTOMER', fee: { amount: 1000, captured: true, refunded: true } }))).toBe('refunded');
    expect(feeState(assignment({ view: 'WORKER_LIMITED', fee: null }))).toBeNull();
  });
});

describe('pageVersion', () => {
  it('changes when the server page changes, stable otherwise', () => {
    const a = { items: [assignment()] };
    const same = { items: [assignment()] };
    const moved = { items: [assignment({ status: 'EN_ROUTE' })] };
    const sig = (x: ReturnType<typeof assignment>) => `${x.id}:${x.status}`;
    expect(pageVersion(a, sig)).toBe(pageVersion(same, sig));
    expect(pageVersion(a, sig)).not.toBe(pageVersion(moved, sig));
    expect(pageVersion({ items: [] }, sig)).toBe(pageVersion({ items: [] }, sig));
    expect(pageVersion(null, sig)).toBe('none');
  });
});
