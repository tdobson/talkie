const MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/mp4'] as const;

/** Best supported recording type, or '' to let the browser choose. */
export function pickMime(isTypeSupported: (m: string) => boolean): string {
  return MIME_PREFERENCE.find((m) => isTypeSupported(m)) ?? '';
}

export interface CommentRecorderOptions {
  timesliceMs: number;
  onChunk: (blob: Blob, seq: number) => void;
  /** Fires when recording has really begun: the moment to set t=0 on the event log. */
  onStart: () => void;
}

/** One MediaRecorder per comment, emitting numbered chunks. */
export class CommentRecorder {
  private readonly rec: MediaRecorder;
  private readonly timesliceMs: number;
  private readonly picked: string;
  private seq = 0;
  private stopping: Promise<number> | null = null;

  constructor(stream: MediaStream, opts: CommentRecorderOptions) {
    this.timesliceMs = opts.timesliceMs;
    this.picked = pickMime((m) => MediaRecorder.isTypeSupported(m));
    this.rec = this.picked
      ? new MediaRecorder(stream, { mimeType: this.picked })
      : new MediaRecorder(stream);
    this.rec.addEventListener('start', () => opts.onStart());
    this.rec.addEventListener('dataavailable', (e) => {
      const blob = (e as BlobEvent).data;
      // Browsers can emit an empty blob on stop; it carries nothing and must not take a seq.
      if (blob && blob.size > 0) opts.onChunk(blob, this.seq++);
    });
  }

  get mimeType(): string {
    return this.rec.mimeType || this.picked;
  }

  start(): void {
    this.rec.start(this.timesliceMs);
  }

  /** Resolves with the number of chunks emitted, after the final dataavailable. */
  stop(): Promise<number> {
    if (this.stopping) return this.stopping;
    if (this.rec.state === 'inactive') return Promise.resolve(this.seq);
    this.stopping = new Promise<number>((resolve) => {
      const finish = () => resolve(this.seq);
      // The spec fires the last dataavailable before 'stop'. An error also ends the recording.
      this.rec.addEventListener('stop', finish, { once: true });
      this.rec.addEventListener('error', finish, { once: true });
      this.rec.stop();
    });
    return this.stopping;
  }
}
