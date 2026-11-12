import { useLocale } from 'next-intl';
import type { FormatMoneyOptions } from '@tezfiks/shared';
import { moneyText } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MoneyProps extends FormatMoneyOptions {
  /** Integer qəpik. */
  minor: number | null | undefined;
  className?: string;
  /** Colour negatives red and positives green (ledger lines). */
  colored?: boolean;
}

export function Money({ minor, className, colored, ...opts }: MoneyProps) {
  const locale = useLocale();
  const tone =
    colored && typeof minor === 'number'
      ? minor < 0
        ? 'text-danger'
        : minor > 0
          ? 'text-primary-strong'
          : ''
      : '';
  return (
    <span className={cn('tabular-nums whitespace-nowrap', tone, className)}>
      {moneyText(minor, locale, opts)}
    </span>
  );
}
