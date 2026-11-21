'use client';

import { ActionIcon, Button, Slider } from '@mantine/core';
import {
  IconMaximize,
  IconMinimize,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react';
import { moreCopy } from '@/lib/review/additions';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import classes from './player.module.css';

/**
 * The scroll bar works in these units, not seconds, so no time ever reaches the page: not in
 * text, a tooltip or an ARIA value.
 */
export const SCROLL_STEPS = 10_000;

export interface ControlsProps {
  currentTime: number;
  duration: number;
  playing: boolean;
  /** 0..1 */
  volume: number;
  /** False while the end screen shows its own Done button. */
  showDone?: boolean;
  /** True while Done is waiting for the last comment to be saved. */
  finishing?: boolean;
  /** True while the player fills the screen: the button then leaves full screen. */
  fullscreen?: boolean;
  /** False where the browser cannot go full screen at all: the button is not shown. */
  canFullscreen?: boolean;
  onPlayPause: () => void;
  /** New position in seconds. */
  onSeek: (time: number) => void;
  onVolume: (volume: number) => void;
  onFullscreen: () => void;
  onDone: () => void;
}

/** The bar under the picture. It never overlays the picture and never shows a time. */
export function Controls({
  currentTime,
  duration,
  playing,
  volume,
  showDone = true,
  finishing = false,
  fullscreen = false,
  canFullscreen = true,
  onPlayPause,
  onSeek,
  onVolume,
  onFullscreen,
  onDone,
}: ControlsProps) {
  const known = Number.isFinite(duration) && duration > 0;
  const position = known
    ? Math.round((Math.min(Math.max(currentTime, 0), duration) / duration) * SCROLL_STEPS)
    : 0;

  return (
    <div className={classes.controls}>
      <div className={classes.controlRow}>
        <ActionIcon
          size="xl"
          radius="xl"
          variant="filled"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={onPlayPause}
          data-testid={T.playPause}
        >
          {playing ? <IconPlayerPauseFilled size={22} /> : <IconPlayerPlayFilled size={22} />}
        </ActionIcon>
        <Slider
          className={classes.scroll}
          min={0}
          max={SCROLL_STEPS}
          step={1}
          value={position}
          onChange={(v) => {
            if (known) onSeek((v / SCROLL_STEPS) * duration);
          }}
          label={null}
          thumbLabel="Scroll through the video"
          thumbValueText="Position in video"
          size="lg"
          thumbSize={20}
          data-testid={T.scrollBar}
        />
        <div className={classes.volume}>
          {volume === 0 ? (
            <IconVolumeOff size={20} aria-hidden="true" />
          ) : (
            <IconVolume size={20} aria-hidden="true" />
          )}
          <Slider
            className={classes.volumeSlider}
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(v) => onVolume(v / 100)}
            label={null}
            thumbLabel="Volume"
            color="gray"
            size="sm"
            data-testid={T.volume}
          />
        </div>
        {canFullscreen && (
          <ActionIcon
            size="lg"
            variant="subtle"
            color="gray.3"
            aria-label={fullscreen ? moreCopy.player.exitFullscreen : moreCopy.player.fullscreen}
            onClick={onFullscreen}
            data-testid={T.fullscreen}
          >
            {fullscreen ? <IconMinimize size={20} /> : <IconMaximize size={20} />}
          </ActionIcon>
        )}
      </div>
      <div className={classes.footRow}>
        <span className={classes.hint} data-testid={T.playHint}>
          {copy.player.hint}
        </span>
        {showDone && (
          <Button
            variant="white"
            color="dark"
            loading={finishing}
            onClick={onDone}
            data-testid={T.doneButton}
          >
            {copy.player.done}
          </Button>
        )}
      </div>
    </div>
  );
}
