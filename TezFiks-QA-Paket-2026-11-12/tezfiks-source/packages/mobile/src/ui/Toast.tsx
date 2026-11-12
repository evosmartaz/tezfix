import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { AppText } from './Text';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

interface ToastApi {
  show(message: string, opts?: ToastOptions): void;
  hide(): void;
}

/** What the hosts need: the current toast and which modal host (if any) is on top. */
interface ToastHostState {
  item: ToastItem | null;
  /** Id of the most recently mounted modal host; null when no modal with a host is open (the root host draws). */
  topHost: number | null;
  register(id: number): void;
  unregister(id: number): void;
  hide(): void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined, hide: () => undefined });
const ToastHostContext = createContext<ToastHostState | null>(null);

/**
 * Snackbar at the bottom of the screen; one at a time, newest wins.
 * An RN <Modal> (bottom sheet, offer modal) is drawn above the root host, so while a modal with a <ModalToastHost/> is
 * open, that host draws the toast instead (exactly one copy is ever rendered).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const [hosts, setHosts] = useState<readonly number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const insets = useSafeAreaInsets();

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setItem(null);
  }, []);

  const show = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      if (timer.current) clearTimeout(timer.current);
      seq.current += 1;
      setItem({ id: seq.current, message, ...opts });
      timer.current = setTimeout(hide, opts.durationMs ?? 3500);
    },
    [hide],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const register = useCallback((id: number) => setHosts((h) => (h.includes(id) ? h : [...h, id])), []);
  const unregister = useCallback((id: number) => setHosts((h) => h.filter((x) => x !== id)), []);
  const topHost = hosts.length ? hosts[hosts.length - 1] : null;

  const api = useMemo(() => ({ show, hide }), [show, hide]);
  const hostState = useMemo(() => ({ item, topHost, register, unregister, hide }), [item, topHost, register, unregister, hide]);

  return (
    <ToastContext.Provider value={api}>
      <ToastHostContext.Provider value={hostState}>
        {children}
        {item && topHost === null ? <ToastView item={item} onHide={hide} style={{ bottom: insets.bottom + spacing.xl }} /> : null}
      </ToastHostContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

let hostSeq = 0;

export interface ModalToastHostProps {
  /** Where the toast sits inside the modal: 'top' (default; clear of a bottom sheet's buttons) or 'bottom'. */
  position?: 'top' | 'bottom';
}

/**
 * Draws the app's toasts inside an RN <Modal> (place it as the last child of the modal content). While mounted, the root
 * host stays empty; with several modals open, the most recently mounted host draws. BottomSheet already includes one.
 */
export function ModalToastHost({ position = 'top' }: ModalToastHostProps) {
  const ctx = useContext(ToastHostContext);
  const insets = useSafeAreaInsets();
  const id = useRef(0);
  if (!id.current) id.current = ++hostSeq;
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  useEffect(() => {
    if (!register || !unregister) return;
    const own = id.current;
    register(own);
    return () => unregister(own);
  }, [register, unregister]);

  if (!ctx?.item || ctx.topHost !== id.current) return null;
  const place = position === 'top' ? { top: insets.top + spacing.md } : { bottom: insets.bottom + spacing.xl };
  return <ToastView item={ctx.item} onHide={ctx.hide} style={place} />;
}

function ToastView({ item, onHide, style }: { item: ToastItem; onHide: () => void; style: StyleProp<ViewStyle> }) {
  const bg = item.kind === 'error' ? colors.danger : item.kind === 'success' ? colors.primaryDark : colors.dark;
  return (
    <View pointerEvents="box-none" style={[styles.host, style]}>
      <View style={[styles.toast, { backgroundColor: bg }]} accessibilityLiveRegion="polite" accessibilityRole="alert" testID="toast">
        <AppText variant="small" color="textInverse" style={styles.message}>
          {item.message}
        </AppText>
        {item.actionLabel ? (
          <Pressable
            onPress={() => {
              item.onAction?.();
              onHide();
            }}
            hitSlop={8}
            testID="toast-action"
          >
            <AppText variant="bodyStrong" color="textInverse">
              {item.actionLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadows.sheet,
  },
  message: { flex: 1, marginRight: spacing.sm },
});
