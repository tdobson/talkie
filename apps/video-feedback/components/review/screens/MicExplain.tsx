'use client';

import { Button, Text } from '@mantine/core';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

/** Shown before the browser's permission prompt. `waiting` is true while that prompt is up. */
export function MicExplain({
  onContinue,
  waiting = false,
}: {
  onContinue: () => void;
  waiting?: boolean;
}) {
  return (
    <ScreenCard testId={T.micExplain} heading={copy.micExplain.title}>
      <Text className={classes.lead}>{copy.micExplain.body}</Text>
      <Button size="md" onClick={onContinue} loading={waiting} data-testid={T.micContinue}>
        {copy.micExplain.continue}
      </Button>
    </ScreenCard>
  );
}
