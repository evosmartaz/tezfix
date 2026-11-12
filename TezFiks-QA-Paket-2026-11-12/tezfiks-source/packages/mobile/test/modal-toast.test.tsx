import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheet } from '../src/ui/BottomSheet';
import { ModalToastHost, ToastProvider, useToast } from '../src/ui/Toast';

const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

function wrap(node: React.ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ToastProvider>{node}</ToastProvider>
    </SafeAreaProvider>
  );
}

/** A screen with a confirmation sheet whose action fails (the cancel / decline / delete pattern of the apps). */
function SheetScreen({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View testID="screen">
      <Pressable testID="open" onPress={() => setOpen(true)} />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Ləğv edilsin?" testID="confirm-sheet">
        <Pressable testID="confirm" onPress={() => toast.show('Bu əməliyyat indiki mərhələdə mümkün deyil', { kind: 'error' })}>
          <Text>Təsdiqlə</Text>
        </Pressable>
        <Pressable testID="close" onPress={() => setOpen(false)}>
          <Text>Bağla</Text>
        </Pressable>
      </BottomSheet>
      <Pressable testID="show-root" onPress={() => toast.show('Saxlanıldı', { kind: 'success' })} />
    </View>
  );
}

describe('toasts above modals (an RN Modal covers the root toast host)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('an error raised while a bottom sheet is open is drawn inside the sheet, exactly once', async () => {
    await render(wrap(<SheetScreen />));
    await fireEvent.press(screen.getByTestId('confirm'));
    expect(within(screen.getByTestId('confirm-sheet')).getByText('Bu əməliyyat indiki mərhələdə mümkün deyil')).toBeTruthy();
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByTestId('toast').props.accessibilityRole).toBe('alert');
  });

  it('when the sheet closes, a toast still on screen moves back to the root host', async () => {
    await render(wrap(<SheetScreen />));
    await fireEvent.press(screen.getByTestId('confirm'));
    await fireEvent.press(screen.getByTestId('close'));
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByText('Bu əməliyyat indiki mərhələdə mümkün deyil')).toBeTruthy();
  });

  it('without an open sheet the root host shows the toast; it hides after its duration', async () => {
    await render(wrap(<SheetScreen initiallyOpen={false} />));
    await fireEvent.press(screen.getByTestId('show-root'));
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    expect(screen.getByText('Saxlanıldı')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('a toast shown before the sheet opened is visible above the sheet once it opens', async () => {
    await render(wrap(<SheetScreen initiallyOpen={false} />));
    await fireEvent.press(screen.getByTestId('show-root'));
    await fireEvent.press(screen.getByTestId('open'));
    expect(within(screen.getByTestId('confirm-sheet')).getByText('Saxlanıldı')).toBeTruthy();
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
  });

  it('ModalToastHost works in any RN Modal (e.g. a full-screen offer modal); the newest open modal wins', async () => {
    function Offer() {
      const toast = useToast();
      return (
        <>
          <Modal visible transparent>
            <View testID="offer-modal">
              <Pressable testID="accept" onPress={() => toast.show('Balans kifayət etmir', { kind: 'error' })} />
              <ModalToastHost />
            </View>
          </Modal>
          <BottomSheet visible testID="top-sheet">
            <Text>Sheet</Text>
          </BottomSheet>
        </>
      );
    }
    await render(wrap(<Offer />));
    await fireEvent.press(screen.getByTestId('accept'));
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    // The bottom sheet was mounted last, so it is the topmost modal and carries the toast.
    expect(within(screen.getByTestId('top-sheet')).getByText('Balans kifayət etmir')).toBeTruthy();
  });

  it('the toast action still works from inside a sheet', async () => {
    const onAction = jest.fn();
    function WithAction() {
      const toast = useToast();
      return (
        <BottomSheet visible testID="sheet">
          <Pressable testID="go" onPress={() => toast.show('Xəta', { kind: 'error', actionLabel: 'Yenidən', onAction })} />
        </BottomSheet>
      );
    }
    await render(wrap(<WithAction />));
    await fireEvent.press(screen.getByTestId('go'));
    await fireEvent.press(within(screen.getByTestId('sheet')).getByTestId('toast-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toast')).toBeNull();
  });
});
