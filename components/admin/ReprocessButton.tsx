'use client';

import { Button, Stack, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { T } from '@/lib/testids';

export interface ReprocessButtonProps {
  videoId: string;
  version: number;
  /** Failed comments on this version. The button is disabled at zero. */
  failed: number;
  fetchImpl?: typeof fetch;
}

type Notice = { tone: 'ok' | 'error'; text: string } | null;

/** Puts the failed comments of one version back on the processing queue. */
export function ReprocessButton({ videoId, version, failed, fetchImpl }: ReprocessButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function onClick() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await (fetchImpl ?? fetch)(`/api/admin/videos/${videoId}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { queued?: number };
      const queued = body.queued ?? 0;
      setNotice({
        tone: 'ok',
        text:
          queued === 0
            ? 'Nothing to reprocess right now.'
            : `Queued ${queued} comment${queued === 1 ? '' : 's'} for another go.`,
      });
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not reprocess. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap={4}>
      <Button
        variant="default"
        leftSection={<IconRefresh size={16} />}
        onClick={onClick}
        loading={busy}
        disabled={failed === 0}
        data-testid={T.adminReprocess}
      >
        Reprocess failed comments
      </Button>
      {notice && (
        <Text size="sm" c={notice.tone === 'error' ? 'red' : 'dimmed'} role="status">
          {notice.text}
        </Text>
      )}
    </Stack>
  );
}
