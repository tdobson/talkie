'use client';

import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { LiveMicMeter } from '../MicMeter';
import classes from './player.module.css';

/** "Listening" with a red dot and the live level. Shared with the general comment screen. */
export function ListeningStatus({ stream, label }: { stream: MediaStream | null; label: string }) {
  return (
    <div className={classes.listeningRow}>
      <span className={classes.dot} aria-hidden="true" />
      <span className={classes.listeningLabel}>{label}</span>
      <div className={classes.listeningMeter}>
        <LiveMicMeter stream={stream} testId={T.listeningLevel} size="sm" onDark />
      </div>
    </div>
  );
}

/**
 * Shown at the top of the picture while a moment comment is recording. It lets the pointer
 * through, so pointing at the picture underneath it still works and is still recorded.
 */
export function ListeningOverlay({ stream }: { stream: MediaStream | null }) {
  return (
    <div className={classes.listening} role="status" aria-live="polite" data-testid={T.listening}>
      <ListeningStatus stream={stream} label={copy.player.listening} />
      <div className={classes.help}>{copy.player.listeningHelp}</div>
      <div className={classes.tips}>{copy.player.listeningTips}</div>
    </div>
  );
}
