import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api, type ProviderProjectView } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RowLink, TabLinks } from '@/features/admin/components/ui';
import { CompanyLoadError } from '@/features/company/components/load-error';
import { loadCompany } from '@/features/company/server';

type Tab = 'open' | 'active' | 'history';

function asTab(v: string | string[] | undefined): Tab {
  return v === 'active' || v === 'history' ? v : 'open';
}

/** Layihələr: open quote requests, the company's active (quoted / awarded) projects and history. */
export default async function CompanyProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { companyId } = await params;
  const tab = asTab((await searchParams).tab);
  const { result } = await loadCompany(companyId, (client) =>
    tab === 'open'
      ? client.call(api.providerProjects.open, { query: { companyId } })
      : client.call(api.providerProjects.mine, { query: { companyId, scope: tab } }),
  );
  const t = await getTranslations('panel.company.projects');
  const base = `/company/${companyId}/projects`;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <TabLinks
        tabs={[
          { key: 'open', label: t('tabs.open'), href: base, active: tab === 'open' },
          { key: 'active', label: t('tabs.active'), href: `${base}?tab=active`, active: tab === 'active' },
          { key: 'history', label: t('tabs.history'), href: `${base}?tab=history`, active: tab === 'history' },
        ]}
      />
      {!result.ok ? (
        <CompanyLoadError error={result} />
      ) : result.data.items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title={t(`empty.${tab}`)} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <ProjectsTable companyId={companyId} items={result.data.items} t={t} />
        </div>
      )}
    </div>
  );
}

function ProjectsTable({
  companyId,
  items,
  t,
}: {
  companyId: string;
  items: ProviderProjectView[];
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t('columns.number')}</TableHead>
          <TableHead>{t('columns.project')}</TableHead>
          <TableHead>{t('columns.customer')}</TableHead>
          <TableHead>{t('columns.dates')}</TableHead>
          <TableHead>{t('columns.workers')}</TableHead>
          <TableHead>{t('columns.deadline')}</TableHead>
          <TableHead>{t('columns.status')}</TableHead>
          <TableHead>{t('columns.myQuote')}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((p) => (
          <TableRow key={p.id} data-project-id={p.id}>
            <TableCell className="font-semibold">{t('number', { number: p.number })}</TableCell>
            <TableCell>
              <div className="font-medium">{p.title ?? p.category.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.category.name} · {p.scope}
              </div>
              <div className="text-xs text-muted-foreground">{p.addressText}</div>
            </TableCell>
            <TableCell>{p.customer.name}</TableCell>
            <TableCell className="whitespace-nowrap">
              <DateTime value={`${p.dateFrom}T12:00:00+04:00`} mode="date" /> – <DateTime value={`${p.dateTo}T12:00:00+04:00`} mode="date" />
            </TableCell>
            <TableCell>{p.workersNeeded}</TableCell>
            <TableCell>
              <DateTime value={p.quoteDeadline} />
            </TableCell>
            <TableCell>
              <StatusBadge family="projectStatus" status={p.status} />
              {p.isAwardedToMe ? <div className="text-xs font-semibold text-primary-strong">{t('awardedToUs')}</div> : null}
            </TableCell>
            <TableCell>
              {p.myQuote ? (
                <div>
                  <Money minor={p.myQuote.totalAmount} />
                  <div>
                    <StatusBadge family="quoteStatus" status={p.myQuote.status} />
                  </div>
                </div>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>
              <RowLink href={`/company/${companyId}/projects/${p.id}`}>{t('open')}</RowLink>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
