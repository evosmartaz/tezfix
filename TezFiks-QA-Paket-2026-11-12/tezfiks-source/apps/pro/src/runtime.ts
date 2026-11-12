import { createMobileRuntime } from '@tezfiks/mobile';

/** One runtime per process: API client, auth store (SecureStore refresh token), query client. */
export const runtime = createMobileRuntime({ app: 'PRO' });
