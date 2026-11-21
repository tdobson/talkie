import { Stack, Text, Title } from '@mantine/core';
import { InboxTable } from '@/components/admin/InboxTable';
import { summariseVideos } from '@/lib/admin/summary';
import { requireAdminPage } from '@/lib/auth/guard';
import { config } from '@/lib/config';
import { inboxDir } from '@/lib/storage/paths';
import { listInbox } from '@/lib/videos/import';

export const dynamic = 'force-dynamic';

export default async function AdminInboxPage() {
  await requireAdminPage();
  const [files, videos] = await Promise.all([listInbox(), summariseVideos(config().publicBaseUrl)]);
  return (
    <Stack>
      <Title order={2}>Inbox</Title>
      <Text c="dimmed">
        Videos copied to the server wait here until you import them. Importing moves the file out of
        the inbox.
      </Text>
      <InboxTable files={files} videos={videos} inboxPath={inboxDir()} />
    </Stack>
  );
}
