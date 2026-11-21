'use client';

import { Button, Code, Group, Paper, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { formatBytes, formatWhen } from '@/lib/admin/format';
import { T } from '@/lib/testids';
import type { AdminVideoSummary, ImportRequest, InboxFile } from '@/lib/types';
import { ImportModal } from './ImportModal';

export interface InboxTableProps {
  files: InboxFile[];
  videos: AdminVideoSummary[];
  inboxPath: string;
  fetchImpl?: typeof fetch;
}

/** Files waiting in the inbox folder, each importable as a new video or a new version. */
export function InboxTable({ files, videos, inboxPath, fetchImpl }: InboxTableProps) {
  const [target, setTarget] = useState<{ file: InboxFile; mode: ImportRequest['mode'] } | null>(
    null
  );

  if (files.length === 0) {
    return (
      <Paper withBorder p="xl">
        <Stack gap="xs" align="flex-start">
          <Text fw={600}>The inbox is empty.</Text>
          <Text>Copy an MP4 into this folder on the server, then reload this page.</Text>
          <Code>{inboxPath}</Code>
        </Stack>
      </Paper>
    );
  }

  return (
    <>
      <Table.ScrollContainer minWidth={640}>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>File</Table.Th>
              <Table.Th>Size</Table.Th>
              <Table.Th>Modified</Table.Th>
              <Table.Th>Import as</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {files.map((file) => (
              <Table.Tr key={file.filename} data-testid={T.adminInboxRow}>
                <Table.Td>{file.filename}</Table.Td>
                <Table.Td>{formatBytes(file.sizeBytes)}</Table.Td>
                <Table.Td>{formatWhen(file.modifiedAt)}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      size="compact-sm"
                      onClick={() => setTarget({ file, mode: 'new' })}
                      data-testid={T.adminImportNew}
                    >
                      New video
                    </Button>
                    <Button
                      size="compact-sm"
                      variant="default"
                      disabled={videos.length === 0}
                      onClick={() => setTarget({ file, mode: 'version' })}
                      data-testid={T.adminImportVersion}
                    >
                      New version of...
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {target && (
        <ImportModal
          // A fresh modal per file and mode, so no title or error carries over.
          key={`${target.mode}:${target.file.filename}`}
          file={target.file}
          videos={videos}
          mode={target.mode}
          opened
          onClose={() => setTarget(null)}
          fetchImpl={fetchImpl}
        />
      )}
    </>
  );
}
