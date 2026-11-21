import type { Page } from '@playwright/test';

/**
 * Keep every audio and video element on the page silent. Headless browsers still play through
 * the desktop's speakers, so call this before the page loads. The page still reads back the
 * volume it set, so the player's controls and its tests behave as they do with sound.
 */
export async function silence(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const proto = HTMLMediaElement.prototype;
    const native = Object.getOwnPropertyDescriptor(proto, 'volume')!;
    const asked = new WeakMap<HTMLMediaElement, number>();
    Object.defineProperty(proto, 'volume', {
      configurable: true,
      enumerable: true,
      get(this: HTMLMediaElement) {
        return asked.get(this) ?? 1;
      },
      set(this: HTMLMediaElement, volume: number) {
        asked.set(this, volume);
        native.set!.call(this, 0);
      },
    });
    const play = proto.play;
    proto.play = function playSilently(this: HTMLMediaElement) {
      native.set!.call(this, 0);
      return play.call(this);
    };
  });
}
