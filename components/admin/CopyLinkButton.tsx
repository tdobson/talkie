'use client';

import { Button } from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { T } from '@/lib/testids';

/** Copies a review link to the clipboard and confirms it for two seconds. */
export function CopyLinkButton({ url }: { url: string }) {
  const clipboard = useClipboard({ timeout: 2000 });
  return (
    <Button
      size="compact-sm"
      variant={clipboard.copied ? 'filled' : 'light'}
      color={clipboard.copied ? 'teal' : undefined}
      leftSection={clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      onClick={() => clipboard.copy(url)}
      data-testid={T.adminCopyLink}
    >
      {clipboard.copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}
