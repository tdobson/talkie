#!/usr/bin/env node
// Watches one video on the review platform and prints each comment once it is processed, while
// the reviewer is still watching. Plain Node 20 or newer, no dependencies, so an agent on any
// machine can run it. No model is involved: the same comments on the server give the same lines.
//
//   node watch-feedback.mjs <videoId> [--version latest] [--every 20] [--state watch.json]
//                           [--images ./stills] [--new-only] [--once]
//
// Environment: VF (default https://video-feedback.tdobson.net), CF_ACCESS_CLIENT_ID and
// CF_ACCESS_CLIENT_SECRET (the service token, see docs/review-platform-for-agents.md).
//
// Output, one JSON object per line on stdout:
//   {"type":"comment", ...the comment as export.json has it, "local": {...}}
//     when a comment is finished: done (transcript and stills ready), empty (no speech) or
//     failed. With --images, "local" maps each media path to the file saved under that folder.
//   {"type":"session-done","sessionId":...,"reviewerName":...,"doneAt":...}
//     when a reviewer pressed Done and every comment of theirs has been printed.
// Problems go to stderr, and the watch carries on. Exit codes: 2 for refused credentials, 3 for an
// unknown video, 1 for bad arguments or a failed --once.
// With --state, what was printed is remembered across restarts. A comment is printed at least
// once: if the watcher is stopped between printing and saving, it prints that comment again.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A comment is printed once it reaches one of these. */
export const FINISHED = new Set(['done', 'empty', 'failed']);

export function emptyState() {
  return { etag: null, comments: [], sessions: [] };
}

/** The media paths of a comment that are pictures: overview, moment stills, zoomed stills. */
export function imagePaths(comment) {
  const paths = [];
  if (comment.files?.overview) paths.push(comment.files.overview);
  for (const m of comment.moments ?? []) {
    paths.push(m.image);
    if (m.zoomImage) paths.push(m.zoomImage);
  }
  return paths;
}

/**
 * The events a fresh export gives, and the state after them. Pure: the same export and state
 * always give the same events, in the export's order (comments by start time).
 */
export function diff(model, state) {
  const seen = new Set(state.comments);
  const doneSessions = new Set(state.sessions);
  const comments = model.comments.filter((c) => FINISHED.has(c.state) && !seen.has(c.commentId));
  for (const c of comments) seen.add(c.commentId);

  const sessions = [];
  for (const s of model.sessions) {
    if (s.doneAt === null || doneSessions.has(s.sessionId)) continue;
    const waiting = model.comments.some(
      (c) => c.sessionId === s.sessionId && !FINISHED.has(c.state)
    );
    if (waiting) continue;
    doneSessions.add(s.sessionId);
    sessions.push({
      type: 'session-done',
      sessionId: s.sessionId,
      reviewerName: s.reviewerName,
      doneAt: s.doneAt,
    });
  }
  return {
    comments,
    sessions,
    state: { ...state, comments: [...seen].sort(), sessions: [...doneSessions].sort() },
  };
}

export class WatchError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * One poll. Asks for export.json with the last ETag, so an unchanged video costs a 304.
 * `emit` gets each event; with `imagesDir`, a comment's stills are saved before it is emitted.
 * Returns the new state. A refused or unknown video throws a WatchError.
 */
export async function poll({ base, videoId, version, headers, state, imagesDir, emit, fetchFn }) {
  const root = `${base.replace(/\/$/, '')}/api/admin/videos/${encodeURIComponent(videoId)}/`;
  const url = `${root}export.json?version=${encodeURIComponent(version)}&partial=1`;
  const res = await fetchFn(url, {
    headers: { ...headers, ...(state.etag ? { 'If-None-Match': state.etag } : {}) },
    redirect: 'manual',
  });
  if (res.status === 304) return state;
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new WatchError(
      `The server refused the credentials (HTTP ${res.status}). Load the admin token: see "Get the admin token" in docs/review-platform-for-agents.md.`,
      2
    );
  }
  if (res.status === 404) throw new WatchError(`No video "${videoId}" (or no such version).`, 3);
  if (res.status !== 200) throw new Error(`export.json answered HTTP ${res.status}`);

  const model = await res.json();
  const { comments, sessions, state: next } = diff(model, state);
  for (const comment of comments) {
    const local = {};
    if (imagesDir) {
      for (const path of imagePaths(comment)) {
        const got = await fetchFn(root + path, { headers, redirect: 'manual' });
        if (got.status !== 200) {
          process.stderr.write(`watch-feedback: ${path} answered HTTP ${got.status}\n`);
          continue;
        }
        const file = join(imagesDir, ...path.split('/').slice(1));
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.part`, Buffer.from(await got.arrayBuffer()));
        await rename(`${file}.part`, file);
        local[path] = file;
      }
    }
    emit({ type: 'comment', ...comment, local });
  }
  for (const event of sessions) emit(event);
  return { ...next, etag: res.headers.get('etag') };
}

function parseArgs(argv) {
  const opts = {
    version: 'latest',
    every: 20,
    state: null,
    images: null,
    newOnly: false,
    once: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new WatchError(`${arg} needs a value`, 1);
      return v;
    };
    if (arg === '--version') opts.version = value();
    else if (arg === '--every') opts.every = Number(value());
    else if (arg === '--state') opts.state = value();
    else if (arg === '--images') opts.images = value();
    else if (arg === '--new-only') opts.newOnly = true;
    else if (arg === '--once') opts.once = true;
    else if (arg.startsWith('--')) throw new WatchError(`Unknown option ${arg}`, 1);
    else rest.push(arg);
  }
  if (rest.length !== 1) throw new WatchError('Usage: watch-feedback.mjs <videoId> [options]', 1);
  if (!Number.isFinite(opts.every) || opts.every < 5) {
    throw new WatchError('--every is in seconds, 5 or more', 1);
  }
  return { videoId: rest[0], ...opts };
}

async function loadState(path) {
  if (!path) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(await readFile(path, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }
}

async function saveState(path, state) {
  if (!path) return;
  await writeFile(`${path}.part`, `${JSON.stringify(state, null, 2)}\n`);
  await rename(`${path}.part`, path);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const base = process.env.VF ?? 'https://video-feedback.tdobson.net';
  const headers = {};
  if (process.env.CF_ACCESS_CLIENT_ID) {
    headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET ?? '';
  }
  let state = await loadState(opts.state);
  const print = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  const common = { base, videoId: opts.videoId, version: opts.version, headers, fetchFn: fetch };

  // --new-only on a first run: what is already there counts as seen, without printing it.
  if (opts.newOnly && state.etag === null) {
    state = await poll({ ...common, state, imagesDir: null, emit: () => {} });
    await saveState(opts.state, state);
  }
  for (;;) {
    try {
      state = await poll({ ...common, state, imagesDir: opts.images, emit: print });
      await saveState(opts.state, state);
    } catch (err) {
      if (err instanceof WatchError || opts.once) throw err;
      process.stderr.write(`watch-feedback: ${err instanceof Error ? err.message : err}\n`);
    }
    if (opts.once) return;
    await new Promise((resolve) => setTimeout(resolve, opts.every * 1000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`watch-feedback: ${err.message}\n`);
    process.exit(err instanceof WatchError ? err.code : 1);
  });
}
