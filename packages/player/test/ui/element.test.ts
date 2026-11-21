import { TalkieError, type TalkieFilm } from '@talkie/format';
import type { EngineOptions } from '../../src/engine/engine';
import type { Cue } from '../../src/engine/vtt';
import { defineTalkiePlayer, TalkieEngine, TalkiePlayerElement } from '../../src/index';
import { flush } from '../engine/helpers';

const FILM: TalkieFilm = {
  talkie: 1,
  title: 'Gutters',
  duration: 200,
  size: [1920, 1080],
  audio: [{ src: 'a/voice.webm', type: 'audio/webm; codecs=opus' }],
  scenes: [
    { id: 's1', src: 'a/s1.json', start: 0, end: 100 },
    { id: 's2', src: 'a/s2.json', start: 100, end: 200 },
  ],
  chapters: [
    { title: 'Start', start: 0 },
    { title: 'Fixing', start: 100 },
  ],
  captions: [{ lang: 'en', label: 'English', src: 'c/en.vtt' }],
  poster: { png: 'poster.png' },
};

class FakeEngine extends EventTarget {
  static last: FakeEngine;
  audio = document.createElement('audio');
  film: TalkieFilm | null = null;
  cues: Cue[] = [];
  currentTime = 0;
  duration = NaN;
  paused = true;
  ended = false;
  playbackRate = 1;
  volume = 1;
  muted = false;
  loadError: TalkieError | null = null;

  constructor(public opts: EngineOptions) {
    super();
    FakeEngine.last = this;
  }

  load = jest.fn(async (_input: unknown, opts: { start?: number } = {}) => {
    if (this.loadError) {
      this.dispatchEvent(new CustomEvent('error', { detail: this.loadError }));
      throw this.loadError;
    }
    this.film = FILM;
    this.duration = FILM.duration;
    this.currentTime = opts.start ?? 0;
    this.cues = [{ start: 0, end: 5, text: 'Hello <i>there</i>' }];
    this.dispatchEvent(new Event('loadedmetadata'));
    return FILM;
  });

  play = jest.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
  });

  pause = jest.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });

  retry = jest.fn(async () => undefined);
  renderAt = jest.fn(async () => undefined);
  resize = jest.fn();
  destroy = jest.fn();
}

function mount(attrs: Record<string, string> = { src: '/films/a/' }) {
  const el = document.createElement('talkie-player') as TalkiePlayerElement;
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  document.body.append(el);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    el.shadowRoot!.querySelector<T>(selector)!;
  return { el, engine: FakeEngine.last, $ };
}

function key(el: HTMLElement, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

beforeAll(() => {
  TalkiePlayerElement.engineFactory = (opts) => new FakeEngine(opts) as unknown as TalkieEngine;
  defineTalkiePlayer();
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  jest.useRealTimers();
});

describe('exports', () => {
  it('exports the engine and registers the element once', () => {
    expect(typeof TalkieEngine).toBe('function');
    expect(customElements.get('talkie-player')).toBe(TalkiePlayerElement);
    expect(() => defineTalkiePlayer()).not.toThrow();
  });
});

describe('attributes', () => {
  it('loads src into the engine', async () => {
    const { engine } = mount();
    await flush();
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledWith('/films/a/', { start: undefined });
  });

  it('passes start', async () => {
    const { engine } = mount({ src: '/films/a/', start: '12.5' });
    await flush();
    expect(engine.load).toHaveBeenCalledWith('/films/a/', { start: 12.5 });
  });

  it('reloads when src changes', async () => {
    const { el, engine } = mount();
    await flush();
    el.setAttribute('src', '/films/b.lottie');
    await flush();
    expect(engine.load).toHaveBeenLastCalledWith('/films/b.lottie', { start: undefined });
  });

  it('loads the source property', async () => {
    const { el, engine } = mount({});
    await flush();
    expect(engine.load).not.toHaveBeenCalled();
    const bytes = new Uint8Array([1, 2, 3]);
    el.source = bytes;
    await flush();
    expect(engine.load).toHaveBeenCalledWith(bytes, { start: undefined });
    expect(el.source).toBe(bytes);
  });

  it('passes debug to the engine', () => {
    expect(mount({ debug: '' }).engine.opts.debug).toBe(true);
    expect(mount().engine.opts.debug).toBe(false);
  });

  it('shows the controls unless controls="false"', () => {
    expect(mount().$('.root').getAttribute('data-controls')).toBe('on');
    const { el, $ } = mount({ src: '/films/a/', controls: 'false' });
    expect($('.root').getAttribute('data-controls')).toBe('off');
    el.setAttribute('controls', '');
    expect($('.root').getAttribute('data-controls')).toBe('on');
  });

  it('shows the big play button until the first play', async () => {
    const { engine, $ } = mount();
    await flush();
    expect($('.big-play').hidden).toBe(false);
    expect(engine.play).not.toHaveBeenCalled();
    $('.big-play').click();
    await flush();
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect($('.big-play').hidden).toBe(true);
  });

  it('autoplays muted with an unmute chip', async () => {
    const { engine, $ } = mount({ src: '/films/a/', autoplay: '' });
    await flush();
    expect(engine.muted).toBe(true);
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect($('.unmute').hidden).toBe(false);
    $('.unmute').click();
    expect(engine.muted).toBe(false);
    engine.dispatchEvent(new Event('volumechange'));
    expect($('.unmute').hidden).toBe(true);
  });

  it('uses the poster attribute', async () => {
    const { $ } = mount({ src: '/films/a/', poster: '/p.png' });
    await flush();
    expect($<HTMLImageElement>('.poster').getAttribute('src')).toBe('/p.png');
    expect($('.poster').hidden).toBe(false);
  });

  it('finds the poster of a folder film', async () => {
    const { $ } = mount();
    await flush();
    expect($<HTMLImageElement>('.poster').src).toBe('http://localhost/films/a/poster.png');
  });
});

describe('media API', () => {
  it('forwards properties and methods to the engine', async () => {
    const { el, engine } = mount();
    await flush();
    expect(el.duration).toBe(200);
    expect(el.paused).toBe(true);
    expect(el.ended).toBe(false);
    el.currentTime = 42;
    expect(engine.currentTime).toBe(42);
    expect(el.currentTime).toBe(42);
    el.volume = 0.3;
    el.muted = true;
    el.playbackRate = 1.5;
    expect(engine.volume).toBe(0.3);
    expect(engine.muted).toBe(true);
    expect(engine.playbackRate).toBe(1.5);
    await el.play();
    expect(engine.play).toHaveBeenCalled();
    el.pause();
    expect(engine.pause).toHaveBeenCalled();
    expect(el.film).toBe(FILM);
  });

  it('keeps values set before it is connected', () => {
    const el = document.createElement('talkie-player') as TalkiePlayerElement;
    expect(el.paused).toBe(true);
    expect(el.duration).toBeNaN();
    el.volume = 0.2;
    el.playbackRate = 2;
    expect(el.volume).toBe(0.2);
    document.body.append(el);
    expect(FakeEngine.last.volume).toBe(0.2);
    expect(FakeEngine.last.playbackRate).toBe(2);
  });

  it('destroys the engine when removed', async () => {
    const { el, engine } = mount();
    await flush();
    el.remove();
    expect(engine.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('events', () => {
  it('re-dispatches engine events from the element, composed', async () => {
    const { el, engine } = mount();
    await flush();
    const seen: Event[] = [];
    for (const type of ['play', 'pause', 'timeupdate', 'seeking', 'seeked', 'waiting', 'ended']) {
      el.addEventListener(type, (e) => seen.push(e));
      engine.dispatchEvent(new Event(type));
    }
    expect(seen.map((e) => e.type)).toEqual([
      'play',
      'pause',
      'timeupdate',
      'seeking',
      'seeked',
      'waiting',
      'ended',
    ]);
    expect(seen.every((e) => e.composed && e.target === el)).toBe(true);
  });

  it('re-dispatches loadedmetadata, chapterchange and error with their detail', async () => {
    const { el, engine } = mount();
    const meta = jest.fn();
    el.addEventListener('loadedmetadata', meta);
    await flush();
    expect(meta).toHaveBeenCalledTimes(1);

    const chapter = jest.fn();
    el.addEventListener('chapterchange', (e) => chapter((e as CustomEvent).detail));
    engine.dispatchEvent(new CustomEvent('chapterchange', { detail: { index: 1 } }));
    expect(chapter).toHaveBeenCalledWith({ index: 1 });

    const error = jest.fn();
    el.addEventListener('error', (e: Event) => error((e as CustomEvent).detail));
    const detail = new TalkieError('network', 'gone');
    engine.dispatchEvent(new CustomEvent('error', { detail }));
    expect(error).toHaveBeenCalledWith(detail);
  });
});

describe('controls', () => {
  it('hide after 3 s of playback and return on pointer move', async () => {
    jest.useFakeTimers();
    const { el, engine, $ } = mount();
    await flush();
    const root = $('.root');
    expect(root.hasAttribute('data-hidden')).toBe(false);
    jest.advanceTimersByTime(10000);
    expect(root.hasAttribute('data-hidden')).toBe(false);

    await engine.play();
    jest.advanceTimersByTime(2900);
    expect(root.hasAttribute('data-hidden')).toBe(false);
    jest.advanceTimersByTime(200);
    expect(root.hasAttribute('data-hidden')).toBe(true);

    el.dispatchEvent(new Event('pointermove'));
    expect(root.hasAttribute('data-hidden')).toBe(false);
    jest.advanceTimersByTime(3100);
    expect(root.hasAttribute('data-hidden')).toBe(true);

    engine.pause();
    expect(root.hasAttribute('data-hidden')).toBe(false);
    jest.advanceTimersByTime(10000);
    expect(root.hasAttribute('data-hidden')).toBe(false);
  });

  it('label every button', () => {
    const { el } = mount();
    const buttons = Array.from(el.shadowRoot!.querySelectorAll('.row button, .big-play'));
    expect(buttons.length).toBeGreaterThanOrEqual(9);
    for (const b of buttons) {
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('play and pause from the bar, and show the time', async () => {
    const { engine, $ } = mount();
    await flush();
    $('.play').click();
    await flush();
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect($('.play').getAttribute('aria-label')).toBe('Pause');
    $('.play').click();
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect($('.play').getAttribute('aria-label')).toBe('Play');

    engine.currentTime = 65;
    engine.dispatchEvent(new Event('timeupdate'));
    expect($('.time').textContent).toBe('1:05 / 3:20');
    expect($('.scrubber').getAttribute('aria-valuetext')).toBe(
      '1 minute 5 seconds of 3 minutes 20 seconds'
    );
  });

  it('skip, mute and change speed', async () => {
    const { engine, $ } = mount();
    await flush();
    engine.currentTime = 50;
    $('.skip-forward').click();
    expect(engine.currentTime).toBe(60);
    $('.skip-back').click();
    expect(engine.currentTime).toBe(50);
    $('.mute').click();
    expect(engine.muted).toBe(true);

    $('.settings').click();
    expect($('.settings-menu').hidden).toBe(false);
    $<HTMLButtonElement>('.settings-menu [data-value="1.5"]').click();
    expect(engine.playbackRate).toBe(1.5);
    expect($('.settings-menu').hidden).toBe(true);
  });

  it('list chapters, jump to one and show its title', async () => {
    const { engine, $ } = mount();
    await flush();
    expect($('.scrubber').querySelectorAll('.segment')).toHaveLength(2);
    expect($('.chapter-title').textContent).toBe('Start');
    $('.chapters').click();
    const items = $('.chapters-menu').querySelectorAll('button');
    expect(Array.from(items, (b) => b.textContent)).toEqual(['Start0:00', 'Fixing1:40']);
    items[1]!.click();
    expect(engine.currentTime).toBe(100);
    engine.dispatchEvent(new CustomEvent('chapterchange', { detail: { index: 1 } }));
    expect($('.chapter-title').textContent).toBe('Fixing');
  });

  it('answer the keyboard', async () => {
    const { el, engine, $ } = mount();
    await flush();
    engine.currentTime = 50;
    key(el, 'l');
    expect(engine.currentTime).toBe(60);
    key(el, 'ArrowLeft');
    expect(engine.currentTime).toBe(55);
    key(el, '5');
    expect(engine.currentTime).toBe(100);
    key(el, 'm');
    expect(engine.muted).toBe(true);
    key(el, 'ArrowDown');
    expect(engine.volume).toBe(0.9);
    key(el, 'k');
    await flush();
    expect(engine.play).toHaveBeenCalledTimes(1);
    // Arrows on the slider seek once, not twice.
    key($('.scrubber'), 'ArrowRight');
    expect(engine.currentTime).toBe(105);
  });
});

function pointer(target: Element, type: string, pointerType: string) {
  const event = new MouseEvent(type, { bubbles: true, composed: true, clientX: 10 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

/** What a browser sends for one finger tap: the pointer events, then a click. */
function touchTap(target: HTMLElement) {
  pointer(target, 'pointerdown', 'touch');
  pointer(target, 'pointerup', 'touch');
  target.click();
}

describe('touch', () => {
  it('plays once when the big play button is tapped', async () => {
    const { engine, $ } = mount();
    await flush();
    touchTap($('.big-play'));
    await flush();
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.pause).not.toHaveBeenCalled();
    expect(engine.paused).toBe(false);
  });

  it('plays once when the bare stage is tapped before the first play', async () => {
    const { engine, $ } = mount();
    await flush();
    touchTap($('.stage'));
    await flush();
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it('toggles the controls, not playback, when the stage is tapped during playback', async () => {
    const { el, engine, $ } = mount();
    await flush();
    await el.play();
    engine.play.mockClear();
    touchTap($('.stage'));
    touchTap($('.stage'));
    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it('leaves the stage alone when the unmute chip is tapped', async () => {
    const { el, engine, $ } = mount({ src: '/films/a/', autoplay: '' });
    await flush();
    engine.play.mockClear();
    touchTap($('.unmute'));
    expect(el.muted).toBe(false);
    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it('still answers a mouse click after a tap whose click never reached the stage', async () => {
    const { engine, $ } = mount();
    await flush();
    // A long press or a scroll ends in pointerup with no click.
    pointer($('.stage'), 'pointerdown', 'touch');
    pointer($('.stage'), 'pointerup', 'touch');
    await flush();
    expect(engine.play).toHaveBeenCalledTimes(1);
    pointer($('.stage'), 'pointerdown', 'mouse');
    pointer($('.stage'), 'pointerup', 'mouse');
    $('.stage').click();
    expect(engine.pause).toHaveBeenCalledTimes(1);
  });
});

describe('captions', () => {
  it('are off by default and toggle with the button and the c key', async () => {
    const { el, engine, $ } = mount();
    await flush();
    engine.dispatchEvent(new Event('timeupdate'));
    expect($('.captions').hidden).toBe(true);
    expect($('.captions-toggle').hidden).toBe(false);

    $('.captions-toggle').click();
    expect($('.captions').hidden).toBe(false);
    expect($('.plate').textContent).toBe('Hello there');
    expect($('.captions-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(el.getAttribute('captions')).toBe('en');

    key(el, 'c');
    expect($('.captions').hidden).toBe(true);
    expect(el.getAttribute('captions')).toBe('off');
  });

  it('follow the captions attribute and the time', async () => {
    const { engine, $ } = mount({ src: '/films/a/', captions: 'en' });
    await flush();
    expect($('.plate').textContent).toBe('Hello there');
    engine.currentTime = 9;
    engine.dispatchEvent(new Event('timeupdate'));
    expect($('.captions').hidden).toBe(true);
  });
});

describe('errors', () => {
  it.each(['no-playable-audio', 'unsupported-version', 'invalid-film'] as const)(
    'shows a message for %s with no retry',
    async (code) => {
      const { engine, $ } = mount();
      await flush();
      engine.dispatchEvent(new CustomEvent('error', { detail: new TalkieError(code, 'x') }));
      expect($('.error').hidden).toBe(false);
      expect($('.error').getAttribute('data-code')).toBe(code);
      expect($('.error-text').textContent!.length).toBeGreaterThan(10);
      expect($('.error-text').textContent).not.toMatch(/[\u2013\u2014]/);
      expect($('.retry').hidden).toBe(true);
    }
  );

  it('offers retry after a network error', async () => {
    const { engine, $ } = mount();
    await flush();
    engine.dispatchEvent(new CustomEvent('error', { detail: new TalkieError('network', 'x') }));
    expect($('.error').hidden).toBe(false);
    expect($('.retry').hidden).toBe(false);
    $('.retry').click();
    expect(engine.retry).toHaveBeenCalledTimes(1);
    expect($('.error').hidden).toBe(true);
  });

  it('loads again on retry when the film never opened', async () => {
    const { engine, $ } = mount({});
    engine.loadError = new TalkieError('network', 'offline');
    FakeEngine.last = engine;
    document.querySelector('talkie-player')!.setAttribute('src', '/films/a/');
    await flush();
    expect($('.error').hidden).toBe(false);
    engine.loadError = null;
    $('.retry').click();
    await flush();
    expect(engine.retry).not.toHaveBeenCalled();
    expect(engine.load).toHaveBeenCalledTimes(2);
    expect($('.error').hidden).toBe(true);
  });
});

describe('resume', () => {
  it('restores the saved position when start is not given', async () => {
    localStorage.setItem('talkie:pos:/films/a/', '42');
    const { engine } = mount();
    await flush();
    expect(engine.load).toHaveBeenCalledWith('/films/a/', { start: 42 });
  });

  it('prefers start', async () => {
    localStorage.setItem('talkie:pos:/films/a/', '42');
    const { engine } = mount({ src: '/films/a/', start: '0' });
    await flush();
    expect(engine.load).toHaveBeenCalledWith('/films/a/', { start: 0 });
  });

  it('saves on pause and clears near the end', async () => {
    const { engine } = mount();
    await flush();
    await engine.play();
    engine.currentTime = 30;
    engine.pause();
    expect(localStorage.getItem('talkie:pos:/films/a/')).toBe('30');
    await engine.play();
    engine.currentTime = 198;
    engine.dispatchEvent(new Event('timeupdate'));
    expect(localStorage.getItem('talkie:pos:/films/a/')).toBeNull();
  });
});
