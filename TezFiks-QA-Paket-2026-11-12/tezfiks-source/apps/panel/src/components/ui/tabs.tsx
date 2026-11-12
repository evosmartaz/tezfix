'use client';

import * as React from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { withBase } from '@/lib/utils';

export const Tabs = BaseTabs.Root;

/** Pill tabs as on board 05 ("Hamısı (312)", "Təsdiq gözləyən (9)", ...). */
export function TabsList({ className, ...props }: React.ComponentProps<typeof BaseTabs.List>) {
  return <BaseTabs.List className={withBase(className, 'flex flex-wrap items-center gap-2')} {...props} />;
}

export function TabsTab({ className, ...props }: React.ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={withBase(
        className,
        'inline-flex h-8 items-center rounded-full border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted',
        'data-active:border-ink data-active:bg-ink data-active:text-white',
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: React.ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={withBase(className, 'mt-4 outline-none')} {...props} />;
}
