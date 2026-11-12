'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

/** Global toast host (mounted once in the root layout). Use `toast.success(...)` / `toast.error(...)` anywhere on the client. */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }}
    />
  );
}

export { toast };
