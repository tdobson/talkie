'use client';

import { Card, Center, Stack, Title } from '@mantine/core';
import { type ReactNode, useEffect, useRef } from 'react';
import classes from './review.module.css';

/** A screen's heading. Takes focus when the screen appears, so screen readers announce it. */
export function ScreenHeading({ children, order = 1 }: { children: ReactNode; order?: 1 | 2 }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <Title ref={ref} order={order} size="h2" tabIndex={-1} className={classes.heading}>
      {children}
    </Title>
  );
}

/** The centred card that every screen outside the player sits in. */
export function ScreenCard({
  testId,
  heading,
  children,
}: {
  testId: string;
  heading: ReactNode;
  children: ReactNode;
}) {
  return (
    <Center component="main" className={classes.page} p="md">
      <Card withBorder shadow="sm" radius="lg" className={classes.card} data-testid={testId}>
        <Stack gap="md">
          <ScreenHeading>{heading}</ScreenHeading>
          {children}
        </Stack>
      </Card>
    </Center>
  );
}
