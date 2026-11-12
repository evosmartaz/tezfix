import React from 'react';
import { formatMoney, type FormatMoneyOptions } from '@tezfiks/shared';
import { useT } from '../i18n';
import { AppText, type AppTextProps } from './Text';

export interface MoneyProps extends Omit<AppTextProps, 'children'> {
  /** Integer qəpik. */
  minor: number;
  options?: FormatMoneyOptions;
  /** Colors negative amounts red and positive signed amounts green (wallet history). */
  colored?: boolean;
}

/** Locale-aware money ("45,00 ₼" in az, "₼45.00" in en). */
export function Money({ minor, options, colored, color, ...rest }: MoneyProps) {
  const { locale } = useT();
  const tone = colored ? (minor < 0 ? 'danger' : minor > 0 && options?.sign ? 'primary' : color) : color;
  return (
    <AppText {...rest} color={tone}>
      {formatMoney(minor, locale, options)}
    </AppText>
  );
}
