import { createStore } from 'zustand/vanilla';
import { inviteTokenFromUrl, type KeyValueStorage } from '@tezfiks/mobile';

/** Invite tokens are 24 url-safe characters today; the contract accepts 10..64. */
const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;

export function isValidInviteToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/**
 * Token from what the user typed or pasted on "Dəvət linki ilə qoşul": a bare token, the app link
 * tezfiksusta://join/<token> or the web link https://evosmart.az/tezfix/join/<token>. Null when invalid.
 */
export function parseInviteInput(text: string): string | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const fromUrl = inviteTokenFromUrl(raw);
  if (fromUrl !== null) return isValidInviteToken(fromUrl) ? fromUrl : null;
  // Links of other apps or sites (tezfiks://..., https://other.site/join/...) are not invites.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  // "…/join/<token>" pasted without a scheme
  const m = /(?:^|\/)join\/([^/?#\s]+)/.exec(raw);
  const candidate = m ? m[1] : raw;
  return isValidInviteToken(candidate) ? candidate : null;
}

/** Token of the current route when it is the invite route "/join/<token>". */
export function inviteTokenFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/join\/([^/?#]+)\/?$/.exec(pathname ?? '');
  if (!m) return null;
  let token = m[1];
  try {
    token = decodeURIComponent(token);
  } catch {
    // keep raw
  }
  return isValidInviteToken(token) ? token : null;
}

export const PENDING_INVITE_KEY = 'tf.pendingInvite';
/** A stashed token older than this is dropped (the user gave up on the invite). */
export const PENDING_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingInviteState {
  token: string | null;
  stashedAt: number;
}

/**
 * The invite token of a deep link opened while signed out. The login gate sends the user to the phone/OTP screens;
 * once signed in, the entry redirect consumes the token and opens /join/<token>.
 */
export const pendingInviteStore = createStore<PendingInviteState>(() => ({ token: null, stashedAt: 0 }));

let persist: KeyValueStorage | null = null;

/** Persists the stash so it survives the app being killed during OTP. Call once at startup. */
export async function hydratePendingInvite(storage: KeyValueStorage, now: number = Date.now()): Promise<void> {
  persist = storage;
  try {
    const raw = await storage.getItem(PENDING_INVITE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PendingInviteState>;
    if (isValidInviteToken(parsed.token) && typeof parsed.stashedAt === 'number' && now - parsed.stashedAt < PENDING_INVITE_TTL_MS) {
      if (!pendingInviteStore.getState().token) pendingInviteStore.setState({ token: parsed.token, stashedAt: parsed.stashedAt });
    } else {
      await storage.removeItem(PENDING_INVITE_KEY);
    }
  } catch {
    // storage unavailable: memory only
  }
}

export function stashInvite(token: string, now: number = Date.now()): void {
  if (!isValidInviteToken(token)) return;
  const state = pendingInviteStore.getState();
  if (state.token === token) return;
  pendingInviteStore.setState({ token, stashedAt: now });
  void persist?.setItem(PENDING_INVITE_KEY, JSON.stringify({ token, stashedAt: now })).catch(() => undefined);
}

export function peekPendingInvite(now: number = Date.now()): string | null {
  const { token, stashedAt } = pendingInviteStore.getState();
  if (!token) return null;
  if (now - stashedAt >= PENDING_INVITE_TTL_MS) {
    clearPendingInvite();
    return null;
  }
  return token;
}

export function clearPendingInvite(): void {
  pendingInviteStore.setState({ token: null, stashedAt: 0 });
  void persist?.removeItem(PENDING_INVITE_KEY).catch(() => undefined);
}

/** Returns the stashed token once and clears it. */
export function takePendingInvite(now: number = Date.now()): string | null {
  const token = peekPendingInvite(now);
  if (token) clearPendingInvite();
  return token;
}
