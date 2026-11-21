'use client';

import { Button } from '@mantine/core';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from './player.module.css';

/** The words and the Reconnect button, for wherever the lost microphone is reported. */
export function MicLostNotice({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className={classes.listeningRow} role="alert" data-testid={T.micLost}>
      <span className={classes.listeningLabel}>{copy.player.micLost}</span>
      <Button size="xs" color="red" onClick={onReconnect} data-testid={T.micReconnect}>
        {copy.player.micReconnect}
      </Button>
    </div>
  );
}

/**
 * Takes the place of the listening overlay when the microphone has gone. Unlike that overlay
 * it can be clicked; `data-no-capture` keeps those clicks out of the recorded pointer events.
 */
export function MicLost({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className={classes.listening} data-interactive="true" data-no-capture="true">
      <MicLostNotice onReconnect={onReconnect} />
    </div>
  );
}
