'use client';

import { Button, Text } from '@mantine/core';
import { useState } from 'react';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

export function MobileBlock() {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // No clipboard access (old browser, or permission refused): the address bar still works.
    }
  };

  return (
    <ScreenCard testId={T.mobileBlock} heading={copy.mobile.title}>
      <Text className={classes.lead}>{copy.mobile.body}</Text>
      <Button size="md" variant="light" onClick={copyLink} data-testid={T.mobileCopyLink}>
        <span aria-live="polite">{copied ? copy.mobile.copied : copy.mobile.copy}</span>
      </Button>
    </ScreenCard>
  );
}
