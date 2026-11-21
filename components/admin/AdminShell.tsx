'use client';

import { AppShell, Button, Container, Group, Title } from '@mantine/core';
import { IconInbox, IconVideo } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/admin', label: 'Videos', icon: IconVideo },
  { href: '/admin/inbox', label: 'Inbox', icon: IconInbox },
];

/** Header and navigation shared by every admin page. */
export function AdminShell({ children }: { children: ReactNode }) {
  const inboxActive = (usePathname() ?? '').startsWith('/admin/inbox');
  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Title order={1} size="h4">
            Video feedback admin
          </Title>
          <Group component="nav" gap={4} wrap="nowrap" aria-label="Admin">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === '/admin/inbox' ? inboxActive : !inboxActive;
              return (
                <Button
                  key={href}
                  component={Link}
                  href={href}
                  variant={active ? 'light' : 'subtle'}
                  leftSection={<Icon size={16} />}
                  aria-current={active ? 'page' : undefined}
                >
                  {label}
                </Button>
              );
            })}
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="lg">{children}</Container>
      </AppShell.Main>
    </AppShell>
  );
}
