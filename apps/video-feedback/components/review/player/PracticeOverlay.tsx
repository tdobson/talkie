'use client';

import { useEffect, useRef } from 'react';
import { MIC_SPEECH_THRESHOLD, PRACTICE_SILENCE_MS, PRACTICE_SPEECH_MS } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import { PracticeListener } from '@/lib/review/practice';
import { T } from '@/lib/testids';
import { useMicLevel } from '../hooks/useMicLevel';
import { ListeningStatus } from './ListeningOverlay';
import classes from './player.module.css';

/**
 * The practice pause. Looks like the real listening overlay, but records nothing: it only
 * listens to the level, and calls `onHeard` once the reviewer has spoken for a second or so
 * and then stopped. After that it shows "Got that".
 */
export function PracticeOverlay({
  stream,
  gotThat,
  onHeard,
}: {
  stream: MediaStream | null;
  gotThat: boolean;
  onHeard: () => void;
}) {
  const level = useMicLevel(gotThat ? null : stream);
  const levelRef = useRef(level);
  levelRef.current = level;
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;

  useEffect(() => {
    if (gotThat) return;
    const listener = new PracticeListener({
      threshold: MIC_SPEECH_THRESHOLD,
      speechMs: PRACTICE_SPEECH_MS,
      silenceMs: PRACTICE_SILENCE_MS,
    });
    // Sampled on a timer, not on render: silence does not re-render.
    const timer = setInterval(() => {
      if (listener.update(levelRef.current, performance.now())) {
        clearInterval(timer);
        onHeardRef.current();
      }
    }, 50);
    return () => clearInterval(timer);
  }, [gotThat]);

  if (gotThat) {
    return (
      <div className={classes.listening} role="status" data-testid={T.practiceGotThat}>
        <div className={classes.listeningLabel}>{copy.practice.gotThat}</div>
        <div className={classes.help}>{copy.practice.gotThatHelp}</div>
      </div>
    );
  }
  return (
    <div
      className={classes.listening}
      role="status"
      aria-live="polite"
      data-testid={T.practiceListening}
    >
      <ListeningStatus stream={stream} label={copy.practice.listening} />
      <div className={classes.help}>{copy.practice.listeningHelp}</div>
    </div>
  );
}
