// Limits and time-outs added in Phase 6 hardening. `lib/constants.ts` is a frozen shared file,
// so these live here. They sit on one mutable object so tests can lower them.

import { FILM_MAX_ENTRIES, FILM_MAX_UNPACKED_BYTES } from '@/lib/constants';

const MB = 1024 * 1024;
const GB = 1024 * MB;
const MINUTE = 60_000;

export const limits = {
  /**
   * Most bytes a Talkie film may unpack to on import. Scenes are stored gzipped, so this only
   * bounds the work of one import (a guard against zip bombs), not the disk it takes.
   */
  filmUnpackedBytes: 4 * FILM_MAX_UNPACKED_BYTES,
  /** Most bytes a Talkie film may take on disk once imported, its scenes counted gzipped. */
  filmStoredBytes: FILM_MAX_UNPACKED_BYTES,
  /** Most files a Talkie film may hold. */
  filmEntries: FILM_MAX_ENTRIES,

  /** Largest JSON request body the reviewer API reads (session start, comment complete). */
  jsonBodyBytes: 64 * 1024,

  /** New sessions per review link in a rolling hour. A whole team opening one link fits. */
  sessionsPerTokenPerHour: 120,
  /** New sessions per client address (CF-Connecting-IP) in a rolling hour. */
  sessionsPerIpPerHour: 40,
  /** Sessions one video may hold in total. */
  sessionsPerVideo: 1000,
  /** Comments one session may hold. */
  commentsPerSession: 300,
  /** Bytes one session may store while the server is up. */
  sessionBytes: 2 * GB,
  /** Chunk requests per review link per minute, across all its sessions. */
  chunkRequestsPerMinPerToken: 1200,
  /** New uploads and sessions are refused (507) when DATA_DIR has less free space than this. */
  minFreeDiskBytes: GB,

  /**
   * Longest comment that is processed. Longer recordings are cut to this length when the audio
   * is assembled, which keeps transcription under Groq's upload limit and bounds every render.
   */
  commentDurationMs: 20 * MINUTE,

  /**
   * Largest file sent to Groq in one request. Their limit is 25MB; a 16 kHz WAV reaches that
   * after about 13 minutes, so anything larger is sent as FLAC, which is about half the size.
   */
  transcribeUploadBytes: 24 * MB,

  /** A comment still `receiving` with no new chunk for this long is finished by the server. */
  staleReceivingMs: 30 * MINUTE,
  /** How often the server looks for such comments. */
  staleSweepEveryMs: 5 * MINUTE,

  // Wall-clock limits for child processes. The queue runs one job at a time, so a hung ffmpeg
  // would otherwise block every later comment until the server is restarted.
  probeTimeoutMs: MINUTE,
  frameTimeoutMs: 2 * MINUTE,
  audioTimeoutMs: 10 * MINUTE,
  remuxTimeoutMs: 30 * MINUTE,
  clipTimeoutMs: 45 * MINUTE,

  /** Most bytes kept from a child's stdout (a PNG frame is a few megabytes). */
  maxStdoutBytes: 64 * MB,
  /** Most bytes kept from a child's stderr: the end of it, where the error is. */
  maxStderrBytes: MB,
};
