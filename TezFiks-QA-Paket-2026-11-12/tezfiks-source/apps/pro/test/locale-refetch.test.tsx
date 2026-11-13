import React, { type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n, initI18n, createMemoryStorage } from '@tezfiks/mobile';
import { qk, useLocaleRefetch } from '../src/hooks/queries';

// BUG-005: after a language change the server-localized queries (profile, categories, jobs) must be refetched.
function setup() {
  const qc = new QueryClient();
  const spy = jest.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, spy, wrapper };
}
const keys = (spy: jest.SpyInstance) => spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);

describe('useLocaleRefetch', () => {
  beforeAll(async () => {
    await initI18n({ appNamespace: 'pro', storage: createMemoryStorage(), language: 'az' });
  });

  it('does nothing on mount, refetches localized queries on every language change and leaves wallet/chat alone', async () => {
    const { spy, wrapper } = setup();
    await renderHook(() => useLocaleRefetch(), { wrapper }); // async in @testing-library/react-native 14
    expect(spy).not.toHaveBeenCalled();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(keys(spy)).toEqual(expect.arrayContaining([qk.profile, qk.categories, ['pro', 'assignments']]));
    // Everything the API localizes for the pro app: offers, company boards, projects, invite previews, notifications.
    expect(keys(spy)).toEqual(expect.arrayContaining([['pro', 'assignment'], ['pro', 'offers'], ['company'], ['projects'], ['invites'], qk.notifications]));
    expect(keys(spy)).not.toContainEqual(['wallet']);
    expect(keys(spy)).not.toContainEqual(['chat']);

    spy.mockClear();
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    expect(keys(spy)).toContainEqual(qk.profile);
    spy.mockClear();
    await act(async () => {
      await i18n.changeLanguage('az');
    });
    expect(keys(spy)).toContainEqual(qk.profile);
  });

  it('does not refetch when the same language is set again', async () => {
    const { spy, wrapper } = setup();
    await renderHook(() => useLocaleRefetch(), { wrapper });
    await act(async () => {
      await i18n.changeLanguage('az');
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
