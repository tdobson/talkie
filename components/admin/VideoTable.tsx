import { Anchor, Badge, Code, Group, Paper, Stack, Table, Text } from '@mantine/core';
import Link from 'next/link';
import { formatWhen, plural } from '@/lib/admin/format';
import { T } from '@/lib/testids';
import type { AdminVideoSummary } from '@/lib/types';
import { CopyLinkButton } from './CopyLinkButton';

interface Totals {
  sessions: number;
  comments: number;
  pending: number;
  lastActivity: string | null;
}

function totals(video: AdminVideoSummary): Totals {
  const out: Totals = { sessions: 0, comments: 0, pending: 0, lastActivity: null };
  for (const v of video.versions) {
    out.sessions += v.sessions;
    out.comments += v.comments;
    out.pending += v.pendingProcessing;
    if (v.lastActivity && (out.lastActivity === null || v.lastActivity > out.lastActivity)) {
      out.lastActivity = v.lastActivity;
    }
  }
  return out;
}

/** The video list on /admin. Counts are totals across every version. */
export function VideoTable({
  videos,
  inboxPath,
}: {
  videos: AdminVideoSummary[];
  inboxPath: string;
}) {
  if (videos.length === 0) {
    return (
      <Paper withBorder p="xl">
        <Stack gap="xs" align="flex-start">
          <Text fw={600}>No videos yet</Text>
          <Text>Drop an MP4 into the inbox folder on the server, then import it here.</Text>
          <Code>{inboxPath}</Code>
          <Anchor component={Link} href="/admin/inbox">
            Go to the inbox
          </Anchor>
        </Stack>
      </Paper>
    );
  }

  return (
    <Table.ScrollContainer minWidth={760}>
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Video</Table.Th>
            <Table.Th>Latest</Table.Th>
            <Table.Th>Feedback</Table.Th>
            <Table.Th>Last activity</Table.Th>
            <Table.Th>Review link</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {videos.map((video) => {
            const t = totals(video);
            return (
              <Table.Tr key={video.videoId} data-testid={T.adminVideoRow}>
                <Table.Td>
                  <Anchor component={Link} href={`/admin/videos/${video.videoId}`} fw={600}>
                    {video.title}
                  </Anchor>
                </Table.Td>
                <Table.Td>v{video.latestVersion}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Text size="sm">
                      {plural(t.sessions, 'session')}, {plural(t.comments, 'comment')}
                    </Text>
                    {t.pending > 0 && (
                      <Badge color="yellow" variant="light">
                        {t.pending} processing
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{formatWhen(t.lastActivity)}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" c="dimmed" truncate maw={260}>
                      {video.reviewUrl}
                    </Text>
                    <CopyLinkButton url={video.reviewUrl} />
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
