import { dateTimeText, type DateTimeMode } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface DateTimeProps {
  value: string | Date | number | null | undefined;
  mode?: DateTimeMode;
  className?: string;
}

/** Date/time in Baku time ("24.10.2026, 18:05"), identical on the server and in the browser. */
export function DateTime({ value, mode = 'datetime', className }: DateTimeProps) {
  const text = dateTimeText(value, mode);
  if (text === '—' || value === null || value === undefined) return <span className={className}>—</span>;
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso} className={cn('tabular-nums whitespace-nowrap', className)}>
      {text}
    </time>
  );
}
