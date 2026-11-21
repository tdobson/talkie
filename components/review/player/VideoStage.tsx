'use client';

import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react';
import { ZOOM_ANIM_MS } from '@/lib/constants';
import { T } from '@/lib/testids';
import type { Rect, ZoomState } from '@/lib/types';
import classes from './player.module.css';

export interface VideoStageProps {
  stageRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  playing: boolean;
  zoom: ZoomState | null;
  /** Where the zoom last was, so zooming out shrinks back around the same point. */
  lastOrigin: { originX: number; originY: number };
  /** The letterboxed picture rectangle inside the stage, once the video size is known. */
  pictureRect: Rect | null;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
  onPlay: () => void;
  onPause: () => void;
  /** Overlays. They sit above the picture and are not zoomed with it. */
  children?: ReactNode;
}

/**
 * The dark stage and the picture in it. Pointer coordinates are measured against the stage.
 * The picture layer is sized to the letterboxed picture, so a zoom origin given as a fraction
 * of the picture can be used directly as the CSS transform origin.
 */
export function VideoStage({
  stageRef,
  videoRef,
  src,
  playing,
  zoom,
  lastOrigin,
  pictureRect,
  onClick,
  onLoadedMetadata,
  onTimeUpdate,
  onEnded,
  onPlay,
  onPause,
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
      data-playing={playing ? 'true' : undefined}
      data-zoomed={zoom ? 'true' : undefined}
      onClick={onClick}
    >
      <div className={classes.layer} style={layerStyle}>
        {/* biome-ignore lint/a11y/useMediaCaption: the video is the work under review; captions are not ours to add. */}
        <video
          ref={videoRef}
          className={classes.video}
          src={src}
          preload="auto"
          playsInline
          disablePictureInPicture
          draggable={false}
          data-testid={T.video}
          onLoadedMetadata={onLoadedMetadata}
          onDurationChange={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onSeeked={onTimeUpdate}
          onEnded={onEnded}
          onPlay={onPlay}
          onPause={onPause}
        />
      </div>
      {children}
    </div>
  );
}
