'use client';

import { Button, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { SpeechGate } from '@/lib/capture/micLevel';
import { MIC_SPEECH_HOLD_MS } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { useMicLevel } from '../hooks/useMicLevel';
import { MicMeter } from '../MicMeter';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

/** Level, on the meter's 0..1 scale, that counts as speech. */
export const SPEECH_THRESHOLD = 0.08;

/**
 * Live level meter. Start watching unlocks once speech has been heard for MIC_SPEECH_HOLD_MS,
 * and stays unlocked. `starting` is true while the session is being created.
 */
export function MicCheck({
  stream,
  onHeard,
  onStart,
  starting = false,
}: {
  stream: MediaStream | null;
  onHeard: () => void;
  onStart: () => void;
  starting?: boolean;
}) {
  const level = useMicLevel(stream);
  const gate = useRef<SpeechGate | null>(null);
  const [heard, setHeard] = useState(false);
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;

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
      <Button
        size="md"
        disabled={!heard}
        loading={starting}
        onClick={onStart}
        data-testid={T.startWatching}
      >
        {copy.micCheck.startWatching}
      </Button>
    </ScreenCard>
  );
}
