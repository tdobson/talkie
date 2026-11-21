import { CommentRecorder, pickMime } from './recorder';

class FakeMediaRecorder extends EventTarget {
  static supported = ['audio/webm;codecs=opus'];
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(m: string) {
    return FakeMediaRecorder.supported.includes(m);
  }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  timeslice: number | undefined;
  finalData = 'tail';
  stream: MediaStream;
  options: { mimeType?: string } | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    super();
    this.stream = stream;
    this.options = options;
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }
  private emit(text: string) {
    const ev = new Event('dataavailable') as Event & { data: Blob };
    ev.data = new Blob([text], { type: this.mimeType });
    this.dispatchEvent(ev);
  }
  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
    setTimeout(() => this.dispatchEvent(new Event('start')), 0);
    this.timer = setInterval(() => this.emit('chunk'), timeslice ?? 1000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.state = 'inactive';
    setTimeout(() => {
      this.emit(this.finalData);
      this.dispatchEvent(new Event('stop'));
    }, 0);
  }
}

const stream = {} as MediaStream;

describe('pickMime', () => {
  it('pickMime prefers opus webm then mp4', () => {
    expect(pickMime((m) => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickMime((m) => m === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMime(() => false)).toBe('');
  });
});

describe('CommentRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supported = ['audio/webm;codecs=opus'];
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emits numbered chunks on the timeslice and resolves stop() with the total', async () => {
    const chunks: Array<[number, number]> = [];
    const onStart = vi.fn();
    const rec = new CommentRecorder(stream, {
      timesliceMs: 2000,
      onChunk: (blob, seq) => chunks.push([seq, blob.size]),
      onStart,
    });
    expect(rec.mimeType).toBe('audio/webm;codecs=opus');
    rec.start();
    expect(FakeMediaRecorder.instances[0].timeslice).toBe(2000);
    expect(onStart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4100);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([
      [0, 5],
      [1, 5],
    ]);
    const stopped = rec.stop();
    await vi.advanceTimersByTimeAsync(1);
    expect(await stopped).toBe(3);
    expect(chunks[2]).toEqual([2, 4]);
  });

  it('does not number an empty final blob', async () => {
    const onChunk = vi.fn();
    const rec = new CommentRecorder(stream, { timesliceMs: 1000, onChunk, onStart: () => {} });
    rec.start();
    await vi.advanceTimersByTimeAsync(1050);
    FakeMediaRecorder.instances[0].finalData = '';
    const stopped = rec.stop();
    await vi.advanceTimersByTimeAsync(1);
    expect(await stopped).toBe(1);
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it('falls back to mp4, then to the browser default', () => {
    FakeMediaRecorder.supported = ['audio/mp4'];
    const a = new CommentRecorder(stream, { timesliceMs: 1, onChunk() {}, onStart() {} });
    expect(a.mimeType).toBe('audio/mp4');
    FakeMediaRecorder.supported = [];
    const b = new CommentRecorder(stream, { timesliceMs: 1, onChunk() {}, onStart() {} });
    expect(FakeMediaRecorder.instances[1].options).toBeUndefined();
    expect(b.mimeType).toBe('');
  });

  it('stop() before start() resolves with 0, and a second stop() gives the same total', async () => {
    const rec = new CommentRecorder(stream, { timesliceMs: 1000, onChunk() {}, onStart() {} });
    expect(await rec.stop()).toBe(0);
    rec.start();
    await vi.advanceTimersByTimeAsync(1050);
    const first = rec.stop();
    const second = rec.stop();
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toBe(2);
    expect(await second).toBe(2);
  });
});
