/** @jest-environment node */
import { renderToString } from 'react-dom/server';
import { TalkiePlayer } from '../src/index';

test('renders on the server without touching window', () => {
  expect(typeof window).toBe('undefined');
  const html = renderToString(<TalkiePlayer src="/f/" accentColor="#e8590c" />);
  expect(html).toContain('<talkie-player');
  expect(html).toContain('src="/f/"');
  expect(html).toContain('--talkie-accent:#e8590c');
});
