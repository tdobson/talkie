'use client';

import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from './player.module.css';

export type SaveState = 'idle' | 'saving' | 'saved';

/** Small toast in the corner of the picture: Saving... until the server confirms, then Saved. */
export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <div role="status" aria-live="polite">
      {state === 'saving' && (
        <div className={classes.toast} data-kind="saving" data-testid={T.savingToast}>
          {copy.player.saving}
        </div>
      )}
      {state === 'saved' && (
        <div className={classes.toast} data-kind="saved" data-testid={T.savedToast}>
          {copy.player.saved}
        </div>
      )}
    </div>
  );
}

/** Sits above the controls, off the picture, while uploads are failing. */
export function TroubleBanner() {
  return (
    <div className={classes.banner} role="alert" data-testid={T.saveTroubleBanner}>
      {copy.player.trouble}
    </div>
  );
}
