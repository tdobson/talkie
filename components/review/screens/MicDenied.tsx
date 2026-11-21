'use client';

import { Button, Text } from '@mantine/core';
import { MORE_T, moreCopy } from '@/lib/review/additions';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

export type BrowserFamily = 'chrome' | 'firefox' | 'safari';

const FAMILIES: BrowserFamily[] = ['chrome', 'firefox', 'safari'];

/** Which set of unblock steps fits this browser, or null if it cannot be told. */
export function browserFamily(userAgent: string): BrowserFamily | null {
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'firefox';
  // Chrome and Edge both say "Safari" too, so they are checked first.
  if (/Chrome\/|Chromium\/|Edg\/|CriOS\//.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent)) return 'safari';
  return null;
}

/** Steps to unblock the microphone: this browser's first, the others as a fallback. */
export function MicDenied({
  userAgent,
  noDevice = false,
  onRetry,
}: {
  userAgent?: string;
  /** True when the browser found no microphone at all, rather than blocking one. */
  noDevice?: boolean;
  onRetry: () => void;
}) {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const current = browserFamily(ua);
  const order = current ? [current, ...FAMILIES.filter((f) => f !== current)] : FAMILIES;

  if (noDevice) {
    return (
      <ScreenCard testId={T.micDenied} heading={copy.micDenied.title}>
        <Text className={classes.lead} data-testid={MORE_T.micNoDevice}>
          {moreCopy.micDenied.noDevice}
        </Text>
        <Button size="md" onClick={onRetry} data-testid={T.micRetry}>
          {copy.micDenied.retry}
        </Button>
      </ScreenCard>
    );
  }

  return (
    <ScreenCard testId={T.micDenied} heading={copy.micDenied.title}>
      <Text className={classes.lead}>{copy.micDenied.body}</Text>
      <ul className={classes.steps}>
        {order.map((family) => (
          <li key={family} data-current={family === current ? 'true' : undefined}>
            {copy.micDenied[family]}
          </li>
        ))}
      </ul>
      <Button size="md" onClick={onRetry} data-testid={T.micRetry}>
        {copy.micDenied.retry}
      </Button>
    </ScreenCard>
  );
}
