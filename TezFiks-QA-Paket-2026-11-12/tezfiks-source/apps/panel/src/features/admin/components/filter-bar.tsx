'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { hrefWith } from '../mappers';
import { Select } from './ui';

export interface FilterSelect {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

export interface FilterBarProps {
  /** Page path without basePath, e.g. "/admin/orders". */
  path: string;
  /** Current flat search params. */
  params: Record<string, string | undefined>;
  /** Show the text search (`q`). */
  search?: boolean;
  searchPlaceholder?: string;
  selects?: FilterSelect[];
  /** Show `from` / `to` date inputs (Baku days). */
  dates?: boolean;
  /** Free text filters (e.g. audit entityType / entityId). */
  texts?: Array<{ key: string; label: string; placeholder?: string }>;
}

/** URL-driven list filters: every change navigates to the same page with new search params (first page). */
export function FilterBar({ path, params, search, searchPlaceholder, selects = [], dates, texts = [] }: FilterBarProps) {
  const t = useTranslations('panel.admin.common');
  const router = useRouter();
  const [q, setQ] = useState(params.q ?? '');
  const [textValues, setTextValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(texts.map((f) => [f.key, params[f.key] ?? ''])),
  );

  function go(patch: Record<string, string | undefined>) {
    router.push(hrefWith(path, params, patch));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    go({ ...(search ? { q: q.trim() } : {}), ...Object.fromEntries(Object.entries(textValues).map(([k, v]) => [k, v.trim()])) });
  }

  const filterKeys = ['q', ...selects.map((s) => s.key), ...(dates ? ['from', 'to'] : []), ...texts.map((f) => f.key)];
  const active = filterKeys.some((k) => params[k]);

  return (
    <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3" role="search">
      {search ? (
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="filter-q">{t('search')}</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="filter-q"
              name="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder ?? t('searchPlaceholder')}
              className="pl-9"
              maxLength={100}
            />
          </div>
        </div>
      ) : null}
      {texts.map((f) => (
        <div key={f.key} className="flex min-w-44 flex-col gap-1.5">
          <Label htmlFor={`filter-${f.key}`}>{f.label}</Label>
          <Input
            id={`filter-${f.key}`}
            value={textValues[f.key] ?? ''}
            placeholder={f.placeholder}
            onChange={(e) => setTextValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            maxLength={60}
          />
        </div>
      ))}
      {selects.map((s) => (
        <div key={s.key} className="flex min-w-44 flex-col gap-1.5">
          <Label htmlFor={`filter-${s.key}`}>{s.label}</Label>
          <Select id={`filter-${s.key}`} value={params[s.key] ?? ''} onChange={(e) => go({ [s.key]: e.target.value })}>
            <option value="">{t('all')}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
      {dates ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-from">{t('from')}</Label>
            <Input id="filter-from" type="date" value={params.from ?? ''} onChange={(e) => go({ from: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-to">{t('to')}</Label>
            <Input id="filter-to" type="date" value={params.to ?? ''} onChange={(e) => go({ to: e.target.value })} />
          </div>
        </>
      ) : null}
      {search || texts.length ? (
        <Button type="submit" variant="secondary">
          {t('apply')}
        </Button>
      ) : null}
      {active ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setQ('');
            setTextValues(Object.fromEntries(texts.map((f) => [f.key, ''])));
            go(Object.fromEntries(filterKeys.map((k) => [k, undefined])));
          }}
        >
          <X />
          {t('reset')}
        </Button>
      ) : null}
    </form>
  );
}
