'use client';

import { Button, Loader, Text } from '@mantine/core';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { ScreenCard } from '../ScreenCard';

/**
 * Between Start and the film, for a browser that has been through the microphone checks
 * before: nothing to read, only a spinner. If the session cannot be started, Try again.
 */
export function Starting({
  failed = false,
  starting = false,
  onRetry,
}: {
  failed?: boolean;
  starting?: boolean;
  onRetry: () => void;
}) {
  return (
    <ScreenCard testId={T.starting} heading={copy.micCheck.starting}>
      {!failed && <Loader size="sm" aria-label={copy.micCheck.starting} />}
      {failed && (
        <>
          <Text c="red.8" role="alert">
            {copy.micCheck.startFailed}
          </Text>
          <Button size="md" loading={starting} onClick={onRetry} data-testid={T.startWatching}>
            {copy.micCheck.tryAgain}
          </Button>
        </>
      )}
    </ScreenCard>
  );
}
