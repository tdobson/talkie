import { Badge, Group, Table, Text } from '@mantine/core';
import { formatWhen, plural } from '@/lib/admin/format';
import type { AdminSessionRow } from '@/lib/admin/sessions';
import { T } from '@/lib/testids';

/** The reviewer sessions of one video version. */
export function SessionTable({ sessions }: { sessions: AdminSessionRow[] }) {
  if (sessions.length === 0) {
    return <Text c="dimmed">Nobody has reviewed this version yet. Send them the link above.</Text>;
  }

  return (
    <Table.ScrollContainer minWidth={560}>
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Reviewer</Table.Th>
            <Table.Th>Started</Table.Th>
            <Table.Th>Done</Table.Th>
            <Table.Th>Comments</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sessions.map((s) => (
            <Table.Tr key={s.sessionId} data-testid={T.adminSessionRow}>
              <Table.Td>{s.reviewerName}</Table.Td>
              <Table.Td>{formatWhen(s.startedAt)}</Table.Td>
              <Table.Td>{s.doneAt ? formatWhen(s.doneAt) : 'Not finished'}</Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <Text size="sm">{plural(s.comments, 'comment')}</Text>
                  {s.emptyComments > 0 && (
                    <Badge color="gray" variant="light">
                      {s.emptyComments} empty
                    </Badge>
                  )}
                  {s.failedComments > 0 && (
                    <Badge color="red" variant="light">
                      {s.failedComments} failed
                    </Badge>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
