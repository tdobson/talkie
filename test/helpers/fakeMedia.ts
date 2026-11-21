import { vi } from 'vitest';

/** Stand-in for the browser MediaRecorder: a chunk per timeslice and a tail chunk on stop. */
export class FakeMediaRecorder extends EventTarget {
  static supported = ['audio/webm;codecs=opus'];
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(m: string) {
    return FakeMediaRecorder.supported.includes(m);
  }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  stream: MediaStream;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    super();
    this.stream = stream;
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }
  private emit(text: string) {
    const ev = new Event('dataavailable') as Event & { data: Blob };
    ev.data = new Blob([text], { type: this.mimeType });
    this.dispatchEvent(ev);
  }
  start(timeslice?: number) {
    this.state = 'recording';
    setTimeout(() => this.dispatchEvent(new Event('start')), 0);
    this.timer = setInterval(() => this.emit('chunk'), timeslice ?? 1000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.state = 'inactive';
    setTimeout(() => {
      this.emit('tail');
      this.dispatchEvent(new Event('stop'));
    }, 0);
  }
}

export interface FakeTrack extends EventTarget {
  readyState: 'live' | 'ended';
  stop: () => void;
}

/** A MediaStream with one audio track whose state the test can change. */
export function fakeStream(readyState: 'live' | 'ended' = 'live'): {
  stream: MediaStream;
  track: FakeTrack;
} {
  const track = Object.assign(new EventTarget(), { readyState, stop: vi.fn() }) as FakeTrack;
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

/** jsdom has no media playback: makes play() and pause() spies on every media element. */
export function stubMediaPlayback(): {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
} {
  const play = vi.fn().mockResolvedValue(undefined);
  const pause = vi.fn();
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  return { play, pause };
}
