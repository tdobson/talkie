'use client';

import { Button, Group, Stack, Switch, Text } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { type MouseEvent, useState } from 'react';
import { T } from '@/lib/testids';

export interface DownloadButtonProps {
  videoId: string;
  version: number;
  /** Comments known to be waiting on the server, used in the "still processing" message. */
  pending?: number;
  fetchImpl?: typeof fetch;
  /** Starts the download. Replaced in tests. */
  navigate?: (url: string) => void;
}

type Notice = { tone: 'wait' | 'error'; text: string } | null;

export function exportZipUrl(videoId: string, version: number, clips: boolean): string {
  return `/api/admin/videos/${videoId}/export.zip?version=${version}&clips=${clips ? 1 : 0}`;
}

function stillProcessing(pending: number | undefined): string {
  if (!pending) return 'Still processing comments, try again in a moment';
  return `Still processing ${pending} comment${pending === 1 ? '' : 's'}, try again in a moment`;
}

/**
 * A plain link to the export zip with a "with clips" toggle. Clicking it first asks the
 * server whether the export is ready, so a 202 shows a message instead of a broken download.
 */
export function DownloadButton({
  videoId,
  version,
  pending,
  fetchImpl,
  navigate,
}: DownloadButtonProps) {
  const [clips, setClips] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const url = exportZipUrl(videoId, version, clips);

  async function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Leave modified clicks (new tab, save link as) to the browser.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (checking) return;
    setChecking(true);
    setNotice(null);
    try {
      const res = await (fetchImpl ?? fetch)(`${url}&partial=0`, {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (res.status === 202) {
        setNotice({ tone: 'wait', text: stillProcessing(pending) });
      } else if (res.ok || res.status === 304) {
        (navigate ?? ((to: string) => window.location.assign(to)))(url);
      } else {
        setNotice({
          tone: 'error',
          text: `Could not prepare the download (error ${res.status}). Try again in a moment.`,
        });
      }
    } catch {
      setNotice({
        tone: 'error',
        text: 'Could not prepare the download. Check your connection and try again.',
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <Stack gap={4}>
      <Group gap="md">
        <Button
          component="a"
          href={url}
          onClick={onClick}
          loading={checking}
          leftSection={<IconDownload size={16} />}
          data-testid={T.adminDownload}
        >
          Download zip
        </Button>
        <Switch
          label="With clips"
          checked={clips}
          onChange={(event) => {
            setClips(event.currentTarget.checked);
            setNotice(null);
          }}
          data-testid={T.adminClipsToggle}
        />
      </Group>
      {notice && (
        <Text size="sm" c={notice.tone === 'error' ? 'red' : 'dimmed'} role="status">
          {notice.text}
        </Text>
      )}
    </Stack>
  );
}
