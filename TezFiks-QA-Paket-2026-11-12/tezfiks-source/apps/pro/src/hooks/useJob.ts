import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type FinalPriceEntry, type ProAssignment } from '@tezfiks/shared';
import { useApi } from '@tezfiks/mobile';
import { proRole, redactForRole, type JobRole } from '../lib/jobs';
import { qk, useProProfile } from './queries';

export interface JobData {
  /** Redacted for the viewer's role (a company worker never gets description/price/fee/rating/phone). */
  job: ProAssignment | undefined;
  role: JobRole;
  /** Who enters the final price for company jobs (null for solo jobs or while unknown). */
  finalPriceEntry: FinalPriceEntry | null;
  companyId: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * One assignment for the active job screens: GET /pro/assignments/:id (solo handyman or company worker) or, with a
 * companyId, GET /company/:companyId/assignments/:id (manager). The result is redacted for the viewer's role.
 */
export function useJob(id: string | undefined, companyId: string | null): JobData {
  const client = useApi();
  const profile = useProProfile();
  const manager = !!companyId;
  const query = useQuery({
    queryKey: manager ? qk.companyAssignment(companyId!, id ?? '') : qk.assignment(id ?? ''),
    enabled: !!id,
    queryFn: (): Promise<ProAssignment> =>
      manager
        ? client.call(api.company.assignment, { params: { companyId: companyId!, id: id! } })
        : client.call(api.pro.assignment, { params: { id: id! } }),
  });
  const company = useQuery({
    queryKey: qk.company(companyId ?? 'none'),
    enabled: manager,
    queryFn: () => client.call(api.company.get, { params: { companyId: companyId! } }),
  });
  const raw = query.data;
  const role: JobRole = manager ? 'manager' : raw ? proRole(raw) : 'solo';
  const finalPriceEntry: FinalPriceEntry | null = manager
    ? company.data?.finalPriceEntry ?? null
    : role === 'worker'
      ? profile.data?.profile?.company?.finalPriceEntry ?? null
      : null;
  const job = useMemo(() => (raw ? redactForRole(raw, role) : undefined), [raw, role]);
  return {
    job,
    role,
    finalPriceEntry,
    companyId,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isRefetching: query.isRefetching,
    refetch: () => query.refetch(),
  };
}
