import type { FilmSource, TalkieFilm } from '@talkie/format';
import { CaptionsView, cueText } from '../../src/ui/captions-view';
import { enterFullscreen, exitFullscreen, isFullscreen } from '../../src/ui/fullscreen';
import { attachMediaSession, chapterStep } from '../../src/ui/media-session';
import { Preview } from '../../src/ui/preview';
import { chapterSegments, Scrubber } from '../../src/ui/scrubber';
import { fakeRenderers, flush } from '../engine/helpers';

const FILM: TalkieFilm = {
  talkie: 1,
  title: 'Gutters',
  duration: 200,
  size: [1920, 1080],
  audio: [{ src: 'a/voice.webm', type: 'audio/webm' }],
  scenes: [
    { id: 's1', src: 'a/s1.json', start: 0, end: 100 },
    { id: 's2', src: 'a/s2.json', start: 100, end: 200 },
  ],
  chapters: [
    { title: 'Start', start: 0 },
    { title: 'Fixing', start: 100 },
    { title: 'Checks', start: 150 },
  ],
  captions: [],
  poster: { png: 'poster.png' },
};

describe('chapterSegments', () => {
  it('makes one segment per chapter', () => {
    expect(chapterSegments(FILM)).toEqual([
      { start: 0, end: 100, title: 'Start' },
      { start: 100, end: 150, title: 'Fixing' },
      { start: 150, end: 200, title: 'Checks' },
    ]);
  });

  it('covers the time before the first chapter, and films with no chapters', () => {
    expect(chapterSegments({ ...FILM, chapters: [{ title: 'Late', start: 50 }] })).toEqual([
      { start: 0, end: 50, title: '' },
      { start: 50, end: 200, title: 'Late' },
    ]);
    expect(chapterSegments({ ...FILM, chapters: [] })).toEqual([{ start: 0, end: 200, title: '' }]);
  });
});

describe('Scrubber', () => {
  function setup() {
    const el = document.createElement('div');
    const track = document.createElement('div');
    const thumb = document.createElement('div');
    el.append(track, thumb);
    document.body.append(el);
    el.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect;
    const handlers = { onSeek: jest.fn(), onHover: jest.fn(), onHoverEnd: jest.fn() };
    const scrubber = new Scrubber(el, track, thumb, handlers);
    scrubber.setFilm(FILM);
    return { el, track, thumb, handlers, scrubber };
  }
  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { clientX, bubbles: true, button: 0 });
    Object.assign(event, { pointerId: 1, pointerType: 'mouse' });
    return event;
  };
  const buffered = (end: number): TimeRanges =>
    ({ length: 1, start: () => 0, end: () => end }) as TimeRanges;

  it('fills the segments up to the time and the loaded audio', () => {
    const { track, thumb, el, scrubber } = setup();
    scrubber.update(125, buffered(175));
    const played = Array.from(track.querySelectorAll<HTMLElement>('.played'), (p) => p.style.width);
    const loaded = Array.from(
      track.querySelectorAll<HTMLElement>('.buffered'),
      (p) => p.style.width
    );
    expect(played).toEqual(['100%', '50%', '0%']);
    expect(loaded).toEqual(['100%', '100%', '50%']);
    expect(thumb.style.left).toBe('62.5%');
    expect(el.getAttribute('aria-valuemax')).toBe('200');
    expect(el.getAttribute('aria-valuenow')).toBe('125');
    expect(el.getAttribute('aria-valuetext')).toBe('2 minutes 5 seconds of 3 minutes 20 seconds');
  });

  it('seeks once on release after a drag', () => {
    const { el, handlers, scrubber } = setup();
    el.dispatchEvent(pointer('pointerdown', 200));
    expect(scrubber.isDragging).toBe(true);
    expect(handlers.onSeek).toHaveBeenLastCalledWith(50, false);
    el.dispatchEvent(pointer('pointermove', 300));
    expect(handlers.onSeek).toHaveBeenLastCalledWith(100, false);
    el.dispatchEvent(pointer('pointerup', 900));
    expect(handlers.onSeek).toHaveBeenLastCalledWith(200, true);
    expect(scrubber.isDragging).toBe(false);
  });

  it('reports hover without seeking', () => {
    const { el, handlers } = setup();
    el.dispatchEvent(pointer('pointermove', 300));
    expect(handlers.onHover).toHaveBeenCalledWith(100, 0.5);
    expect(handlers.onSeek).not.toHaveBeenCalled();
    el.dispatchEvent(new Event('pointerleave'));
    expect(handlers.onHoverEnd).toHaveBeenCalledTimes(1);
  });

  it('seeks with the arrow keys, Home and End', () => {
    const { el, handlers, scrubber } = setup();
    scrubber.update(50, null);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(handlers.onSeek).toHaveBeenLastCalledWith(55, true);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(handlers.onSeek).toHaveBeenLastCalledWith(45, true);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(handlers.onSeek).toHaveBeenLastCalledWith(200, true);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(handlers.onSeek).toHaveBeenLastCalledWith(0, true);
  });
});

describe('Preview', () => {
  function setup() {
    jest.useFakeTimers();
    let now = 1000;
    const { made, create } = fakeRenderers();
    const source: FilmSource = {
      kind: 'folder',
      json: jest.fn(async (path: string) => ({ path, fr: 25, ip: 0, op: 2500 })),
      url: async (path: string) => path,
      dispose: jest.fn(),
    };
    const open = jest.fn(async () => ({ film: FILM, source }));
    const preview = new Preview({
      canvas: document.createElement('canvas'),
      createRenderer: create,
      open,
      now: () => now,
    });
    const advance = async (ms: number) => {
      now += ms;
      jest.advanceTimersByTime(ms);
      await flush(30);
    };
    return { preview, made, source, open, advance };
  }

  afterEach(() => jest.useRealTimers());

  it('renders the hovered time with its own renderer', async () => {
    const { preview, made, open, advance } = setup();
    preview.renderAt(10);
    await advance(0);
    expect(open).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(1);
    expect(made[0]!.loads).toEqual([{ path: 'a/s1.json', fr: 25, ip: 0, op: 2500 }]);
    expect(made[0]!.frames).toEqual([250]);
  });

  it('draws at most 10 times a second and always draws the last time asked for', async () => {
    const { preview, made, advance } = setup();
    preview.renderAt(10);
    await advance(0);
    preview.renderAt(11);
    preview.renderAt(12);
    preview.renderAt(13);
    await advance(50);
    expect(made[0]!.frames).toEqual([250]);
    await advance(50);
    expect(made[0]!.frames).toEqual([250, 325]);
  });

  it('loads another scene when the hover crosses into it, and cleans up', async () => {
    const { preview, made, source, open, advance } = setup();
    preview.renderAt(10);
    await advance(0);
    preview.renderAt(120);
    await advance(100);
    expect(open).toHaveBeenCalledTimes(1);
    expect(made[0]!.loads).toHaveLength(2);
    expect(made[0]!.frames).toEqual([250, 500]);
    preview.destroy();
    expect(made[0]!.destroyed).toBe(true);
    expect(source.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('media session', () => {
  class FakePlayer extends EventTarget {
    currentTime = 120;
    duration = 200;
    playbackRate = 1;
    play = jest.fn(async () => undefined);
    pause = jest.fn();
  }

  it('does nothing where the API is missing', () => {
    expect('mediaSession' in navigator).toBe(false);
    expect(() => attachMediaSession(new FakePlayer(), FILM, null)()).not.toThrow();
  });

  it('steps between chapters', () => {
    expect(chapterStep(FILM, 120, 1)).toBe(150);
    expect(chapterStep(FILM, 180, 1)).toBeNull();
    expect(chapterStep(FILM, 120, -1)).toBe(100);
    expect(chapterStep(FILM, 101, -1)).toBe(0);
  });

  it('sets metadata, position and handlers, and removes them', () => {
    const handlers = new Map<string, ((d: Record<string, unknown>) => void) | null>();
    const session = {
      metadata: null as unknown,
      setActionHandler: jest.fn((action: string, handler) => void handlers.set(action, handler)),
      setPositionState: jest.fn(),
    };
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
    (globalThis as Record<string, unknown>).MediaMetadata = class {
      constructor(public init: unknown) {}
    };
    try {
      const player = new FakePlayer();
      const detach = attachMediaSession(player, FILM, 'http://x/poster.png');
      expect((session.metadata as { init: unknown }).init).toEqual({
        title: 'Gutters',
        artist: 'Fixing',
        artwork: [{ src: 'http://x/poster.png', type: 'image/png' }],
      });
      expect(session.setPositionState).toHaveBeenLastCalledWith({
        duration: 200,
        playbackRate: 1,
        position: 120,
      });
      expect([...handlers.keys()].sort()).toEqual([
        'nexttrack',
        'pause',
        'play',
        'previoustrack',
        'seekbackward',
        'seekforward',
        'seekto',
      ]);

      handlers.get('play')!({});
      expect(player.play).toHaveBeenCalled();
      handlers.get('pause')!({});
      expect(player.pause).toHaveBeenCalled();
      handlers.get('seekforward')!({});
      expect(player.currentTime).toBe(130);
      handlers.get('seekbackward')!({ seekOffset: 30 });
      expect(player.currentTime).toBe(100);
      handlers.get('seekto')!({ seekTime: 42 });
      expect(player.currentTime).toBe(42);
      handlers.get('nexttrack')!({});
      expect(player.currentTime).toBe(100);
      handlers.get('previoustrack')!({});
      expect(player.currentTime).toBe(0);

      player.playbackRate = 1.5;
      player.dispatchEvent(new Event('ratechange'));
      expect(session.setPositionState).toHaveBeenLastCalledWith({
        duration: 200,
        playbackRate: 1.5,
        position: 0,
      });
      player.currentTime = 160;
      player.dispatchEvent(new Event('timeupdate'));
      expect((session.metadata as { init: { artist: string } }).init.artist).toBe('Checks');

      detach();
      expect(session.metadata).toBeNull();
      expect(handlers.get('play')).toBeNull();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaSession;
      delete (globalThis as Record<string, unknown>).MediaMetadata;
    }
  });
});

describe('fullscreen', () => {
  it('falls back to an overlay class where the API is missing', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const changed = jest.fn();
    host.addEventListener('talkiefullscreenchange', changed);
    expect(typeof host.requestFullscreen).toBe('undefined');
    await enterFullscreen(host);
    expect(host.classList.contains('talkie-fullscreen')).toBe(true);
    expect(isFullscreen(host)).toBe(true);
    await exitFullscreen(host);
    expect(isFullscreen(host)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('uses requestFullscreen where it exists and locks to landscape', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.requestFullscreen = jest.fn(async () => undefined);
    const lock = jest.fn(async () => undefined);
    Object.defineProperty(screen, 'orientation', { value: { lock }, configurable: true });
    try {
      await enterFullscreen(host);
      expect(host.requestFullscreen).toHaveBeenCalledTimes(1);
      expect(lock).toHaveBeenCalledWith('landscape');
      expect(host.classList.contains('talkie-fullscreen')).toBe(false);
    } finally {
      delete (screen as unknown as Record<string, unknown>).orientation;
    }
  });
});

describe('captions view', () => {
  it('strips WebVTT tags', () => {
    expect(cueText('<v Tim>Fix the <i>gutter</i> &amp; go')).toBe('Fix the gutter & go');
  });

  it('shows the cue for the time, only when on', () => {
    const box = document.createElement('div');
    const plate = document.createElement('span');
    const view = new CaptionsView(box, plate);
    const cues = [{ start: 1, end: 3, text: 'One\ntwo' }];
    view.update(cues, 2, true);
    expect(box.hidden).toBe(false);
    expect(plate.textContent).toBe('One\ntwo');
    view.update(cues, 2, false);
    expect(box.hidden).toBe(true);
    view.update(cues, 5, true);
    expect(box.hidden).toBe(true);
  });
});
