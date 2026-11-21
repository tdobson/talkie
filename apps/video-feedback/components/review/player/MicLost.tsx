'use client';

import { Button } from '@mantine/core';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from './player.module.css';

export interface MicLostProps {
  onReconnect: () => void;
  /** True while the browser is being asked for the microphone again. */
  reconnecting?: boolean;
  /** True after a reconnect that did not get a microphone. */
  reconnectFailed?: boolean;
}

/** The words and the Reconnect button, for wherever the lost microphone is reported. */
export function MicLostNotice({
  onReconnect,
  reconnecting = false,
  reconnectFailed = false,
}: MicLostProps) {
  return (
    <div role="alert" data-testid={T.micLost}>
      <div className={classes.listeningRow}>
        <span className={classes.listeningLabel}>{copy.player.micLost}</span>
        <Button
          size="xs"
          color="red"
          loading={reconnecting}
          onClick={onReconnect}
          data-testid={T.micReconnect}
        >
          {copy.player.micReconnect}
        </Button>
      </div>
      {reconnectFailed && !reconnecting && (
        <div className={classes.help} data-testid={T.micStillLost}>
          {copy.player.micStillLost}
        </div>
      )}
    </div>
  );
}

/**
 * Takes the place of the listening overlay when the microphone has gone. Unlike that overlay
 * it can be clicked; `data-no-capture` keeps those clicks out of the recorded pointer events.
 */
export function MicLost(props: MicLostProps) {
  return (
    <div className={classes.listening} data-interactive="true" data-no-capture="true">
      <MicLostNotice {...props} />
    </div>
  );
}
