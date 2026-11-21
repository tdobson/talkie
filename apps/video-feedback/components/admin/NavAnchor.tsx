'use client';

import { Anchor, type AnchorProps } from '@mantine/core';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A Mantine link that navigates client-side. Server components cannot pass `component={Link}`
 * themselves, because a function prop cannot cross into a client component.
 */
export function NavAnchor({
  href,
  children,
  ...props
}: AnchorProps & { href: string; children: ReactNode }) {
  return (
    <Anchor component={Link} href={href} {...props}>
      {children}
    </Anchor>
  );
}
