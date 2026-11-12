import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { installFakeApi, me, route } from './helpers';
import { resetApp, signedIn, UUID } from './pro-helpers';
import { CATEGORIES, profileResponse, proProfile } from './fixtures';
import { KYC_POLICY_VERSION } from '../src/lib/kyc';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const PLUMB = '00000000-0000-4000-8000-0000000000c1';
const SOCKET = '00000000-0000-4000-8000-0000000000c3';

afterEach(() => resetApp());

const kycStatus = (status: 'NONE' | 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'BLOCKED', over: Record<string, unknown> = {}) => ({
  status,
  submittedAt: null,
  reviewedAt: null,
  rejectReason: null,
  attemptsLeft24h: 3,
  ...over,
});

describe('onboarding forms: an invalid field below the fold is never a silent failure', () => {
  const layout = (testID: string, y: number) => fireEvent.layout(screen.getByTestId(testID), { x: 0, y, width: 320, height: 72 });
  const scrollTo = () => (require('react-native').ScrollView.prototype.scrollTo as jest.Mock);
  const focus = () => (require('react-native').TextInput.prototype.focus as jest.Mock);
  const focusedTestIds = () => focus().mock.contexts.map((c) => (c as { props?: { testID?: string } })?.props?.testID);

  it('solo: tells the pro, scrolls to the first invalid field and focuses it; a picker below the fold is scrolled to', async () => {
    const { REVEAL_MARGIN } = require('../src/hooks/useFieldReveal') as typeof import('../src/hooks/useFieldReveal');
    const calls = installFakeApi([...signedIn(() => me({ firstName: 'İsmayıl', lastName: 'Şükürov' })), route('GET', '/categories', () => ({ status: 200, body: { items: CATEGORIES } }))]);
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/solo' });
    await waitFor(() => expect(screen.getByTestId('solo-onboarding-screen')).toBeTruthy());
    await layout('solo-field-firstName', 180);
    await layout('solo-field-trades', 900);
    await fireEvent.changeText(screen.getByTestId('solo-first-name'), ' ');
    scrollTo().mockClear();
    focus().mockClear();

    await fireEvent.press(screen.getByTestId('solo-submit'));
    await waitFor(() => expect(screen.getByText('Formda səhv var: qırmızı ilə göstərilən xananı düzəldin')).toBeTruthy());
    expect(scrollTo()).toHaveBeenCalledWith({ y: 180 - REVEAL_MARGIN, animated: true });
    expect(focusedTestIds()).toContain('solo-first-name');
    expect(calls.some((c) => c.path === '/pro/onboarding/solo')).toBe(false);

    // name fixed: the trades block (no text input) is the next target
    await fireEvent.changeText(screen.getByTestId('solo-first-name'), 'İsmayıl');
    scrollTo().mockClear();
    focus().mockClear();
    await fireEvent.press(screen.getByTestId('solo-submit'));
    await waitFor(() => expect(scrollTo()).toHaveBeenCalledWith({ y: 900 - REVEAL_MARGIN, animated: true }));
    expect(focusedTestIds()).not.toContain('solo-first-name');
    expect(calls.some((c) => c.path === '/pro/onboarding/solo')).toBe(false);
  });

  it('company: an invalid VÖEN below the fold is scrolled to and focused', async () => {
    const { REVEAL_MARGIN } = require('../src/hooks/useFieldReveal') as typeof import('../src/hooks/useFieldReveal');
    const calls = installFakeApi([...signedIn(() => me({ firstName: 'Aysel', lastName: 'Qasımova' })), route('GET', '/categories', () => ({ status: 200, body: { items: CATEGORIES } }))]);
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/company' });
    await waitFor(() => expect(screen.getByTestId('company-onboarding-screen')).toBeTruthy());
    await layout('company-field-voen', 640);
    await fireEvent.changeText(screen.getByTestId('company-name'), 'FixPro MMC');
    await fireEvent.changeText(screen.getByTestId('company-voen'), '12345');
    scrollTo().mockClear();
    focus().mockClear();

    await fireEvent.press(screen.getByTestId('company-submit'));
    await waitFor(() => expect(screen.getByText('Formda səhv var: qırmızı ilə göstərilən xananı düzəldin')).toBeTruthy());
    expect(scrollTo()).toHaveBeenCalledWith({ y: 640 - REVEAL_MARGIN, animated: true });
    expect(focusedTestIds()).toContain('company-voen');
    expect(calls.some((c) => c.path === '/pro/onboarding/company')).toBe(false);
  });
});

describe('solo onboarding → KYC → pending', () => {
  it('registers a solo handyman, walks the KYC camera steps, uploads every photo and submits', async () => {
    let current = me({ firstName: 'İsmayıl', lastName: 'Şükürov' });
    let kyc = kycStatus('DRAFT');
    let fileN = 0;
    const uploads: string[] = [];
    const calls = installFakeApi([
      ...signedIn(() => current),
      route('GET', '/categories', () => ({ status: 200, body: { items: CATEGORIES } })),
      route('POST', '/pro/onboarding/solo', (c) => {
        current = me({ firstName: 'İsmayıl', lastName: 'Şükürov', handyman: { id: UUID(1), kind: 'SOLO', status: 'DRAFT', companyId: null, isOnline: false } });
        const body = c.body as { firstName: string; lastName: string };
        return { status: 200, body: proProfile({ status: 'DRAFT', firstName: body.firstName, lastName: body.lastName }) };
      }),
      route('GET', '/kyc/status', () => ({ status: 200, body: kyc })),
      route('POST', '/files', () => {
        fileN++;
        const id = UUID(100 + fileN);
        uploads.push(id);
        return { status: 200, body: { id, kind: 'KYC_ID_FRONT', url: `http://x/${id}`, contentType: 'image/jpeg', width: 1200, height: 1600 } };
      }),
      route('POST', '/kyc/submissions', () => {
        kyc = kycStatus('PENDING_REVIEW', { submittedAt: new Date().toISOString(), attemptsLeft24h: 2 });
        current = me({ firstName: 'İsmayıl', lastName: 'Şükürov', handyman: { id: UUID(1), kind: 'SOLO', status: 'PENDING_REVIEW', companyId: null, isOnline: false } });
        return { status: 200, body: kyc };
      }),
      route('GET', '/pro/profile', () => ({ status: 200, body: profileResponse({ profile: proProfile({ status: 'PENDING_REVIEW' }) }) })),
    ]);

    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('onboarding-screen')).toBeTruthy());
    expect(screen.getByText('Fərdi usta')).toBeTruthy();
    expect(screen.getByText('Usta şirkəti')).toBeTruthy();
    expect(screen.getByText('Dəvət linki ilə qoşul')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    await waitFor(() => expect(screen.getByTestId('solo-onboarding-screen')).toBeTruthy());
    expect(r.getPathname()).toBe('/onboarding/solo');

    // validation first
    await fireEvent.press(screen.getByTestId('solo-submit'));
    await waitFor(() => expect(screen.getByText('Ən azı bir ixtisas seçin')).toBeTruthy());
    expect(calls.some((c) => c.path === '/pro/onboarding/solo')).toBe(false);

    await waitFor(() => expect(screen.getByTestId(`trade-${PLUMB}`)).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('trade-picker-search'), 'deyisimi');
    expect(screen.queryByTestId(`trade-${PLUMB}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`trade-${SOCKET}`));
    await fireEvent.changeText(screen.getByTestId('trade-picker-search'), '');
    await fireEvent.press(screen.getByTestId(`trade-${PLUMB}`));
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByTestId('radius-plus'));
    expect(screen.getByTestId('radius-value').props.children).toBe('13 km');
    await fireEvent.press(screen.getByTestId('base-picker-locate'));
    await waitFor(() => expect(screen.getByTestId('base-picker-coords').props.children).toBe('Seçilən nöqtə: 40.40930, 49.86710'));

    await fireEvent.press(screen.getByTestId('solo-submit'));
    await waitFor(() => expect(screen.getByTestId('kyc-screen')).toBeTruthy());
    expect(calls.find((c) => c.path === '/pro/onboarding/solo')?.body).toEqual({
      firstName: 'İsmayıl',
      lastName: 'Şükürov',
      tradeIds: [SOCKET, PLUMB],
      serviceRadiusKm: 13,
      base: { lat: 40.4093, lng: 49.8671 },
    });
    expect(r.getPathname()).toBe('/kyc');

    // consent
    await waitFor(() => expect(screen.getByTestId('kyc-consent-text')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('kyc-consent-accept'));

    // ID front/back with the card frame (back camera), then the three selfie prompts (front camera)
    const expected: Array<[string, string, 'card' | 'face']> = [
      ['idFront', 'Vəsiqəni çərçivənin içinə yerləşdirin. Bütün yazılar oxunaqlı olsun', 'card'],
      ['idBack', 'Vəsiqəni çevirin və arxa üzünü çərçivəyə yerləşdirin', 'card'],
      ['selfieFront', 'Üzünüzü ovalın içinə yerləşdirib birbaşa kameraya baxın', 'face'],
      ['selfieTurn', 'Başınızı yavaşca sağa çevirin və şəkil çəkin', 'face'],
      ['selfieBlink', 'Kameraya baxın, gözünüzü qırpın və şəkil çəkin', 'face'],
    ];
    for (const [slot, instruction, overlay] of expected) {
      await waitFor(() => expect(screen.getByTestId(`kyc-camera-${slot}`)).toBeTruthy());
      expect(screen.getByTestId('kyc-instruction').props.children).toBe(instruction);
      expect(screen.getByTestId(`kyc-overlay-${overlay}`)).toBeTruthy();
      expect(screen.getByTestId('kyc-camera-view').props.facing).toBe(overlay === 'card' ? 'back' : 'front');
      await fireEvent.press(screen.getByTestId('kyc-capture'));
      await waitFor(() => expect(screen.getByTestId('kyc-preview')).toBeTruthy());
      await fireEvent.press(screen.getByTestId('kyc-use'));
    }

    await waitFor(() => expect(screen.getByTestId('kyc-extras-next')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('kyc-extras-next'));
    await waitFor(() => expect(uploads).toHaveLength(5));
    await waitFor(() => expect(screen.getByTestId('kyc-submit').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByTestId('kyc-submit'));

    await waitFor(() => expect(screen.getByTestId('verification-screen')).toBeTruthy());
    expect(calls.find((c) => c.path === '/kyc/submissions')?.body).toEqual({
      subject: 'HANDYMAN',
      idFrontFileId: uploads[0],
      idBackFileId: uploads[1],
      selfie: { frontFileId: uploads[2], turnFileId: uploads[3], blinkFileId: uploads[4] },
      selfieChecks: null,
      tradeProofFileIds: [],
      companyDocFileIds: [],
      consent: { policyVersion: KYC_POLICY_VERSION, locale: 'az', accepted: true },
    });
    await waitFor(() => expect(screen.getByText('Yoxlama prosesi')).toBeTruthy());
    expect(screen.getByText(/adətən 24 saat ərzində/)).toBeTruthy();
  });

  it('a rejected handyman sees the reason on the home screen and can resubmit', async () => {
    const current = me({ handyman: { id: UUID(1), kind: 'SOLO', status: 'REJECTED', companyId: null, isOnline: false } });
    installFakeApi([
      ...signedIn(() => current),
      route('GET', '/pro/profile', () => ({
        status: 200,
        body: profileResponse({ profile: proProfile({ status: 'REJECTED', rejectReason: 'Şəkil bulanıqdır', kyc: kycStatus('REJECTED', { rejectReason: 'Şəkil bulanıqdır', attemptsLeft24h: 2 }) }) }),
      })),
      route('GET', '/kyc/status', () => ({ status: 200, body: kycStatus('REJECTED', { rejectReason: 'Şəkil bulanıqdır', attemptsLeft24h: 2 }) })),
    ]);
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('verification-card-rejected')).toBeTruthy());
    expect(screen.getByText('Səbəb: Şəkil bulanıqdır')).toBeTruthy();
    expect(screen.getByText('24 saat ərzində 2 cəhd qalıb')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('verification-card-resubmit'));
    await waitFor(() => expect(screen.getByTestId('kyc-consent-text')).toBeTruthy());
    expect(r.getPathname()).toBe('/kyc');
  });

  it('a pending handyman opening KYC sees the pending state instead of the flow', async () => {
    const current = me({ handyman: { id: UUID(1), kind: 'SOLO', status: 'PENDING_REVIEW', companyId: null, isOnline: false } });
    installFakeApi([...signedIn(() => current), route('GET', '/kyc/status', () => ({ status: 200, body: kycStatus('PENDING_REVIEW') }))]);
    await renderRouter(APP_DIR, { initialUrl: '/kyc' });
    await waitFor(() => expect(screen.getByTestId('verification-card-pending')).toBeTruthy());
    expect(screen.queryByTestId('kyc-consent-text')).toBeNull();
  });
});

describe('company registration → manager mode entry', () => {
  it('validates the VÖEN, registers the company, opens company KYC and the home shows the company with its balance', async () => {
    let current = me({ firstName: 'Aysel', lastName: 'Qasımova' });
    const company = {
      id: UUID(9),
      name: 'FixPro MMC',
      legalForm: 'MMC',
      voen: '1234567890',
      status: 'DRAFT',
      rejectReason: null,
      finalPriceEntry: 'WORKER',
      isVatPayer: true,
      trades: [],
      base: { lat: 40.4093, lng: 49.8671 },
      baseAddress: null,
      serviceRadiusKm: 15,
      ratingAvg: null,
      ratingCount: 0,
      strikes: 0,
      wallet: { accountId: UUID(10), currency: 'AZN', posted: 24000, held: 0, available: 24000, isDebt: false, lowBalance: false },
      earningsBalance: 0,
      membersCount: 1,
      onlineWorkers: 0,
      myRole: 'MANAGER',
      kyc: kycStatus('NONE'),
    };
    const calls = installFakeApi([
      ...signedIn(() => current),
      route('GET', '/categories', () => ({ status: 200, body: { items: CATEGORIES } })),
      route('POST', '/pro/onboarding/company', () => {
        current = me({
          firstName: 'Aysel',
          lastName: 'Qasımova',
          companies: [{ companyId: company.id, companyName: company.name, role: 'MANAGER', companyStatus: 'DRAFT' }],
        });
        return { status: 200, body: company };
      }),
      route('GET', `/kyc/status?companyId=${company.id}`, () => ({ status: 200, body: kycStatus('DRAFT') })),
      route('GET', '/pro/profile', () => ({
        status: 200,
        body: profileResponse({ profile: null, managedCompanies: [{ id: company.id, name: company.name, status: 'DRAFT', role: 'MANAGER' }] }),
      })),
      route('GET', `/company/${company.id}`, () => ({ status: 200, body: company })),
    ]);

    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('onboarding-screen')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('choice-company'));
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    await waitFor(() => expect(screen.getByTestId('company-onboarding-screen')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('company-name'), 'FixPro MMC');
    await fireEvent.changeText(screen.getByTestId('company-voen'), '12345');
    await waitFor(() => expect(screen.getByTestId(`trade-${SOCKET}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`trade-${SOCKET}`));
    await fireEvent.press(screen.getByTestId('base-picker-locate'));
    await waitFor(() => expect(screen.getByTestId('base-picker-coords').props.children).toMatch(/^Seçilən nöqtə/));
    await fireEvent.press(screen.getByTestId('company-submit'));
    await waitFor(() => expect(screen.getByText('VÖEN 10 rəqəmdən ibarət olmalıdır')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('company-voen'), '12-345-678-90');
    await fireEvent(screen.getByTestId('company-vat'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('company-base-address'), 'Xətai r., M.Hadi küç. 12');
    await fireEvent.press(screen.getByTestId('company-submit'));
    await waitFor(() => expect(screen.getByTestId('kyc-screen')).toBeTruthy());
    expect(calls.find((c) => c.path === '/pro/onboarding/company')?.body).toEqual({
      firstName: 'Aysel',
      lastName: 'Qasımova',
      company: {
        name: 'FixPro MMC',
        legalForm: 'MMC',
        voen: '1234567890',
        isVatPayer: true,
        tradeIds: [SOCKET],
        serviceRadiusKm: 15,
        base: { lat: 40.4093, lng: 49.8671 },
        baseAddress: 'Xətai r., M.Hadi küç. 12',
      },
    });
    expect(screen.getByText('Şirkətin yoxlanılması')).toBeTruthy();
    expect(r.getPathname()).toBe('/kyc');

    // back to home: manager mode entry with the balance chip and the company verification card
    await fireEvent.press(screen.getByTestId('header-back'));
    await waitFor(() => expect(screen.getByTestId('home-company-mode')).toBeTruthy());
    expect(screen.getByText('FixPro MMC — İdarəedici')).toBeTruthy();
    expect(screen.getByText(/^Balans: 240\s₼$/)).toBeTruthy();
    expect(screen.getByTestId('verification-card-draft')).toBeTruthy();
  });
});
