'use client';

import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { EventLog } from '@/lib/capture/eventLog';
import { CommentRecorder } from '@/lib/capture/recorder';
import type { Uploader } from '@/lib/capture/uploader';
import { CHUNK_MS, KEY_STEP_COLLAPSE_MS } from '@/lib/constants';
import { containRect } from '@/lib/geometry';
import type { ReviewAction, ReviewState } from '@/lib/review/machine';
import { T } from '@/lib/testids';
import type {
  CaptureEvent,
  CommentKind,
  CommentMeta,
  MediaKind,
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
import { CaptionPlate } from '../media/CaptionPlate';
import { filmFolderUrl } from '../media/filmUrl';
import type { PlayerAdapter, SceneWarningDetail } from '../media/playerAdapter';
import { VideoAdapter } from '../media/VideoAdapter';
import { EndScreen } from '../screens/EndScreen';
import { GeneralComment } from '../screens/GeneralComment';
import { Controls } from './Controls';
import { CommentStopped, ListeningOverlay, VideoError, VideoLoading } from './ListeningOverlay';
import { MicLost } from './MicLost';
import classes from './player.module.css';
import { type SaveState, SaveStatus, TroubleBanner } from './SaveStatus';
import { VideoStage } from './VideoStage';

/** The part of the uploader the player needs. */
export type PlayerUploader = Pick<Uploader, 'enqueue' | 'complete'>;

/** A Talkie adapter that has been mounted but has not opened its film yet. */
export type TalkiePlayerAdapter = PlayerAdapter & { load(): Promise<void> };

/** Mounts a Talkie engine in `container` for the film folder at `filmUrl`. */
export type MountTalkie = (container: HTMLElement, filmUrl: string) => Promise<TalkiePlayerAdapter>;

export interface PlayerProps {
  token: string;
  /** Seconds per frame of an mp4, for arrow-key stepping. A film reads its own, scene by scene. */
  frameDuration: number;
  /** What this version is. Versions from before Talkie support are mp4. */
  mediaKind?: MediaKind;
  /** Test seam. Defaults to the real engine, which is only ever loaded in the browser. */
  mountTalkie?: MountTalkie;
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
  /** True while the browser is being asked for the microphone again. */
  reconnecting?: boolean;
  /** True after a reconnect that did not get a microphone. */
  reconnectFailed?: boolean;
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
  /** True once the event log has its t=0. Events pushed before that are thrown away. */
  begun: boolean;
  micLost: boolean;
  /** Chunks handed to the uploader so far. */
  sent: number;
  /**
   * Set on a comment opened by scrolling back from the end screen, while that drag is still
   * going: performance.now() of its last tick. Until the drag settles, each tick moves the
   * frame the comment is about instead of being logged as a seek within it.
   */
  landing: number | null;
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

/** The adapter events the player acts on. */
const ADAPTER_EVENTS = [
  'loadedmetadata',
  'timeupdate',
  'seeked',
  'ended',
  'play',
  'pause',
  'error',
  'buffering',
  'scenewarning',
] as const;
type AdapterHandlers = Record<(typeof ADAPTER_EVENTS)[number], (e: Event) => void>;

/**
 * The video, its controls and everything that happens while it is paused: each pause records
 * one comment (microphone plus pointer, click, zoom and seek events) and uploads it in chunks.
 * Nothing is recorded during playback.
 */
export function Player({
  token,
  frameDuration,
  mediaKind = 'mp4',
  mountTalkie,
  state,
  dispatch,
  stream,
  uploader,
  trouble,
  refusedCommentId = null,
  onReconnectMic,
  reconnecting = false,
  reconnectFailed = false,
  onDone,
}: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  // The media, whichever kind it is. Everything below talks to this and never to the element.
  const adapterRef = useRef<PlayerAdapter | null>(null);
  // The film's adapter again, as state, for the caption plate to follow.
  const [film, setFilm] = useState<PlayerAdapter | null>(null);
  const [captionsOn, setCaptionsOn] = useState(true);
  const frameDurationRef = useRef(frameDuration);
  frameDurationRef.current = frameDuration;
  const mountTalkieRef = useRef(mountTalkie);
  mountTalkieRef.current = mountTalkie;
  const volumeRef = useRef(1);
  // Scenes that failed to load and have not been logged in a comment yet.
  const sceneWarningsRef = useRef<string[]>([]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [pictureRect, setPictureRect] = useState<Rect | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [saveFailed, setSaveFailed] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(finishing);
  finishingRef.current = finishing;
  const [videoError, setVideoError] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(true);

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
  const { version } = sessionRef.current;
  const micLostRef = useRef(state.micLost);
  micLostRef.current = state.micLost;

  // Layout

  const measure = useCallback((): PlayerInfo => {
    const box = stageRef.current?.getBoundingClientRect();
    const size = adapterRef.current?.naturalSize;
    const containerWidth = box?.width ?? 0;
    const containerHeight = box?.height ?? 0;
    const videoWidth = size?.width ?? 0;
    const videoHeight = size?.height ?? 0;
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

  /** Logs the scenes that failed to load, once the comment's event log has its t=0. */
  const flushSceneWarnings = useCallback((o: OpenComment) => {
    if (!o.begun) return;
    for (const sceneId of sceneWarningsRef.current.splice(0)) {
      o.log.push({ type: 'sceneWarning', sceneId });
    }
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
            o.begun = true;
            o.startedAt = performance.now();
            o.meta.startedAt = new Date().toISOString();
            flushSceneWarnings(o);
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
    [flushSceneWarnings, sendChunk]
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
        begun: false,
        micLost: false,
        sent: 0,
        landing: null,
        enqueues: [],
        meta: {
          commentId: cid,
          sessionId: sid,
          version,
          kind,
          pausedAtVideoTime: kind === 'moment' ? (adapterRef.current?.currentTime ?? 0) : null,
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
        o.begun = true;
        flushSceneWarnings(o);
        if (!micLostRef.current) dispatch({ type: 'micLost' });
      }
      openRef.current = o;
      return cid;
    },
    [attachRecorder, dispatch, flushSceneWarnings, measure]
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

  /** Playback could not start or carry on: back to paused, with no comment opened. */
  const failPlayback = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    adapterRef.current?.pause();
    dispatch({ type: 'playFailed' });
  }, [dispatch]);

  const play = useCallback(
    (alreadyPlaying = false) => {
      const screen = screenRef.current;
      if (screen !== 'player' && screen !== 'end') return;
      if (playingRef.current) return;
      playingRef.current = true;
      void closeComment().catch(() => {});
      dispatch({ type: 'play' });
      const adapter = adapterRef.current;
      if (!adapter || alreadyPlaying) return;
      adapter.play().catch((err: unknown) => {
        // AbortError only means a pause arrived first. Anything else: playback did not start,
        // so there is nothing to pause on and nothing to comment on.
        const name = (err as { name?: string } | null)?.name;
        if (name === 'AbortError' || !mountedRef.current) return;
        if (adapter.failed || name === 'NotSupportedError') setVideoError(true);
        failPlayback();
      });
    },
    [closeComment, dispatch, failPlayback]
  );

  const pause = useCallback(() => {
    if (screenRef.current !== 'player' || !playingRef.current) return;
    playingRef.current = false;
    const adapter = adapterRef.current;
    adapter?.pause();
    const commentId = openComment('moment');
    dispatch({ type: 'pause', commentId });
    if (adapter) setCurrentTime(adapter.currentTime);
  }, [dispatch, openComment]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  const seekTo = useCallback(
    (to: number, via: 'scrollbar' | 'key') => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      const length = adapter.duration;
      if (!Number.isFinite(length) || length <= 0) return;
      if (finishingRef.current) return;
      const from = adapter.currentTime;
      const target = Math.min(Math.max(to, 0), length);
      if (target === from) return;
      adapter.currentTime = target;
      setCurrentTime(target);
      const now = performance.now();

      // Looking again after the end: back to the player, paused. Paused means listening, so
      // this opens a comment on the frame they land on, exactly as pausing there would.
      if (screenRef.current === 'end') {
        screenRef.current = 'player';
        const commentId = openComment('moment');
        if (openRef.current && via === 'scrollbar') openRef.current.landing = now;
        dispatch({ type: 'scrollBack', commentId });
        return;
      }
      if (playingRef.current) return;

      const o = openRef.current;
      if (o && o.landing !== null) {
        const settling =
          via === 'scrollbar' && o.sent === 0 && now - o.landing <= KEY_STEP_COLLAPSE_MS;
        if (settling) {
          o.meta.pausedAtVideoTime = target;
          o.landing = now;
          return;
        }
        o.landing = null;
      }
      push({ type: 'seek', from, to: target, via });
    },
    [dispatch, openComment, push]
  );

  const step = useCallback(
    (delta: number) => {
      const adapter = adapterRef.current;
      if (adapter) seekTo(adapter.currentTime + delta, 'key');
    },
    [seekTo]
  );

  /** One frame forwards or back. The adapter says where that is: a film's scenes differ. */
  const stepFrame = useCallback(
    (direction: 1 | -1) => {
      const adapter = adapterRef.current;
      if (adapter) seekTo(adapter.stepFrame(direction), 'key');
    },
    [seekTo]
  );

  useKeyboard({
    screen: state.screen,
    paused: !state.playing,
    onToggle: toggle,
    onStep: step,
    onFrameStep: stepFrame,
  });

  // Zoom and pointer. The zoom hook is first so a pan is logged before the pointer position.

  useHoldToZoom({
    stageRef,
    adapterRef,
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
    adapterRef,
    getZoom: () => zoomRef.current,
    push,
    measure,
  });

  // Media events, from the adapter

  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    // Clicking the picture pauses. While paused it never resumes: clicks there are pointing.
    if (isOffPicture(e.target)) return;
    if (playingRef.current) pause();
  };

  const onLoadedMetadata = () => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    setDuration(Number.isFinite(adapter.duration) ? adapter.duration : 0);
    measure();
  };

  const onTimeUpdate = () => {
    const adapter = adapterRef.current;
    if (adapter) setCurrentTime(adapter.currentTime);
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
    if (playingRef.current && !adapterRef.current?.ended) pause();
  };
  const onVideoPlay = () => {
    if (playingRef.current) return;
    if (screenRef.current === 'general' || finishing) adapterRef.current?.pause();
    else play(true);
  };

  const onVideoError = () => {
    setVideoError(true);
    setBuffering(false);
    failPlayback();
  };

  const onBuffering = (waiting: boolean) => {
    setBuffering(waiting);
    // Data arriving again means whatever went wrong has passed.
    if (!waiting) setVideoError(false);
  };

  // A scene of a film could not be loaded. The reviewer carries on; the comment says so.
  const onSceneWarning = (sceneId: string) => {
    const pending = sceneWarningsRef.current;
    if (!pending.includes(sceneId)) pending.push(sceneId);
    if (openRef.current) flushSceneWarnings(openRef.current);
  };

  const handlersRef = useRef<AdapterHandlers | null>(null);
  handlersRef.current = {
    loadedmetadata: onLoadedMetadata,
    timeupdate: onTimeUpdate,
    seeked: onTimeUpdate,
    ended: onEnded,
    play: onVideoPlay,
    pause: onVideoPause,
    error: onVideoError,
    buffering: (e) => onBuffering((e as CustomEvent<boolean>).detail),
    scenewarning: (e) => onSceneWarning((e as CustomEvent<SceneWarningDetail>).detail.sceneId),
  };

  /** Starts listening to the media. The handlers called are always this render's. */
  const listenTo = useCallback((adapter: PlayerAdapter): (() => void) => {
    const listener = (e: Event) => handlersRef.current?.[e.type as keyof AdapterHandlers]?.(e);
    for (const type of ADAPTER_EVENTS) adapter.addEventListener(type, listener);
    return () => {
      for (const type of ADAPTER_EVENTS) adapter.removeEventListener(type, listener);
    };
  }, []);

  // An mp4: wrap the <video> element the stage rendered.
  useEffect(() => {
    const video = videoRef.current;
    if (mediaKind !== 'mp4' || !video) return;
    const adapter = new VideoAdapter(video, () => frameDurationRef.current);
    adapterRef.current = adapter;
    const stop = listenTo(adapter);
    return () => {
      stop();
      adapter.destroy();
      if (adapterRef.current === adapter) adapterRef.current = null;
    };
  }, [mediaKind, listenTo]);

  // A film: mount a Talkie engine in the stage. The engine is only ever imported here, in the
  // browser, and only for a film, so it is never loaded on the server or for an mp4.
  const filmUrl = mediaKind === 'talkie' ? filmFolderUrl(token, version) : null;
  useEffect(() => {
    const surface = surfaceRef.current;
    if (filmUrl === null || !surface) return;
    let cancelled = false;
    let mounted: PlayerAdapter | null = null;
    let stop = () => {};
    setBuffering(true);
    void (async () => {
      const mount =
        mountTalkieRef.current ?? (await import('../media/TalkieAdapter')).mountTalkieAdapter;
      const adapter = await mount(surface, filmUrl);
      if (cancelled) {
        adapter.destroy();
        return;
      }
      mounted = adapter;
      adapterRef.current = adapter;
      adapter.setVolume(volumeRef.current);
      stop = listenTo(adapter);
      setFilm(adapter);
      await adapter.load();
    })().catch(() => {
      if (cancelled) return;
      setVideoError(true);
      setBuffering(false);
    });
    return () => {
      cancelled = true;
      stop();
      mounted?.destroy();
      if (adapterRef.current === mounted) adapterRef.current = null;
      setFilm(null);
    };
  }, [filmUrl, listenTo]);

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement != null);
    update();
    // Where the browser (or an embedding page) rules fullscreen out, the button would be dead.
    setCanFullscreen(document.fullscreenEnabled !== false);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  // Buttons

  const changeVolume = (v: number) => {
    setVolume(v);
    volumeRef.current = v;
    adapterRef.current?.setVolume(v);
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
    adapterRef.current?.pause();
    dispatch({ type: 'shareMore', commentId: openComment('general') });
  };

  const generalFinished = () => {
    void closeComment().catch(() => {});
    dispatch({ type: 'generalFinished' });
  };

  const done = async () => {
    // During a general comment the only way on is its own Finished button.
    if (finishing || screenRef.current === 'general') return;
    setFinishing(true);
    playingRef.current = false;
    adapterRef.current?.pause();
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
  // The server refused part of the open comment: it is no longer being recorded.
  const stopped = refusedCommentId !== null && state.commentId === refusedCommentId;
  const general = state.screen === 'general';
  const mic = { onReconnect: onReconnectMic, reconnecting, reconnectFailed };

  return (
    <div ref={containerRef} className={classes.player} data-testid={T.player}>
      {/* Under a general comment nothing here may be focused or pressed. */}
      <div className={classes.body} inert={general}>
        <VideoStage
          stageRef={stageRef}
          kind={mediaKind}
          videoRef={videoRef}
          surfaceRef={surfaceRef}
          src={
            mediaKind === 'mp4'
              ? `/api/r/${encodeURIComponent(token)}/video?version=${version}`
              : undefined
          }
          playing={state.playing}
          zoom={state.zoom}
          lastOrigin={lastOriginRef.current}
          pictureRect={pictureRect}
          onClick={onStageClick}
        >
          <CaptionPlate adapter={film} rect={pictureRect} on={captionsOn} />
          {listening &&
            (stopped ? (
              <CommentStopped />
            ) : state.micLost ? (
              <MicLost {...mic} />
            ) : (
              <ListeningOverlay stream={stream} />
            ))}
          {buffering && !videoError && <VideoLoading />}
          {videoError && <VideoError onReload={() => window.location.reload()} />}
          {state.screen === 'end' && (
            <EndScreen onShareMore={shareMore} onDone={done} finishing={finishing} />
          )}
          <SaveStatus state={save} />
        </VideoStage>
        {(trouble || saveFailed || stopped) && <TroubleBanner />}
        <Controls
          currentTime={currentTime}
          duration={duration}
          playing={state.playing}
          volume={volume}
          showDone={state.screen !== 'end'}
          finishing={finishing}
          fullscreen={isFullscreen}
          canFullscreen={canFullscreen}
          captions={mediaKind === 'talkie' ? captionsOn : undefined}
          onCaptions={() => setCaptionsOn((on) => !on)}
          onPlayPause={toggle}
          onSeek={(time) => seekTo(time, 'scrollbar')}
          onVolume={changeVolume}
          onFullscreen={toggleFullscreen}
          onDone={done}
        />
      </div>
      {general && (
        <GeneralComment
          stream={stream}
          micLost={state.micLost}
          stopped={stopped}
          onFinished={generalFinished}
          {...mic}
        />
      )}
    </div>
  );
}
