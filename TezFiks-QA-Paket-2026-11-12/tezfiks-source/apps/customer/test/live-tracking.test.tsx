import { renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import path from 'node:path';
import { IDS, detail } from './fixtures';
import { enRoute } from './fixtures-m3';
import { fail, ok, on, resetApp, serverEmit, signedInCustomer } from './screen-helpers';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const URL = `/assignment/${IDS.assignment}`;

/**
 * Founder decision (2026-10-26): the customer sees the handyman live from acceptance, with the ETA, and the phone number
 * appears by itself once the live ETA is about 5 minutes; nobody has to press "Yola çıxdım" first.
 */
describe('live tracking from acceptance (customer app)', () => {
  beforeEach(() => resetApp());

  it('an accepted job already shows the live position and the ETA, and the number appears when the server unlocks it', async () => {
    const state = { a: enRoute({ status: 'ACCEPTED', enRouteAt: null, etaSec: 600, distanceM: 3000 }) };
    signedInCustomer({
      extra: [
        on('GET', '/assignments/:id', (_c, p) => (p.id === state.a.id ? ok(state.a) : fail(404, 'NOT_FOUND'))),
        on('GET', '/requests/:id', () =>
          ok(
            detail({
              status: 'IN_PROGRESS',
              isSearching: false,
              search: null,
              slotsRequested: 1,
              slotsFilled: 1,
              slots: [{ index: 0, status: 'FILLED' as const, assignmentId: state.a.id }],
              assignments: [state.a],
            }),
          ),
        ),
      ],
    });
    await renderRouter(APP_DIR, { initialUrl: URL });
    await waitFor(() => expect(screen.getByTestId('tracking-screen')).toBeTruthy());
    expect(screen.getByTestId('tracking-map')).toBeTruthy();
    expect(within(screen.getByTestId('tracking-eta')).getByText('10 dəq məsafədə')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('Marker')).toHaveLength(2));
    expect(screen.queryByTestId('tracking-phone')).toBeNull();

    // A live ping lowers the ETA while the job is still ACCEPTED.
    await serverEmit('assignment:location', { assignmentId: IDS.assignment, lat: 40.415, lng: 49.872, heading: 210, at: new Date(Date.now() + 1000).toISOString(), etaSec: 280, distanceM: 900 });
    await waitFor(() => expect(within(screen.getByTestId('tracking-eta')).getByText('5 dəq məsafədə')).toBeTruthy());

    // The server unlocks the contact from the live ETA: the number is shown without any button press.
    state.a = { ...state.a, etaSec: 280, contactUnlocked: true, providerPhone: '+994501112233', chatEnabled: true };
    await serverEmit('assignment:contact', { assignmentId: IDS.assignment });
    await waitFor(() => expect(screen.getByTestId('tracking-phone')).toBeTruthy());
    expect(screen.getByText('Telefon: +994 50 111 22 33')).toBeTruthy();
    expect(screen.getByTestId('tracking-call')).not.toBeDisabled();
  });
});
