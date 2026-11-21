'use client';

import { Transition } from '@mantine/core';
import { type ReactNode, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Uploader, type UploaderOptions } from '@/lib/capture/uploader';
import { initialState, reducer } from '@/lib/review/machine';
import { useSession } from './hooks/useSession';
import { Player, type PlayerUploader } from './player/Player';
import classes from './review.module.css';
import { MicCheck } from './screens/MicCheck';
import { MicDenied } from './screens/MicDenied';
import { MicExplain } from './screens/MicExplain';
import { MobileBlock } from './screens/MobileBlock';
import { Thanks } from './screens/Thanks';
import { Welcome } from './screens/Welcome';

/** The part of the uploader the reviewer page uses. */
export type ReviewUploader = PlayerUploader & Pick<Uploader, 'resumePending' | 'dispose'>;

export interface ReviewAppProps {
  token: string;
  title: string;
  /** Version a new session will be given. A resumed session keeps the one it started on. */
  latestVersion: number;
  /** Seconds per frame of the video, for frame stepping. */
  frameDuration: number;
  /** Seconds per frame of each version, for a session resumed on an older one. */
  frameDurations?: Record<number, number>;
  /** Test seam. Defaults to the real IndexedDB-backed uploader. */
  createUploader?: (options: UploaderOptions) => ReviewUploader;
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true },
};
const FADE_MS = 150;

/** A phone or tablet: the main pointer is a finger and no mouse or trackpad is attached. */
function isTouchOnly(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return (
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(any-pointer: fine)').matches
  );
}

function stopTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Fades a screen in when it appears. */
function Fade({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  return (
    <Transition mounted={shown} transition="fade" duration={FADE_MS} timingFunction="ease">
      {(styles) => <div style={styles}>{children}</div>}
    </Transition>
  );
}

/**
 * The whole reviewer page. Owns the screen machine, the microphone stream, the upload queue
 * and the session; the screens and the player below it are told what to show.
 */
export function ReviewApp({
  token,
  title,
  latestVersion,
  frameDuration,
  frameDurations,
  createUploader,
}: ReviewAppProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);
  const [uploader, setUploader] = useState<ReviewUploader | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [trouble, setTrouble] = useState(false);
  const [refusedCommentId, setRefusedCommentId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [noDevice, setNoDevice] = useState(false);
  const session = useSession(token);

  const createUploaderRef = useRef(createUploader);
  createUploaderRef.current = createUploader;
  const streamRef = useRef<MediaStream | null>(null);

  // On arrival: turn phones away, send anything an earlier visit left behind, and pick up
  // the session this browser already has for this link.
  useEffect(() => {
    let cancelled = false;
    const options: UploaderOptions = {
      token,
      onTrouble: setTrouble,
      onRejected: (chunk) => setRefusedCommentId(chunk.cid),
    };
    const up = createUploaderRef.current?.(options) ?? new Uploader(options);
    setUploader(up);

    if (isTouchOnly()) {
      dispatch({ type: 'detectedMobile' });
      setReady(true);
    } else {
      void up.resumePending().catch(() => {});
      void session.resume().then((found) => {
        if (cancelled) return;
        if (found) {
          dispatch({
            type: 'loadedResumable',
            sessionId: found.sessionId,
            version: found.version,
            name: found.reviewerName,
          });
        }
        setReady(true);
      });
    }
    return () => {
      cancelled = true;
      up.dispose();
    };
  }, [token, session]);

  // Microphone

  const requestMic = useCallback(async (): Promise<void> => {
    setAsking(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      stopTracks(streamRef.current);
      streamRef.current = next;
      setStream(next);
    } finally {
      setAsking(false);
    }
  }, []);

  const askForMic = async () => {
    try {
      await requestMic();
      setNoDevice(false);
      dispatch({ type: 'micGranted' });
    } catch (err) {
      // Refused, or no microphone at all: either way the reviewer cannot go on without one,
      // but what they need to do about it differs.
      const name = (err as { name?: string } | null)?.name;
      setNoDevice(name === 'NotFoundError' || name === 'OverconstrainedError');
      dispatch({ type: 'micDenied' });
    }
  };

  const reconnectMic = async () => {
    setReconnectFailed(false);
    try {
      await requestMic();
      dispatch({ type: 'micReconnected' });
    } catch {
      // Still no microphone: the Reconnect button stays, and says why nothing changed.
      setReconnectFailed(true);
    }
  };

  const onMicCheck = state.screen === 'micCheck';

  // The stream stays open for the whole session. If its track ends (unplugged, permission
  // withdrawn), the next pause offers to reconnect.
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    // On the mic check there is no Reconnect button to offer: without this the meter would
    // sit flat and Start watching would stay disabled with no way on.
    const onEnded = () => dispatch({ type: onMicCheck ? 'micDenied' : 'micLost' });
    track.addEventListener('ended', onEnded);
    return () => track.removeEventListener('ended', onEnded);
  }, [stream, onMicCheck]);

  // Let go of the microphone when the review is over, and when the page goes away.
  useEffect(() => {
    if (state.screen !== 'thanks') return;
    stopTracks(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, [state.screen]);
  useEffect(() => () => stopTracks(streamRef.current), []);

  // Session

  const startWatching = async () => {
    if (starting) return;
    if (state.sessionId !== null && state.version !== null) {
      dispatch({ type: 'sessionStarted', sessionId: state.sessionId, version: state.version });
      return;
    }
    setStarting(true);
    setStartFailed(false);
    try {
      const created = await session.start(state.name);
      dispatch({
        type: 'sessionStarted',
        sessionId: created.sessionId,
        version: created.version ?? latestVersion,
      });
    } catch {
      // Could not reach the server: the button comes back so the reviewer can try again.
      setStartFailed(true);
    } finally {
      setStarting(false);
    }
  };

  const finish = async () => {
    if (state.sessionId !== null) await session.finish(state.sessionId);
    dispatch({ type: 'done' });
  };

  if (!ready || uploader === null) return <div className={classes.page} />;

  switch (state.screen) {
    case 'mobile':
      return (
        <Fade key="mobile">
          <MobileBlock />
        </Fade>
      );
    case 'welcome':
      return (
        <Fade key="welcome">
          <Welcome title={title} onSubmit={(name) => dispatch({ type: 'submitName', name })} />
        </Fade>
      );
    case 'micExplain':
      return (
        <Fade key="micExplain">
          <MicExplain
            waiting={asking}
            onContinue={() => {
              dispatch({ type: 'micExplained' });
              void askForMic();
            }}
          />
        </Fade>
      );
    case 'micDenied':
      return (
        <Fade key="micDenied">
          <MicDenied
            noDevice={noDevice}
            onRetry={() => {
              dispatch({ type: 'micRetry' });
              void askForMic();
            }}
          />
        </Fade>
      );
    case 'micCheck':
      return (
        <Fade key="micCheck">
          <MicCheck
            stream={stream}
            starting={starting}
            startFailed={startFailed}
            onHeard={() => dispatch({ type: 'micHeard' })}
            onStart={() => void startWatching()}
          />
        </Fade>
      );
    case 'thanks':
      return (
        <Fade key="thanks">
          <Thanks name={state.name} />
        </Fade>
      );
    default:
      // player, end and general are all the player: it must not remount between them.
      return (
        <Fade key="player">
          <Player
            token={token}
            frameDuration={frameDurations?.[state.version ?? latestVersion] ?? frameDuration}
            state={state}
            dispatch={dispatch}
            stream={stream}
            uploader={uploader}
            trouble={trouble}
            refusedCommentId={refusedCommentId}
            onReconnectMic={() => void reconnectMic()}
            reconnecting={asking}
            reconnectFailed={reconnectFailed}
            onDone={finish}
          />
        </Fade>
      );
  }
}
