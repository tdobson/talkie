'use client';

import { Button, Loader } from '@mantine/core';
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

/** The words for a comment the server has stopped taking (it is full). Nothing is recording. */
export function CommentStoppedNotice({ text, help }: { text: string; help: string }) {
  return (
    <div role="alert" data-testid={T.commentStopped}>
      <div className={classes.listeningLabel}>{text}</div>
      <div className={classes.help}>{help}</div>
    </div>
  );
}

/** Takes the place of the listening overlay once a moment comment has been stopped. */
export function CommentStopped() {
  return (
    <div className={classes.listening}>
      <CommentStoppedNotice text={copy.player.stopped} help={copy.player.stoppedHelp} />
    </div>
  );
}

/** Over the picture when the video cannot be loaded. `data-no-capture` keeps its clicks out. */
export function VideoError({ onReload }: { onReload: () => void }) {
  return (
    <div
      className={classes.videoError}
      role="alert"
      data-no-capture="true"
      data-testid={T.videoError}
    >
      <div className={classes.listeningLabel}>{copy.player.videoError}</div>
      <Button size="sm" variant="white" color="dark" onClick={onReload} data-testid={T.videoReload}>
        {copy.player.reload}
      </Button>
    </div>
  );
}

/** A small spinner in the middle of the picture while the video waits for data. */
export function VideoLoading() {
  return (
    <div className={classes.videoLoading} role="status" data-testid={T.videoLoading}>
      <Loader color="gray.3" size="md" aria-label={copy.player.loading} />
    </div>
  );
}
