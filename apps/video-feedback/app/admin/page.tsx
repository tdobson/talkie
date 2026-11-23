import { Alert, Stack, Title } from '@mantine/core';
import { VideoTable } from '@/components/admin/VideoTable';
import { pipelineLine } from '@/lib/admin/pipeline-line';
import { summariseVideos } from '@/lib/admin/summary';
import { requireAdminPage } from '@/lib/auth/guard';
import { config } from '@/lib/config';
import { readPipelineStatus } from '@/lib/pipeline/pipeline-status';
import { inboxDir } from '@/lib/storage/paths';
import { T } from '@/lib/testids';

export const dynamic = 'force-dynamic';

export default async function AdminVideosPage() {
  // Layouts are not re-rendered on client navigation, so every page checks for itself.
  await requireAdminPage();
  const videos = await summariseVideos(config().publicBaseUrl);
  const processing = pipelineLine(await readPipelineStatus());
  return (
    <Stack>
      <Title order={2}>Videos</Title>
      <Alert
        variant="light"
        color={{ ok: 'teal', busy: 'blue', down: 'red' }[processing.tone]}
        data-testid={T.adminProcessing}
      >
        {processing.text}
      </Alert>
      <VideoTable videos={videos} inboxPath={inboxDir()} />
    </Stack>
  );
}
