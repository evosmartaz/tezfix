'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import type { CompanyView, FinalPriceEntry } from '@tezfiks/shared';
import { FormError, FormField } from '@/components/form-field';
import { PanelMap, BAKU_CENTER } from '@/components/map/panel-map';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { updateSettingsAction } from '../actions';
import { settingsBody, settingsFormOf, type SettingsForm } from '../mappers';

export interface TradeOption {
  id: string;
  name: string;
  group: string;
}

type SettingsField = 'name' | 'tradeIds' | 'serviceRadiusKm' | 'base' | 'baseAddress';

const ENTRIES: FinalPriceEntry[] = ['WORKER', 'MANAGER'];

/** Tənzimləmələr: name, "Yekun qiyməti kim daxil edir?" (board 04), VAT payer, trades, radius, base point + address. */
export function CompanySettingsForm({ company, tradeOptions }: { company: CompanyView; tradeOptions: TradeOption[] }) {
  const t = useTranslations('panel.company.settings');
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState<SettingsForm>(() => settingsFormOf(company));
  const [field, setField] = useState<SettingsField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The company's current trades stay visible even if the catalogue no longer lists them.
  const options = useMemo(() => {
    const known = new Set(tradeOptions.map((o) => o.id));
    const extra = company.trades.filter((tr) => !known.has(tr.id)).map((tr) => ({ id: tr.id, name: tr.name, group: '' }));
    const all = [...tradeOptions, ...extra];
    const groups = new Map<string, TradeOption[]>();
    for (const o of all) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
    return [...groups.entries()];
  }, [tradeOptions, company.trades]);

  const baseLat = Number(form.baseLat.replace(',', '.'));
  const baseLng = Number(form.baseLng.replace(',', '.'));
  const hasBase = form.baseLat.trim() !== '' && Number.isFinite(baseLat) && Number.isFinite(baseLng);
  const [mapCenter] = useState(() => (company.base ? company.base : BAKU_CENTER));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = settingsBody(company, form);
    if (!built.ok) {
      setField(built.field);
      return;
    }
    setField(null);
    setError(null);
    if (Object.keys(built.body).length === 0) {
      toast(t('noChanges'));
      return;
    }
    setBusy(true);
    try {
      const r = await updateSettingsAction(company.id, built.body);
      if (r.ok) {
        toast.success(t('saved'));
        setForm(settingsFormOf(r.data));
        router.refresh();
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <FormError message={error} />

      <section className="flex flex-col gap-3" aria-labelledby={`${id}-fpe`}>
        <div>
          <h2 id={`${id}-fpe`} className="text-base font-semibold">
            {t('finalPrice.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('finalPrice.description')}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" role="radiogroup" aria-labelledby={`${id}-fpe`}>
          {ENTRIES.map((entry) => {
            const checked = form.finalPriceEntry === entry;
            return (
              <label
                key={entry}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border-2 p-4 transition-colors',
                  checked ? 'border-primary' : 'border-border hover:border-primary/50',
                )}
              >
                <input
                  type="radio"
                  name="finalPriceEntry"
                  value={entry}
                  checked={checked}
                  onChange={() => setForm({ ...form, finalPriceEntry: entry })}
                  className="mt-1 size-4 accent-[var(--color-primary)]"
                />
                <span>
                  <span className="block font-semibold">{t(`finalPrice.${entry}.title`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`finalPrice.${entry}.description`)}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="rounded-lg bg-ink p-4 text-sm text-white/85">
          <div className="mb-1 font-semibold text-primary">{t('finalPrice.howTitle')}</div>
          {t('finalPrice.how')}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label={t('name')} htmlFor={`${id}-name`} error={field === 'name' ? t('errors.name') : undefined}>
          <Input
            id={`${id}-name`}
            value={form.name}
            maxLength={120}
            aria-invalid={field === 'name' || undefined}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </FormField>
        <FormField
          label={t('radius')}
          htmlFor={`${id}-radius`}
          error={field === 'serviceRadiusKm' ? t('errors.radius') : undefined}
          hint={t('radiusHint')}
        >
          <Input
            id={`${id}-radius`}
            inputMode="numeric"
            value={form.serviceRadiusKm}
            aria-invalid={field === 'serviceRadiusKm' || undefined}
            onChange={(e) => setForm({ ...form, serviceRadiusKm: e.target.value })}
          />
        </FormField>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-primary)]"
            checked={form.isVatPayer}
            onChange={(e) => setForm({ ...form, isVatPayer: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t('vat')}</span>
            <span className="block text-xs text-muted-foreground">{t('vatHint')}</span>
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby={`${id}-trades`}>
        <h2 id={`${id}-trades`} className="text-base font-semibold">
          {t('trades')}
        </h2>
        {field === 'tradeIds' ? (
          <p role="alert" className="text-xs text-danger">
            {t('errors.trades')}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {options.map(([group, items]) => (
            <fieldset key={group || '-'} className="flex flex-col gap-1.5">
              {group ? <legend className="mb-1 text-xs font-semibold text-muted-foreground uppercase">{group}</legend> : null}
              {items.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={form.tradeIds.includes(o.id)}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        tradeIds: e.target.checked ? [...f.tradeIds, o.id] : f.tradeIds.filter((x) => x !== o.id),
                      }))
                    }
                  />
                  {o.name}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby={`${id}-base`}>
        <h2 id={`${id}-base`} className="text-base font-semibold">
          {t('base')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('baseHint')}</p>
        <PanelMap
          className="h-72"
          center={mapCenter}
          markers={hasBase ? [{ id: 'base', lat: baseLat, lng: baseLng, label: t('base') }] : []}
          onMapClick={(p) =>
            setForm((f) => ({ ...f, baseLat: p.lat.toFixed(6), baseLng: p.lng.toFixed(6) }))
          }
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FormField label={t('lat')} htmlFor={`${id}-lat`} error={field === 'base' ? t('errors.base') : undefined}>
            <Input id={`${id}-lat`} inputMode="decimal" value={form.baseLat} onChange={(e) => setForm({ ...form, baseLat: e.target.value })} />
          </FormField>
          <FormField label={t('lng')} htmlFor={`${id}-lng`}>
            <Input id={`${id}-lng`} inputMode="decimal" value={form.baseLng} onChange={(e) => setForm({ ...form, baseLng: e.target.value })} />
          </FormField>
          <FormField label={t('baseAddress')} htmlFor={`${id}-addr`} error={field === 'baseAddress' ? t('errors.baseAddress') : undefined}>
            <Input
              id={`${id}-addr`}
              value={form.baseAddress}
              maxLength={300}
              onChange={(e) => setForm({ ...form, baseAddress: e.target.value })}
            />
          </FormField>
        </div>
      </section>

      <div>
        <Button type="submit" loading={busy} size="lg">
          <Save />
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
