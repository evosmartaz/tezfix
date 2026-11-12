import React from 'react';
import { render } from '@testing-library/react-native';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OfferModal } from '../src/components/OfferModal';
import { resetApp } from './pro-helpers';
import { assignment, offer } from './fixtures';
import { installPro } from './m4-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');

afterEach(() => resetApp());

/**
 * The API sends `lastInitial` with its period ("T.", see apps/api request views and test/b1/dispatch.spec.ts); the app
 * showed "Nizami T.." on the device. Names must read "Nizami T." whether or not the initial carries the period.
 */
describe('customer short name', () => {
  it('the job screen shows "Nizami T." when the API sends lastInitial "T."', async () => {
    const job = assignment();
    installPro({ assignments: [{ ...job, customer: { ...job.customer, lastInitial: 'T.' } }] });
    await renderRouter(APP_DIR, { initialUrl: `/job/${job.id}` });
    await waitFor(() => expect(screen.getByTestId('job-customer-name')).toBeTruthy());
    expect(screen.getByTestId('job-customer-name').props.children).toBe('Nizami T.');
  });

  it('the offer modal shows "Nizami T." for lastInitial "T." and "T"', async () => {
    for (const lastInitial of ['T.', 'T']) {
      const view = await render(
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
          <OfferModal offer={offer({ customer: { ...offer().customer, lastInitial } })} waiting={0} accepting={false} onAccept={() => undefined} onDecline={() => undefined} />
        </SafeAreaProvider>,
      );
      expect(screen.getByTestId('offer-customer').props.children).toBe('Nizami T. • ★ 4.8');
      await view.unmount();
    }
  });
});
