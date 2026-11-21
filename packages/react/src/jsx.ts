import type { CSSProperties, Ref } from 'react';
import type { TalkiePlayerElement } from '@talkie/player';

/** The attributes `<talkie-player>` reads, as React passes them to a custom element. */
export interface TalkiePlayerAttributes {
  ref?: Ref<TalkiePlayerElement | null>;
  key?: string | number | bigint | null;
  src?: string;
  controls?: string;
  autoplay?: string;
  start?: number | string;
  captions?: string;
  poster?: string;
  'wasm-url'?: string;
  debug?: string;
  class?: string;
  style?: CSSProperties;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'talkie-player': TalkiePlayerAttributes;
    }
  }
}
