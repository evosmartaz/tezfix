import { afterEach } from 'vitest';

process.env.API_INTERNAL_URL = 'http://api.test/tezfix/api';

afterEach(async () => {
  // React Testing Library cleanup only exists in jsdom test files.
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
