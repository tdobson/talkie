import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TalkiePlayer } from '@talkie/react';
import { Alert, Code, Container, Group, List, ListItem, Paper, Text, Title } from '@mantine/core';

// Read talkie.json on every request, so a rebuilt film shows up without rebuilding the app.
export const dynamic = 'force-dynamic';

const FILM_URL = '/films/sample/';

interface Film {
  title: string;
  chapters: Array<{ title: string; start: number }>;
}

/** The film's title and chapters, or null when the film has not been copied into public/ yet. */
async function readFilm(): Promise<Film | null> {
  try {
    const file = join(process.cwd(), 'public', FILM_URL, 'talkie.json');
    const film = JSON.parse(await readFile(file, 'utf8'));
    return { title: String(film.title), chapters: film.chapters ?? [] };
  } catch {
    return null;
  }
}

/** Seconds as minutes and seconds, for example 75.4 as 1:15. */
function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export default async function WatchPage() {
  const film = await readFilm();

  if (!film) {
    return (
      <Container size="md" py="xl">
        <Title order={1}>Watch</Title>
        <Alert mt="lg" color="yellow" title="The sample film is not built yet">
          From the repo root, run <Code>yarn build && yarn sample</Code>, then start this app again.
        </Alert>
      </Container>
    );
  }

  return (
    <Container size="md" py="xl">
      <Title order={1}>{film.title}</Title>
      <Paper mt="lg" withBorder radius="md" style={{ overflow: 'hidden' }}>
        <TalkiePlayer
          src={FILM_URL}
          accentColor="var(--mantine-primary-color-filled)"
          wasmUrl="/dotlottie-player.wasm"
        />
      </Paper>
      <Title order={2} mt="xl" size="h4">
        Chapters
      </Title>
      <List mt="sm" listStyleType="none" spacing="xs">
        {film.chapters.map((chapter) => (
          <ListItem key={chapter.start}>
            <Group gap="sm">
              <Text c="dimmed" ff="monospace">
                {clock(chapter.start)}
              </Text>
              <Text>{chapter.title}</Text>
            </Group>
          </ListItem>
        ))}
      </List>
    </Container>
  );
}
