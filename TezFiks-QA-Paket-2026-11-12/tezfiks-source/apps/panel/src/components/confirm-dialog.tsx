'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  /** Element that opens the dialog (rendered as the trigger). Omit it to open the dialog from code (`open`). */
  trigger?: ReactNode;
  /** Controlled mode: the caller decides when the dialog is open (e.g. after a select changed). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  destructive?: boolean;
  /** Extra content (e.g. a reason field) between the description and the buttons. */
  children?: ReactNode;
  /** May be async; the dialog stays open with a spinner until it settles, and closes only when it resolves to anything but `false`. */
  onConfirm: () => unknown | Promise<unknown>;
}

export function ConfirmDialog({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  children,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations();
  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;
  const setOpen = (next: boolean) => {
    if (controlled) onOpenChange?.(next);
    else setInnerOpen(next);
  };
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const result = await onConfirm();
      if (result !== false) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      {trigger ? <AlertDialog.Trigger render={<span className="inline-flex" />}>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-ink/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-xl',
            'transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
          )}
        >
          <AlertDialog.Title className="text-lg font-semibold">
            {title ?? t('panel.confirm.title')}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground">
            {description ?? t('panel.confirm.description')}
          </AlertDialog.Description>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close render={<Button variant="outline" disabled={busy} />}>
              {cancelLabel ?? t('common.actions.cancel')}
            </AlertDialog.Close>
            <Button variant={destructive ? 'destructive' : 'default'} loading={busy} onClick={confirm}>
              {confirmLabel ?? t('common.actions.confirm')}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
