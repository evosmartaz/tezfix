/*
 * KYC consent and submission edge cases: the consent text shown is the exact text the server hashes into the consent
 * record, a double tap sends one submission, the 24 h attempt limit screen and the limit / already-pending errors.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeApi, me, route } from './helpers';
import { resetApp, signedIn, UUID } from './pro-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const LOCALES = path.join(__dirname, '..', '..', '..', 'packages', 'i18n', 'locales');

afterEach(() => resetApp());

const readJson = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(LOCALES, ...p), 'utf8'));

const kycStatus = (status: string, over: Record<string, unknown> = {}) => ({
  status,
  submittedAt: null,
  reviewedAt: null,
  rejectReason: null,
  attemptsLeft24h: 3,
  ...over,
});

describe('KYC consent text', () => {
  it.each(['az', 'ru', 'en'])('the %s consent text is the one the server stores the hash of (server.providers.consentText)', (locale) => {
    const pro = readJson(locale, 'pro.json');
    const server = readJson(locale, 'server', 'providers.json');
    expect(typeof server.consentText).toBe('string');
    expect(pro.kyc.consentText).toBe(server.consentText);
  });
});

function draftHandyman() {
  return me({ handyman: { id: UUID(1), kind: 'SOLO', status: 'DRAFT', companyId: null, isOnline: false } });
}

async function walkToReview() {
  await waitFor(() => expect(screen.getByTestId('kyc-consent-text')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('kyc-consent-accept'));
  for (const slot of ['idFront', 'idBack', 'selfieFront', 'selfieTurn', 'selfieBlink']) {
    await waitFor(() => expect(screen.getByTestId(`kyc-camera-${slot}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('kyc-capture'));
    await waitFor(() => expect(screen.getByTestId('kyc-preview')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('kyc-use'));
  }
  await waitFor(() => expect(screen.getByTestId('kyc-extras-next')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('kyc-extras-next'));
  await waitFor(() => expect(screen.getByTestId('kyc-submit').props.accessibilityState.disabled).toBe(false));
}

function kycRoutes(submit: () => { status: number; body?: unknown }) {
  let fileN = 0;
  return installFakeApi([
    ...signedIn(draftHandyman),
    route('GET', '/kyc/status', () => ({ status: 200, body: kycStatus('DRAFT') })),
    route('POST', '/files', () => {
      const id = UUID(100 + ++fileN);
      return { status: 200, body: { id, kind: 'KYC_ID_FRONT', url: `http://x/${id}`, contentType: 'image/jpeg', width: 1200, height: 1600 } };
    }),
    route('POST', '/kyc/submissions', submit),
    route('GET', '/pro/profile', () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'x', details: null } } })),
  ]);
}

describe('KYC submission', () => {
  it('renders the server consent text on the consent step', async () => {
    kycRoutes(() => ({ status: 200, body: kycStatus('PENDING_REVIEW') }));
    await renderRouter(APP_DIR, { initialUrl: '/kyc' });
    await waitFor(() => expect(screen.getByTestId('kyc-consent-text')).toBeTruthy());
    expect(screen.getByTestId('kyc-consent-text').props.children).toBe(readJson('az', 'server', 'providers.json').consentText);
  });

  it('a double tap on "Göndər" sends a single submission', async () => {
    const calls = kycRoutes(() => ({ status: 200, body: kycStatus('PENDING_REVIEW', { attemptsLeft24h: 2 }) }));
    await renderRouter(APP_DIR, { initialUrl: '/kyc' });
    await walkToReview();
    const button = screen.getByTestId('kyc-submit');
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    await waitFor(() => expect(screen.getByTestId('verification-screen')).toBeTruthy());
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/kyc/submissions')).toHaveLength(1);
  });

  it('KYC_RESUBMIT_LIMIT keeps the review step and explains the limit', async () => {
    const calls = kycRoutes(() => ({ status: 429, body: { error: { code: 'KYC_RESUBMIT_LIMIT', message: 'limit', details: null } } }));
    await renderRouter(APP_DIR, { initialUrl: '/kyc' });
    await walkToReview();
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    await waitFor(() => expect(screen.getByText('Bu gün üçün cəhdlər bitib, sabah yenidən yoxlayın')).toBeTruthy());
    expect(screen.queryByTestId('verification-screen')).toBeNull();
    expect(screen.getByTestId('kyc-submit')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/kyc/submissions')).toHaveLength(1);
  });

  it('KYC_ALREADY_PENDING shows the "already being checked" message', async () => {
    kycRoutes(() => ({ status: 409, body: { error: { code: 'KYC_ALREADY_PENDING', message: 'pending', details: null } } }));
    await renderRouter(APP_DIR, { initialUrl: '/kyc' });
    await walkToReview();
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    await waitFor(() => expect(screen.getByText('Sənədləriniz artıq yoxlanılır')).toBeTruthy());
  });

  it('with no attempts left in 24 hours the flow is replaced by the limit notice', async () => {
    installFakeApi([...signedIn(draftHandyman), route('GET', '/kyc/status', () => ({ status: 200, body: kycStatus('REJECTED', { attemptsLeft24h: 0 }) }))]);
    await renderRouter(APP_DIR, { initialUrl: '/kyc' });
    await waitFor(() => expect(screen.getByTestId('kyc-limit')).toBeTruthy());
    expect(screen.queryByTestId('kyc-consent-text')).toBeNull();
  });
});
