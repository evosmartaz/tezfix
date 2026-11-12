import { createMemoryStorage } from '@tezfiks/mobile';
import { ENTRY_ROUTES } from '../src/routes';
import { proEntryRedirect } from '../src/lib/entry';
import {
  clearPendingInvite,
  hydratePendingInvite,
  inviteTokenFromPath,
  parseInviteInput,
  peekPendingInvite,
  PENDING_INVITE_KEY,
  PENDING_INVITE_TTL_MS,
  stashInvite,
  takePendingInvite,
} from '../src/lib/invite';

const TOKEN = 'AbC123_-xyzAbC123_-xyz9';

describe('invite token parsing', () => {
  it('accepts a bare token, the app link and the web link', () => {
    expect(parseInviteInput(` ${TOKEN} `)).toBe(TOKEN);
    expect(parseInviteInput(`tezfiksusta://join/${TOKEN}`)).toBe(TOKEN);
    expect(parseInviteInput(`https://evosmart.az/tezfix/join/${TOKEN}`)).toBe(TOKEN);
    expect(parseInviteInput(`evosmart.az/tezfix/join/${TOKEN}`)).toBe(TOKEN);
  });

  it('rejects junk, short tokens and other apps', () => {
    expect(parseInviteInput('')).toBeNull();
    expect(parseInviteInput('abc')).toBeNull();
    expect(parseInviteInput('tezfiks://join/AbC123_-xyzAbC12')).toBeNull();
    expect(parseInviteInput('token with spaces inside')).toBeNull();
  });

  it('reads the token of the /join/<token> route', () => {
    expect(inviteTokenFromPath(`/join/${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFromPath('/join')).toBeNull();
    expect(inviteTokenFromPath('/onboarding')).toBeNull();
    expect(inviteTokenFromPath(null)).toBeNull();
  });
});

describe('pro entry gate with the invite deep link', () => {
  it('lets users who are still onboarding open the join route', () => {
    expect(ENTRY_ROUTES.onboarding.allow).toContain('join');
    expect(proEntryRedirect('onboarding', 'join', `/join/${TOKEN}`, ENTRY_ROUTES, null)).toEqual({ href: null, stash: null, consumeInvite: false });
    // other screens still go to "Usta kimi qoşulun"
    expect(proEntryRedirect('onboarding', '(tabs)', '/', ENTRY_ROUTES, null).href).toBe('/onboarding');
  });

  it('sends signed-out users from the join link to login and stashes the token', () => {
    expect(proEntryRedirect('auth', 'join', `/join/${TOKEN}`, ENTRY_ROUTES, null)).toEqual({ href: '/phone', stash: TOKEN, consumeInvite: false });
    // on the login screens nothing more happens
    expect(proEntryRedirect('auth', '(auth)', '/phone', ENTRY_ROUTES, TOKEN)).toEqual({ href: null, stash: null, consumeInvite: false });
  });

  it('keeps the stash through the profile step and opens the join screen after login', () => {
    expect(proEntryRedirect('profile', '(auth)', '/otp', ENTRY_ROUTES, TOKEN)).toEqual({ href: '/profile-setup', stash: null, consumeInvite: false });
    expect(proEntryRedirect('onboarding', 'profile-setup', '/profile-setup', ENTRY_ROUTES, TOKEN)).toEqual({
      href: `/join/${TOKEN}`,
      stash: null,
      consumeInvite: false,
    });
    expect(proEntryRedirect('main', '(auth)', '/otp', ENTRY_ROUTES, TOKEN).href).toBe(`/join/${TOKEN}`);
    // the stash is cleared once the join screen is open, and the user stays there
    expect(proEntryRedirect('onboarding', 'join', `/join/${TOKEN}`, ENTRY_ROUTES, TOKEN)).toEqual({ href: null, stash: null, consumeInvite: true });
    expect(proEntryRedirect('main', 'join', `/join/${TOKEN}`, ENTRY_ROUTES, TOKEN)).toEqual({ href: null, stash: null, consumeInvite: true });
  });

  it('a signed-in handyman opening the link stays on the join screen', () => {
    expect(proEntryRedirect('main', 'join', `/join/${TOKEN}`, ENTRY_ROUTES, null).href).toBeNull();
  });

  it('after registration the gate opens the KYC flow instead of the tabs, once', () => {
    const next = '/kyc?subject=COMPANY&companyId=c1';
    expect(proEntryRedirect('main', 'onboarding', '/onboarding/company', ENTRY_ROUTES, null, next)).toEqual({ href: next, stash: null, consumeInvite: false });
    expect(proEntryRedirect('main', 'kyc', '/kyc', ENTRY_ROUTES, null, next)).toMatchObject({ href: null, consumeNext: true });
    // without a destination the tabs open as usual; signed-in users elsewhere are not moved
    expect(proEntryRedirect('main', 'onboarding', '/onboarding/solo', ENTRY_ROUTES, null, null).href).toBe('/');
    expect(proEntryRedirect('main', '(tabs)', '/orders', ENTRY_ROUTES, null, next).href).toBeNull();
    // still onboarding (me not refreshed yet): stay on the form
    expect(proEntryRedirect('onboarding', 'onboarding', '/onboarding/solo', ENTRY_ROUTES, null, '/kyc').href).toBeNull();
  });

  it('keeps the onboarding KYC route open right after registration', () => {
    expect(proEntryRedirect('onboarding', 'kyc', '/kyc', ENTRY_ROUTES, null).href).toBeNull();
  });
});

describe('pending invite stash', () => {
  afterEach(() => clearPendingInvite());

  it('is taken once', () => {
    stashInvite(TOKEN, 1000);
    expect(peekPendingInvite(1000)).toBe(TOKEN);
    expect(takePendingInvite(1000)).toBe(TOKEN);
    expect(takePendingInvite(1000)).toBeNull();
  });

  it('ignores invalid tokens and expires after 24 h', () => {
    stashInvite('bad', 0);
    expect(peekPendingInvite(0)).toBeNull();
    stashInvite(TOKEN, 0);
    expect(peekPendingInvite(PENDING_INVITE_TTL_MS)).toBeNull();
  });

  it('survives an app restart through storage', async () => {
    const storage = createMemoryStorage();
    await hydratePendingInvite(storage, 0);
    stashInvite(TOKEN, 5);
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(storage.data.get(PENDING_INVITE_KEY)!)).toEqual({ token: TOKEN, stashedAt: 5 });
    clearPendingInvite();
    await new Promise((r) => setTimeout(r, 0));
    expect(storage.data.has(PENDING_INVITE_KEY)).toBe(false);
    storage.data.set(PENDING_INVITE_KEY, JSON.stringify({ token: TOKEN, stashedAt: 10 }));
    await hydratePendingInvite(storage, 20);
    expect(peekPendingInvite(20)).toBe(TOKEN);
  });
});
