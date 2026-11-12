import { useStore } from 'zustand';
import type { ProProfileResponse } from '@tezfiks/shared';
import { modeStore, resolveMode, type ProMode } from '../lib/mode';

/** Effective personal/company mode for the loaded profile (see resolveMode). */
export function useProMode(profile: ProProfileResponse | null | undefined): ProMode {
  const preferred = useStore(modeStore, (s) => s.preferred);
  return resolveMode(profile, preferred);
}
