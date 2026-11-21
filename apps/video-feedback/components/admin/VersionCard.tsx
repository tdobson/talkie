'use client';

import { Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import { formatWhen, plural } from '@/lib/admin/format';
import type { AdminSessionRow } from '@/lib/admin/sessions';
import type { AdminVersionSummary } from '@/lib/types';
import { DownloadButton } from './DownloadButton';
import { ReprocessButton } from './ReprocessButton';
import { SessionTable } from './SessionTable';

export interface VersionCardProps {
  videoId: string;
  summary: AdminVersionSummary;
  /** Sessions of this version only. */
  sessions: AdminSessionRow[];
  latest?: boolean;
}

/** One version of a video: counts, its sessions, the zip download and reprocess. */
export function VersionCard({ videoId, summary, sessions, latest = false }: VersionCardProps) {
  return (
    <Card withBorder padding="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="xs">
              <Title order={3} size="h4">
                Version {summary.version}
              </Title>
              {latest && <Badge variant="light">Latest</Badge>}
              {summary.pendingProcessing > 0 && (
                <Badge color="yellow" variant="light">
                  {summary.pendingProcessing} processing
                </Badge>
              )}
              {summary.failedComments > 0 && (
                <Badge color="red" variant="light">
                  {summary.failedComments} failed
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {plural(summary.sessions, 'session')}, {plural(summary.comments, 'comment')}. Last
              activity: {formatWhen(summary.lastActivity)}
            </Text>
          </Stack>
          <Group align="flex-start">
            <DownloadButton
              videoId={videoId}
              version={summary.version}
              pending={summary.pendingProcessing}
            />
            <ReprocessButton
              videoId={videoId}
              version={summary.version}
              failed={summary.failedComments}
            />
          </Group>
        </Group>
        <SessionTable sessions={sessions} />
      </Stack>
    </Card>
  );
}
