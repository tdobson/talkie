import { Code, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { notFound } from 'next/navigation';
import { CopyLinkButton } from '@/components/admin/CopyLinkButton';
import { OpenLinkButton } from '@/components/admin/OpenLinkButton';
import { NavAnchor } from '@/components/admin/NavAnchor';
import { VersionCard } from '@/components/admin/VersionCard';
import { summariseSessions } from '@/lib/admin/sessions';
import { summariseVideos } from '@/lib/admin/summary';
import { requireAdminPage } from '@/lib/auth/guard';
import { config } from '@/lib/config';
import { ID_RE } from '@/lib/storage/paths';

export const dynamic = 'force-dynamic';

export default async function AdminVideoPage({ params }: { params: Promise<{ videoId: string }> }) {
  await requireAdminPage();
  const { videoId } = await params;
  if (!ID_RE.test(videoId)) notFound();
  const video = (await summariseVideos(config().publicBaseUrl)).find((v) => v.videoId === videoId);
  if (!video) notFound();
  const sessions = await summariseSessions(videoId);

  return (
    <Stack>
      <NavAnchor href="/admin" size="sm">
        All videos
      </NavAnchor>
      <Title order={2}>{video.title}</Title>
      <Paper withBorder p="md">
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Review link
          </Text>
          <Group gap="sm">
            <Code>{video.reviewUrl}</Code>
            <CopyLinkButton url={video.reviewUrl} />
            <OpenLinkButton url={video.reviewUrl} />
          </Group>
          <Text size="sm" c="dimmed">
            The link always opens the latest version (v{video.latestVersion}).
          </Text>
        </Stack>
      </Paper>
      {/* Newest version first. */}
      {[...video.versions].reverse().map((summary) => (
        <VersionCard
          key={summary.version}
          videoId={video.videoId}
          summary={summary}
          sessions={sessions.filter((s) => s.version === summary.version)}
          latest={summary.version === video.latestVersion}
        />
      ))}
    </Stack>
  );
}
