'use client';

import { Progress } from '@mantine/core';
import { useMicLevel } from './hooks/useMicLevel';
import classes from './review.module.css';

export const METER_BARS = 12;
const BARS = Array.from({ length: METER_BARS }, (_, i) => i);

function barColor(i: number): string {
  if (i >= METER_BARS - 2) return 'red';
  if (i >= METER_BARS - 5) return 'yellow';
  return 'teal';
}

/** Twelve-bar level meter. `level` is 0..1. Decorative: the text beside it says what matters. */
export function MicMeter({
  level,
  testId,
  size = 'md',
  onDark = false,
}: {
  level: number;
  testId: string;
  size?: 'sm' | 'md';
  /** True on the dark player, where unlit bars need to be dim rather than light. */
  onDark?: boolean;
}) {
  const lit = Math.max(0, Math.min(METER_BARS, Math.round(level * METER_BARS)));
  return (
    <div
      className={classes.meter}
      data-size={size}
      data-testid={testId}
      data-lit={lit}
      aria-hidden="true"
    >
      {BARS.map((i) => (
        <Progress
          key={i}
          className={classes.meterBar}
          value={i < lit ? 100 : 0}
          color={barColor(i)}
          size={size === 'sm' ? 8 : 12}
          radius={size === 'sm' ? 2 : 'sm'}
          bg={onDark ? 'rgba(255, 255, 255, 0.2)' : undefined}
          transitionDuration={0}
        />
      ))}
    </div>
  );
}

/** A meter driven by the live microphone level. */
export function LiveMicMeter(props: {
  stream: MediaStream | null;
  testId: string;
  size?: 'sm' | 'md';
  onDark?: boolean;
}) {
  const level = useMicLevel(props.stream);
  return <MicMeter level={level} testId={props.testId} size={props.size} onDark={props.onDark} />;
}
