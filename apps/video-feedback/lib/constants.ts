export const DWELL_RADIUS = 0.02;
export const DWELL_MS = 400;
export const MERGE_MS = 500;
export const MERGE_DIST = 0.03;
export const MAX_MOMENTS = 12;
export const KEY_STEP_COLLAPSE_MS = 1000;
export const ZOOM_END_MOVE = 0.05;
export const ZOOM_SCALE = 2.5;
export const HOLD_TO_ZOOM_MS = 250;
export const ZOOM_ANIM_MS = 150;
export const CHUNK_MS = 2000;
export const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
/**
 * Most bytes of events one chunk may carry, as JSON. A chunk is 2 seconds, so a real batch is
 * a few kilobytes; this still lets a full batch of 20,000 pointer events through.
 */
export const MAX_EVENTS_BYTES = 2 * 1024 * 1024;
export const MAX_COMMENT_BYTES = 50 * 1024 * 1024;
export const MAX_CHUNK_REQUESTS_PER_MIN = 120;
/**
 * The E2E build sets NEXT_PUBLIC_E2E_FAST_TIMERS=1 (inlined at build time) so the trouble banner
 * shows after 2 seconds. Production builds never set it.
 */
export const SAVE_TROUBLE_AFTER_MS =
  process.env.NEXT_PUBLIC_E2E_FAST_TIMERS === '1' ? 2_000 : 20_000;
/** Level, on the mic meter's 0..1 scale, that counts as speech. */
export const MIC_SPEECH_THRESHOLD = 0.08;
export const MIC_SPEECH_HOLD_MS = 300;
const FAST = process.env.NEXT_PUBLIC_E2E_FAST_TIMERS === '1';
/** How long "Got you, loud and clear" shows before the film starts. */
export const MIC_HEARD_SHOW_MS = 1000;
/**
 * Speech, in total, the practice pause waits for. As soon as the reviewer has started talking it
 * has done what the practice is for, so it moves on without waiting for them to stop.
 */
export const PRACTICE_SPEECH_MS = 600;
/** Quiet after that speech before it moves on: none. */
export const PRACTICE_SILENCE_MS = 0;
/** How long "Got that" shows before the film goes back to the start, for real. */
export const PRACTICE_GOT_THAT_MS = 2500;
/**
 * A paused comment ends on its own after this long with no speech, so a reviewer who walks away
 * (or talks to someone else in the room) is not recorded for ever. Shorter in the E2E build.
 */
export const COMMENT_SILENCE_END_MS = FAST ? 4000 : 30_000;
/** The longest one comment records, even while the reviewer keeps talking. */
export const COMMENT_MAX_MS = FAST ? 15_000 : 300_000;
/** How long before that limit the reviewer is told. */
export const COMMENT_WARN_BEFORE_MS = FAST ? 5000 : 60_000;
/** Playing this long with no pause brings up the "Pause any time" hint. */
export const FEEDBACK_HINT_AFTER_MS = FAST ? 2000 : 60_000;
/** How long that hint stays up. */
export const FEEDBACK_HINT_SHOW_MS = 4000;
export const SILENCE_NOISE_DB = -40;
export const SILENCE_MIN_SPEECH_S = 0.3;
export const STILL_MAX_WIDTH = 1920;
export const CLIP_MAX_WIDTH = 1280;
export const CLIP_FPS = 15;
export const DEICTIC_WORDS = ['this', 'that', 'these', 'those', 'here', 'there', 'it'] as const;
export const TRANSCRIBE_BACKOFF_MS = [5_000, 30_000, 120_000];
export const GROQ_MODEL = 'whisper-large-v3';
export const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000;
/**
 * Most bytes a Talkie film may take on disk, its scenes stored gzipped. It may unpack to four
 * times this (`limits.filmUnpackedBytes`).
 */
export const FILM_MAX_UNPACKED_BYTES = 500 * 1024 * 1024;
/** Most files a Talkie film may hold. */
export const FILM_MAX_ENTRIES = 2000;
/** Limit for one Talkie still, after which the headless browser is restarted. */
export const TALKIE_FRAME_TIMEOUT_MS = 30_000;
/** The headless browser for Talkie stills closes after this long idle. */
export const TALKIE_BROWSER_IDLE_MS = 120_000;
