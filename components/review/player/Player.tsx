'use client';

import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { EventLog } from '@/lib/capture/eventLog';
import { CommentRecorder } from '@/lib/capture/recorder';
import type { Uploader } from '@/lib/capture/uploader';
import { CHUNK_MS } from '@/lib/constants';
import { containRect } from '@/lib/geometry';
import type { ReviewAction, ReviewState } from '@/lib/review/machine';
import { T } from '@/lib/testids';
import type {
  CaptureEvent,
  CommentKind,
  CommentMeta,
  PlayerInfo,
  Rect,
  ZoomState,
} from '@/lib/types';
import { useHoldToZoom } from '../hooks/useHoldToZoom';
import { useKeyboard } from '../hooks/useKeyboard';
import {
  type CaptureEventInput,
  isOffPicture,
  usePointerCapture,
} from '../hooks/usePointerCapture';
import { EndScreen } from '../screens/EndScreen';
import { GeneralComment } from '../screens/GeneralComment';
import { Controls } from './Controls';
import { ListeningOverlay } from './ListeningOverlay';
import { MicLost } from './MicLost';
import classes from './player.module.css';
import { type SaveState, SaveStatus, TroubleBanner } from './SaveStatus';
import { VideoStage } from './VideoStage';

/** The part of the uploader the player needs. */
export type PlayerUploader = Pick<Uploader, 'enqueue' | 'complete'>;

export interface PlayerProps {
  token: string;
  /** Seconds per frame, for arrow-key stepping. */
  frameDuration: number;
  /** Machine state. The player shows the `player`, `end` and `general` screens. */
  state: ReviewState;
  dispatch: (action: ReviewAction) => void;
  /** The session's microphone. A new stream arrives here after a reconnect. */
  stream: MediaStream | null;
  uploader: PlayerUploader;
  /** True while uploads have been failing for a while. */
  trouble: boolean;
  /** A comment the server refused a chunk of: its recording is stopped. */
  refusedCommentId?: string | null;
  onReconnectMic: () => void;
  /** Called by Done, once every comment has been saved. */
  onDone: () => void | Promise<void>;
}

/** How long the Saved toast stays up. */
const SAVED_TOAST_MS = 1500;

interface OpenComment {
  cid: string;
  kind: CommentKind;
  log: EventLog;
  recorder: CommentRecorder | null;
  /** The stream the recorder was started on. */
  mic: MediaStream | null;
  meta: CommentMeta;
  /** performance.now() at t=0 of the event log. */
  startedAt: number;
  micLost: boolean;
  /** Chunks handed to the uploader so far. */
  sent: number;
  enqueues: Promise<void>[];
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID needs a secure context; this is the same version 4 layout without it.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function micIsLive(stream: MediaStream | null): stream is MediaStream {
  return stream?.getAudioTracks()[0]?.readyState === 'live';
}

const sameRect = (a: Rect | null, b: Rect) =>
  a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * The video, its controls and everything that happens while it is paused: each pause records
 * one comment (microphone plus pointer, click, zoom and seek events) and uploads it in chunks.
 * Nothing is recorded during playback.
 */
export function Player({
  token,
  frameDuration,
  state,
  dispatch,
  stream,
  uploader,
  trouble,
  refusedCommentId = null,
  onReconnectMic,
  onDone,
}: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [pictureRect, setPictureRect] = useState<Rect | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [saveFailed, setSaveFailed] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // What the event handlers read. Updated in the handlers themselves, not on render, so two
  // events in a row (a key press and the video's own pause event, say) see each other's effect.
  const playingRef = useRef(state.playing);
  const screenRef = useRef(state.screen);
  screenRef.current = state.screen;
  const zoomRef = useRef<ZoomState | null>(null);
  const lastOriginRef = useRef({ originX: 0.5, originY: 0.5 });
  const openRef = useRef<OpenComment | null>(null);
  const savesRef = useRef(new Set<Promise<void>>());
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const streamRef = useRef(stream);
  streamRef.current = stream;
  const uploaderRef = useRef(uploader);
  uploaderRef.current = uploader;
  const sessionRef = useRef({ sid: state.sessionId ?? '', version: state.version ?? 0 });
  sessionRef.current = { sid: state.sessionId ?? '', version: state.version ?? 0 };
  const micLostRef = useRef(state.micLost);
  micLostRef.current = state.micLost;

  // Layout

  const measure = useCallback((): PlayerInfo => {
    const box = stageRef.current?.getBoundingClientRect();
    const video = videoRef.current;
    const containerWidth = box?.width ?? 0;
    const containerHeight = box?.height ?? 0;
    const videoWidth = video?.videoWidth ?? 0;
    const videoHeight = video?.videoHeight ?? 0;
    const contentRect = containRect(containerWidth, containerHeight, videoWidth, videoHeight);
    setPictureRect((prev) => (sameRect(prev, contentRect) ? prev : contentRect));
    return {
      containerWidth,
      containerHeight,
      videoWidth,
      videoHeight,
      contentRect,
      fullscreen: document.fullscreenElement != null,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }, []);

  useEffect(() => {
    measure();
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    // The stage also changes size without a window resize, when the trouble banner appears.
    const observer = new ResizeObserver(() => measure());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [measure]);

  // Comments

  const push = useCallback((event: CaptureEventInput) => {
    openRef.current?.log.push(event);
  }, []);

  const sendChunk = useCallback(
    (o: OpenComment, audio: Blob, seq: number, events: CaptureEvent[]) => {
      const meta: CommentMeta | undefined =
        seq === 0 ? { ...o.meta, audioMime: o.recorder?.mimeType ?? '' } : undefined;
      o.sent = Math.max(o.sent, seq + 1);
      const queued = uploaderRef.current
        .enqueue({
          sid: o.meta.sessionId,
          cid: o.cid,
          seq,
          audio,
          events,
          ...(meta ? { meta } : {}),
        })
        .catch(() => {
          // The uploader reports its own failures; complete() will find the chunk missing.
        });
      o.enqueues.push(queued);
    },
    []
  );

  /** Starts recording the microphone into the comment. False if there is no live microphone. */
  const attachRecorder = useCallback(
    (o: OpenComment): boolean => {
      const mic = streamRef.current;
      if (!micIsLive(mic)) return false;
      try {
        const recorder = new CommentRecorder(mic, {
          timesliceMs: CHUNK_MS,
          onStart: () => {
            // t=0 for the events is the moment the audio starts.
            o.log.begin();
            o.startedAt = performance.now();
            o.meta.startedAt = new Date().toISOString();
          },
          onChunk: (blob, seq) => sendChunk(o, blob, seq, o.log.drain()),
        });
        recorder.start();
        o.recorder = recorder;
        o.mic = mic;
        return true;
      } catch {
        return false;
      }
    },
    [sendChunk]
  );

  const openComment = useCallback(
    (kind: CommentKind): string => {
      const cid = newId();
      const { sid, version } = sessionRef.current;
      const o: OpenComment = {
        cid,
        kind,
        log: new EventLog(),
        recorder: null,
        mic: null,
        startedAt: performance.now(),
        micLost: false,
        sent: 0,
        enqueues: [],
        meta: {
          commentId: cid,
          sessionId: sid,
          version,
          kind,
          pausedAtVideoTime: kind === 'moment' ? (videoRef.current?.currentTime ?? 0) : null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          durationMs: null,
          audioMime: '',
          totalChunks: null,
          player: measure(),
        },
      };
      if (!attachRecorder(o)) {
        // No microphone: the pointing is still worth keeping, and is flagged.
        o.micLost = true;
        o.log.begin();
        if (!micLostRef.current) dispatch({ type: 'micLost' });
      }
      openRef.current = o;
      return cid;
    },
    [attachRecorder, dispatch, measure]
  );

  const track = useCallback((saving: Promise<void>) => {
    const saves = savesRef.current;
    saves.add(saving);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSave('saving');
    const settle = (ok: boolean) => {
      saves.delete(saving);
      if (!mountedRef.current) return;
      setSaveFailed(!ok);
      if (saves.size > 0) return;
      if (!ok) {
        setSave('idle');
        return;
      }
      setSave('saved');
      savedTimerRef.current = setTimeout(() => setSave('idle'), SAVED_TOAST_MS);
    };
    saving.then(
      () => settle(true),
      () => settle(false)
    );
  }, []);

  /** Ends the open comment, if any. The promise settles when the server has all of it. */
  const closeComment = useCallback((): Promise<void> => {
    const o = openRef.current;
    if (!o) return Promise.resolve();

    const zoom = zoomRef.current;
    if (zoom) {
      o.log.push({ type: 'zoom', state: 'end', ...zoom });
      zoomRef.current = null;
    }
    openRef.current = null;

    const endedAt = new Date().toISOString();
    const durationMs = Math.max(0, Math.round(performance.now() - o.startedAt));
    const player = measure();
    const micLost = o.micLost || !micIsLive(streamRef.current);

    const saving = (async () => {
      let total = o.recorder ? await o.recorder.stop() : 0;
      total = Math.max(total, o.sent);
      // Events the last audio chunk did not carry, or a comment with no audio at all.
      const rest = o.log.drain();
      if (total === 0 || rest.length > 0) {
        const type = o.recorder?.mimeType || 'application/octet-stream';
        sendChunk(o, new Blob([], { type }), total, rest);
        total += 1;
      }
      await Promise.all(o.enqueues);
      await uploaderRef.current.complete(o.meta.sessionId, o.cid, {
        totalChunks: total,
        endedAt,
        durationMs,
        player,
        ...(micLost ? { micLost: true } : {}),
      });
    })();
    track(saving);
    return saving;
  }, [measure, sendChunk, track]);

  const closeRef = useRef(closeComment);
  closeRef.current = closeComment;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      // Leaving with a comment open: send what there is.
      void closeRef.current().catch(() => {});
    };
  }, []);

  // Closing or reloading the tab mid-comment: stop the recorder so the last audio is queued.
  // Whatever does not get sent now is in IndexedDB and goes on the next visit.
  useEffect(() => {
    const onPageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) void closeRef.current().catch(() => {});
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // The microphone went away while a comment was open: the flag stays on that comment, whatever
  // happens to the microphone afterwards.
  useEffect(() => {
    const o = openRef.current;
    if (o && state.micLost) o.micLost = true;
  }, [state.micLost]);

  // A microphone reconnected during a comment. With no audio yet, it starts recording into it.
  // Otherwise the comment's recorder died with the old stream and cannot be restarted: that
  // comment is closed, flagged, and a new one is opened on the new stream.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a new stream arrives.
  useEffect(() => {
    const o = openRef.current;
    if (!o || !micIsLive(stream)) return;
    if (o.recorder === null && o.sent === 0) {
      attachRecorder(o);
      return;
    }
    if (o.mic === stream) return;
    o.micLost = true;
    void closeRef.current().catch(() => {});
    dispatch({ type: 'commentRestarted', commentId: openComment(o.kind) });
  }, [stream, attachRecorder]);

  // The server refused part of this comment (too large, or too many requests): stop adding to it.
  useEffect(() => {
    const o = openRef.current;
    if (refusedCommentId && o?.cid === refusedCommentId) void o.recorder?.stop();
  }, [refusedCommentId]);

  // Play and pause

  const play = useCallback(
    (alreadyPlaying = false) => {
      const screen = screenRef.current;
      if (screen !== 'player' && screen !== 'end') return;
      if (playingRef.current) return;
      playingRef.current = true;
      void closeComment().catch(() => {});
      dispatch({ type: 'play' });
      const video = videoRef.current;
      if (!video || alreadyPlaying) return;
      Promise.resolve(video.play()).catch((err: unknown) => {
        // AbortError only means a pause arrived first. Anything else: playback did not start.
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
        if (playingRef.current && mountedRef.current) pauseRef.current();
      });
    },
    [closeComment, dispatch]
  );

  const pause = useCallback(() => {
    if (screenRef.current !== 'player' || !playingRef.current) return;
    playingRef.current = false;
    const video = videoRef.current;
    video?.pause();
    const commentId = openComment('moment');
    dispatch({ type: 'pause', commentId });
    if (video) setCurrentTime(video.currentTime);
  }, [dispatch, openComment]);
  const pauseRef = useRef(pause);
  pauseRef.current = pause;

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  const seekTo = useCallback(
    (to: number, via: 'scrollbar' | 'key') => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const from = video.currentTime;
      const target = Math.min(Math.max(to, 0), video.duration);
      if (target === from) return;
      video.currentTime = target;
      setCurrentTime(target);
      if (!playingRef.current) push({ type: 'seek', from, to: target, via });
      // Looking again after the end: back to the player, paused.
      if (screenRef.current === 'end') dispatch({ type: 'scrollBack' });
    },
    [dispatch, push]
  );

  const step = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (video) seekTo(video.currentTime + delta, 'key');
    },
    [seekTo]
  );

  useKeyboard({
    screen: state.screen,
    paused: !state.playing,
    frameDuration,
    onToggle: toggle,
    onStep: step,
  });

  // Zoom and pointer. The zoom hook is first so a pan is logged before the pointer position.

  useHoldToZoom({
    stageRef,
    videoRef,
    enabled: state.screen === 'player' && !state.playing,
    onStart: (zoom) => {
      zoomRef.current = zoom;
      lastOriginRef.current = { originX: zoom.originX, originY: zoom.originY };
      dispatch({ type: 'zoomStart', zoom });
      push({ type: 'zoom', state: 'start', ...zoom });
    },
    onPan: (originX, originY) => {
      if (!zoomRef.current) return;
      zoomRef.current = { ...zoomRef.current, originX, originY };
      lastOriginRef.current = { originX, originY };
      dispatch({ type: 'zoomPan', originX, originY });
      push({ type: 'zoomPan', originX, originY });
    },
    onEnd: (last) => {
      // closeComment() has already logged the end if play was pressed mid-zoom.
      if (zoomRef.current) push({ type: 'zoom', state: 'end', ...last });
      zoomRef.current = null;
      dispatch({ type: 'zoomEnd' });
    },
  });

  usePointerCapture({
    stageRef,
    videoRef,
    getZoom: () => zoomRef.current,
    push,
    measure,
  });

  // Video element events

  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    // Clicking the picture pauses. While paused it never resumes: clicks there are pointing.
    if (isOffPicture(e.target)) return;
    if (playingRef.current) pause();
  };

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    measure();
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (video) setCurrentTime(video.currentTime);
  };

  const onEnded = () => {
    // Scrolling to the very end while paused also fires this; only real playback ends the video.
    if (!playingRef.current) return;
    playingRef.current = false;
    void closeComment().catch(() => {});
    dispatch({ type: 'ended' });
  };

  // The video can be paused or played from outside the page (media keys, the system's controls).
  const onVideoPause = () => {
    if (playingRef.current && !videoRef.current?.ended) pause();
  };
  const onVideoPlay = () => {
    if (playingRef.current) return;
    if (screenRef.current === 'general' || finishing) videoRef.current?.pause();
    else play(true);
  };

  // Buttons

  const changeVolume = (v: number) => {
    setVolume(v);
    const video = videoRef.current;
    if (video) {
      video.volume = v;
      video.muted = v === 0;
    }
  };

  const toggleFullscreen = () => {
    try {
      const done = document.fullscreenElement
        ? document.exitFullscreen()
        : containerRef.current?.requestFullscreen();
      void Promise.resolve(done).catch(() => {});
    } catch {
      // Fullscreen is refused in some embeds; the player works the same without it.
    }
  };

  const shareMore = () => {
    if (screenRef.current !== 'end' || finishing) return;
    videoRef.current?.pause();
    dispatch({ type: 'shareMore', commentId: openComment('general') });
  };

  const generalFinished = () => {
    void closeComment().catch(() => {});
    dispatch({ type: 'generalFinished' });
  };

  const done = async () => {
    if (finishing) return;
    setFinishing(true);
    playingRef.current = false;
    videoRef.current?.pause();
    void closeComment().catch(() => {});
    // Thanks says it has all come through, so wait until it has.
    await Promise.allSettled([...savesRef.current]);
    try {
      await onDone();
    } finally {
      if (mountedRef.current) setFinishing(false);
    }
  };

  const listening = state.screen === 'player' && !state.playing && state.commentId !== null;
  const { version } = sessionRef.current;

  return (
    <div ref={containerRef} className={classes.player} data-testid={T.player}>
      <VideoStage
        stageRef={stageRef}
        videoRef={videoRef}
        src={`/api/r/${encodeURIComponent(token)}/video?version=${version}`}
        playing={state.playing}
        zoom={state.zoom}
        lastOrigin={lastOriginRef.current}
        pictureRect={pictureRect}
        onClick={onStageClick}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onPlay={onVideoPlay}
        onPause={onVideoPause}
      >
        {listening &&
          (state.micLost ? (
            <MicLost onReconnect={onReconnectMic} />
          ) : (
            <ListeningOverlay stream={stream} />
          ))}
        {state.screen === 'end' && (
          <EndScreen onShareMore={shareMore} onDone={done} finishing={finishing} />
        )}
        <SaveStatus state={save} />
      </VideoStage>
      {(trouble || saveFailed) && <TroubleBanner />}
      <Controls
        currentTime={currentTime}
        duration={duration}
        playing={state.playing}
        volume={volume}
        showDone={state.screen !== 'end'}
        finishing={finishing}
        onPlayPause={toggle}
        onSeek={(time) => seekTo(time, 'scrollbar')}
        onVolume={changeVolume}
        onFullscreen={toggleFullscreen}
        onDone={done}
      />
      {state.screen === 'general' && (
        <GeneralComment
          stream={stream}
          micLost={state.micLost}
          onReconnect={onReconnectMic}
          onFinished={generalFinished}
        />
      )}
    </div>
  );
}
