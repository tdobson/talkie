'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { T } from '@/lib/testids';
import type { Rect } from '@/lib/types';
import type { MediaAdapter, MediaAdapterEvent } from './adapter';

export interface CaptionPlateProps {
  /** The media being shown. Only a film has captions: nothing is drawn for an mp4. */
  adapter: MediaAdapter | null;
  /** The letterboxed picture rectangle inside the stage. Without it the plate uses the stage. */
  rect: Rect | null;
  /** False once the reviewer has turned captions off. */
  on: boolean;
}

/** The times at which the caption can change. */
const CHANGES: MediaAdapterEvent[] = ['timeupdate', 'seeking', 'seeked', 'loadedmetadata'];

const plateStyle: CSSProperties = {
  maxWidth: '90%',
  marginBottom: '4%',
  padding: '0.3em 0.7em',
  borderRadius: '0.3em',
  background: 'rgba(11, 11, 15, 0.8)',
  color: '#fff',
  fontSize: 'clamp(0.875rem, 2.2vw, 1.5rem)',
  lineHeight: 1.35,
  textAlign: 'center',
  whiteSpace: 'pre-line',
  pointerEvents: 'none',
};

/**
 * The film's caption for the current time, on a plate at the bottom of the picture. It is part
 * of the page, not the picture, so it is never in a still or a clip, and it does not zoom. The
 * pointer goes straight through it: a click there is a click on the picture underneath.
 *
 * Styled inline so that being invisible to the pointer does not depend on a stylesheet.
 */
export function CaptionPlate({ adapter, rect, on }: CaptionPlateProps) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (adapter?.kind !== 'talkie' || !on) {
      setText(null);
      return;
    }
    const update = () => setText(adapter.caption());
    update();
    for (const type of CHANGES) adapter.addEventListener(type, update);
    return () => {
      for (const type of CHANGES) adapter.removeEventListener(type, update);
    };
  }, [adapter, on]);

  if (!text) return null;

  const sized = rect !== null && rect.width > 0 && rect.height > 0;
  const boxStyle: CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    pointerEvents: 'none',
    ...(sized
      ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
      : { inset: 0 }),
  };

  return (
    <div style={boxStyle}>
      <div style={plateStyle} data-testid={T.captionPlate}>
        {text}
      </div>
    </div>
  );
}
