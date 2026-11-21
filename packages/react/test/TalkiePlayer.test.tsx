import { createRef } from 'react';
import { render } from '@testing-library/react';
import type { TalkiePlayerElement } from '@talkie/player';
import { TalkiePlayer } from '../src/index';

// The real element is covered by @talkie/player's own tests. Here the tag stays an unknown
// element, so the tests see exactly what the wrapper renders and listens for.
const mockDefine = jest.fn();
jest.mock('@talkie/player', () => ({ defineTalkiePlayer: () => mockDefine() }));

function node(container: HTMLElement): HTMLElement {
  const el = container.querySelector('talkie-player');
  if (!el) {
    throw new Error('no talkie-player rendered');
  }
  return el as HTMLElement;
}

test('renders talkie-player with its attributes', () => {
  const { container } = render(
    <TalkiePlayer
      src="/films/demo/"
      autoPlay
      start={12}
      captions="en"
      poster="/p.svg"
      wasmUrl="/w.wasm"
      className="film"
    />
  );
  const el = node(container);
  expect(el.getAttribute('src')).toBe('/films/demo/');
  expect(el.getAttribute('autoplay')).toBe('');
  expect(el.getAttribute('start')).toBe('12');
  expect(el.getAttribute('captions')).toBe('en');
  expect(el.getAttribute('poster')).toBe('/p.svg');
  expect(el.getAttribute('wasm-url')).toBe('/w.wasm');
  expect(el.getAttribute('class')).toBe('film');
  expect(el.hasAttribute('controls')).toBe(false);
});

test('leaves optional attributes off and maps controls={false}', () => {
  const { container, rerender } = render(<TalkiePlayer src="/f/" />);
  const el = node(container);
  expect(el.hasAttribute('autoplay')).toBe(false);
  expect(el.hasAttribute('start')).toBe(false);
  rerender(<TalkiePlayer src="/f/" controls={false} />);
  expect(el.getAttribute('controls')).toBe('false');
});

test('registers the custom element on mount', async () => {
  mockDefine.mockClear();
  render(<TalkiePlayer src="/f/" />);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(mockDefine).toHaveBeenCalled();
});

test('sets source as a property, not an attribute', () => {
  const blob = new Blob(['x']);
  const { container, rerender } = render(<TalkiePlayer source={blob} />);
  const el = node(container) as TalkiePlayerElement;
  expect(el.source).toBe(blob);
  expect(el.hasAttribute('source')).toBe(false);
  const next = new Uint8Array([1, 2]);
  rerender(<TalkiePlayer source={next} />);
  expect(el.source).toBe(next);
});

test('element events call the handlers', () => {
  const h = {
    onPlay: jest.fn(),
    onPause: jest.fn(),
    onEnded: jest.fn(),
    onTimeUpdate: jest.fn(),
    onChapterChange: jest.fn(),
    onError: jest.fn(),
    onLoadedMetadata: jest.fn(),
  };
  const { container, unmount } = render(<TalkiePlayer src="/f/" {...h} />);
  const el = node(container);
  Object.assign(el, { currentTime: 3.5, duration: 42 });

  el.dispatchEvent(new Event('play'));
  el.dispatchEvent(new Event('pause'));
  el.dispatchEvent(new Event('ended'));
  el.dispatchEvent(new Event('timeupdate'));
  el.dispatchEvent(new CustomEvent('chapterchange', { detail: { index: 2 } }));
  const failure = new Error('bad film');
  el.dispatchEvent(new CustomEvent('error', { detail: failure }));
  el.dispatchEvent(new Event('loadedmetadata'));

  expect(h.onPlay).toHaveBeenCalledTimes(1);
  expect(h.onPause).toHaveBeenCalledTimes(1);
  expect(h.onEnded).toHaveBeenCalledTimes(1);
  expect(h.onTimeUpdate).toHaveBeenCalledWith(3.5);
  expect(h.onChapterChange).toHaveBeenCalledWith(2);
  expect(h.onError).toHaveBeenCalledWith(failure);
  expect(h.onLoadedMetadata).toHaveBeenCalledWith(42);

  unmount();
  el.dispatchEvent(new Event('play'));
  expect(h.onPlay).toHaveBeenCalledTimes(1);
});

test('ref gives the element', () => {
  const ref = createRef<TalkiePlayerElement | null>();
  const { container } = render(<TalkiePlayer src="/f/" ref={ref} />);
  expect(ref.current).toBe(node(container));
});

test('accentColor sets the CSS variable and keeps other styles', () => {
  const { container } = render(
    <TalkiePlayer src="/f/" accentColor="#e8590c" style={{ maxWidth: 640 }} />
  );
  const el = node(container);
  expect(el.style.getPropertyValue('--talkie-accent')).toBe('#e8590c');
  expect(el.style.maxWidth).toBe('640px');
});
