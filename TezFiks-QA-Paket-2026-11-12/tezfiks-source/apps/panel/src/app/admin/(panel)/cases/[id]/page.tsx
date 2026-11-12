import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { CaseActions, CaseNoteForm } from '@/features/admin/components/case-components';
import { AssignmentsTable } from '@/features/admin/components/detail-tables';
import { LoadError } from '@/features/admin/components/load-error';
import { InfoList, PhotoGrid, Section } from '@/features/admin/components/ui';
import { requestNo } from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

/** Case detail: claim, photos, the assignment, internal notes, redispatch / resolve / reject. */
export default async function AdminCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { result } = await loadAdmin((client) => client.call(api.admin.case, { params: { id } }));
  const t = await getTranslations('panel.admin.cases');
  const tc = await getTranslations('common');
  const back = (
    <Link href="/admin/cases" className="hover:underline">
      ← {t('title')}
    </Link>
  );
  if (!result.ok) {
    return (
      <div>
        <PageHeader title={t('detailTitle')} breadcrumb={back} />
        <LoadError error={result} />
      </div>
    );
  }
  const { case: c, row, assignment, notes } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={back}
        title={`${tc(`caseType.${c.type}`)} · ${c.requestNumber !== null ? requestNo(c.requestNumber) : c.projectNumber !== null ? t('projectRef', { number: c.projectNumber }) : ''}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge family="caseStatus" status={c.status} />
            <span>
              {t('openedAt')} <DateTime value={c.createdAt} />
            </span>
          </span>
        }
        actions={<CaseActions caseId={c.id} caseType={c.type} status={c.status} />}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.claim')} className="xl:col-span-2">
          <InfoList
            items={[
              { label: t('columns.customer'), value: row.customerName },
              { label: t('columns.provider'), value: row.providerName ?? '—' },
              { label: t('fields.description'), value: <span className="whitespace-pre-wrap">{c.description}</span> },
              { label: t('fields.photos'), value: <PhotoGrid files={c.photos} alt={t('fields.photos')} /> },
              { label: t('fields.resolution'), value: c.resolutionNote ?? '—' },
              {
                label: t('fields.followUp'),
                value: c.followUpRequestId ? (
                  <Link href={`/admin/orders/${c.followUpRequestId}`} className="text-primary hover:underline">
                    {t('openFollowUp')}
                  </Link>
                ) : (
                  '—'
                ),
              },
              { label: t('columns.updatedAt'), value: <DateTime value={c.updatedAt} /> },
            ]}
          />
        </Section>
        <Section title={t('sections.notes', { count: notes.length })}>
          <div className="flex flex-col gap-4">
            {notes.length ? (
              <ul className="flex flex-col gap-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-md bg-muted px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{n.authorName}</span>
                      <DateTime value={n.createdAt} />
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('notes.empty')}</p>
            )}
            <CaseNoteForm caseId={c.id} />
          </div>
        </Section>
      </div>
      {assignment ? (
        <Section title={t('sections.assignment')} bodyClassName="p-0">
          <AssignmentsTable rows={[assignment]} showRequest />
        </Section>
      ) : null}
    </div>
  );
}
