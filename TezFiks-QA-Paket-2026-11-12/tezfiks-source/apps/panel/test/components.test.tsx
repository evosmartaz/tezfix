// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Money } from '@/components/money';
import { DateTime } from '@/components/date-time';
import { StatusBadge } from '@/components/status-badge';
import { StatCard } from '@/components/stat-card';
import { dateTimeText, moneyText, percentText } from '@/lib/format';
import { renderPanel } from './render';

const NBSP = ' ';

describe('money formatting', () => {
  it('formats integer qəpik per locale', () => {
    expect(moneyText(142000, 'az')).toBe(`1.420,00${NBSP}₼`);
    expect(moneyText(142000, 'ru')).toBe(`1${NBSP}420,00${NBSP}₼`);
    expect(moneyText(142000, 'en')).toBe('₼1,420.00');
    expect(moneyText(1000, 'az', { compact: true })).toBe(`10${NBSP}₼`);
    expect(moneyText(-250, 'az')).toBe(`-2,50${NBSP}₼`);
    expect(moneyText(500, 'en', { sign: true })).toBe('+₼5.00');
  });

  it('shows a dash for missing amounts and never formats fractions of a qəpik', () => {
    expect(moneyText(null, 'az')).toBe('—');
    expect(moneyText(undefined, 'az')).toBe('—');
    expect(moneyText(Number.NaN, 'az')).toBe('—');
    expect(moneyText(1999.9, 'en')).toBe('₼19.99');
  });

  it('renders <Money> in the current locale, with ledger colouring', () => {
    renderPanel(<Money minor={142000} />, 'az');
    // Exact text: the default matcher would collapse the non-breaking space formatMoney emits.
    expect(screen.getByText(`1.420,00${NBSP}₼`, { normalizer: (s) => s })).toBeTruthy();
    renderPanel(<Money minor={-1000} colored compact />, 'en');
    const negative = screen.getByText('-₼10', { normalizer: (s) => s });
    expect(negative.className).toContain('text-danger');
  });
});

describe('date rendering (Baku time)', () => {
  it('converts UTC instants to Asia/Baku (UTC+4)', () => {
    expect(dateTimeText('2026-10-24T14:05:00.000Z')).toBe('24.10.2026, 18:05');
    expect(dateTimeText('2026-10-24T21:30:00Z', 'date')).toBe('25.10.2026');
    expect(dateTimeText('2026-10-24T21:30:00Z', 'time')).toBe('01:30');
    expect(dateTimeText(null)).toBe('—');
    expect(dateTimeText('not a date')).toBe('—');
  });

  it('renders a <time> element with the ISO instant', () => {
    renderPanel(<DateTime value="2026-09-01T06:00:00.000Z" />);
    const el = screen.getByText('01.09.2026, 10:00');
    expect(el.tagName).toBe('TIME');
    expect(el.getAttribute('datetime')).toBe('2026-09-01T06:00:00.000Z');
  });

  it('formats percentages per locale', () => {
    expect(percentText(0.063, 'az')).toBe('6,3%');
    expect(percentText(0.063, 'en')).toBe('6.3%');
    expect(percentText(null, 'az')).toBe('—');
  });
});

describe('StatusBadge', () => {
  it('shows the common label and tone for request statuses (az)', () => {
    renderPanel(<StatusBadge family="requestStatus" status="SEARCHING" />);
    const badge = screen.getByText('Usta axtarılır');
    expect(badge.getAttribute('data-tone')).toBe('warning');
  });

  it('translates in ru and en', () => {
    renderPanel(<StatusBadge family="verificationStatus" status="APPROVED" />, 'en');
    expect(screen.getByText('Active').getAttribute('data-tone')).toBe('success');
    renderPanel(<StatusBadge family="offerStatus" status="EXPIRED" />, 'ru');
    expect(screen.getByText('Истекло')).toBeTruthy();
  });

  it('renders unknown statuses as a neutral badge', () => {
    renderPanel(<StatusBadge family="assignmentStatus" status="TELEPORTED" />);
    expect(screen.getByText('Naməlum').getAttribute('data-tone')).toBe('neutral');
  });
});

describe('StatCard', () => {
  it('renders label, value and hint (board 05 KPI)', () => {
    renderPanel(
      <StatCard label="Bugünkü sifarişlər" value="142" hint="+12% dünənlə müqayisədə" tone="primary" />,
    );
    expect(screen.getByText('Bugünkü sifarişlər')).toBeTruthy();
    expect(screen.getByText('142').className).toContain('text-primary');
    expect(screen.getByText('+12% dünənlə müqayisədə')).toBeTruthy();
  });
});
