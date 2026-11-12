'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { RotateCcw, Save } from 'lucide-react';
import type { PlatformSettings } from '@tezfiks/shared';
import { FormError, FormField } from '@/components/form-field';
import { toast } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { moneyText } from '@/lib/format';
import { updateSettingsAction } from '../actions';
import {
  SETTINGS_GROUPS,
  settingDefaultText,
  settingsPatch,
  settingsToForm,
  type SettingField,
  type SettingKey,
  type SettingsForm,
} from '../mappers';
import { Section } from './ui';

/** Platform settings (fees, timers, limits) with the defaults next to each field; only changed values are sent. */
export function SettingsFormView({
  settings,
  defaults,
  demoMode,
  canEdit,
}: {
  settings: PlatformSettings;
  defaults: PlatformSettings;
  demoMode: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations('panel.admin.settings');
  const locale = useLocale();
  const router = useRouter();
  const initial = useMemo(() => settingsToForm(settings), [settings]);
  const form = useForm<SettingsForm>({ defaultValues: initial, values: initial });
  const [invalid, setInvalid] = useState<SettingKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  function defaultText(field: SettingField): string {
    if (field.kind === 'money') return moneyText(defaults[field.key], locale);
    return `${settingDefaultText(field, defaults)} ${t(`units.${field.unit}`)}`.trim();
  }

  async function submit(values: SettingsForm) {
    setError(null);
    const out = settingsPatch(values, settings);
    if (!out.ok) {
      setInvalid(out.errors);
      return;
    }
    setInvalid([]);
    if (Object.keys(out.patch).length === 0) {
      toast.info(t('noChanges'));
      return;
    }
    const r = await updateSettingsAction(out.patch);
    if (r.ok) {
      toast.success(t('saved'));
      router.refresh();
    } else setError(r.message);
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-6" noValidate>
      {demoMode ? (
        <div className="rounded-md border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-800" data-demo-badge>
          <span className="mr-2 rounded bg-violet-600 px-1.5 py-0.5 text-xs font-semibold text-white uppercase">{t('demoBadge')}</span>
          {t('demoNotice')}
        </div>
      ) : null}
      <FormError message={error ?? (invalid.length ? t('invalidFields', { count: invalid.length }) : null)} />
      {SETTINGS_GROUPS.map((group) => (
        <Section key={group.id} title={t(`groups.${group.id}`)}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.fields.map((field) => {
              const id = `setting-${field.key}`;
              const changed = form.watch(field.key) !== initial[field.key];
              return (
                <FormField
                  key={field.key}
                  htmlFor={id}
                  label={
                    <span>
                      {t(`fields.${field.key}`)}
                      {changed ? <span className="ml-1 text-accent-strong">•</span> : null}
                    </span>
                  }
                  error={invalid.includes(field.key) ? t('invalidValue') : undefined}
                  hint={t('defaultHint', { value: defaultText(field) })}
                >
                  <div className="relative">
                    <Input
                      id={id}
                      inputMode={field.kind === 'int' ? 'numeric' : 'decimal'}
                      disabled={!canEdit}
                      aria-invalid={invalid.includes(field.key) || undefined}
                      className="pr-14"
                      {...form.register(field.key)}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                      {t(`units.${field.unit}`)}
                    </span>
                  </div>
                </FormField>
              );
            })}
          </div>
        </Section>
      ))}
      {canEdit ? (
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background/95 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              form.reset(initial);
              setInvalid([]);
            }}
          >
            <RotateCcw />
            {t('reset')}
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            <Save />
            {t('save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
