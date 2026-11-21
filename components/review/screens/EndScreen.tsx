'use client';

import { Button, Stack, Text, Title } from '@mantine/core';
import { useEffect, useRef } from 'react';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from '../player/player.module.css';

/**
 * Shown over the picture when the video ends. The controls underneath stay usable, so the
 * reviewer can scroll back. `finishing` is true while Done waits for the last save.
 */
export function EndScreen({
  onShareMore,
  onDone,
  finishing = false,
}: {
  onShareMore: () => void;
  onDone: () => void;
  finishing?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className={classes.endOverlay} data-no-capture="true" data-testid={T.endScreen}>
      <div className={classes.panel}>
        <Stack gap="md">
          <Title ref={heading} order={2} size="h3" tabIndex={-1} className={classes.panelHeading}>
            {copy.end.title}
          </Title>
          <Text className={classes.panelText}>{copy.end.otherThings}</Text>
          <Button size="md" onClick={onShareMore} disabled={finishing} data-testid={T.shareMore}>
            {copy.end.shareMore}
          </Button>
          <Text className={classes.panelText} c="gray.4">
            {copy.end.lookAgain}
          </Text>
          <Button
            size="md"
            variant="white"
            color="dark"
            onClick={onDone}
            loading={finishing}
            data-testid={T.doneButton}
          >
            {copy.end.done}
          </Button>
        </Stack>
      </div>
    </div>
  );
}
