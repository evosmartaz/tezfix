'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bot, Send, Trash2 } from 'lucide-react';
import type { Category, DemoConfig } from '@tezfiks/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError, FormField } from '@/components/form-field';
import { BAKU_CENTER, PanelMap } from '@/components/map/panel-map';
import { Money } from '@/components/money';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { demoClearBotsAction, demoConfigAction, demoCreateRequestAction, demoSpawnBotsAction } from '../actions';
import {
  demoRequestBody,
  demoSpawnBody,
  instantServices,
  MAP_COLORS,
  moneyInput,
  parseMoneyInput,
  type DemoRequestForm,
  type DemoSpawnForm,
} from '../mappers';
import type { DemoState } from '../types';
import { Section, Select } from './ui';

type Point = { lat: number; lng: number };

/** A company bots can join as workers (approved companies only). */
export interface DemoCompanyOption {
  id: string;
  name: string;
}

export interface DemoConfigForm {
  autoAccept: boolean;
  acceptDelaySec: string;
  speedKmh: string;
  autoArrive: boolean;
  autoPrice: boolean;
  priceLabor: string;
  priceMaterials: string;
}

export function demoConfigToForm(c: DemoConfig): DemoConfigForm {
  return {
    autoAccept: c.autoAccept,
    acceptDelaySec: String(c.acceptDelaySec),
    speedKmh: String(c.speedKmh),
    autoArrive: c.autoArrive,
    autoPrice: c.autoPrice,
    priceLabor: moneyInput(c.priceLabor),
    priceMaterials: moneyInput(c.priceMaterials),
  };
}

/** Changed simulator settings only; null when a number is invalid (contract ranges: delay 1..120 s, speed 5..300 km/h). */
export function demoConfigPatch(form: DemoConfigForm, current: DemoConfig): Partial<DemoConfig> | null {
  const delay = Number(form.acceptDelaySec);
  const speed = Number(form.speedKmh);
  const labor = parseMoneyInput(form.priceLabor);
  const materials = parseMoneyInput(form.priceMaterials);
  if (!Number.isInteger(delay) || delay < 1 || delay > 120) return null;
  if (!Number.isInteger(speed) || speed < 5 || speed > 300) return null;
  if (labor === null || labor < 0 || materials === null || materials < 0) return null;
  const next: DemoConfig = {
    autoAccept: form.autoAccept,
    acceptDelaySec: delay,
    speedKmh: speed,
    autoArrive: form.autoArrive,
    autoPrice: form.autoPrice,
    priceLabor: labor,
    priceMaterials: materials,
  };
  const patch: Partial<DemoConfig> = {};
  for (const key of Object.keys(next) as Array<keyof DemoConfig>) {
    if (next[key] !== current[key]) (patch as Record<string, unknown>)[key] = next[key];
  }
  return patch;
}

function SpawnBots({ point, services, companies }: { point: Point | null; services: Category[]; companies: DemoCompanyOption[] }) {
  const t = useTranslations('panel.admin.demo.spawn');
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState<DemoSpawnForm>({ count: '5', radius: '3', tradeId: '', companyId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = demoSpawnBody(form, point ?? BAKU_CENTER);
    if (!parsed.ok) {
      setError(t('invalid'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await demoSpawnBotsAction(parsed.body);
      if (res.ok) {
        toast.success(t('done', { count: parsed.body.count }));
        router.refresh();
      } else setError(res.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <FormError message={error} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('count')} htmlFor={`${id}-count`}>
          <Input id={`${id}-count`} inputMode="numeric" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
        </FormField>
        <FormField label={t('radius')} htmlFor={`${id}-radius`}>
          <Input id={`${id}-radius`} inputMode="decimal" value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} />
        </FormField>
        <FormField label={t('trade')} htmlFor={`${id}-trade`}>
          <Select id={`${id}-trade`} value={form.tradeId} onChange={(e) => setForm({ ...form, tradeId: e.target.value })}>
            <option value="">{t('anyTrade')}</option>
            {services.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('company')} htmlFor={`${id}-company`}>
          <Select id={`${id}-company`} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            <option value="">{t('solo')}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">{point ? t('atPoint') : t('atCenter')}</p>
      <div>
        <Button type="submit" size="sm" loading={busy}>
          <Bot />
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

function ConfigForm({ config }: { config: DemoConfig }) {
  const t = useTranslations('panel.admin.demo.config');
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState<DemoConfigForm>(() => demoConfigToForm(config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch = demoConfigPatch(form, config);
    if (!patch) {
      setError(t('invalid'));
      return;
    }
    if (Object.keys(patch).length === 0) {
      toast.info(t('noChanges'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await demoConfigAction(patch);
      if (r.ok) {
        toast.success(t('saved'));
        router.refresh();
      } else setError(r.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: 'autoAccept' | 'autoArrive' | 'autoPrice') => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-[var(--color-primary)]"
        checked={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
      />
      {t(key)}
    </label>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <FormError message={error} />
      <div className="flex flex-wrap gap-4">
        {toggle('autoAccept')}
        {toggle('autoArrive')}
        {toggle('autoPrice')}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('acceptDelaySec')} htmlFor={`${id}-delay`}>
          <Input id={`${id}-delay`} inputMode="numeric" value={form.acceptDelaySec} onChange={(e) => setForm({ ...form, acceptDelaySec: e.target.value })} />
        </FormField>
        <FormField label={t('speedKmh')} htmlFor={`${id}-speed`}>
          <Input id={`${id}-speed`} inputMode="numeric" value={form.speedKmh} onChange={(e) => setForm({ ...form, speedKmh: e.target.value })} />
        </FormField>
        <FormField label={t('priceLabor')} htmlFor={`${id}-labor`}>
          <Input id={`${id}-labor`} inputMode="decimal" value={form.priceLabor} onChange={(e) => setForm({ ...form, priceLabor: e.target.value })} />
        </FormField>
        <FormField label={t('priceMaterials')} htmlFor={`${id}-materials`}>
          <Input
            id={`${id}-materials`}
            inputMode="decimal"
            value={form.priceMaterials}
            onChange={(e) => setForm({ ...form, priceMaterials: e.target.value })}
          />
        </FormField>
      </div>
      <div>
        <Button type="submit" size="sm" variant="secondary" loading={busy}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

function TestRequestForm({ point, categories }: { point: Point | null; categories: Category[] }) {
  const t = useTranslations('panel.admin.demo.request');
  const tc = useTranslations('common');
  const router = useRouter();
  const id = useId();
  const services = useMemo(() => instantServices(categories), [categories]);
  const [form, setForm] = useState<DemoRequestForm>({
    categoryId: services[0]?.id ?? '',
    timing: 'NOW',
    slots: '1',
    scheduledAt: '',
    description: '',
  });
  const [field, setField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ requestId: string; number: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = demoRequestBody(form, point);
    if (!built.ok) {
      setField(built.field);
      return;
    }
    setField(null);
    setError(null);
    setBusy(true);
    try {
      const r = await demoCreateRequestAction(built.body);
      if (r.ok) {
        setCreated(r.data);
        toast.success(t('created', { number: r.data.number }));
        router.refresh();
      } else setError(r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <FormError message={error ?? (field === 'point' ? t('pickPoint') : null)} />
      <p className="text-xs text-muted-foreground">
        {point ? t('point', { lat: point.lat.toFixed(5), lng: point.lng.toFixed(5) }) : t('pickPoint')}
      </p>
      <FormField label={t('category')} htmlFor={`${id}-cat`} error={field === 'categoryId' ? t('required') : undefined}>
        <Select id={`${id}-cat`} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
          <option value="">—</option>
          {services.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('timing')} htmlFor={`${id}-timing`}>
          <Select
            id={`${id}-timing`}
            value={form.timing}
            onChange={(e) => setForm({ ...form, timing: e.target.value as DemoRequestForm['timing'] })}
          >
            {(['NOW', 'SCHEDULED', 'EMERGENCY'] as const).map((v) => (
              <option key={v} value={v}>
                {tc(`timing.${v}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('slots')} htmlFor={`${id}-slots`} error={field === 'slots' ? t('slotsError') : undefined}>
          <Input id={`${id}-slots`} inputMode="numeric" value={form.slots} onChange={(e) => setForm({ ...form, slots: e.target.value })} />
        </FormField>
      </div>
      {form.timing === 'SCHEDULED' ? (
        <FormField label={t('scheduledAt')} htmlFor={`${id}-at`} error={field === 'scheduledAt' ? t('required') : undefined} hint={t('bakuTime')}>
          <Input id={`${id}-at`} type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
        </FormField>
      ) : null}
      <FormField label={t('description')} htmlFor={`${id}-desc`}>
        <Textarea id={`${id}-desc`} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" loading={busy}>
          <Send />
          {t('submit')}
        </Button>
        {created ? (
          <Link href={`/admin/orders/${created.requestId}`} className="text-sm font-semibold text-primary hover:underline">
            {t('open', { number: created.number })} →
          </Link>
        ) : null}
      </div>
    </form>
  );
}

/** Demo simulator console (DEMO_MODE only): bots, simulator settings, test requests placed by clicking the map. */
export function DemoConsole({
  state,
  categories,
  companies = [],
}: {
  state: DemoState;
  categories: Category[];
  /** Approved companies the spawned bots can join as workers. */
  companies?: DemoCompanyOption[];
}) {
  const t = useTranslations('panel.admin.demo');
  const services = useMemo(() => instantServices(categories), [categories]);
  const router = useRouter();
  const [point, setPoint] = useState<Point | null>(null);

  const markers = [
    ...state.bots.map((b) => ({
      id: `h:${b.handymanId}`,
      lat: b.lat,
      lng: b.lng,
      label: `${b.name}${b.companyName ? ` · ${b.companyName}` : ''}`,
      color: b.busy ? MAP_COLORS.busy : MAP_COLORS.bot,
    })),
    ...(point ? [{ id: 'picked', lat: point.lat, lng: point.lng, label: t('pickedPoint'), color: MAP_COLORS.request }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-2 xl:col-span-2">
          <p className="text-sm text-muted-foreground">{t('mapHint')}</p>
          <PanelMap className="h-[32rem]" markers={markers} onMapClick={setPoint} />
        </div>
        <div className="flex flex-col gap-6">
          <Section title={t('sections.request')}>
            <TestRequestForm point={point} categories={categories} />
          </Section>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title={t('sections.spawn')}>
          <SpawnBots point={point} services={services} companies={companies} />
        </Section>
        <Section title={t('sections.config')}>
          <ConfigForm key={JSON.stringify(state.config)} config={state.config} />
        </Section>
      </div>
      <Section
        title={t('sections.bots', { count: state.bots.length })}
        bodyClassName="p-0"
        actions={
          state.bots.length ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Trash2 />
                  {t('clear')}
                </Button>
              }
              title={t('clear')}
              description={t('clearDescription')}
              destructive
              onConfirm={async () => {
                const r = await demoClearBotsAction();
                if (!r.ok) {
                  toast.error(r.message);
                  return false;
                }
                toast.success(t('cleared'));
                router.refresh();
                return true;
              }}
            />
          ) : null
        }
      >
        {state.bots.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t('noBots')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.trades')}</TableHead>
                <TableHead>{t('columns.location')}</TableHead>
                <TableHead>{t('columns.state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.bots.map((b) => (
                <TableRow key={b.handymanId}>
                  <TableCell>
                    <Link href={`/admin/handymen/${b.handymanId}`} className="font-medium text-primary hover:underline">
                      {b.name}
                    </Link>
                    {b.companyName ? <div className="text-xs text-muted-foreground">{b.companyName}</div> : null}
                  </TableCell>
                  <TableCell>{b.trades.join(', ') || '—'}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {b.lat.toFixed(4)}, {b.lng.toFixed(4)}
                  </TableCell>
                  <TableCell>{b.busy ? t('busy') : t('free')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <p className="text-xs text-muted-foreground">
        {t('priceNote')} <Money minor={state.config.priceLabor + state.config.priceMaterials} />
      </p>
    </div>
  );
}
