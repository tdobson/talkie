'use client';

import { Alert, Button, Text } from '@mantine/core';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

/**
 * Shown before the browser's permission prompt. `waiting` is true while that prompt is up.
 * `version` is the version about to be reviewed, shown when there is more than one, and
 * `newerThan` is the older version this browser reviewed before, when there is one.
 */
export function MicExplain({
  onContinue,
  waiting = false,
  version = 1,
  newerThan = null,
}: {
  onContinue: () => void;
  waiting?: boolean;
  version?: number;
  newerThan?: number | null;
}) {
  return (
    <ScreenCard testId={T.micExplain} heading={copy.micExplain.title}>
      {newerThan !== null && (
        <Alert color="blue" data-testid={T.newerVersion}>
          {copy.newerVersion(version, newerThan)}
        </Alert>
      )}
      {version > 1 && newerThan === null && (
        <Text c="gray.7" size="sm" data-testid={T.versionLabel}>
          {copy.version(version)}
        </Text>
      )}
      <Text className={classes.lead}>{copy.micExplain.body}</Text>
      <Button size="md" onClick={onContinue} loading={waiting} data-testid={T.micContinue}>
        {copy.micExplain.continue}
      </Button>
    </ScreenCard>
  );
}
