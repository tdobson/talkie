'use client';

import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react';
import { ZOOM_ANIM_MS } from '@/lib/constants';
import { T } from '@/lib/testids';
import type { MediaKind, Rect, ZoomState } from '@/lib/types';
import classes from './player.module.css';

export interface VideoStageProps {
  stageRef: RefObject<HTMLDivElement | null>;
  /** What the picture is: a `<video>` element, or a surface a Talkie engine draws into. */
  kind: MediaKind;
  /** The `<video>` element, for an mp4. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The element the Talkie engine mounts its canvases in, for a film. */
  surfaceRef: RefObject<HTMLDivElement | null>;
  /** The video file, for an mp4. A film is loaded by its engine. */
  src?: string;
  playing: boolean;
  zoom: ZoomState | null;
  /** Where the zoom last was, so zooming out shrinks back around the same point. */
  lastOrigin: { originX: number; originY: number };
  /** The letterboxed picture rectangle inside the stage, once the video size is known. */
  pictureRect: Rect | null;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  /** Overlays. They sit above the picture and are not zoomed with it. */
  children?: ReactNode;
}

/**
 * The dark stage and the picture in it, whichever kind of picture it is. Pointer coordinates
 * are measured against the stage. The picture layer is sized to the letterboxed picture, so a
 * zoom origin given as a fraction of the picture can be used directly as the CSS transform origin.
 *
 * The stage only draws. What the media does is heard through its MediaAdapter, by the player.
 */
export function VideoStage({
  stageRef,
  kind,
  videoRef,
  surfaceRef,
  src,
  playing,
  zoom,
  lastOrigin,
  pictureRect,
  onClick,
  children,
}: VideoStageProps) {
  const origin = zoom ?? lastOrigin;
  const layerStyle: CSSProperties = {
    transformOrigin: `${origin.originX * 100}% ${origin.originY * 100}%`,
    transform: zoom ? `scale(${zoom.scale})` : undefined,
    transition: `transform ${ZOOM_ANIM_MS}ms ease-out`,
  };
  if (pictureRect && pictureRect.width > 0 && pictureRect.height > 0) {
    layerStyle.left = pictureRect.x;
    layerStyle.top = pictureRect.y;
    layerStyle.width = pictureRect.width;
    layerStyle.height = pictureRect.height;
    layerStyle.right = 'auto';
    layerStyle.bottom = 'auto';
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the picture pauses, as on any video player; the Play/Pause button and the space bar do the same for keyboard users.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above, space is handled at page level.
    <div
      ref={stageRef}
      className={classes.stage}
      data-testid={T.videoStage}
      data-media-kind={kind === 'talkie' ? 'talkie' : undefined}
      data-playing={playing ? 'true' : undefined}
      data-zoomed={zoom ? 'true' : undefined}
      onClick={onClick}
    >
      <div className={classes.layer} style={layerStyle}>
        {kind === 'talkie' ? (
          // The engine adds two stacked canvases here and nothing else: no controls, no time.
          <div ref={surfaceRef} className={classes.surface} data-testid={T.video} />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: the video is the work under review; captions are not ours to add.
          <video
            ref={videoRef}
            className={classes.video}
            src={src}
            preload="auto"
            playsInline
            disablePictureInPicture
            draggable={false}
            data-testid={T.video}
          />
        )}
      </div>
      {children}
    </div>
  );
}
