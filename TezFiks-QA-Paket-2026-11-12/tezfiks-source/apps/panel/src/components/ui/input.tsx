import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type = 'text', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
        'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
        'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}
