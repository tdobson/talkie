'use client';

import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'indigo',
  // Shade 6 gives white button text only 4.3:1; shade 7 clears WCAG AA (4.5:1).
  primaryShade: { light: 7, dark: 8 },
  defaultRadius: 'md',
  fontFamily: 'Inter, system-ui, sans-serif',
  headings: { fontWeight: '650' },
});
