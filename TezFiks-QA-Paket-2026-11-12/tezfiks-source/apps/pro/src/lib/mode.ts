import { createStore } from 'zustand/vanilla';
import type { KeyValueStorage } from '@tezfiks/mobile';
import type { ProProfileResponse } from '@tezfiks/shared';

/**
 * Personal mode (own handyman profile: online toggle, offers, own jobs) or company mode (board 04: a company the
 * user manages). Company screens are built by lane M4; this lane provides the switch and the entry point.
 */
export type ProMode = { kind: 'personal' } | { kind: 'company'; companyId: string };

export const PRO_MODE_KEY = 'tf.proMode';

export interface ModeState {
  /** What the user picked last (may be stale: resolveMode validates it against the profile). */
  preferred: ProMode | null;
}

export const modeStore = createStore<ModeState>(() => ({ preferred: null }));

let persist: KeyValueStorage | null = null;

export function serializeMode(mode: ProMode): string {
  return mode.kind === 'company' ? `company:${mode.companyId}` : 'personal';
}

export function parseMode(raw: string | null | undefined): ProMode | null {
  if (raw === 'personal') return { kind: 'personal' };
  const m = /^company:(.+)$/.exec(raw ?? '');
  return m ? { kind: 'company', companyId: m[1]! } : null;
}

export async function hydrateMode(storage: KeyValueStorage): Promise<void> {
  persist = storage;
  try {
    const parsed = parseMode(await storage.getItem(PRO_MODE_KEY));
    if (parsed && !modeStore.getState().preferred) modeStore.setState({ preferred: parsed });
  } catch {
    // memory only
  }
}

export function setPreferredMode(mode: ProMode): void {
  modeStore.setState({ preferred: mode });
  void persist?.setItem(PRO_MODE_KEY, serializeMode(mode)).catch(() => undefined);
}

export function resetMode(): void {
  modeStore.setState({ preferred: null });
  void persist?.removeItem(PRO_MODE_KEY).catch(() => undefined);
}

/**
 * The effective mode:
 * - a user without a handyman profile who manages a company is always in company mode (first managed company or the preferred one);
 * - a handyman who also manages companies uses the preferred mode when it is still valid, personal otherwise;
 * - everyone else is personal.
 */
export function resolveMode(profile: Pick<ProProfileResponse, 'profile' | 'managedCompanies'> | null | undefined, preferred: ProMode | null): ProMode {
  const companies = profile?.managedCompanies ?? [];
  const validCompany = preferred?.kind === 'company' && companies.some((c) => c.id === preferred.companyId) ? preferred : null;
  if (!profile?.profile) {
    if (validCompany) return validCompany;
    if (companies.length) return { kind: 'company', companyId: companies[0]!.id };
    return { kind: 'personal' };
  }
  return validCompany ?? { kind: 'personal' };
}

/** True when the switcher should be shown (both modes, or several companies, are available). */
export function canSwitchMode(profile: Pick<ProProfileResponse, 'profile' | 'managedCompanies'> | null | undefined): boolean {
  const companies = profile?.managedCompanies.length ?? 0;
  return companies > 0 && (!!profile?.profile || companies > 1);
}
