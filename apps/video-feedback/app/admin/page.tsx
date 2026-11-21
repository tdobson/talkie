import { Stack, Title } from '@mantine/core';
import { VideoTable } from '@/components/admin/VideoTable';
import { summariseVideos } from '@/lib/admin/summary';
import { requireAdminPage } from '@/lib/auth/guard';
import { config } from '@/lib/config';
import { inboxDir } from '@/lib/storage/paths';

export const dynamic = 'force-dynamic';

export default async function AdminVideosPage() {
  // Layouts are not re-rendered on client navigation, so every page checks for itself.
  await requireAdminPage();
  const videos = await summariseVideos(config().publicBaseUrl);
  return (
    <Stack>
      <Title order={2}>Videos</Title>
      <VideoTable videos={videos} inboxPath={inboxDir()} />
    </Stack>
  );
}
