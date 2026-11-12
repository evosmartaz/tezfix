import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { InfoList, PhotoGrid, Rating, Section } from '@/features/admin/components/ui';
import { CompanyLoadError } from '@/features/company/components/load-error';
import {
  CompleteProjectForm,
  InvoiceCard,
  QuoteFormView,
  ReportFormView,
  WithdrawQuoteButton,
} from '@/features/company/components/project-forms';
import { Note } from '@/features/company/components/ui';
import { quoteWindowOpen } from '@/features/company/mappers';
import { loadCompany, optional } from '@/features/company/server';

const WORKING = new Set(['AWARDED', 'IN_PROGRESS']);

/** B2B project as the company sees it: details, quote with fee preview / own quote, daily reports, completion and invoice. */
export default async function CompanyProjectPage({ params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const { companyId, projectId } = await params;
  const { ctx, result } = await loadCompany(companyId, (client) =>
    client.call(api.providerProjects.get, { params: { id: projectId }, query: { companyId } }),
  );
  const t = await getTranslations('panel.company.projects');
  const back = (
    <Link href={`/company/${companyId}/projects`} className="hover:underline">
      ← {t('title')}
    </Link>
  );
  if (!result.ok) {
    return (
      <div>
        <PageHeader title={t('detailTitleShort')} breadcrumb={back} />
        <CompanyLoadError error={result} />
      </div>
    );
  }
  const p = result.data;
  const wallet = await optional(ctx.api.call(api.company.wallet, { params: { companyId } }));
  // Rendered per request: the quote window is compared with the server's deadline at render time.
  const canQuote = !p.myQuote && quoteWindowOpen(p, Date.now());
  const q = p.myQuote;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={back}
        title={t('detailTitle', { number: p.number, name: p.title ?? p.category.name })}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge family="projectStatus" status={p.status} />
            <span>
              {p.category.name} · {p.scope}
            </span>
            {p.isAwardedToMe ? <span className="font-semibold text-primary-strong">{t('awardedToUs')}</span> : null}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.details')} className="xl:col-span-2">
          <InfoList
            items={[
              { label: t('fields.customer'), value: p.customer.name },
              { label: t('fields.customerRating'), value: <Rating value={p.customer.ratingAvg} /> },
              {
                label: t('fields.dates'),
                value: (
                  <>
                    <DateTime value={`${p.dateFrom}T12:00:00+04:00`} mode="date" /> –{' '}
                    <DateTime value={`${p.dateTo}T12:00:00+04:00`} mode="date" />
                  </>
                ),
              },
              { label: t('fields.workers'), value: p.workersNeeded },
              { label: t('fields.address'), value: p.address.formatted || p.addressText },
              { label: t('fields.deadline'), value: <DateTime value={p.quoteDeadline} /> },
              { label: t('fields.quotes'), value: p.quotesCount },
              { label: t('fields.feePerWorkerDay'), value: <Money minor={p.feePerWorkerDay} /> },
            ]}
          />
          <div className="mt-4 text-sm whitespace-pre-line">{p.description}</div>
          {p.photos.length ? (
            <div className="mt-4">
              <PhotoGrid files={p.photos} alt={t('fields.photo')} />
            </div>
          ) : null}
        </Section>

        <Section title={t('sections.quote')}>
          {q ? (
            <div className="flex flex-col gap-3 text-sm" data-testid="my-quote">
              <div className="flex items-center justify-between">
                <StatusBadge family="quoteStatus" status={q.status} />
                {q.status === 'SUBMITTED' ? <WithdrawQuoteButton companyId={companyId} projectId={p.id} quoteId={q.id} /> : null}
              </div>
              <InfoList
                className="sm:grid-cols-1"
                items={[
                  { label: t('quote.total'), value: <Money minor={q.totalAmount} className="font-semibold" /> },
                  { label: t('quote.workersDays'), value: t('quote.workersDaysValue', { workers: q.workers, days: q.days }) },
                  { label: t('quote.note'), value: q.note ?? '—' },
                  {
                    label: t('quote.feeHeld'),
                    value: (
                      <>
                        <Money minor={q.feeHeld} />{' '}
                        <span className="text-xs text-muted-foreground">{q.feeCaptured ? t('quote.feeCaptured') : t('quote.feeOnHold')}</span>
                      </>
                    ),
                  },
                  { label: t('quote.sentAt'), value: <DateTime value={q.createdAt} /> },
                ]}
              />
            </div>
          ) : canQuote ? (
            <QuoteFormView companyId={companyId} project={p} walletAvailable={wallet?.available ?? null} />
          ) : (
            <Note tone="info">{t('quote.closed')}</Note>
          )}
        </Section>
      </div>

      {p.isAwardedToMe ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Section title={t('sections.reports', { count: p.reports.length })}>
            {p.reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('report.empty')}</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {[...p.reports]
                  .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt))
                  .map((r) => (
                    <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          <DateTime value={`${r.reportDate}T12:00:00+04:00`} mode="date" />
                        </span>
                        <span className="text-xs font-semibold text-primary-strong">{r.progressPercent}%</span>
                      </div>
                      <p className="mt-1 whitespace-pre-line">{r.note}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{r.authorName}</p>
                      {r.photos.length ? <PhotoGrid className="mt-2" files={r.photos} alt={t('fields.photo')} /> : null}
                    </li>
                  ))}
              </ol>
            )}
            {WORKING.has(p.status) ? (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-semibold">{t('report.title')}</h3>
                <ReportFormView companyId={companyId} projectId={p.id} />
              </div>
            ) : null}
          </Section>
          <Section title={t('sections.invoice')}>
            {p.invoice ? (
              <InvoiceCard invoice={p.invoice} />
            ) : WORKING.has(p.status) ? (
              <CompleteProjectForm companyId={companyId} projectId={p.id} quoteTotal={q?.totalAmount ?? null} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('invoice.none')}</p>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}
