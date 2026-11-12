import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { statusPresentation, TONE_CLASSES, type StatusFamily, type StatusOf } from '@/lib/status';
import { cn } from '@/lib/utils';

export interface StatusBadgeProps<F extends StatusFamily> {
  family: F;
  status: StatusOf<F> | (string & {});
  className?: string;
}

/** Coloured, translated status pill for every status enum (request, assignment, verification, payment, ...). */
export function StatusBadge<F extends StatusFamily>({ family, status, className }: StatusBadgeProps<F>) {
  const t = useTranslations();
  const p = statusPresentation(family, status);
  return (
    <Badge className={cn(TONE_CLASSES[p.tone], className)} data-tone={p.tone} data-status={status}>
      {t(p.labelKey)}
    </Badge>
  );
}
