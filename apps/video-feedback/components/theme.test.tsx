import { DEFAULT_THEME, getPrimaryShade, mergeMantineTheme } from '@mantine/core';
import { theme } from '@/theme';

function channel(hex: string, i: number): number {
  const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

it('white button text on the primary colour meets WCAG AA for normal text', () => {
  const merged = mergeMantineTheme(DEFAULT_THEME, theme);
  const filled = merged.colors[merged.primaryColor][getPrimaryShade(merged, 'light')];
  expect(contrast('#ffffff', filled)).toBeGreaterThanOrEqual(4.5);
});
