'use client';

import { useId, type ReactNode } from 'react';
import {
  useFormContext,
  type FieldErrors,
  type FieldValues,
  type Path,
  type RegisterOptions,
} from 'react-hook-form';
import { Input, Label, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  label: ReactNode;
  /** Id of the control (links the label). */
  htmlFor: string;
  error?: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error layout used by every panel form. */
export function FormField({ label, htmlFor, error, hint, className, children }: FormFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function errorText<T extends FieldValues>(errors: FieldErrors<T>, name: string): string | undefined {
  let node: unknown = errors;
  for (const part of name.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  const message = (node as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : undefined;
}

export interface TextFieldProps<T extends FieldValues> {
  name: Path<T>;
  label: ReactNode;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  hint?: ReactNode;
  multiline?: boolean;
  rules?: RegisterOptions<T, Path<T>>;
  className?: string;
  disabled?: boolean;
}

/** react-hook-form text input (inside <FormProvider>); zod errors from the resolver are shown under the field. */
export function TextField<T extends FieldValues>({
  name,
  label,
  type = 'text',
  placeholder,
  autoComplete,
  inputMode,
  hint,
  multiline,
  rules,
  className,
  disabled,
}: TextFieldProps<T>) {
  const { register, formState } = useFormContext<T>();
  const id = `${useId()}-${name}`;
  const error = errorText(formState.errors, name);
  const common = {
    id,
    placeholder,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    ...register(name, rules),
  };
  return (
    <FormField label={label} htmlFor={id} error={error} hint={hint} className={className}>
      {multiline ? (
        <Textarea {...common} />
      ) : (
        <Input type={type} autoComplete={autoComplete} inputMode={inputMode} {...common} />
      )}
    </FormField>
  );
}

/** Form-level error (e.g. the translated API error of a failed action). */
export function FormError({ message }: { message?: ReactNode }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger"
    >
      {message}
    </div>
  );
}
