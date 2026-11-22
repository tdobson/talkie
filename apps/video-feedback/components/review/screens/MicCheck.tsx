'use client';

import { Button, Loader, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { SpeechGate } from '@/lib/capture/micLevel';
import { MIC_HEARD_SHOW_MS, MIC_SPEECH_HOLD_MS, MIC_SPEECH_THRESHOLD } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { useMicLevel } from '../hooks/useMicLevel';
import { MicMeter } from '../MicMeter';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

/** Level, on the meter's 0..1 scale, that counts as speech. */
export const SPEECH_THRESHOLD = MIC_SPEECH_THRESHOLD;

/** How long the meter may stay quiet before the screen suggests what to check. */
export const QUIET_HELP_AFTER_MS = 8000;

/**
 * Live level meter, and no button: once speech has been heard for MIC_SPEECH_HOLD_MS it says
 * so for MIC_HEARD_SHOW_MS and then starts by itself, with `onStart(true)` (the practice run
 * follows). If nothing is heard for a while it says what to check and offers to carry on
 * anyway, with `onStart(false)`. `starting` is true while the session is being created, and
 * `startFailed` after an attempt to create it did not work: a Try again button then appears.
 */
export function MicCheck({
  stream,
  onHeard,
  onStart,
  starting = false,
  startFailed = false,
}: {
  stream: MediaStream | null;
  onHeard: () => void;
  onStart: (practice: boolean) => void;
  starting?: boolean;
  startFailed?: boolean;
}) {
  const level = useMicLevel(stream);
  const gate = useRef<SpeechGate | null>(null);
  const [heard, setHeard] = useState(false);
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  // What the last start was, so Try again repeats it.
  const practiceRef = useRef(true);

  const levelRef = useRef(level);
  levelRef.current = level;

  const check = () => {
    if (heard) return;
    gate.current ??= new SpeechGate(SPEECH_THRESHOLD, MIC_SPEECH_HOLD_MS);
    if (gate.current.update(levelRef.current, performance.now())) {
      setHeard(true);
      onHeardRef.current();
    }
  };
  const checkRef = useRef(check);
  checkRef.current = check;

  // Runs on every render: the level changes many times a second while someone speaks.
  useEffect(() => checkRef.current());

  // A perfectly steady sound never re-renders, so the gate is also checked on a timer.
  useEffect(() => {
    const timer = setInterval(() => checkRef.current(), 100);
    return () => clearInterval(timer);
  }, []);

  // Heard: say so for a moment, then go on by itself.
  useEffect(() => {
    if (!heard) return;
    const timer = setTimeout(() => {
      practiceRef.current = true;
      onStartRef.current(true);
    }, MIC_HEARD_SHOW_MS);
    return () => clearTimeout(timer);
  }, [heard]);

  // Nothing heard for a while: say what to check, and offer a way on so nobody is stuck here.
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuiet(true), QUIET_HELP_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const skip = () => {
    practiceRef.current = false;
    onStart(false);
  };

  return (
    <ScreenCard testId={T.micCheck} heading={copy.micCheck.title}>
      <MicMeter level={level} testId={T.micMeter} />
      <div className={classes.heardSlot} role="status" aria-live="polite">
        {heard && (
          <Text c="teal.8" fw={600} data-testid={T.micHeard}>
            {copy.micCheck.heard}
          </Text>
        )}
      </div>
      {starting && !startFailed && <Loader size="sm" aria-label={copy.micCheck.starting} />}
      {quiet && !heard && !starting && (
        <>
          <Text c="gray.7" size="sm" data-testid={T.micCheckHelp}>
            {copy.micCheck.quietHelp}
          </Text>
          <Button variant="subtle" size="xs" onClick={skip} data-testid={T.micSkip}>
            {copy.micCheck.skip}
          </Button>
        </>
      )}
      {startFailed && (
        <>
          <Text c="red.8" role="alert">
            {copy.micCheck.startFailed}
          </Text>
          <Button
            size="md"
            loading={starting}
            onClick={() => onStart(practiceRef.current)}
            data-testid={T.startWatching}
          >
            {copy.micCheck.tryAgain}
          </Button>
        </>
      )}
    </ScreenCard>
  );
}
