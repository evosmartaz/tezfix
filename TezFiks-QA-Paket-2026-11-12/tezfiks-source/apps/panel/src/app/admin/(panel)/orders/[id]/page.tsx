import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { api } from '@tezfiks/shared';
import type { AdminRequestDetail } from '@/features/admin/types';
import { DateTime } from '@/components/date-time';
import { PanelMap } from '@/components/map/panel-map';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AssignmentsTable, LedgerTable } from '@/features/admin/components/detail-tables';
import { LoadError } from '@/features/admin/components/load-error';
import { AdminLiveRefresh } from '@/features/admin/components/live-refresh';
import { RequestCancelButton } from '@/features/admin/components/request-actions';
import { InfoList, PhotoGrid, Section } from '@/features/admin/components/ui';
import { cellBoundary } from '@/features/admin/h3';
import { decimalText, MAP_COLORS, requestNo, sortTimeline, timelineKey } from '@/features/admin/mappers';
import { loadAdmin } from '@/features/admin/server';

const CANCELLABLE = new Set(['SEARCHING', 'ASSIGNED', 'IN_PROGRESS']);

function searchPolygons(d: AdminRequestDetail) {
  const cells = d.request.search?.cells ?? [];
  const out: Array<{ id: string; points: Array<{ lat: number; lng: number }>; color: string; fillOpacity: number }> = [];
  for (const cell of cells) {
    try {
      out.push({
        id: cell,
        points: cellBoundary(cell).map(([lat, lng]) => ({ lat, lng })),
        color: MAP_COLORS.searching,
        fillOpacity: 0.15,
      });
    } catch {
      // invalid cell: skip
    }
  }
  return out;
}

/** Order detail: request, customer, timeline, assignments (with phones), offers log, ledger, map, force-cancel. */
export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, result } = await loadAdmin((client) => client.call(api.admin.request, { params: { id } }));
  const locale = ctx.locale;
  const t = await getTranslations('panel.admin.orders');
  const tc = await getTranslations('common');
  const te = await getTranslations('panel.admin.enums');
  const tt = await getTranslations('panel.admin.timeline');
  const back = (
    <Link href="/admin/orders" className="hover:underline">
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
  const d = result.data;
  const r = d.request;
  const address = r.address;
  const addressParts = [
    address.district,
    address.street,
    address.building && `${tc('fields.building')} ${address.building}`,
    address.block && `${tc('fields.block')} ${address.block}`,
    address.entrance && `${tc('fields.entrance')} ${address.entrance}`,
    address.floor && `${tc('fields.floor')} ${address.floor}`,
    address.apartment && `${tc('fields.apartment')} ${address.apartment}`,
    address.intercom && `${tc('fields.intercom')} ${address.intercom}`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <AdminLiveRefresh intervalMs={r.isSearching ? 10_000 : undefined} />
      <PageHeader
        breadcrumb={back}
        title={t('detailTitle', { number: requestNo(r.number) })}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge family="requestStatus" status={r.status} />
            <span>{tc(`timing.${r.timing}`)}</span>
            <span>·</span>
            <span>{r.category.name}</span>
            {r.isGuaranteeFix ? <span>· {t('guaranteeFix')}</span> : null}
          </span>
        }
        actions={
          CANCELLABLE.has(r.status) ? (
            <RequestCancelButton requestId={r.id} penaltyPreview={r.cancelPenaltyPreview} />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title={t('sections.request')} className="xl:col-span-2">
          <InfoList
            items={[
              { label: t('fields.createdAt'), value: <DateTime value={r.createdAt} /> },
              { label: t('fields.scheduledAt'), value: <DateTime value={r.scheduledAt} /> },
              { label: t('fields.slots'), value: t('slotsValue', { filled: r.slotsFilled, requested: r.slotsRequested }) },
              { label: t('fields.preference'), value: tc(`providerPreference.${r.providerPreference}`) },
              {
                label: t('fields.emergencyFee'),
                value: r.emergencyFee ? (
                  <span>
                    <Money minor={r.emergencyFee.total} /> ({t('captured')}: <Money minor={r.emergencyFee.captured} />)
                  </span>
                ) : (
                  '—'
                ),
              },
              { label: t('fields.cancelReason'), value: r.cancelReason ?? '—' },
              { label: t('fields.address'), value: [address.formatted, ...addressParts].join(', ') },
              { label: t('fields.addressNote'), value: address.note ?? '—' },
              { label: t('fields.description'), value: <span className="whitespace-pre-wrap">{r.description}</span> },
              { label: t('fields.photos'), value: <PhotoGrid files={r.photos} alt={t('fields.photos')} /> },
            ]}
          />
        </Section>
        <div className="flex flex-col gap-6">
          <Section title={t('sections.customer')}>
            <InfoList
              className="sm:grid-cols-1"
              items={[
                {
                  label: tc('fields.firstName'),
                  value: (
                    <Link href={`/admin/customers/${d.customer.accountId}`} className="font-medium text-primary hover:underline">
                      {d.customer.name}
                    </Link>
                  ),
                },
                { label: tc('fields.phone'), value: d.customer.phone },
                { label: t('fields.customerType'), value: tc(`customerType.${d.customer.type}`) },
                ...(d.customer.companyName ? [{ label: tc('fields.companyName'), value: d.customer.companyName }] : []),
              ]}
            />
          </Section>
          <PanelMap
            className="h-72"
            center={{ lat: address.lat, lng: address.lng }}
            zoom={13}
            markers={[{ id: r.id, lat: address.lat, lng: address.lng, label: requestNo(r.number), color: MAP_COLORS.request }]}
            polygons={searchPolygons(d)}
          />
        </div>
      </div>

      <Section title={t('sections.timeline')}>
        {d.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ol className="relative flex flex-col gap-3 border-l border-border pl-5">
            {sortTimeline(d.timeline).map((item, i) => {
              const key = timelineKey(item.event);
              return (
                <li key={`${item.at}-${i}`} className="relative">
                  <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary ring-4 ring-surface" />
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <DateTime value={item.at} className="text-xs text-muted-foreground" />
                    <span className="text-sm font-medium">{tt.has(key) ? tt(key) : item.event}</span>
                    {item.actor ? <span className="text-xs text-muted-foreground">{item.actor}</span> : null}
                  </div>
                  {item.details ? <p className="text-sm text-muted-foreground">{item.details}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section title={t('sections.assignments')} bodyClassName="p-0">
        <AssignmentsTable rows={d.assignments} />
      </Section>

      <Section title={t('sections.offers')} bodyClassName="p-0">
        {d.offers.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t('noOffers')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('offers.target')}</TableHead>
                <TableHead>{t('offers.step')}</TableHead>
                <TableHead>{t('offers.distance')}</TableHead>
                <TableHead>{t('offers.status')}</TableHead>
                <TableHead>{t('offers.sentAt')}</TableHead>
                <TableHead>{t('offers.respondedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.offers.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.handymanName ?? o.companyName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {te(`offerTarget.${o.target}`)}
                      {o.handymanName && o.companyName ? ` · ${o.companyName}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>{t('offers.stepValue', { step: o.step, ring: o.ring })}</TableCell>
                  <TableCell>{o.distanceM === null ? '—' : t('offers.km', { km: decimalText(o.distanceM / 1000, locale) })}</TableCell>
                  <TableCell>
                    <StatusBadge family="offerStatus" status={o.status} />
                  </TableCell>
                  <TableCell>
                    <DateTime value={o.sentAt} />
                  </TableCell>
                  <TableCell>
                    <DateTime value={o.respondedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title={t('sections.ledger')} bodyClassName="p-0">
        <LedgerTable rows={d.ledger} />
      </Section>
    </div>
  );
}
