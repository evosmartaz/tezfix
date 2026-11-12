import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api, type ProAssignment } from '@tezfiks/shared';
import { DateTime } from '@/components/date-time';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { InfoList, PhotoGrid, Rating, Section } from '@/features/admin/components/ui';
import { AssignmentActions } from '@/features/company/components/assignment-actions';
import { CompanyLiveRefresh } from '@/features/company/components/live-refresh';
import { CompanyLoadError } from '@/features/company/components/load-error';
import { Avatar, Note } from '@/features/company/components/ui';
import {
  customerShortName,
  etaMinutes,
  feeState,
  managerCanEnterPrice,
  personName,
  reassignCandidates,
  requestNo,
} from '@/features/company/mappers';
import { loadCompany, optional } from '@/features/company/server';

function addressDetails(a: ProAssignment['address']): string[] {
  return [a.building, a.block, a.entrance, a.floor, a.apartment, a.intercom].filter((v): v is string => !!v);
}

/** Company job detail with the manager actions: price entry (finalPriceEntry = MANAGER), reassign, cancel. */
export default async function CompanyOrderPage({
  params,
}: {
  params: Promise<{ companyId: string; assignmentId: string }>;
}) {
  const { companyId, assignmentId } = await params;
  const { ctx, result } = await loadCompany(companyId, (client) =>
    client.call(api.company.assignment, { params: { companyId, id: assignmentId } }),
  );
  const t = await getTranslations('panel.company.orders');
  const tc = await getTranslations('common');
  const back = (
    <Link href={`/company/${companyId}/orders`} className="hover:underline">
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
  const a = result.data;
  const [company, members] = await Promise.all([
    optional(ctx.api.call(api.company.get, { params: { companyId } })),
    a.status === 'ACCEPTED' ? optional(ctx.api.call(api.company.members, { params: { companyId } })) : Promise.resolve(null),
  ]);
  const finalPriceEntry = company?.finalPriceEntry ?? 'WORKER';
  const candidates = members ? reassignCandidates(members.items, a) : null;
  const eta = etaMinutes(a.etaSec);
  const details = addressDetails(a.address);
  const customerName = customerShortName({ ...a.customer, companyName: null });
  const fee = feeState(a);

  return (
    <div className="flex flex-col gap-6">
      <CompanyLiveRefresh companyId={companyId} topics={['assignments']} />
      <PageHeader
        breadcrumb={back}
        title={t('detailTitle', { number: requestNo(a.requestNumber) })}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge family="assignmentStatus" status={a.status} />
            <span>
              {a.category.name} · {tc(`timing.${a.timing}`)}
            </span>
            {a.isEmergency ? <span className="font-semibold text-danger">{t('emergency')}</span> : null}
            {a.isGuaranteeFix ? <span className="font-semibold text-violet-700">{t('guaranteeFix')}</span> : null}
          </span>
        }
        actions={
          company ? (
            <AssignmentActions companyId={companyId} assignment={a} finalPriceEntry={finalPriceEntry} candidates={candidates} />
          ) : null
        }
      />

      {a.status === 'ARRIVED' && company && !managerCanEnterPrice(a, finalPriceEntry) ? (
        <Note tone="info">{t('workerEntersPrice')}</Note>
      ) : null}
      {a.status === 'EN_ROUTE' && eta !== null ? <Note tone="info">{t('etaNote', { minutes: eta })}</Note> : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.job')} className="xl:col-span-2">
          <InfoList
            items={[
              { label: t('fields.category'), value: a.category.name },
              {
                label: t('fields.timing'),
                value:
                  a.timing === 'SCHEDULED' && a.scheduledAt ? (
                    <>
                      {tc('timing.SCHEDULED')} · <DateTime value={a.scheduledAt} />
                    </>
                  ) : (
                    tc(`timing.${a.timing}`)
                  ),
              },
              { label: t('fields.description'), value: a.description ?? '—' },
              { label: t('fields.address'), value: a.address.formatted },
              { label: t('fields.addressDetails'), value: details.length ? details.join(', ') : '—' },
              { label: t('fields.addressNote'), value: a.address.note ?? '—' },
            ]}
          />
          {a.photos.length ? (
            <div className="mt-4">
              <PhotoGrid files={a.photos} alt={t('fields.photo')} />
            </div>
          ) : null}
        </Section>

        <div className="flex flex-col gap-6">
          <Section title={t('sections.worker')}>
            <div className="flex items-center gap-3">
              <Avatar name={personName(a.worker)} photo={a.worker.photo} />
              <div>
                <div className="font-semibold">{personName(a.worker)}</div>
                {a.worker.phone ? (
                  <a href={`tel:${a.worker.phone}`} className="text-sm text-primary hover:underline">
                    {a.worker.phone}
                  </a>
                ) : null}
              </div>
            </div>
          </Section>
          <Section title={t('sections.customer')}>
            <div className="flex items-center gap-3">
              <Avatar name={customerName} photo={a.customer.photo} />
              <div>
                <div className="font-semibold">
                  {a.customer.companyName ? `${a.customer.companyName} · ` : ''}
                  {customerName}
                </div>
                <div className="text-sm">
                  <Rating value={a.customer.ratingAvg} />
                </div>
                {a.customerPhone ? (
                  <a href={`tel:${a.customerPhone}`} className="text-sm text-primary hover:underline">
                    {a.customerPhone}
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('contactLocked')}</p>
                )}
              </div>
            </div>
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title={t('sections.price')}>
          <InfoList
            items={[
              { label: t('fields.labor'), value: a.price ? <Money minor={a.price.labor} /> : '—' },
              { label: t('fields.materials'), value: a.price ? <Money minor={a.price.materials} /> : '—' },
              { label: t('fields.total'), value: a.price ? <Money minor={a.price.total} className="font-semibold" /> : '—' },
              { label: t('fields.paymentMethod'), value: a.paymentMethod ? tc(`paymentMethod.${a.paymentMethod}`) : '—' },
              { label: t('fields.paymentStatus'), value: a.paymentStatus ? tc(`paymentStatus.${a.paymentStatus}`) : '—' },
              { label: t('fields.tip'), value: a.tipAmount ? <Money minor={a.tipAmount} /> : '—' },
              {
                label: t('fields.fee'),
                value: a.fee ? (
                  <>
                    <Money minor={a.fee.amount} />{' '}
                    <span className="text-xs text-muted-foreground">
                      {fee === 'refunded' ? t('feeRefunded') : fee === 'captured' ? t('feeCaptured') : fee === 'released' ? t('feeReleased') : t('feeHeld')}
                    </span>
                  </>
                ) : (
                  '—'
                ),
              },
              { label: t('fields.guaranteeUntil'), value: <DateTime value={a.guaranteeUntil} /> },
            ]}
          />
        </Section>
        <Section title={t('sections.timeline')}>
          <ol className="flex flex-col gap-2 text-sm">
            {(
              [
                ['acceptedAt', a.acceptedAt],
                ['enRouteAt', a.enRouteAt],
                ['arrivedAt', a.arrivedAt],
                ['priceProposedAt', a.priceProposedAt],
                ['completedAt', a.completedAt],
                ['cancelledAt', a.cancelledAt],
              ] as const
            )
              .filter(([, v]) => v !== null)
              .map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
                  <span>
                    {t(`timeline.${k}`)}
                    {k === 'cancelledAt' && a.cancelledBy ? ` (${t(`cancelledBy.${a.cancelledBy}`)})` : ''}
                  </span>
                  <DateTime value={v} />
                </li>
              ))}
          </ol>
          {a.status === 'ACCEPTED' ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('freeCancelUntil')} <DateTime value={a.freeCancelUntil} />
            </p>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
