'use client';

import { Button } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { T } from '@/lib/testids';

/**
 * Opens a review link in a new tab, so you can give feedback yourself. What you say is saved
 * like any reviewer's, under the name you give.
 */
export function OpenLinkButton({ url }: { url: string }) {
  return (
    <Button
      component="a"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      size="compact-sm"
      variant="light"
      leftSection={<IconExternalLink size={14} />}
      data-testid={T.adminOpenLink}
    >
      Open
    </Button>
  );
}
