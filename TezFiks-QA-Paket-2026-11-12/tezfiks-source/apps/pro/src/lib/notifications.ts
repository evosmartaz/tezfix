import type { NotificationView } from '@tezfiks/shared';

/** Where a notification leads (ids from the server's `data`; never phone numbers). */
export function notificationHref(n: Pick<NotificationView, 'data'>): string | null {
  const d = n.data ?? {};
  const str = (k: string) => (typeof d[k] === 'string' && (d[k] as string).length > 0 ? (d[k] as string) : null);
  const assignmentId = str('assignmentId');
  const companyId = str('companyId');
  const projectId = str('projectId');
  if (assignmentId) return companyId ? `/company/${companyId}/jobs/${assignmentId}` : `/job/${assignmentId}`;
  if (projectId) return companyId ? `/projects/${projectId}?companyId=${companyId}` : `/projects/${projectId}`;
  return null;
}
