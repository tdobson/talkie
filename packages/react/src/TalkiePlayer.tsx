'use client';

import { useEffect, useImperativeHandle, useRef, type CSSProperties, type Ref } from 'react';
import type { TalkiePlayerElement } from '@talkie/player';
import './jsx';

const TAG = 'talkie-player';

export interface TalkiePlayerProps {
  /** A film folder URL or a `.lottie` URL. */
  src?: string;
  /** A `.lottie` held in memory. Set as a property on the element, never as an attribute. */
  source?: Blob | ArrayBuffer | Uint8Array;
  /** Controls are on by default; pass `false` to hide them. */
  controls?: boolean;
  autoPlay?: boolean;
  /** Start time in seconds. */
  start?: number;
  /** Caption language, for example `en`. */
  captions?: string;
  poster?: string;
  wasmUrl?: string;
  /** Sets the `--talkie-accent` CSS variable, for example a Mantine theme colour variable. */
  accentColor?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<TalkiePlayerElement | null>;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (time: number) => void;
  onChapterChange?: (index: number) => void;
  onError?: (error: Error) => void;
  onLoadedMetadata?: (duration: number) => void;
}

/**
 * A thin wrapper around the `<talkie-player>` element. The element is registered in an effect,
 * so server rendering (the Next.js app router included) emits the tag without touching `window`.
 */
export function TalkiePlayer({
  ref,
  source,
  accentColor,
  style,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  onChapterChange,
  onError,
  onLoadedMetadata,
  ...attrs
}: TalkiePlayerProps) {
  const el = useRef<TalkiePlayerElement | null>(null);
  useImperativeHandle(ref, () => el.current!, []);

  useEffect(() => {
    void import('@talkie/player').then((m) => m.defineTalkiePlayer());
  }, []);

  useEffect(() => {
    const node = el.current;
    if (!node || !source) {
      return undefined;
    }
    if (customElements.get(TAG)) {
      node.source = source;
      return undefined;
    }
    // Before the element is registered, an assignment would make a plain property that hides
    // the element's own `source` setter for good. Wait until the setter exists.
    let cancelled = false;
    void customElements.whenDefined(TAG).then(() => {
      if (!cancelled) {
        node.source = source;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    const node = el.current;
    if (!node) {
      return undefined;
    }
    const map: Array<[string, (e: Event) => void]> = [
      ['play', () => onPlay?.()],
      ['pause', () => onPause?.()],
      ['ended', () => onEnded?.()],
      ['timeupdate', () => onTimeUpdate?.(node.currentTime)],
      [
        'chapterchange',
        (e) => onChapterChange?.((e as CustomEvent<{ index: number }>).detail.index),
      ],
      ['error', (e) => onError?.((e as CustomEvent<Error>).detail)],
      ['loadedmetadata', () => onLoadedMetadata?.(node.duration)],
    ];
    map.forEach(([name, handler]) => node.addEventListener(name, handler));
    return () => map.forEach(([name, handler]) => node.removeEventListener(name, handler));
  }, [onPlay, onPause, onEnded, onTimeUpdate, onChapterChange, onError, onLoadedMetadata]);

  return (
    <talkie-player
      ref={el}
      src={attrs.src}
      controls={attrs.controls === false ? 'false' : undefined}
      autoplay={attrs.autoPlay ? '' : undefined}
      start={attrs.start}
      captions={attrs.captions}
      poster={attrs.poster}
      wasm-url={attrs.wasmUrl}
      class={attrs.className}
      style={
        { ...(accentColor ? { '--talkie-accent': accentColor } : {}), ...style } as CSSProperties
      }
    />
  );
}
