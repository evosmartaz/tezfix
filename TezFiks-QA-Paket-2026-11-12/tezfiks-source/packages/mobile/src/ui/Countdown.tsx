import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { countdownProgress, countdownSeconds, formatCountdown } from '../format';
import { useClockOffset } from '../clock';
import { colors, radii } from '../theme/tokens';
import { AppText, type AppTextProps } from './Text';

export interface UseCountdownOptions {
  /** serverNow - clientNow; defaults to the global server clock offset. */
  offsetMs?: number;
  intervalMs?: number;
  onExpire?: () => void;
}

/** Seconds left until a server deadline, ticking; calls onExpire once when it reaches 0. */
export function useCountdown(deadline: string | Date | number | null | undefined, opts: UseCountdownOptions = {}): number {
  const globalOffset = useClockOffset();
  const offset = opts.offsetMs ?? globalOffset;
  const compute = () => (deadline == null ? 0 : countdownSeconds(deadline, offset));
  const [left, setLeft] = useState(compute);
  const onExpireRef = useRef(opts.onExpire);
  onExpireRef.current = opts.onExpire;
  const firedFor = useRef<unknown>(null);

  useEffect(() => {
    if (deadline == null) {
      setLeft(0);
      return;
    }
    const tick = () => {
      const next = countdownSeconds(deadline, offset);
      setLeft(next);
      if (next === 0 && firedFor.current !== deadline) {
        firedFor.current = deadline;
        onExpireRef.current?.();
      }
      return next;
    };
    if (tick() === 0) return;
    const id = setInterval(() => {
      if (tick() === 0) clearInterval(id);
    }, opts.intervalMs ?? 250);
    return () => clearInterval(id);
  }, [deadline, offset, opts.intervalMs]);

  return left;
}

export interface CountdownProps extends Omit<AppTextProps, 'children'> {
  deadline: string | Date | number | null | undefined;
  /** Window length; when set a progress bar is drawn (offer modal "Qəbul üçün 30 saniyə"). */
  totalSec?: number;
  /** "mmss" → "00:42" (default), "seconds" → "42". */
  format?: 'mmss' | 'seconds';
  offsetMs?: number;
  onExpire?: () => void;
  /** Custom text, e.g. t('auth.resendIn', { time }). */
  render?: (left: number, formatted: string) => string;
}

export function Countdown({ deadline, totalSec, format = 'mmss', offsetMs, onExpire, render, testID = 'countdown', ...rest }: CountdownProps) {
  const left = useCountdown(deadline, { offsetMs, onExpire });
  const formatted = format === 'seconds' ? String(left) : formatCountdown(left);
  const text = render ? render(left, formatted) : formatted;
  if (!totalSec) {
    return (
      <AppText {...rest} testID={testID}>
        {text}
      </AppText>
    );
  }
  const progress = countdownProgress(left, totalSec);
  return (
    <View testID={testID}>
      <AppText {...rest}>{text}</AppText>
      <View style={styles.track}>
        <View style={[styles.bar, { width: `${progress * 100}%`, backgroundColor: progress < 0.3 ? colors.danger : colors.primary }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 4, borderRadius: radii.pill, backgroundColor: colors.border, marginTop: 6, overflow: 'hidden' },
  bar: { height: 4, borderRadius: radii.pill },
});
