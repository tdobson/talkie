import { Card, Center, Text } from '@mantine/core';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function HomePage() {
  return (
    <Center mih="100vh" p="md">
      <Card withBorder shadow="sm" padding="xl" maw={420}>
        <Text ta="center">
          Nothing to see here. If you were sent a review link, open that instead.
        </Text>
      </Card>
    </Center>
  );
}
