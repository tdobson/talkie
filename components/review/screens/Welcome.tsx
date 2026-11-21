'use client';

import { Button, Stack, Text, TextInput } from '@mantine/core';
import { type FormEvent, useState } from 'react';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

/** Longest name the server accepts. */
const MAX_NAME_LENGTH = 80;

export function Welcome({ title, onSubmit }: { title: string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed !== '') onSubmit(trimmed);
  };

  return (
    <ScreenCard testId={T.welcome} heading={copy.pageTitle(title)}>
      <Text className={classes.lead} fw={600}>
        {copy.welcome.thanks}
      </Text>
      <Text className={classes.lead}>{copy.welcome.para1}</Text>
      <Text className={classes.lead}>{copy.welcome.para2}</Text>
      <form onSubmit={submit}>
        <Stack gap="md" mt="xs">
          <TextInput
            label={copy.welcome.nameLabel}
            placeholder={copy.welcome.namePlaceholder}
            size="md"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
            data-testid={T.nameInput}
          />
          <Button type="submit" size="md" disabled={trimmed === ''} data-testid={T.startButton}>
            {copy.welcome.start}
          </Button>
        </Stack>
      </form>
    </ScreenCard>
  );
}
