import { useCallback, useRef } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';

/** Space kept above a revealed field (its label stays visible). */
export const REVEAL_MARGIN = 16;

interface Focusable {
  focus(): void;
}

/** First field of `order` (display order) that has an error, or null. */
export function firstInvalidField<F extends string>(order: readonly F[], errors: Partial<Record<F, unknown>>): F | null {
  return order.find((f) => !!errors[f]) ?? null;
}

/**
 * Long forms with a pinned submit button (onboarding): a failed validation must not look like nothing happened when the
 * invalid field is off-screen. `reveal` scrolls to the first invalid field (in display order) and focuses it when it is
 * a text input. Fields report their position with `onLayout(field)` on a direct child of the scroll content.
 */
export function useFieldReveal<F extends string>(order: readonly F[]) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const positions = useRef<Partial<Record<F, number>>>({});
  const inputs = useRef<Partial<Record<F, Focusable | null>>>({});
  // One stable callback per field: a new callback ref on every render would detach and re-attach the input each time.
  const refCallbacks = useRef(new Map<F, (el: Focusable | null) => void>());

  const onLayout = useCallback(
    (field: F) => (e: LayoutChangeEvent) => {
      positions.current[field] = e.nativeEvent.layout.y;
    },
    [],
  );

  const inputRef = useCallback((field: F) => {
    let cb = refCallbacks.current.get(field);
    if (!cb) {
      cb = (el) => {
        inputs.current[field] = el;
      };
      refCallbacks.current.set(field, cb);
    }
    return cb;
  }, []);

  const reveal = useCallback(
    (errors: Partial<Record<F, unknown>>): F | null => {
      const field = firstInvalidField(order, errors);
      if (!field) return null;
      const y = positions.current[field];
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - REVEAL_MARGIN), animated: true });
      inputs.current[field]?.focus();
      return field;
    },
    [order],
  );

  return { scrollRef, onLayout, inputRef, reveal };
}
