import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Countdown } from '../src/ui/Countdown';
import { clockStore } from '../src/clock';

const T0 = Date.parse('2026-10-25T10:00:00.000Z');

describe('Countdown', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    clockStore.getState().reset();
  });
  afterEach(() => {
    jest.useRealTimers();
    clockStore.getState().reset();
  });

  it('ticks down to zero and calls onExpire exactly once', async () => {
    const onExpire = jest.fn();
    await render(<Countdown deadline="2026-10-25T10:00:03.000Z" onExpire={onExpire} />);
    expect(screen.getByTestId('countdown').props.children).toBe('00:03');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('countdown').props.children).toBe('00:02');
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    expect(screen.getByTestId('countdown').props.children).toBe('00:00');
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('uses the global server clock offset', async () => {
    // Server is 10 s ahead: an offer that expires in 30 s server time has 20 s left.
    clockStore.getState().syncWithServer(T0 + 10_000, T0);
    await render(<Countdown deadline={T0 + 30_000} format="seconds" />);
    expect(screen.getByTestId('countdown').props.children).toBe('20');
  });

  it('an explicit offset overrides the global one', async () => {
    clockStore.getState().syncWithServer(T0 + 10_000, T0);
    await render(<Countdown deadline={T0 + 30_000} format="seconds" offsetMs={0} />);
    expect(screen.getByTestId('countdown').props.children).toBe('30');
  });

  it('renders custom text', async () => {
    await render(<Countdown deadline={T0 + 42_000} render={(_left, f) => `Resend (${f})`} />);
    expect(screen.getByText('Resend (00:42)')).toBeTruthy();
  });

  it('an already expired deadline shows zero and expires immediately', async () => {
    const onExpire = jest.fn();
    await render(<Countdown deadline={T0 - 1000} onExpire={onExpire} />);
    expect(screen.getByTestId('countdown').props.children).toBe('00:00');
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
