'use client';

import { useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { toast } from '@/components/toaster';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/input';
import type { ActionResult } from '@/lib/errors';

type Variant = ButtonProps['variant'];

/** Shows the toast for an action result; returns whether it succeeded. */
export function reportResult(result: ActionResult<unknown>, success: ReactNode): boolean {
  if (result.ok) {
    toast.success(success);
    return true;
  }
  toast.error(result.message);
  return false;
}

export interface ConfirmButtonProps {
  label: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  successMessage: ReactNode;
  destructive?: boolean;
  variant?: Variant;
  size?: ButtonProps['size'];
  icon?: ReactNode;
  disabled?: boolean;
  action: () => Promise<ActionResult<unknown>>;
}

/** Button + confirmation dialog for an admin action without input (unblock, approve company, mark paid ...). */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  successMessage,
  destructive,
  variant = 'outline',
  size = 'sm',
  icon,
  disabled,
  action,
}: ConfirmButtonProps) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant={variant} size={size} disabled={disabled}>
          {icon}
          {label}
        </Button>
      }
      title={title ?? label}
      description={description}
      confirmLabel={confirmLabel ?? label}
      destructive={destructive}
      onConfirm={async () => {
        const ok = reportResult(await action(), successMessage);
        if (ok) router.refresh();
        return ok;
      }}
    />
  );
}

export interface ReasonButtonProps extends Omit<ConfirmButtonProps, 'action'> {
  /** Minimum reason length (contract: 3). */
  minLength?: number;
  maxLength?: number;
  reasonLabel?: ReactNode;
  /** Optional extra controls (e.g. "charge the customer" checkbox) rendered under the reason. */
  extra?: ReactNode;
  action: (reason: string) => Promise<ActionResult<unknown>>;
}

/** Button + dialog that asks for a reason (reject, block, cancel, mark payout failed ...). */
export function ReasonButton({
  label,
  title,
  description,
  confirmLabel,
  successMessage,
  destructive = true,
  variant = 'outline',
  size = 'sm',
  icon,
  disabled,
  minLength = 3,
  maxLength = 500,
  reasonLabel,
  extra,
  action,
}: ReasonButtonProps) {
  const t = useTranslations('panel.admin.common');
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <ConfirmDialog
      trigger={
        <Button variant={variant} size={size} disabled={disabled}>
          {icon}
          {label}
        </Button>
      }
      title={title ?? label}
      description={description}
      confirmLabel={confirmLabel ?? label}
      destructive={destructive}
      onConfirm={async () => {
        const text = reason.trim();
        if (text.length < minLength || text.length > maxLength) {
          setError(t('reasonLength', { min: minLength, max: maxLength }));
          return false;
        }
        setError(null);
        const ok = reportResult(await action(text), successMessage);
        if (ok) {
          setReason('');
          router.refresh();
        }
        return ok;
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{reasonLabel ?? t('reason')}</Label>
        <Textarea
          id={id}
          value={reason}
          maxLength={maxLength}
          placeholder={t('reasonPlaceholder')}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {extra}
    </ConfirmDialog>
  );
}
