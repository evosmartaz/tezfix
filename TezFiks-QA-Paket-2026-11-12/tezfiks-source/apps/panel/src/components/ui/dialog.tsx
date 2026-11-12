'use client';

import * as React from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn, withBase } from '@/lib/utils';

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

const backdrop =
  'fixed inset-0 z-50 min-h-dvh bg-ink/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0';

export function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof BaseDialog.Popup> & { closeLabel?: string }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdrop} />
      <BaseDialog.Popup
        className={withBase(
          className,
          'fixed top-1/2 left-1/2 z-50 flex w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-xl',
          'transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
        )}
        {...props}
      >
        {children}
        {closeLabel ? (
          <BaseDialog.Close
            aria-label={closeLabel}
            className="absolute top-4 right-4 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </BaseDialog.Close>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title className={withBase(className, 'text-lg font-semibold text-foreground')} {...props} />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description className={withBase(className, 'text-sm text-muted-foreground')} {...props} />
  );
}

/** Drawer / Sheet: a dialog anchored to the right (detail panels) or left (mobile navigation) edge. */
export function SheetContent({
  className,
  children,
  side = 'right',
  closeLabel,
  ...props
}: React.ComponentProps<typeof BaseDialog.Popup> & { side?: 'left' | 'right'; closeLabel?: string }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdrop} />
      <BaseDialog.Popup
        className={withBase(
          className,
          'fixed inset-y-0 z-50 flex w-[28rem] max-w-[100vw] flex-col gap-4 overflow-y-auto bg-surface p-6 shadow-xl transition-transform duration-200',
          side === 'right'
            ? 'right-0 border-l border-border data-ending-style:translate-x-full data-starting-style:translate-x-full'
            : 'left-0 border-r border-border data-ending-style:-translate-x-full data-starting-style:-translate-x-full',
        )}
        {...props}
      >
        {children}
        {closeLabel ? (
          <BaseDialog.Close
            aria-label={closeLabel}
            className="absolute top-4 right-4 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </BaseDialog.Close>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export const Sheet = BaseDialog.Root;
export const SheetTrigger = BaseDialog.Trigger;
export const SheetClose = BaseDialog.Close;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
