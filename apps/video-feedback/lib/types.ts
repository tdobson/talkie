export type MomentKind = 'pause' | 'click' | 'zoom' | 'word' | 'dwell' | 'seek';
export type CommentKind = 'moment' | 'general';
export type CommentState = 'receiving' | 'queued' | 'processing' | 'done' | 'failed' | 'empty';
export type StepName = 'audio' | 'silence' | 'transcribe' | 'moments' | 'stills' | 'clip';
export type StepState = 'pending' | 'done' | 'failed' | 'skipped';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MediaKind = 'mp4' | 'talkie';

export interface VersionRecord {
  version: number;
  importedAt: string;
  originalFilename: string;
  /** Absent on data written before Talkie support: read as 'mp4'. */
  mediaKind?: MediaKind;
}

export interface VideoRecord {
  videoId: string;
  title: string;
  token: string;
  createdAt: string;
  latestVersion: number;
  versions: VersionRecord[];
}

/** For Talkie versions `codec` is 'talkie' and `pixFmt` is 'vector'. */
export interface ProbeInfo {
  width: number;
  height: number;
  fps: number; // e.g. 25, 29.97
  frameDuration: number; // seconds, 1 / fps
  duration: number; // seconds
  codec: string; // 'h264'
  pixFmt: string; // 'yuv420p'
  hasAudio: boolean;
}

export interface SessionRecord {
  sessionId: string;
  videoId: string;
  version: number;
  reviewerName: string;
  userAgent: string;
  startedAt: string;
  doneAt: string | null;
}

export interface PlayerInfo {
  containerWidth: number;
  containerHeight: number;
  videoWidth: number;
  videoHeight: number;
  contentRect: Rect;
  fullscreen: boolean;
  devicePixelRatio: number;
}

export interface CommentMeta {
  commentId: string;
  sessionId: string;
  version: number;
  kind: CommentKind;
  pausedAtVideoTime: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  audioMime: string;
  totalChunks: number | null;
  player: PlayerInfo;
  micLost?: boolean;
  /** Absent on data written before Talkie support: read as 'mp4'. */
  mediaKind?: MediaKind;
  /** The end of the comment is estimated (server sweep or provisional record). */
  cutShort?: boolean;
}

export interface ZoomState {
  scale: number;
  originX: number;
  originY: number;
}

interface Base {
  t: number;
}
/** A Talkie scene failed to load while the reviewer was commenting. */
export interface SceneWarningEvent extends Base {
  type: 'sceneWarning';
  sceneId: string;
}

/** What moved the playhead: the scroll bar, an arrow key, or the back and forward buttons. */
export type SeekVia = 'scrollbar' | 'key' | 'button';

export type CaptureEvent =
  | (Base & {
      type: 'pointer';
      x: number;
      y: number;
      inside: boolean;
      vt: number;
      zoomed?: boolean;
    })
  | (Base & {
      type: 'click';
      x: number;
      y: number;
      inside: boolean;
      vt: number;
      button: number;
      zoomed?: boolean;
    })
  | (Base & { type: 'seek'; from: number; to: number; via: SeekVia })
  | (Base & {
      type: 'zoom';
      state: 'start' | 'end';
      scale: number;
      originX: number;
      originY: number;
    })
  | (Base & { type: 'zoomPan'; originX: number; originY: number })
  | (Base & { type: 'visibility'; state: 'hidden' | 'visible' | 'blur' | 'focus' })
  | (Base & {
      type: 'layout';
      contentRect: Rect;
      containerWidth: number;
      containerHeight: number;
      fullscreen: boolean;
    })
  | SceneWarningEvent;

export interface CommentStatus {
  state: CommentState;
  steps: Record<StepName, StepState>;
  error: string | null;
  attempts: number;
  updatedAt: string;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
export interface Transcript {
  text: string;
  language: string | null;
  duration: number | null;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

export interface Moment {
  id: string; // 'moment-01'
  t: number; // ms since comment audio start
  vt: number; // video time, seconds
  x: number; // full-frame normalised
  y: number;
  inside: boolean;
  zoom: ZoomState | null; // zoom active at t
  kinds: MomentKind[];
  reasons: string[]; // human labels e.g. "word 'this' at 3.2s"
}

/** Where a moment falls in a Talkie film. Added to moments on 'talkie' versions in the export. */
export interface TalkieMomentInfo {
  sceneId: string;
  sceneIndex: number;
  sceneSrc: string;
  sceneTime: number; // seconds, scene-local, 3 decimals
  sceneFrame: number; // integer Lottie frame
  chapter: string | null;
  caption: string | null;
}

export interface CommentRef {
  videoId: string;
  sessionId: string;
  commentId: string;
}

// Reviewer API payloads
export interface CreateSessionBody {
  reviewerName: string;
  userAgent: string;
}
export interface CreateSessionResult {
  sessionId: string;
  version: number;
}
export interface GetSessionResult {
  sessionId: string;
  version: number;
  reviewerName: string;
  done: boolean;
}
export interface CompleteBody {
  totalChunks: number;
  endedAt: string;
  durationMs: number;
  player: PlayerInfo;
  micLost?: boolean;
}
export interface CompleteResult {
  ok: true;
}
export interface MissingChunksResult {
  ok: false;
  missing: number[];
}

// Admin API payloads
export interface AdminVersionSummary {
  version: number;
  sessions: number;
  comments: number;
  emptyComments: number;
  failedComments: number;
  pendingProcessing: number;
  lastActivity: string | null;
}
export interface AdminVideoSummary {
  videoId: string;
  title: string;
  reviewUrl: string;
  latestVersion: number;
  versions: AdminVersionSummary[];
}
export interface InboxFile {
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
}
export type ImportRequest =
  | { filename: string; mode: 'new'; title: string }
  | { filename: string; mode: 'version'; videoId: string };
export type ImportResult =
  { ok: true; videoId: string; version: number } | { ok: false; reason: string };
