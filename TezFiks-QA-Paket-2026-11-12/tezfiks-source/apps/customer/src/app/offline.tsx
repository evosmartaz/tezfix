import React, { useState } from 'react';
import { ApiError } from '@tezfiks/shared';
import { ErrorState, Screen, useRuntime, useT } from '@tezfiks/mobile';

/** Shown when a saved session exists but the API is unreachable at startup. */
export default function OfflineRoute() {
  const { t } = useT();
  const runtime = useRuntime();
  const [retrying, setRetrying] = useState(false);
  return (
    <Screen testID="offline-screen">
      <ErrorState
        error={new ApiError(0, 'NETWORK', 'offline')}
        message={t('offline.title')}
        retrying={retrying}
        onRetry={async () => {
          setRetrying(true);
          await runtime.auth.getState().restore();
          setRetrying(false);
        }}
      />
    </Screen>
  );
}
