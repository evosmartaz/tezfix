import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadError } from '@/features/admin/components/load-error';
import { InvoiceRowActions } from '@/features/admin/components/payments-tables';
import { InfoList, PhotoGrid, Rating, Section } from '@/features/admin/components/ui';
import { loadAdmin } from '@/features/admin/server';

/** Project detail: request, customer (VÖEN), all quotes with held fees, daily reports, invoice. */
export default async function AdminProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { result } = await loadAdmin((client) => client.call(api.admin.project, { params: { id } }));
  const t = await getTranslations('panel.admin.projects');
  const tc = await getTranslations('common');
  const te = await getTranslations('panel.admin.enums');
  const back = (
    <Link href="/admin/projects" className="hover:underline">
      ← {t('title')}
    </Link>
  );
  if (!result.ok) {
    return (
      <div>
        <PageHeader title={t('detailTitle', { number: '' })} breadcrumb={back} />
        <LoadError error={result} />
      </div>
    );
  }
  const { project: p, customer, quotes } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={back}
        title={t('detailTitle', { number: `P-${p.number}` })}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge family="projectStatus" status={p.status} />
            <span>{p.title ?? p.category.name}</span>
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.project')} className="xl:col-span-2">
          <InfoList
            items={[
              { label: t('columns.category'), value: p.category.name },
              { label: t('fields.scope'), value: p.scope },
              { label: t('columns.dates'), value: `${p.dateFrom} – ${p.dateTo}` },
              { label: t('columns.workers'), value: p.workersNeeded },
              { label: t('fields.quoteDeadline'), value: <DateTime value={p.quoteDeadline} /> },
              { label: t('fields.address'), value: p.address.formatted },
              { label: t('fields.description'), value: <span className="whitespace-pre-wrap">{p.description}</span> },
              { label: t('fields.photos'), value: <PhotoGrid files={p.photos} alt={t('fields.photos')} /> },
              { label: t('fields.guaranteeUntil'), value: <DateTime value={p.guaranteeUntil} /> },
            ]}
          />
        </Section>
        <Section title={t('sections.customer')}>
          <InfoList
            className="sm:grid-cols-1"
            items={[
              {
                label: tc('fields.companyName'),
                value: (
                  <Link href={`/admin/customers/${customer.accountId}`} className="text-primary hover:underline">
                    {customer.name}
                  </Link>
                ),
              },
              { label: tc('fields.phone'), value: customer.phone },
              { label: tc('fields.voen'), value: customer.voen ?? '—' },
            ]}
          />
        </Section>
      </div>

      <Section title={t('sections.quotes', { count: quotes.length })} bodyClassName="p-0">
        {quotes.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t('noQuotes')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('quotes.provider')}</TableHead>
                <TableHead>{t('quotes.total')}</TableHead>
                <TableHead>{t('quotes.workersDays')}</TableHead>
                <TableHead>{t('quotes.fee')}</TableHead>
                <TableHead>{t('quotes.status')}</TableHead>
                <TableHead>{t('quotes.createdAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id} data-awarded={p.awardedQuote?.id === q.id || undefined}>
                  <TableCell>
                    <div className="font-medium">{q.provider.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {te(`providerType.${q.provider.type}`)} · <Rating value={q.provider.ratingAvg} /> ·{' '}
                      {t('quotes.completed', { count: q.provider.completedCount })}
                    </div>
                    {q.note ? <div className="mt-1 text-xs whitespace-pre-wrap">{q.note}</div> : null}
                  </TableCell>
                  <TableCell>
                    <Money minor={q.totalAmount} />
                    {q.provider.isVatPayer ? <div className="text-xs text-muted-foreground">{t('quotes.vatPayer')}</div> : null}
                  </TableCell>
                  <TableCell>{t('quotes.workersDaysValue', { workers: q.workers, days: q.days })}</TableCell>
                  <TableCell>
                    <Money minor={q.feeHeld} />
                    <div className="text-xs text-muted-foreground">{q.feeCaptured ? t('quotes.feeCaptured') : t('quotes.feeHeld')}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge family="quoteStatus" status={q.status} />
                  </TableCell>
                  <TableCell>
                    <DateTime value={q.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title={t('sections.reports', { count: p.reports.length })}>
        {p.reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noReports')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {p.reports.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-3 text-sm">
                  <span className="font-semibold">{r.reportDate}</span>
                  <span className="text-muted-foreground">{r.authorName}</span>
                  <span className="text-muted-foreground">{t('progress', { percent: r.progressPercent })}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{r.note}</p>
                <PhotoGrid files={r.photos} alt={t('fields.photos')} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {p.invoice ? (
        <Section title={t('sections.invoice', { number: p.invoice.number })} actions={<InvoiceRowActions invoice={p.invoice} />}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <StatusBadge family="invoiceStatus" status={p.invoice.status} />
              <span className="text-sm text-muted-foreground">
                {p.invoice.issuer.name} → {p.invoice.customer.name}
              </span>
            </div>
            <Table>
              <TableBody>
                {p.invoice.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right">
                      <Money minor={l.amount} />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>{t('invoice.subtotal')}</TableCell>
                  <TableCell className="text-right">
                    <Money minor={p.invoice.subtotal} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t('invoice.vat', { rate: p.invoice.vatRatePercent })}</TableCell>
                  <TableCell className="text-right">
                    <Money minor={p.invoice.vatAmount} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-semibold">{t('invoice.total')}</TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money minor={p.invoice.total} />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
