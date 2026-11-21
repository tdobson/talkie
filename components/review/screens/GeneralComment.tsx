'use client';

import { Button, Stack, Text, Title } from '@mantine/core';
import { useEffect, useRef } from 'react';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { ListeningStatus } from '../player/ListeningOverlay';
import { MicLostNotice } from '../player/MicLost';
import classes from '../player/player.module.css';

/** Covers the whole player while a general comment is recording. */
export function GeneralComment({
  stream,
  micLost,
  onReconnect,
  onFinished,
}: {
  stream: MediaStream | null;
  micLost: boolean;
  onReconnect: () => void;
  onFinished: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className={classes.generalOverlay} data-testid={T.generalComment}>
      <div className={classes.panel}>
        <Stack gap="md">
          {micLost ? (
            <MicLostNotice onReconnect={onReconnect} />
          ) : (
            <div role="status" aria-live="polite">
              <ListeningStatus stream={stream} label={copy.general.listening} />
            </div>
          )}
          <Title ref={heading} order={2} size="h3" tabIndex={-1} className={classes.panelHeading}>
            {copy.general.prompt1}
          </Title>
          <Text className={classes.panelText}>{copy.general.prompt2}</Text>
          <Button size="md" onClick={onFinished} data-testid={T.generalFinished}>
            {copy.general.finished}
          </Button>
        </Stack>
      </div>
    </div>
  );
}
