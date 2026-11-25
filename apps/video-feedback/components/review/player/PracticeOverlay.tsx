'use client';

import { Button } from '@mantine/core';
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

/**
 * Before the practice: what giving feedback is, and that this first go is only practice. Start
 * practice (or play, or the space bar) plays the film under the coach mark on Pause.
 */
export function PracticeIntro({ ready, onStart }: { ready: boolean; onStart: () => void }) {
  return (
    <div className={classes.practiceIntro} data-no-capture="true" data-testid={T.practiceIntro}>
      <div className={classes.practiceIntroCard} role="dialog" aria-labelledby="practice-title">
        <div id="practice-title" className={classes.practiceIntroTitle}>
          {copy.practice.introTitle}
        </div>
        <div>{copy.practice.intro1}</div>
        <div>{copy.practice.intro2}</div>
        <Button
          size="md"
          disabled={!ready}
          // The card sits on the picture, where a click would otherwise count as a pause.
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          data-testid={T.practiceStart}
        >
          {copy.practice.start}
        </Button>
      </div>
    </div>
  );
}

/** Shown for the whole practice, so nobody mistakes it for the real review. */
export function PracticeBanner() {
  return (
    <div className={classes.practiceBanner} role="note" data-testid={T.practiceBanner}>
      {copy.practice.banner}
    </div>
  );
}

/**
 * A couple of seconds into the practice clip: a big prompt on the picture saying how to pause
 * and talk. Clicks go through it to the picture, which pauses like the button.
 */
export function PracticePrompt({ touch }: { touch: boolean }) {
  return (
    <div className={classes.practicePrompt} role="status" data-testid={T.practicePrompt}>
      {touch ? copy.practice.promptTouch : copy.practice.promptKeys}
    </div>
  );
}
