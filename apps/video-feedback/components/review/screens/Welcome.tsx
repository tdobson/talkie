'use client';

import { Button, Stack, Text, TextInput } from '@mantine/core';
import { type FormEvent, useState } from 'react';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from '../review.module.css';
import { ScreenCard } from '../ScreenCard';

/** Longest name the server accepts. */
const MAX_NAME_LENGTH = 80;

interface WelcomeProps {
  title: string;
  /** The version a new session gets. Shown when there is more than one. */
  version?: number;
  /** Poster of the film about to be reviewed. Only a Talkie version has one. */
  posterUrl?: string;
  onSubmit: (name: string) => void;
}

export function Welcome({ title, version = 1, posterUrl, onSubmit }: WelcomeProps) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed !== '') onSubmit(trimmed);
  };

  return (
    <ScreenCard testId={T.welcome} heading={copy.pageTitle(title)}>
      {version > 1 && (
        <Text c="gray.7" size="sm" data-testid={T.versionLabel}>
          {copy.version(version)}
        </Text>
      )}
      {/* Decorative: the heading names the film. A plain img, as the poster is a private file. */}
      {posterUrl !== undefined && <img src={posterUrl} alt="" className={classes.poster} />}
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
