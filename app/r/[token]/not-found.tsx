import { Card, Center, Stack, Text, Title } from '@mantine/core';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';

/** Shown, with HTTP 404, for a review link that matches no video. It gives no detail. */
export default function InvalidLink() {
  return (
    <Center component="main" mih="100vh" p="md" bg="gray.0">
      <Card withBorder shadow="sm" radius="lg" padding="xl" maw={480} data-testid={T.invalidLink}>
        <Stack gap="sm">
          <Title order={1} size="h2">
            {copy.invalid.title}
          </Title>
          <Text>{copy.invalid.body}</Text>
        </Stack>
      </Card>
    </Center>
  );
}
