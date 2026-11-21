'use client';

import { Text } from '@mantine/core';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

export function Thanks({ name }: { name: string }) {
  return (
    <ScreenCard testId={T.thanks} heading={copy.thanks.title(name)}>
      <Text className={classes.lead}>{copy.thanks.body}</Text>
    </ScreenCard>
  );
}
