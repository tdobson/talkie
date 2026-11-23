'use client';

import { Button } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { SpeechGate } from '@/lib/capture/micLevel';
import {
  COMMENT_MAX_MS,
  COMMENT_SILENCE_END_MS,
  COMMENT_WARN_BEFORE_MS,
  MIC_SPEECH_HOLD_MS,
  MIC_SPEECH_THRESHOLD,
} from '@/lib/constants';
import { CommentLimit } from '@/lib/review/comment-limit';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { useMicLevel } from '../hooks/useMicLevel';
import classes from './player.module.css';

/** Calls `onLevel` with the live level every 100 ms (silence does not re-render). */
function useLevelTicks(stream: MediaStream | null, onTick: (level: number, now: number) => void) {
  const level = useMicLevel(stream);
  const levelRef = useRef(level);
  levelRef.current = level;
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  useEffect(() => {
    const timer = setInterval(() => tickRef.current(levelRef.current, performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
}

/**
 * Watches the comment that is recording, and ends it after a long quiet or at the longest a
 * comment may be (`onEnd`). Tells the reviewer in the last minute. Mount it with the comment's
 * id as its key, so each comment starts its own clock.
 */
export function CommentLimiter({
  stream,
  onEnd,
}: {
  stream: MediaStream | null;
  onEnd: (reason: 'silence' | 'cap') => void;
}) {
  const [warn, setWarn] = useState(false);
  const limit = useRef<CommentLimit | null>(null);
  const ended = useRef(false);
  useLevelTicks(stream, (level, now) => {
    if (ended.current) return;
    limit.current ??= new CommentLimit(
      {
        threshold: MIC_SPEECH_THRESHOLD,
        silenceMs: COMMENT_SILENCE_END_MS,
        maxMs: COMMENT_MAX_MS,
        warnBeforeMs: COMMENT_WARN_BEFORE_MS,
      },
      now
    );
    const state = limit.current.update(level, now);
    if (state === 'warn') setWarn(true);
    if (state === 'silence' || state === 'cap') {
      ended.current = true;
      onEnd(state);
    }
  });
  if (!warn) return null;
  return (
    <div className={classes.idleHint} role="status" data-testid={T.commentLimitWarning}>
      {copy.player.limitWarning}
    </div>
  );
}

/**
 * Paused, but not recording: the comment ended on its own. After a quiet spell, talking again
 * starts a new comment here; after the longest a comment may be, only Say more does (so a
 * conversation in the room does not keep recording). Play carries on watching either way.
 */
export function CommentHeld({
  reason,
  stream,
  onSayMore,
}: {
  reason: 'silence' | 'cap';
  stream: MediaStream | null;
  onSayMore: () => void;
}) {
  const gate = useRef(new SpeechGate(MIC_SPEECH_THRESHOLD, MIC_SPEECH_HOLD_MS));
  const done = useRef(false);
  useLevelTicks(reason === 'silence' ? stream : null, (level, now) => {
    if (done.current || reason !== 'silence') return;
    if (gate.current.update(level, now)) {
      done.current = true;
      onSayMore();
    }
  });
  return (
    <div
      className={classes.listening}
      role="status"
      aria-live="polite"
      data-interactive="true"
      data-no-capture="true"
      data-testid={T.commentHeld}
    >
      <div className={classes.listeningLabel}>
        {reason === 'silence' ? copy.player.heldSilenceTitle : copy.player.heldCapTitle}
      </div>
      <div className={classes.help}>
        {reason === 'silence' ? copy.player.heldSilenceHelp : copy.player.heldCapHelp}
      </div>
      <Button
        mt="xs"
        size="xs"
        variant="white"
        color="dark"
        // The notice sits on the picture, where a click would otherwise count as pointing.
        onClick={(e) => {
          e.stopPropagation();
          if (done.current) return;
          done.current = true;
          onSayMore();
        }}
        data-testid={T.sayMore}
      >
        {copy.player.sayMore}
      </Button>
    </div>
  );
}
