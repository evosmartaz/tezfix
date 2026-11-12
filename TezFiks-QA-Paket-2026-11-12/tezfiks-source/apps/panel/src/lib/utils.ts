import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui class combiner. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Merges base classes into a Base UI `className` prop, which may be a string or a function of the component state.
 */
export function withBase<S>(
  className: string | ((state: S) => string | undefined) | undefined,
  ...base: ClassValue[]
): string | ((state: S) => string) {
  if (typeof className === 'function') return (state: S) => cn(...base, className(state));
  return cn(...base, className);
}
