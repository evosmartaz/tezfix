import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { OtpInput, sanitizeOtp } from '../src/ui/OtpInput';
import { nextPhoneDigits, PhoneInput } from '../src/ui/PhoneInput';

function OtpHarness({ onComplete, onChange }: { onComplete: (c: string) => void; onChange?: (c: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <OtpInput
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      onComplete={onComplete}
    />
  );
}

function boxText(i: number): string {
  const box = screen.getByTestId(`otp-input-box-${i}`);
  const child = box.props.children as React.ReactElement<{ children: string }>;
  return child.props.children;
}

describe('OtpInput', () => {
  it('renders 6 boxes', async () => {
    await render(<OtpHarness onComplete={jest.fn()} />);
    for (let i = 0; i < 6; i++) expect(screen.getByTestId(`otp-input-box-${i}`)).toBeTruthy();
    expect(screen.queryByTestId('otp-input-box-6')).toBeNull();
  });

  it('fills boxes as digits are typed and auto-submits on the 6th digit', async () => {
    const onComplete = jest.fn();
    await render(<OtpHarness onComplete={onComplete} />);
    const input = screen.getByTestId('otp-input');
    await fireEvent.changeText(input, '7');
    await fireEvent.changeText(input, '72');
    await fireEvent.changeText(input, '724');
    expect(boxText(0)).toBe('7');
    expect(boxText(1)).toBe('2');
    expect(boxText(2)).toBe('4');
    expect(boxText(3)).toBe('');
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.changeText(input, '72401');
    await fireEvent.changeText(input, '724019');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('724019');
  });

  it('accepts a pasted code with spaces or text and submits once', async () => {
    const onComplete = jest.fn();
    const onChange = jest.fn();
    await render(<OtpHarness onComplete={onComplete} onChange={onChange} />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), 'Kod: 12 34 56');
    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
    for (let i = 0; i < 6; i++) expect(boxText(i)).toBe(String(i + 1));
  });

  it('ignores non-digits and extra digits', async () => {
    const onComplete = jest.fn();
    const onChange = jest.fn();
    await render(<OtpHarness onComplete={onComplete} onChange={onChange} />);
    const input = screen.getByTestId('otp-input');
    await fireEvent.changeText(input, 'ab');
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.changeText(input, '12345678');
    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('supports deleting digits', async () => {
    const onChange = jest.fn();
    await render(<OtpHarness onComplete={jest.fn()} onChange={onChange} />);
    const input = screen.getByTestId('otp-input');
    await fireEvent.changeText(input, '123');
    await fireEvent.changeText(input, '12');
    expect(onChange).toHaveBeenLastCalledWith('12');
    expect(boxText(2)).toBe('');
  });

  it('sanitizeOtp keeps digits only', async () => {
    expect(sanitizeOtp(' 1-2-3 4 5 6 7')).toBe('123456');
    expect(sanitizeOtp('')).toBe('');
    expect(sanitizeOtp('1234', 4)).toBe('1234');
  });
});

function PhoneHarness({ onChange }: { onChange: (d: string, e: string | null) => void }) {
  const [digits, setDigits] = useState('');
  return (
    <PhoneInput
      value={digits}
      onChange={(d, e) => {
        setDigits(d);
        onChange(d, e);
      }}
    />
  );
}

describe('PhoneInput', () => {
  it('shows the +994 chip', async () => {
    await render(<PhoneHarness onChange={jest.fn()} />);
    expect(screen.getByTestId('phone-input-chip')).toBeTruthy();
    expect(screen.getByText('+994')).toBeTruthy();
  });

  it('formats a typed national number and reports the E.164 number', async () => {
    const onChange = jest.fn();
    await render(<PhoneHarness onChange={onChange} />);
    const input = screen.getByTestId('phone-input');
    await fireEvent.changeText(input, '0501234567');
    expect(onChange).toHaveBeenLastCalledWith('501234567', '+994501234567');
    expect(screen.getByTestId('phone-input').props.value).toBe('50 123 45 67');
  });

  it('reports null until the number is complete', async () => {
    const onChange = jest.fn();
    await render(<PhoneHarness onChange={onChange} />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '50123');
    expect(onChange).toHaveBeenLastCalledWith('50123', null);
    expect(screen.getByTestId('phone-input').props.value).toBe('50 123');
  });

  it('accepts a pasted international number', async () => {
    const onChange = jest.fn();
    await render(<PhoneHarness onChange={onChange} />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '+994 55 765 43 21');
    expect(onChange).toHaveBeenLastCalledWith('557654321', '+994557654321');
    expect(screen.getByTestId('phone-input').props.value).toBe('55 765 43 21');
  });

  it('deleting a separator removes the previous digit', async () => {
    expect(nextPhoneDigits('5012', '50 1')).toBe('501');
    expect(nextPhoneDigits('501', '50 ')).toBe('50');
    expect(nextPhoneDigits('501234567', '50 123 45 6')).toBe('50123456');
  });

  it('a paste appended to existing digits takes the pasted number', async () => {
    expect(nextPhoneDigits('50', '50+994701112233')).toBe('701112233');
  });
});
