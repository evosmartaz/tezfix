import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Badge, StatusPill } from '../src/ui/Badge';

// A long Russian status on a 360 dp phone: the pill must give way to the handyman's name next to it.
const LONG = 'Ожидает подтверждения цены';

describe('status pills and badges shrink instead of pushing their neighbours off screen', () => {
  it('StatusPill: shrinks, is capped in width and truncates its label to one line', async () => {
    await render(
      <View style={{ flexDirection: 'row', width: 360 }}>
        <Text style={{ flex: 1 }}>Elvin Məmmədov</Text>
        <StatusPill label={LONG} tone="warning" testID="pill" />
      </View>,
    );
    const pill = StyleSheet.flatten(screen.getByTestId('pill').props.style);
    expect(pill.flexShrink).toBe(1);
    expect(pill.maxWidth).toBeDefined();
    const label = screen.getByText(LONG);
    expect(label.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(label.props.style).flexShrink).toBe(1);
    // The full status stays available to screen readers.
    expect(screen.getByTestId('pill').props.accessibilityLabel).toBe(LONG);
  });

  it('Badge: shrinks and truncates to one line too', async () => {
    await render(<Badge label={LONG} tone="info" testID="badge" />);
    const badge = StyleSheet.flatten(screen.getByTestId('badge').props.style);
    expect(badge.flexShrink).toBe(1);
    expect(badge.maxWidth).toBeDefined();
    expect(screen.getByText(LONG).props.numberOfLines).toBe(1);
  });

  it('a caller style still overrides the defaults (e.g. a wider cap)', async () => {
    await render(<StatusPill label="ONLAYN" tone="success" style={{ maxWidth: '80%' }} testID="pill" />);
    expect(StyleSheet.flatten(screen.getByTestId('pill').props.style).maxWidth).toBe('80%');
  });
});
