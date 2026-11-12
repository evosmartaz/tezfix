import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, etaMinutes, formatDateTime, formatPhone, type ProAssignment } from '@tezfiks/shared';
import {
  AppText,
  Avatar,
  Banner,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  ListItem,
  LoadingState,
  MapPin,
  Screen,
  TfMapView,
  Timeline,
  colors,
  errorCodeOf,
  errorMessage,
  openNavigation,
  radii,
  serverNow,
  spacing,
  useApi,
  useT,
  useToast,
} from '@tezfiks/mobile';
import { jobVisibility, nextStep, timelineSteps, type JobStep } from '../lib/jobs';
import { reassignCandidates } from '../lib/company';
import { useJob } from '../hooks/useJob';
import { beginRoute, useJobRouteTracking } from '../hooks/useRouteTracking';
import { qk } from '../hooks/queries';
import { currentFix } from '../online/tracking';
import { AddressBlock, CancelSection, CustomerCard, DescriptionBlock, JobStatusBadge, MoneyBlock, NavButtons } from './JobParts';

/** Re-renders every second while `enabled` (free-window countdown). */
function useTick(enabled: boolean): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return enabled ? now : serverNow();
}

function back(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Active job (board 03 B3 "Aktiv sifariş", board 04 worker screen, manager view of a company job).
 * - solo handyman: timeline, customer card, address + description, navigation, Yola çıxdım → Ünvana çatdım → İşi tamamla,
 *   cancel with the free-window info, phone/chat once unlocked, rate the customer after completion;
 * - company worker (WORKER_LIMITED): "Sifariş məkanı" with Google Maps / Waze / Paylaş and "Yola çıxdım"; no description,
 *   price, fee, customer rating, phone or chat; the price step only when the company lets workers enter it;
 * - manager (companyId): everything, worker card, manager price entry, reassign and cancel.
 */
export function JobScreen({ id, companyId }: { id: string | undefined; companyId: string | null }) {
  const { t } = useT();
  const data = useJob(id, companyId);
  const job = data.job;
  useJobRouteTracking(job, data.role);

  return (
    <Screen scroll testID="job-screen" onRefresh={() => void data.refetch()} refreshing={data.isRefetching}>
      <Header title={job ? t('job.title', { number: job.requestNumber }) : t('job.titleShort')} onBack={back} />
      {data.isLoading ? <LoadingState /> : null}
      {data.isError ? <ErrorState error={data.error} message={errorMessage(t, data.error)} onRetry={() => void data.refetch()} /> : null}
      {job ? (data.role === 'worker' ? <WorkerJob job={job} data={data} /> : <FullJob job={job} data={data} />) : null}
    </Screen>
  );
}

type Data = ReturnType<typeof useJob>;

function useJobActions(job: ProAssignment, data: Data) {
  const { t } = useT();
  const client = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const store = (a: ProAssignment) => {
    if (data.companyId) queryClient.setQueryData(qk.companyAssignment(data.companyId, a.id), a);
    else queryClient.setQueryData(qk.assignment(a.id), a);
    void queryClient.invalidateQueries({ queryKey: ['pro', 'assignments'] });
    if (data.companyId) void queryClient.invalidateQueries({ queryKey: ['company', data.companyId, 'assignments'] });
  };

  const run = async (name: string, fn: () => Promise<ProAssignment | void>) => {
    if (busy) return;
    setBusy(name);
    try {
      const a = await fn();
      if (a) store(a);
    } catch (err) {
      toast.show(errorMessage(t, err), { kind: 'error' });
      if (errorCodeOf(err) === 'INVALID_STATE') void data.refetch();
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    enRoute: () =>
      run('enRoute', async () => {
        const fix = await currentFix(4000);
        const a = await client.call(api.pro.enRoute, { params: { id: job.id }, body: fix ? { location: { lat: fix.lat, lng: fix.lng } } : {} });
        if (!(await beginRoute(job.id, t as never))) toast.show(t('job.route.permissionDenied'), { kind: 'error' });
        return a;
      }),
    arrived: () => run('arrived', () => client.call(api.pro.arrived, { params: { id: job.id } })),
    cancel: async (reason: string | undefined, idempotencyKey: string) => {
      await run('cancel', async () => {
        const body = reason ? { reason } : {};
        const a = data.companyId
          ? await client.call(api.company.cancelAssignment, { params: { companyId: data.companyId, id: job.id }, body, idempotencyKey })
          : await client.call(api.pro.cancel, { params: { id: job.id }, body, idempotencyKey });
        toast.show(t('job.cancel.done'), { kind: 'success' });
        return a;
      });
    },
    reassign: (workerId: string) =>
      run('reassign', async () => {
        const a = await client.call(api.company.reassign, { params: { companyId: data.companyId!, id: job.id }, body: { workerId } });
        toast.show(t('company.job.reassigned'), { kind: 'success' });
        return a;
      }),
  };
}

function priceHref(job: ProAssignment, companyId: string | null) {
  return companyId ? { pathname: '/job/[id]/price', params: { id: job.id, companyId } } : { pathname: '/job/[id]/price', params: { id: job.id } };
}

function StepArea({ job, data, step, actions }: { job: ProAssignment; data: Data; step: JobStep; actions: ReturnType<typeof useJobActions> }) {
  const { t } = useT();
  switch (step) {
    case 'enRoute':
      return <Button title={t('job.startRoute')} onPress={() => void actions.enRoute()} loading={actions.busy === 'enRoute'} testID="job-en-route" />;
    case 'arrived':
      return <ArrivedStep actions={actions} />;
    case 'enterPrice':
      return (
        <Button
          title={data.role === 'manager' ? t('company.job.enterPrice') : t('job.complete')}
          onPress={() => router.push(priceHref(job, data.companyId) as never)}
          testID="job-complete"
        />
      );
    case 'awaitingPriceEntry':
      return (
        <Banner
          tone="info"
          message={data.finalPriceEntry === 'MANAGER' ? t('job.state.awaitingManager') : t('job.state.awaitingWorker')}
          testID="job-state-awaiting-price"
        />
      );
    case 'awaitingCustomer':
      return <Banner tone="info" title={t('job.state.awaitingCustomer')} message={t('job.state.awaitingCustomerBody')} testID="job-state-awaiting-customer" />;
    case 'disputed':
      return <Banner tone="danger" message={t('job.state.disputed')} testID="job-state-disputed" />;
    case 'rateCustomer':
      return (
        <View>
          <Banner tone="success" message={t('job.state.done')} testID="job-state-done" />
          <Button title={t('job.rateCustomer')} onPress={() => router.push({ pathname: '/job/[id]/rate', params: { id: job.id } } as never)} testID="job-rate" />
        </View>
      );
    case 'done':
      return <Banner tone="success" message={t('job.state.done')} testID="job-state-done" />;
    case 'followWorker':
      return <Banner tone="info" message={t('job.state.followWorker', { status: t(`common:assignmentStatus.${job.status}`) })} testID="job-state-follow" />;
    case 'cancelled':
    default:
      return <Banner tone="neutral" message={t('job.state.cancelled', { status: t(`common:assignmentStatus.${job.status}`) })} testID="job-state-cancelled" />;
  }
}

/**
 * "Ünvana çatdım" is confirmed first: the arrival notifies the customer, unlocks their phone and chat, and opens the
 * customer's paid "decline on arrival" option, so a stray tap must not send it.
 */
function ArrivedStep({ actions }: { actions: ReturnType<typeof useJobActions> }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Button title={t('job.markArrived')} onPress={() => setOpen(true)} loading={actions.busy === 'arrived'} testID="job-arrived" />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={t('job.arrivedConfirm.title')} testID="job-arrived-sheet">
        <AppText variant="body">{t('job.arrivedConfirm.body')}</AppText>
        <View style={[styles.row, styles.block]}>
          <Button
            variant="outline"
            title={t('job.arrivedConfirm.keep')}
            onPress={() => setOpen(false)}
            fullWidth={false}
            style={styles.sheetAction}
            testID="job-arrived-keep"
          />
          <Button
            title={t('job.arrivedConfirm.confirm')}
            onPress={() => {
              setOpen(false);
              void actions.arrived();
            }}
            fullWidth={false}
            style={styles.sheetAction}
            testID="job-arrived-confirm"
          />
        </View>
      </BottomSheet>
    </View>
  );
}

function JobTimeline({ job }: { job: ProAssignment }) {
  const { t } = useT();
  return (
    <Card style={styles.block}>
      <Timeline steps={timelineSteps(job).map((s) => ({ key: s.key, label: t(`job.timeline.${s.key}`), time: s.time, state: s.state }))} testID="job-timeline" />
    </Card>
  );
}

/** The chat carries the company id for a manager, so its back fallback returns to the company job screen. */
function chatHref(job: Pick<ProAssignment, 'id'>, companyId: string | null) {
  return { pathname: '/job/[id]/chat', params: companyId ? { id: job.id, companyId } : { id: job.id } };
}

/** Solo handyman and manager view (FULL). */
function FullJob({ job, data }: { job: ProAssignment; data: Data }) {
  const { t } = useT();
  const actions = useJobActions(job, data);
  const visibility = jobVisibility(job, data.role);
  const step = nextStep(job, data.role, data.finalPriceEntry);
  const cancellable = job.status === 'ACCEPTED' || job.status === 'EN_ROUTE';
  const now = useTick(cancellable);
  const eta = etaMinutes(job.etaSec);
  const [reassignOpen, setReassignOpen] = useState(false);

  return (
    <View testID="job-full">
      <View style={styles.row}>
        <JobStatusBadge job={job} />
        {job.isEmergency ? <AppText variant="caption" color="danger" style={styles.tag}>{t('job.emergency')}</AppText> : null}
        {job.isGuaranteeFix ? <AppText variant="caption" color="primary" style={styles.tag}>{t('job.guaranteeFix')}</AppText> : null}
        {job.status === 'EN_ROUTE' && eta !== null ? (
          <AppText variant="small" color="textMuted" style={styles.tag} testID="job-eta">
            {t('job.eta', { min: eta })}
          </AppText>
        ) : null}
      </View>
      <JobTimeline job={job} />
      {visibility.worker ? <WorkerCard job={job} /> : null}
      <CustomerCard job={job} visibility={visibility} limited={false} onChat={() => router.push(chatHref(job, data.companyId) as never)} />
      <Card style={styles.block}>
        <AppText variant="h3">{job.category.name}</AppText>
        {job.scheduledAt ? (
          <AppText variant="small" color="primary" style={styles.line}>
            {t('job.scheduledAt', { time: formatDateTime(job.scheduledAt) })}
          </AppText>
        ) : null}
        <View style={styles.line}>
          <AddressBlock job={job} />
        </View>
        {visibility.description ? <DescriptionBlock job={job} /> : null}
      </Card>
      <MoneyBlock job={job} visibility={visibility} />
      <View style={styles.block}>
        <StepArea job={job} data={data} step={step} actions={actions} />
      </View>
      {cancellable && data.role !== 'manager' ? (
        <Button variant="dark" title={t('job.navigate')} onPress={() => void openNavigation(job.address.lat, job.address.lng)} style={styles.block} testID="job-navigate" />
      ) : null}
      {cancellable ? <NavButtons job={job} title={t('job.title', { number: job.requestNumber })} /> : null}
      {data.role === 'manager' && job.status === 'ACCEPTED' ? (
        <Button variant="outline" title={t('company.job.reassign')} onPress={() => setReassignOpen(true)} style={styles.block} testID="job-reassign" />
      ) : null}
      <CancelSection job={job} serverNowMs={now} onCancel={actions.cancel} />
      {data.companyId ? (
        <ReassignSheet
          open={reassignOpen}
          onClose={() => setReassignOpen(false)}
          companyId={data.companyId}
          currentHandymanId={job.worker.handymanId}
          onPick={(workerId) => {
            setReassignOpen(false);
            void actions.reassign(workerId);
          }}
        />
      ) : null}
    </View>
  );
}

function WorkerCard({ job }: { job: ProAssignment }) {
  const { t } = useT();
  const w = job.worker;
  return (
    <Card style={styles.block} testID="job-worker">
      <View style={styles.row}>
        <Avatar uri={w.photo?.url} firstName={w.firstName} lastName={w.lastName} size={44} />
        <View style={styles.flexText}>
          <AppText variant="caption" color="textMuted">
            {t('job.worker')}
          </AppText>
          <AppText variant="bodyStrong">{`${w.firstName} ${w.lastName}`}</AppText>
        </View>
        {w.phone ? (
          <Button
            variant="secondary"
            size="sm"
            title={formatPhone(w.phone)}
            onPress={() => void Linking.openURL(`tel:${w.phone}`)}
            fullWidth={false}
            accessibilityHint={t('company.job.workerPhone')}
            testID="job-worker-call"
          />
        ) : null}
      </View>
    </Card>
  );
}

function ReassignSheet({
  open,
  onClose,
  companyId,
  currentHandymanId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  currentHandymanId: string;
  onPick: (workerId: string) => void;
}) {
  const { t } = useT();
  const client = useApi();
  const members = useQuery({
    queryKey: qk.members(companyId),
    enabled: open,
    queryFn: () => client.call(api.company.members, { params: { companyId } }),
  });
  const list = reassignCandidates(members.data?.items ?? [], currentHandymanId);
  return (
    <BottomSheet visible={open} onClose={onClose} title={t('company.job.reassignTitle')} testID="job-reassign-sheet">
      {members.isLoading ? <LoadingState /> : null}
      {members.data && !list.length ? <EmptyState icon="people-outline" title={t('company.job.noReassign')} /> : null}
      {list.map((m) => (
        <ListItem
          key={m.userId}
          title={`${m.firstName} ${m.lastName}`}
          subtitle={m.isOnline ? t('company.members.online') : t('company.members.offline')}
          left={<Avatar uri={m.photo?.url} firstName={m.firstName} lastName={m.lastName} size={36} />}
          onPress={() => onPick(m.handymanId!)}
          testID={`reassign-${m.handymanId}`}
        />
      ))}
    </BottomSheet>
  );
}

/** Company worker (board 04): only the job location, navigation and the worker's own steps. */
function WorkerJob({ job, data }: { job: ProAssignment; data: Data }) {
  const { t } = useT();
  const actions = useJobActions(job, data);
  const visibility = jobVisibility(job, 'worker');
  const step = nextStep(job, 'worker', data.finalPriceEntry);
  const region = { latitude: job.address.lat, longitude: job.address.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 };
  return (
    <View testID="job-limited">
      <View style={styles.mapBox}>
        <TfMapView style={styles.map} region={region}>
          <MapPin coordinate={{ latitude: job.address.lat, longitude: job.address.lng }} kind="target" />
        </TfMapView>
        <View style={styles.chip}>
          <AppText variant="caption" color="textInverse" numberOfLines={2} testID="job-assigned-by">
            {t('job.limited.assignedBy', { number: job.requestNumber, company: job.company?.name ?? '' })}
          </AppText>
        </View>
      </View>
      <Card style={styles.block} testID="job-location-card">
        <AppText variant="h3">{t('job.limited.location')}</AppText>
        <View style={styles.locationBox}>
          <AddressBlock job={job} />
          <AppText variant="bodyStrong" style={styles.line} testID="job-category">
            {job.category.name}
          </AppText>
          {job.scheduledAt ? (
            <AppText variant="small" color="primary" style={styles.line}>
              {t('job.scheduledAt', { time: formatDateTime(job.scheduledAt) })}
            </AppText>
          ) : null}
        </View>
        <AppText variant="small" color="textMuted" style={styles.line} testID="job-limited-note">
          {t('job.limited.note')}
        </AppText>
        <NavButtons job={job} title={t('job.title', { number: job.requestNumber })} />
      </Card>
      <View style={styles.block}>
        <StepArea job={job} data={data} step={step} actions={actions} />
      </View>
      <JobTimeline job={job} />
      <CustomerCard job={job} visibility={visibility} limited />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.md },
  line: { marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  sheetAction: { flex: 1, marginHorizontal: spacing.xs },
  tag: { marginLeft: spacing.sm },
  flexText: { flex: 1, marginLeft: spacing.md },
  mapBox: { height: 220, borderRadius: radii.lg, overflow: 'hidden' },
  map: { flex: 1 },
  chip: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.dark,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  locationBox: { marginTop: spacing.md, backgroundColor: colors.background, borderRadius: radii.md, padding: spacing.md },
});
