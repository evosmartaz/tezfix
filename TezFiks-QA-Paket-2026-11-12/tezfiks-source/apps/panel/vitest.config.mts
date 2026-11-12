import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      // `server-only` throws outside the react-server condition; tests import server modules directly.
      'server-only': path.resolve(here, 'test/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
