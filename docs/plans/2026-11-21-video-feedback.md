# Video Feedback Tool Implementation Plan

> **For agentic workers:** This plan is structured for workflow orchestration. Tasks are labelled with a role (`explore` / `build` / `review` / `test` / `fix-tests`). Parallel build tasks run with `isolation: worktree`. Checking is deliberately light: only the risky modules (3.2, 3.3, 3.4, 3.5, 4.1, 4.2) get a dedicated review (one round, at most one fix); everything else relies on TDD and the test gate that ends every phase.
>
> **Execution:** The workflow at `.claude/workflows/build-video-feedback.js` runs this plan end to end. It can also be followed by hand with `superpowers:subagent-driven-development`.
>
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the video feedback tool described in `docs/superpowers/specs/2026-11-21-video-feedback-design.md`: a reviewer player that turns "pause and talk while pointing" into timecoded, word-aligned, pointer-annotated feedback, exported as an LLM-ready zip.

**Architecture:** One Next.js 16 App Router app with Mantine 9, plain files on disk under `DATA_DIR`, an in-process single-concurrency processing queue (ffmpeg, sharp, Groq Whisper), reviewer routes under `/r/<token>` and admin routes behind Cloudflare Access. Pure logic (geometry, moment selection, markdown export, review state machine) lives in small framework-free modules with heavy unit tests; IO modules are thin and tested with real ffmpeg fixtures.

**Tech Stack:** Next.js 16.4, React 19, Mantine 9.8, TypeScript 7 (native `tsc`, formerly `tsgo`), Biome 2 (lint), Prettier 3 (format), Vitest 5, Playwright 1.65, sharp, jose, yazl, ffmpeg/ffprobe, Groq `whisper-large-v3`.

**Codebases affected:** `video-feedback.tdobson.net` only (this repo). All paths below are relative to its root.

**Role to model mapping (used by the workflow):**

| Role | Model | Effort |
|---|---|---|
| explore | haiku | default |
| build (coding, review fixes, integration) | fable (Fable 5.2) | low |
| review | fable (Fable 5.2) | low |
| test (write/run tests, QA) | opus | low |
| fix-tests (make failing tests pass) | opus | high |

---

## 0. Rules for every task

1. **Low priority, always.** Every build, install, lint, typecheck, test, Playwright, ffmpeg and dev-server command runs through `./scripts/lowprio.sh` (created in Task 1.1), which is `exec ionice -c2 -n7 nice -n19 "$@"`. Before Task 1.1 exists, prefix with `ionice -c2 -n7 nice -n19` directly. Examples: `./scripts/lowprio.sh yarn install`, `./scripts/lowprio.sh yarn vitest run lib/geometry`. The `yarn` scripts in `package.json` already wrap themselves, so `yarn check` is fine on its own.
2. **TDD.** Write the failing test, run it and see it fail for the right reason, implement, see it pass, commit. Never write implementation before its test.
3. **Branch.** Implementation happens on `feat/video-feedback` (created in Task 1.1 from `spec/video-feedback-design`). Parallel tasks run in their own worktree branches and are merged by the integration step. Commit before finishing; uncommitted work in a worktree is lost.
4. **Shared files are frozen after Phase 1.** `package.json`, `yarn.lock`, `lib/types.ts`, `lib/testids.ts`, `lib/review/copy.ts`, `tsconfig.json`, `biome.json`, `vitest.config.ts` belong to Phase 1. A parallel task that needs a change there must NOT edit them; it reports the needed change in its result under `sharedChangesNeeded`, and the integration step applies it. Exception: a task may add a new devDependency only if the task text says so.
5. **No em-dashes** in any user-facing text (UI copy, README written for the LLM, error messages). Use colons, commas or full stops.
6. **Gate before commit:** `yarn check` (format check, lint, typecheck, unit tests) must pass in your tree before your final commit. If an unrelated pre-existing test fails, say so in your result; do not "fix" other tasks' code.
7. **Commit style:** `feat(area): ...`, `test(area): ...`, `chore: ...`. Small commits are fine.
8. **No secrets in git.** `.env*` is gitignored; `GROQ_API_KEY` only ever comes from the environment.

### Commands (after Task 1.1)

| Command | What it does |
|---|---|
| `yarn check` | prettier --check, biome lint, tsc, vitest run |
| `yarn test` | vitest run |
| `yarn test:watch` | vitest |
| `yarn test:e2e` | playwright test |
| `yarn typecheck` | tsc --noEmit (TypeScript 7 native) |
| `yarn lint` / `yarn format` | biome lint / prettier --write |
| `yarn dev` / `yarn build` / `yarn start` | Next.js (dev and build at low priority; start at normal priority) |
| `yarn fixtures` | generate media fixtures into `test/fixtures/generated/` |
| `yarn import`, `yarn export`, `yarn reprocess` | CLIs (Tasks 3.1, 4.1, 3.3) |

---

## 1. File structure

```
scripts/lowprio.sh                      # ionice + nice wrapper
scripts/make-fixtures.sh                # ffmpeg-generated test media
scripts/cli/import.ts                   # yarn import
scripts/cli/export.ts                   # yarn export
scripts/cli/reprocess.ts                # yarn reprocess
instrumentation.ts                      # Next.js server start: start queue + startup scan

lib/types.ts                            # ALL shared data shapes (Phase 1, frozen)
lib/testids.ts                          # ALL data-testid values (Phase 1, frozen)
lib/config.ts                           # env parsing
lib/format.ts                           # formatVideoTime, slugify
lib/geometry.ts                         # contain rect, normalise, zoom maths, position labels
lib/moments.ts                          # key-moment selection (pure)
lib/storage/paths.ts                    # DATA_DIR layout, id validation
lib/storage/json.ts                     # atomic JSON read/write
lib/storage/ids.ts                      # tokens, ids, slugs
lib/storage/chunks.ts                   # idempotent chunk store
lib/storage/repo.ts                     # videos/sessions/comments lookups
lib/media/run.ts                        # spawn with ionice/nice
lib/media/probe.ts                      # ffprobe + browser-safety validation
lib/media/ops.ts                        # remux, frame extract, wav16k, speech detect
lib/auth/access.ts                      # Cloudflare Access JWT verification
lib/auth/guard.ts                       # withAdmin() for route handlers, requireAdminPage()
lib/videos/import.ts                    # inbox listing, import as new video/version
lib/review/service.ts                   # reviewer API logic (framework-free)
lib/review/range.ts                     # HTTP Range parsing
lib/review/ratelimit.ts                 # per-session limits
lib/review/copy.ts                      # ALL reviewer-facing text (Phase 1, frozen)
lib/review/machine.ts                   # reviewer UI state machine (pure reducer)
lib/pipeline/enqueue.ts                 # completion hook (Phase 1 stub, frozen)
lib/pipeline/queue.ts                   # single-concurrency persistent queue
lib/pipeline/status.ts                  # status.json helpers
lib/pipeline/steps/assemble.ts
lib/pipeline/steps/silence.ts
lib/pipeline/steps/transcribe.ts        # Groq client + fake transcriber
lib/pipeline/steps/moments.ts
lib/pipeline/steps/stills.ts
lib/pipeline/steps/clip.ts
lib/pipeline/process.ts                 # runs steps for one comment
lib/render/overlay.ts                   # SVG overlays (pointer, trail, rings, zoom box)
lib/render/stills.ts                    # moment stills, zoom crops, overview
lib/render/clip.ts                      # reconstructed clip
lib/export/model.ts                     # collect export data
lib/export/markdown.ts                  # feedback.md
lib/export/readme.ts                    # README.md for the LLM
lib/export/zip.ts                       # yazl writer + ETag
lib/capture/eventLog.ts                 # client event log with time base
lib/capture/recorder.ts                 # MediaRecorder wrapper
lib/capture/uploader.ts                 # chunk upload queue with IndexedDB
lib/capture/idb.ts                      # tiny IndexedDB wrapper
lib/capture/micLevel.ts                 # analyser-based level meter

app/layout.tsx, app/page.tsx (404-ish landing), theme.ts
app/r/[token]/page.tsx                  # server: token lookup, renders ReviewApp
app/api/r/[token]/sessions/route.ts
app/api/r/[token]/sessions/[sid]/route.ts
app/api/r/[token]/sessions/[sid]/done/route.ts
app/api/r/[token]/sessions/[sid]/comments/[cid]/chunks/[seq]/route.ts
app/api/r/[token]/sessions/[sid]/comments/[cid]/complete/route.ts
app/api/r/[token]/video/route.ts
app/admin/layout.tsx, app/admin/page.tsx
app/admin/videos/[videoId]/page.tsx
app/admin/inbox/page.tsx
app/api/admin/videos/route.ts
app/api/admin/videos/[videoId]/export.zip/route.ts
app/api/admin/videos/[videoId]/export.json/route.ts
app/api/admin/videos/[videoId]/reprocess/route.ts
app/api/admin/inbox/route.ts

components/review/*                     # ReviewApp and screens (Task 4.2)
components/admin/*                      # admin components (Task 4.3)

test/fixtures/                          # committed small fixtures (events, transcripts)
test/fixtures/generated/                # gitignored, made by yarn fixtures
test/helpers/tmpData.ts                 # temp DATA_DIR per test
e2e/*.spec.ts, playwright.config.ts, e2e/global-setup.ts
deploy/video-feedback.service, deploy/cloudflared.md, docs/DEPLOY.md
```

---

## 2. Shared contracts (created in Phase 1, then frozen)

### 2.1 `lib/types.ts`

```ts
export type MomentKind = 'pause' | 'click' | 'zoom' | 'word' | 'dwell' | 'seek';
export type CommentKind = 'moment' | 'general';
export type CommentState = 'receiving' | 'queued' | 'processing' | 'done' | 'failed' | 'empty';
export type StepName = 'audio' | 'silence' | 'transcribe' | 'moments' | 'stills' | 'clip';
export type StepState = 'pending' | 'done' | 'failed' | 'skipped';

export interface Rect { x: number; y: number; width: number; height: number }

export interface VersionRecord { version: number; importedAt: string; originalFilename: string }

export interface VideoRecord {
  videoId: string;
  title: string;
  token: string;
  createdAt: string;
  latestVersion: number;
  versions: VersionRecord[];
}

export interface ProbeInfo {
  width: number;
  height: number;
  fps: number;            // e.g. 25, 29.97
  frameDuration: number;  // seconds, 1 / fps
  duration: number;       // seconds
  codec: string;          // 'h264'
  pixFmt: string;         // 'yuv420p'
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
}

export interface ZoomState { scale: number; originX: number; originY: number }

interface Base { t: number }
export type CaptureEvent =
  | (Base & { type: 'pointer'; x: number; y: number; inside: boolean; vt: number; zoomed?: boolean })
  | (Base & { type: 'click'; x: number; y: number; inside: boolean; vt: number; button: number; zoomed?: boolean })
  | (Base & { type: 'seek'; from: number; to: number; via: 'scrollbar' | 'key' })
  | (Base & { type: 'zoom'; state: 'start' | 'end'; scale: number; originX: number; originY: number })
  | (Base & { type: 'zoomPan'; originX: number; originY: number })
  | (Base & { type: 'visibility'; state: 'hidden' | 'visible' | 'blur' | 'focus' })
  | (Base & { type: 'layout'; contentRect: Rect; containerWidth: number; containerHeight: number; fullscreen: boolean });

export interface CommentStatus {
  state: CommentState;
  steps: Record<StepName, StepState>;
  error: string | null;
  attempts: number;
  updatedAt: string;
}

export interface TranscriptWord { word: string; start: number; end: number }
export interface TranscriptSegment { start: number; end: number; text: string }
export interface Transcript {
  text: string;
  language: string | null;
  duration: number | null;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

export interface Moment {
  id: string;              // 'moment-01'
  t: number;               // ms since comment audio start
  vt: number;              // video time, seconds
  x: number;               // full-frame normalised
  y: number;
  inside: boolean;
  zoom: ZoomState | null;  // zoom active at t
  kinds: MomentKind[];
  reasons: string[];       // human labels e.g. "word 'this' at 3.2s"
}

export interface CommentRef { videoId: string; sessionId: string; commentId: string }

// Reviewer API payloads
export interface CreateSessionBody { reviewerName: string; userAgent: string }
export interface CreateSessionResult { sessionId: string; version: number }
export interface GetSessionResult { sessionId: string; version: number; reviewerName: string; done: boolean }
export interface CompleteBody { totalChunks: number; endedAt: string; durationMs: number; player: PlayerInfo; micLost?: boolean }
export interface CompleteResult { ok: true }
export interface MissingChunksResult { ok: false; missing: number[] }

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
export interface InboxFile { filename: string; sizeBytes: number; modifiedAt: string }
export type ImportRequest =
  | { filename: string; mode: 'new'; title: string }
  | { filename: string; mode: 'version'; videoId: string };
export type ImportResult =
  | { ok: true; videoId: string; version: number }
  | { ok: false; reason: string };
```

### 2.2 `lib/testids.ts`

Every interactive or asserted element carries one of these. E2E tests use only these.

```ts
export const T = {
  mobileBlock: 'mobile-block',
  mobileCopyLink: 'mobile-copy-link',
  welcome: 'welcome',
  nameInput: 'name-input',
  startButton: 'start-button',
  micExplain: 'mic-explain',
  micContinue: 'mic-continue',
  micCheck: 'mic-check',
  micMeter: 'mic-meter',
  micHeard: 'mic-heard',
  micDenied: 'mic-denied',
  micRetry: 'mic-retry',
  startWatching: 'start-watching',
  player: 'player',
  videoStage: 'video-stage',          // the element pointer coords are relative to
  video: 'video',
  playPause: 'play-pause',
  scrollBar: 'scroll-bar',
  volume: 'volume',
  fullscreen: 'fullscreen',
  playHint: 'play-hint',
  doneButton: 'done-button',
  listening: 'listening-overlay',
  listeningLevel: 'listening-level',
  savingToast: 'saving-toast',
  savedToast: 'saved-toast',
  saveTroubleBanner: 'save-trouble-banner',
  micLost: 'mic-lost',
  micReconnect: 'mic-reconnect',
  endScreen: 'end-screen',
  shareMore: 'share-more',
  generalComment: 'general-comment',
  generalFinished: 'general-finished',
  thanks: 'thanks',
  invalidLink: 'invalid-link',
  adminVideoRow: 'admin-video-row',
  adminCopyLink: 'admin-copy-link',
  adminDownload: 'admin-download',
  adminClipsToggle: 'admin-clips-toggle',
  adminReprocess: 'admin-reprocess',
  adminInboxRow: 'admin-inbox-row',
  adminImportNew: 'admin-import-new',
  adminImportVersion: 'admin-import-version',
  adminImportTitle: 'admin-import-title',
  adminImportSubmit: 'admin-import-submit',
  adminImportError: 'admin-import-error',
  adminSessionRow: 'admin-session-row',
} as const;
```

### 2.3 `lib/review/copy.ts`

All reviewer-facing text. No em-dashes. Components import from here only.

```ts
export const copy = {
  pageTitle: (title: string) => `Feedback: ${title}`,
  welcome: {
    thanks: 'Thanks for taking a look.',
    para1:
      "Any time you see something that's not right, just pause it and explain it to me as if I'm sat right next to you.",
    para2:
      "Point at things with your mouse. I can't see your finger, but I can see the pointer. The more specific you are about which bit you'd change, the better.",
    nameLabel: 'Your name',
    namePlaceholder: 'e.g. Sarah',
    start: 'Start',
  },
  micExplain: {
    title: 'We need your microphone',
    body:
      'Your browser is about to ask if this page can use your microphone. Please click Allow: it only records while the video is paused.',
    continue: 'Continue',
  },
  micCheck: {
    title: 'Say hello so we know we can hear you',
    heard: 'Got you, loud and clear',
    startWatching: 'Start watching',
  },
  micDenied: {
    title: "We can't hear you yet",
    body: 'Your browser blocked the microphone. To fix it:',
    chrome: 'Chrome or Edge: click the icon to the left of the web address, set Microphone to Allow, then reload.',
    firefox: 'Firefox: click the microphone icon in the address bar, remove the block, then reload.',
    safari: 'Safari: open Safari > Settings for This Website, set Microphone to Allow, then reload.',
    retry: 'Try again',
  },
  player: {
    hint: 'Spotted something? Pause and tell me.',
    done: "I'm done",
    listening: 'Listening',
    listeningHelp: "Point and explain. Press play when you're done.",
    listeningTips: 'Hold the mouse down to zoom in. Use ← → to step through frames.',
    saving: 'Saving...',
    saved: 'Saved',
    trouble: "Having trouble saving. Keep this tab open and we'll keep trying.",
    micLost: "We've lost your microphone",
    micReconnect: 'Reconnect',
  },
  end: {
    title: "That's the end of the video.",
    otherThings: "Got any other things to mention that you haven't mentioned anywhere else?",
    shareMore: 'Click here to share them now',
    lookAgain: 'Want to look at something again? Scroll back and pause on it.',
    done: "I'm done",
  },
  general: {
    listening: 'Listening',
    prompt1: 'Was there anything missing?',
    prompt2: "Anything else you'd change, keep, or want to see?",
    finished: 'Finished, save that',
  },
  thanks: {
    title: (name: string) => `Thanks, ${name}.`,
    body: "That's all come through. If you think of anything else, open the same link again and carry on.",
  },
  mobile: {
    title: 'Best on a computer',
    body: 'This review works by pointing with a mouse while you talk, so please open this link on a laptop or desktop.',
    copy: 'Copy link',
    copied: 'Copied',
  },
  invalid: { title: "This link isn't valid", body: 'Check you have the whole link, or ask whoever sent it for a new one.' },
} as const;
```

### 2.4 `lib/pipeline/enqueue.ts` (stub that decouples the reviewer API from the pipeline)

```ts
import type { CommentRef } from '@/lib/types';

type Handler = (ref: CommentRef) => void;
let handler: Handler | null = null;

export function setCommentCompleteHandler(h: Handler | null): void {
  handler = h;
}

export function notifyCommentComplete(ref: CommentRef): void {
  handler?.(ref);
}
```

### 2.5 Tunable constants (`lib/constants.ts`, Phase 1)

```ts
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
export const MAX_COMMENT_BYTES = 50 * 1024 * 1024;
export const MAX_CHUNK_REQUESTS_PER_MIN = 120;
export const SAVE_TROUBLE_AFTER_MS = 20_000;
export const MIC_SPEECH_HOLD_MS = 300;
export const SILENCE_NOISE_DB = -40;
export const SILENCE_MIN_SPEECH_S = 0.3;
export const STILL_MAX_WIDTH = 1920;
export const CLIP_MAX_WIDTH = 1280;
export const CLIP_FPS = 15;
export const DEICTIC_WORDS = ['this', 'that', 'these', 'those', 'here', 'there', 'it'] as const;
export const TRANSCRIBE_BACKOFF_MS = [5_000, 30_000, 120_000];
```

---

## Phase 0: Explore (`explore`, read-only, parallel)

### Task 0.1: Toolchain facts — `explore`
Find and report, with sources (npm, official docs, `node_modules` of `~/dev/next-app-template`):
- Biome 2.6 `biome.json` shape: disabling the formatter, enabling CSS linting, VCS ignore, recommended rules, how to ignore `.next`, `test/fixtures/generated`.
- Whether Next.js 16.4 `next build` works with `typescript@7` installed (Next loads the TypeScript JS API for type checking and tsconfig handling; TS 7 is the Go-native compiler). Report the recommended way: `typescript.ignoreBuildErrors` or an alias such as `"typescript": "^6"` plus `"typescript7": "npm:typescript@7.0.2"` invoked by path.
- Vitest 5 config for a Next/React 19 project: JSX transform, `environmentMatchGlobs` or projects for node vs jsdom, path alias `@/`.
- Next 16 instrumentation file convention (`instrumentation.ts` `register()`), route handler signature for dynamic params (params is a Promise), `output: 'standalone'`.
- Mantine 9.8 changes since 9.4 that affect `MantineProvider`, `ColorSchemeScript`, `postcss-preset-mantine`.

### Task 0.2: Media and API facts — `explore`
- On this machine: `ffmpeg -hide_banner -encoders | grep -E "libx264|libx265|aac|libopus"`, whether libx264 can produce `yuv420p10le` (High 10), and `ffmpeg -filters | grep silencedetect`.
- Groq audio transcription API: endpoint, multipart fields (`model`, `file`, `response_format=verbose_json`, `timestamp_granularities[]`, `language`), response shape for words and segments, size limits, rate-limit status codes. Check `~/dev/transcribeMe/transcribe.js` for how Tim already calls it.
- Playwright 1.65 Chromium flags for a fake mic from a WAV (`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=path`), and whether Firefox/WebKit projects can grant microphone permission with a fake device.
- MediaRecorder MIME support matrix and whether timeslice chunks concatenate into a valid file for `audio/webm;codecs=opus` (Chrome, Firefox) and `audio/mp4` (Safari).

**Output (both):** `{ facts: string[], risks: string[], recommendations: string[] }`. These notes are passed into every later prompt.

---

## Phase 1: Scaffold and contracts (sequential, main tree)

### Task 1.1: Scaffold the app and toolchain — `build`

**Files:**
- Create: whole app skeleton copied from `~/dev/next-app-template` (excluding `.git`, `node_modules`, `.storybook`, `components/Welcome`, `components/ColorSchemeToggle`, `jest.*`, `oxlint.config.mjs`, `oxfmt.config.mjs`, `.stylelintrc.json`, `.stylelintignore`, `test-utils`, `renovate.json`, `.github`)
- Create: `scripts/lowprio.sh`, `biome.json`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `vitest.setup.ts`, `test/helpers/render.tsx`, `.nvmrc`, `.gitignore`, `.env.example`, `README.md`
- Modify: `package.json`, `tsconfig.json`, `next.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `theme.ts`

- [ ] **Step 1: Branch**
```bash
git checkout spec/video-feedback-design && git checkout -b feat/video-feedback
```

- [ ] **Step 2: Copy template files** (rsync with the excludes above). Delete the template's components and stories.

- [ ] **Step 3: `scripts/lowprio.sh`**
```bash
#!/usr/bin/env bash
# Run a command at idle IO priority and lowest CPU priority.
set -euo pipefail
if command -v ionice >/dev/null 2>&1; then
  exec ionice -c2 -n7 nice -n19 "$@"
else
  exec nice -n19 "$@"
fi
```
`chmod +x scripts/lowprio.sh`.

- [ ] **Step 4: `package.json`** (name `video-feedback`, `"engines": {"node": ">=22"}`, `.nvmrc` = `24`). Dependencies: `next@16.4.x`, `react@19.2.x`, `react-dom`, `@mantine/core@9.8.x`, `@mantine/hooks`, `@mantine/notifications`, `@tabler/icons-react`, `sharp`, `jose`, `yazl`, `nanoid`. Dev: `typescript@7.0.x` (see Task 0.1 for the Next compatibility decision), `@types/node`, `@types/react`, `@types/react-dom`, `@types/yazl`, `@biomejs/biome@2.6.x`, `prettier@3.10.x`, `vitest@5.x`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `fake-indexeddb`, `@playwright/test@1.65.x`, `@axe-core/playwright`, `yauzl`, `@types/yauzl`, `tsx`, `postcss`, `postcss-preset-mantine`, `postcss-simple-vars`.

Scripts:
```json
{
  "dev": "./scripts/lowprio.sh next dev",
  "build": "./scripts/lowprio.sh next build",
  "start": "next start",
  "typecheck": "./scripts/lowprio.sh tsc --noEmit",
  "lint": "./scripts/lowprio.sh biome lint .",
  "lint:fix": "./scripts/lowprio.sh biome lint --write .",
  "format": "./scripts/lowprio.sh prettier --write .",
  "format:check": "./scripts/lowprio.sh prettier --check .",
  "test": "./scripts/lowprio.sh vitest run",
  "test:watch": "./scripts/lowprio.sh vitest",
  "test:coverage": "./scripts/lowprio.sh vitest run --coverage",
  "test:e2e": "./scripts/lowprio.sh playwright test",
  "fixtures": "./scripts/lowprio.sh ./scripts/make-fixtures.sh",
  "check": "yarn format:check && yarn lint && yarn typecheck && yarn test",
  "import": "./scripts/lowprio.sh tsx scripts/cli/import.ts",
  "export": "./scripts/lowprio.sh tsx scripts/cli/export.ts",
  "reprocess": "./scripts/lowprio.sh tsx scripts/cli/reprocess.ts"
}
```
Install: `./scripts/lowprio.sh yarn install`.

- [ ] **Step 5: Configs.** `biome.json`: formatter disabled, linter recommended, CSS linting on, `files.includes` excludes `.next`, `node_modules`, `test/fixtures/generated`, `playwright-report`, `test-results`. `.prettierrc.json`: `{ "singleQuote": true, "printWidth": 100, "trailingComma": "es5" }`. `.prettierignore` mirrors the Biome ignores plus `yarn.lock`, `data/`. `tsconfig.json`: drop jest types, add `vitest/globals`, `@testing-library/jest-dom`, `target: "es2022"`. `next.config.mjs`: `output: 'standalone'`, `serverExternalPackages: ['sharp']`, keep `optimizePackageImports`, drop bundle analyzer. `vitest.config.ts`: two projects: `node` (files `lib/**/*.test.ts`, `scripts/**/*.test.ts`, `app/**/*.test.ts`) and `jsdom` (`**/*.test.tsx`, `lib/capture/**/*.test.ts`, `lib/review/machine.test.ts`), alias `@/` to root, setup file loading `@testing-library/jest-dom/vitest` and `fake-indexeddb/auto` for jsdom.

- [ ] **Step 6: `.gitignore`** adds `data/`, `test/fixtures/generated/`, `.env*` (except `.env.example`), `playwright-report/`, `test-results/`, `*.tsbuildinfo`.

- [ ] **Step 7: Theme and layout.** `theme.ts`: primary colour `indigo`, `defaultRadius: 'md'`, font stack `Inter, system-ui, sans-serif`, `headings.fontWeight: '650'`. `app/layout.tsx`: MantineProvider with `defaultColorScheme="light"`, `Notifications`, title "Video feedback". `app/page.tsx`: a minimal centred card "Nothing to see here. If you were sent a review link, open that instead." (`noindex` metadata). Add `robots: { index: false }` to root metadata.

- [ ] **Step 8: Smoke test** `app/page.test.tsx`:
```tsx
import { render, screen } from '@/test/helpers/render';
import HomePage from './page';

test('home page tells visitors to use their review link', () => {
  render(<HomePage />);
  expect(screen.getByText(/review link/i)).toBeInTheDocument();
});
```
Run `yarn test` (fails before page exists, passes after).

- [ ] **Step 9: Verify toolchain.** `yarn check` and `yarn build` both pass. If `next build` fails because of TypeScript 7, apply the fallback from Task 0.1 and note it in `README.md` under "Toolchain notes".

- [ ] **Step 10: Commit** `chore: scaffold Next.js + Mantine app with biome, prettier, TS7, vitest, playwright`.

### Task 1.2: Shared contracts and fixtures — `build`

**Files:**
- Create: `lib/types.ts` (section 2.1), `lib/testids.ts` (2.2), `lib/review/copy.ts` (2.3), `lib/pipeline/enqueue.ts` (2.4), `lib/constants.ts` (2.5), `lib/config.ts`, `lib/config.test.ts`, `lib/format.ts`, `lib/format.test.ts`, `scripts/make-fixtures.sh`, `test/helpers/tmpData.ts`, `test/fixtures/events-basic.json`, `test/fixtures/transcript-basic.json`

- [ ] **Step 1: Copy sections 2.1 to 2.5 verbatim** into their files.

- [ ] **Step 2: Failing tests for `lib/format.ts`**
```ts
import { formatVideoTime, slugify } from './format';

describe('formatVideoTime', () => {
  it.each([
    [0, '0:00.0'],
    [12.44, '0:12.4'],
    [59.96, '1:00.0'],
    [754.25, '12:34.3'],
    [3725.0, '62:05.0'],
  ])('%s -> %s', (s, out) => expect(formatVideoTime(s)).toBe(out));
});

describe('slugify', () => {
  it('lowercases, strips punctuation and collapses dashes', () => {
    expect(slugify("Mavala Launch Film (v2) — FINAL!")).toBe('mavala-launch-film-v2-final');
  });
  it('falls back to "video" for empty results', () => expect(slugify('!!!')).toBe('video'));
  it('caps at 40 chars without a trailing dash', () => {
    const s = slugify('a'.repeat(39) + ' bbbb');
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
});
```
Implement: `formatVideoTime` rounds to tenths first, then splits into minutes and seconds (so 59.96 becomes `1:00.0`).

- [ ] **Step 3: Failing tests for `lib/config.ts`**
```ts
import { loadConfig } from './config';

it('applies defaults', () => {
  const c = loadConfig({});
  expect(c.dataDir).toMatch(/data$/);
  expect(c.whisperLanguage).toBe('en');
  expect(c.adminAuth).toBe('cloudflare');
  expect(c.transcriber).toBe('groq');
});
it('refuses ADMIN_AUTH=off in production', () => {
  expect(() => loadConfig({ ADMIN_AUTH: 'off', NODE_ENV: 'production' })).toThrow(/ADMIN_AUTH=off/);
});
it('requires CF settings when adminAuth is cloudflare in production', () => {
  expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
});
it('accepts TRANSCRIBER=fake for tests', () => {
  expect(loadConfig({ TRANSCRIBER: 'fake' }).transcriber).toBe('fake');
});
```
`loadConfig(env: Record<string, string | undefined>)` returns `{ dataDir, groqApiKey, groqBaseUrl ('https://api.groq.com/openai/v1'), whisperLanguage, cfAccessTeamDomain, cfAccessAud, adminAuth: 'cloudflare' | 'off', transcriber: 'groq' | 'fake', publicBaseUrl (PUBLIC_BASE_URL, default 'http://localhost:3000'), isProduction }`. Export `config()` that memoises `loadConfig(process.env)` and `resetConfigForTests()`.

- [ ] **Step 4: `scripts/make-fixtures.sh`** (idempotent; skips files that exist) writes into `test/fixtures/generated/`:
```bash
#!/usr/bin/env bash
set -euo pipefail
OUT="$(dirname "$0")/../test/fixtures/generated"; mkdir -p "$OUT"; cd "$OUT"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
[ -f h264.mp4 ] || ff -f lavfi -i testsrc2=size=640x360:rate=25:duration=4 -f lavfi -i sine=frequency=440:duration=4 \
  -c:v libx264 -pix_fmt yuv420p -g 25 -c:a aac -shortest h264.mp4
[ -f h264-nofaststart.mp4 ] || ff -i h264.mp4 -c copy -movflags -faststart h264-nofaststart.mp4
[ -f h264-10bit.mp4 ] || ff -f lavfi -i testsrc2=size=320x180:rate=25:duration=1 -c:v libx264 -pix_fmt yuv420p10le h264-10bit.mp4 || true
[ -f mpeg4.mp4 ] || ff -f lavfi -i testsrc2=size=320x180:rate=25:duration=1 -c:v mpeg4 mpeg4.mp4
[ -f speech-like.wav ] || ff -f lavfi -i "sine=frequency=300:duration=3" -af "volume=0.5" -ar 48000 -ac 1 speech-like.wav
[ -f silence.wav ] || ff -f lavfi -i anullsrc=r=48000:cl=mono -t 3 silence.wav
[ -f speech-like.webm ] || ff -i speech-like.wav -c:a libopus speech-like.webm
[ -f e2e-voice.wav ] || ff -f lavfi -i "sine=frequency=220:duration=60" -af "volume=0.6,apulsator=hz=1.5" -ar 48000 -ac 1 e2e-voice.wav
echo "fixtures ready in $OUT"
```
Tests that need fixtures call a Vitest `globalSetup` (`test/globalSetup.ts`) that runs `yarn fixtures` once.

- [ ] **Step 5: `test/helpers/tmpData.ts`**
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfigForTests } from '@/lib/config';

export async function withTmpData(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'vf-'));
  process.env.DATA_DIR = dir;
  resetConfigForTests();
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
```

- [ ] **Step 6: Committed fixtures.** `test/fixtures/events-basic.json`: a realistic 6-second moment comment: pointer samples moving from (0.5,0.5) to (0.12,0.08), resting there from t=2800 to t=3900, a click at (0.48,0.81) at t=7800, a seek from 12.4 to 9.0 at t=5000 via scrollbar, a zoom start at t=8500 (scale 2.5, origin 0.48/0.81) and end at t=9500. `test/fixtures/transcript-basic.json`: Groq verbose_json shape with words "so this logo is the old one and the text here runs on too long", with "this" at 3.2s and "here" at 7.8s. These fixtures are shared by moments, export and render tests.

- [ ] **Step 7:** `yarn check` passes. Commit `feat(core): shared types, copy, test ids, config, format, fixtures`.

### Task R1: Review Phase 1 — `review`
Review the diff `spec/video-feedback-design..feat/video-feedback`. Check: lowprio applied to every heavy script; TS 7 decision documented; contracts match spec sections 4, 6 and 9 exactly (field names, units); copy matches spec section 5 and has no em-dashes; fixtures realistic. Output schema: `{ verdict: 'pass' | 'fix', findings: [{ severity: 'critical'|'high'|'medium'|'low', file, line, issue, fix }] }`.

---

## Phase 2: Core libraries (parallel, worktrees)

All Phase 2 tasks depend only on Phase 1. They touch disjoint files.

### Task 2.1: Storage — `build` (worktree)

**Files:** `lib/storage/{paths,json,ids,chunks,repo}.ts` and tests alongside.

**Contract:**
```ts
// paths.ts
export const ID_RE: RegExp;                       // /^[a-z0-9][a-z0-9-]{2,63}$/ for videoId; UUIDs for session/comment
export function assertSafeId(id: string, kind: 'video' | 'session' | 'comment'): void; // throws on traversal etc.
export function videoDir(videoId: string): string;
export function versionDir(videoId: string, version: number): string;
export function sourcePath(videoId: string, version: number): string;
export function sessionDir(videoId: string, sessionId: string): string;
export function commentDir(ref: CommentRef): string;
export function inboxDir(): string;
// json.ts
export async function writeJsonAtomic(path: string, data: unknown): Promise<void>; // tmp file + rename, mkdir -p
export async function readJson<T>(path: string): Promise<T | null>;              // null if missing
// ids.ts
export function newToken(): string;               // 32 random bytes, base64url (43 chars)
export function newVideoId(title: string): string; // slugify(title) + '-' + 4 chars [a-z0-9]
export function isUuid(s: string): boolean;
// chunks.ts
export async function putChunk(dir: string, seq: number, audio: Buffer, events: CaptureEvent[]):
  Promise<'stored' | 'duplicate'>;
export async function missingChunks(dir: string, total: number): Promise<number[]>;
export async function storedBytes(dir: string): Promise<number>;
// repo.ts
export async function createVideo(title: string): Promise<VideoRecord>;
export async function getVideo(videoId: string): Promise<VideoRecord | null>;
export async function findVideoByToken(token: string): Promise<VideoRecord | null>; // constant-time compare
export async function listVideos(): Promise<VideoRecord[]>;
export async function saveVideo(v: VideoRecord): Promise<void>;
export async function createSession(videoId: string, version: number, name: string, ua: string): Promise<SessionRecord>;
export async function getSession(videoId: string, sessionId: string): Promise<SessionRecord | null>;
export async function saveSession(s: SessionRecord): Promise<void>;
export async function listSessions(videoId: string): Promise<SessionRecord[]>;
export async function listComments(videoId: string, sessionId: string): Promise<CommentRef[]>;
export async function readCommentMeta(ref: CommentRef): Promise<CommentMeta | null>;
export async function writeCommentMeta(ref: CommentRef, meta: CommentMeta): Promise<void>;
```

- [ ] **Step 1: Failing tests** (`lib/storage/*.test.ts`, each using `withTmpData()`):
```ts
it('rejects path traversal and odd ids', () => {
  for (const bad of ['../x', 'a/b', '', '..', 'A B', 'x'.repeat(80)]) {
    expect(() => assertSafeId(bad, 'video')).toThrow();
  }
  expect(() => assertSafeId('not-a-uuid', 'session')).toThrow();
});
it('writeJsonAtomic never leaves a partial file', async () => {
  await writeJsonAtomic(join(dir, 'a/b.json'), { x: 1 });
  expect(await readJson(join(dir, 'a/b.json'))).toEqual({ x: 1 });
  expect((await readdir(join(dir, 'a'))).filter((f) => f.includes('.tmp'))).toEqual([]);
});
it('putChunk is idempotent', async () => {
  expect(await putChunk(d, 0, Buffer.from('a'), [])).toBe('stored');
  expect(await putChunk(d, 0, Buffer.from('DIFFERENT'), [])).toBe('duplicate');
  expect(await readFile(join(d, 'chunks/0.bin'), 'utf8')).toBe('a');
});
it('missingChunks lists gaps', async () => {
  await putChunk(d, 0, Buffer.from('a'), []); await putChunk(d, 2, Buffer.from('c'), []);
  expect(await missingChunks(d, 4)).toEqual([1, 3]);
});
it('findVideoByToken finds by token and ignores near misses', async () => {
  const v = await createVideo('Mavala launch');
  expect((await findVideoByToken(v.token))?.videoId).toBe(v.videoId);
  expect(await findVideoByToken(v.token.slice(0, -1) + 'x')).toBeNull();
});
it('newToken is 43 url-safe chars', () => expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/));
```
- [ ] **Step 2:** Run, see failures. **Step 3:** Implement. Chunk writes go to `chunks/<seq>.bin` and `events/<seq>.json` using `open(path, 'wx')` (exclusive create) so concurrent duplicates cannot both write. `findVideoByToken` keeps an in-memory map invalidated when `saveVideo` runs, and uses `crypto.timingSafeEqual` on equal-length buffers. **Step 4:** Tests pass, `yarn check`. **Step 5:** Commit `feat(storage): file layout, atomic json, idempotent chunks, repo`.

### Task 2.2: Geometry — `build` (worktree)

**Files:** `lib/geometry.ts`, `lib/geometry.test.ts`

**Code:**
```ts
import type { Rect, ZoomState } from '@/lib/types';

/** Picture rectangle inside a container for object-fit: contain, relative to the container. */
export function containRect(cw: number, ch: number, vw: number, vh: number): Rect {
  if (cw <= 0 || ch <= 0 || vw <= 0 || vh <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(cw / vw, ch / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { x: (cw - width) / 2, y: (ch - height) / 2, width, height };
}

/** Container-relative pixel point to normalised on-screen picture coordinates (unzoomed). */
export function normalise(px: number, py: number, content: Rect): { x: number; y: number; inside: boolean } {
  const x = content.width ? (px - content.x) / content.width : 0;
  const y = content.height ? (py - content.y) / content.height : 0;
  return { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

/** On-screen normalised point while zoomed -> full-frame normalised point. */
export function unzoom(sx: number, sy: number, z: ZoomState | null): { x: number; y: number } {
  if (!z || z.scale === 1) return { x: sx, y: sy };
  return { x: z.originX + (sx - z.originX) / z.scale, y: z.originY + (sy - z.originY) / z.scale };
}

/** Full-frame region visible while zoomed, normalised. */
export function visibleRegion(z: ZoomState): Rect {
  const width = 1 / z.scale;
  const height = 1 / z.scale;
  return { x: z.originX - z.originX * width, y: z.originY - z.originY * height, width, height };
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const COLS = ['left', 'centre', 'right'] as const;
const ROWS = ['top', 'middle', 'bottom'] as const;
export function positionLabel(x: number, y: number): string {
  if (x < 0 || x > 1 || y < 0 || y > 1) return 'off-picture';
  const c = COLS[Math.min(2, Math.floor(x * 3))];
  const r = ROWS[Math.min(2, Math.floor(y * 3))];
  if (r === 'middle' && c === 'centre') return 'centre';
  if (r === 'middle') return `middle-${c}`;
  return `${r}-${c}`;
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}
```

- [ ] **Step 1: Failing tests**
```ts
describe('containRect', () => {
  it('letterboxes a 16:9 video in a 4:3 box', () =>
    expect(containRect(800, 600, 1920, 1080)).toEqual({ x: 0, y: 75, width: 800, height: 450 }));
  it('pillarboxes a 9:16 video in a 16:9 box', () => {
    const r = containRect(1600, 900, 1080, 1920);
    expect(r.height).toBe(900); expect(r.width).toBeCloseTo(506.25); expect(r.x).toBeCloseTo(546.875);
  });
  it('handles zero sizes', () => expect(containRect(0, 0, 1920, 1080).width).toBe(0));
});
describe('normalise', () => {
  const content = { x: 0, y: 75, width: 800, height: 450 };
  it('maps centre', () => expect(normalise(400, 300, content)).toEqual({ x: 0.5, y: 0.5, inside: true }));
  it('flags the black bar as outside', () => expect(normalise(400, 10, content).inside).toBe(false));
});
describe('unzoom', () => {
  it('is identity without zoom', () => expect(unzoom(0.3, 0.7, null)).toEqual({ x: 0.3, y: 0.7 }));
  it('keeps the origin fixed', () =>
    expect(unzoom(0.4, 0.6, { scale: 2.5, originX: 0.4, originY: 0.6 })).toEqual({ x: 0.4, y: 0.6 }));
  it('maps the top-left screen corner into the zoomed region', () => {
    const p = unzoom(0, 0, { scale: 2, originX: 0.5, originY: 0.5 });
    expect(p.x).toBeCloseTo(0.25); expect(p.y).toBeCloseTo(0.25);
  });
  it('round-trips with the CSS transform maths', () => {
    const z = { scale: 2.5, originX: 0.2, originY: 0.9 };
    const frame = { x: 0.25, y: 0.85 };
    const screen = { x: z.originX + (frame.x - z.originX) * z.scale, y: z.originY + (frame.y - z.originY) * z.scale };
    const back = unzoom(screen.x, screen.y, z);
    expect(back.x).toBeCloseTo(frame.x); expect(back.y).toBeCloseTo(frame.y);
  });
});
describe('visibleRegion', () => {
  it('is the full frame at scale 1', () =>
    expect(visibleRegion({ scale: 1, originX: 0.3, originY: 0.3 })).toEqual({ x: 0, y: 0, width: 1, height: 1 }));
  it('anchors at the origin', () => {
    const r = visibleRegion({ scale: 2, originX: 1, originY: 0 });
    expect(r).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });
});
describe('positionLabel', () => {
  it.each([
    [0.1, 0.1, 'top-left'], [0.5, 0.1, 'top-centre'], [0.9, 0.5, 'middle-right'],
    [0.5, 0.5, 'centre'], [0.5, 0.9, 'bottom-centre'], [1, 1, 'bottom-right'], [1.2, 0.5, 'off-picture'],
  ])('(%s,%s) -> %s', (x, y, l) => expect(positionLabel(x, y)).toBe(l));
});
```
- [ ] **Step 2-4:** Run failing, implement the code above, pass, `yarn check`. **Step 5:** Commit `feat(geometry): contain rect, normalise, zoom maths, labels`.

### Task 2.3: Moment selection — `build` (worktree)

**Files:** `lib/moments.ts`, `lib/moments.test.ts`

**Code:**
```ts
import {
  DEICTIC_WORDS, DWELL_MS, DWELL_RADIUS, KEY_STEP_COLLAPSE_MS, MAX_MOMENTS, MERGE_DIST, MERGE_MS, ZOOM_END_MOVE,
} from '@/lib/constants';
import { formatVideoTime } from '@/lib/format';
import { distance } from '@/lib/geometry';
import type { CaptureEvent, CommentKind, Moment, MomentKind, Transcript, ZoomState } from '@/lib/types';

const PRIORITY: MomentKind[] = ['click', 'zoom', 'word', 'dwell', 'seek', 'pause'];
type PointerSample = { t: number; x: number; y: number; inside: boolean };
interface Candidate { t: number; vt: number; x: number; y: number; inside: boolean; zoom: ZoomState | null; kinds: MomentKind[]; reasons: string[] }

export interface SelectInput {
  kind: CommentKind;
  pausedAtVideoTime: number | null;
  durationMs: number;
  events: CaptureEvent[];
  transcript: Transcript | null;
}

export function pointerSamples(events: CaptureEvent[]): PointerSample[] {
  return events
    .filter((e): e is Extract<CaptureEvent, { type: 'pointer' | 'click' }> => e.type === 'pointer' || e.type === 'click')
    .map(({ t, x, y, inside }) => ({ t, x, y, inside }))
    .sort((a, b) => a.t - b.t);
}

export function pointerAt(samples: PointerSample[], t: number): PointerSample | null {
  let found: PointerSample | null = null;
  for (const s of samples) {
    if (s.t > t) break;
    found = s;
  }
  return found;
}

export function videoTimeAt(events: CaptureEvent[], t: number, pausedAt: number): number {
  let vt = pausedAt;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'seek') vt = e.to;
  }
  return vt;
}

export function zoomAt(events: CaptureEvent[], t: number): ZoomState | null {
  let z: ZoomState | null = null;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'zoom') z = e.state === 'start' ? { scale: e.scale, originX: e.originX, originY: e.originY } : null;
    if (e.type === 'zoomPan' && z) z = { ...z, originX: e.originX, originY: e.originY };
  }
  return z;
}

export function detectDwells(samples: PointerSample[], endT: number): { t: number; x: number; y: number; inside: boolean; ms: number }[] {
  const out: { t: number; x: number; y: number; inside: boolean; ms: number }[] = [];
  let i = 0;
  while (i < samples.length) {
    const anchor = samples[i];
    let j = i + 1;
    while (j < samples.length && distance(samples[j], anchor) <= DWELL_RADIUS) j++;
    const until = j < samples.length ? samples[j].t : endT;
    const ms = until - anchor.t;
    if (ms >= DWELL_MS) out.push({ t: (anchor.t + until) / 2, x: anchor.x, y: anchor.y, inside: anchor.inside, ms });
    i = j;
  }
  return out;
}

const norm = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');

export function selectMoments(input: SelectInput): Moment[] {
  if (input.kind === 'general' || input.pausedAtVideoTime === null) return [];
  const { events, durationMs } = input;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const samples = pointerSamples(sorted);
  const paused = input.pausedAtVideoTime;
  const at = (t: number, kind: MomentKind, reason: string, pos?: { x: number; y: number; inside: boolean }, vt?: number): Candidate => {
    const p = pos ?? pointerAt(samples, t) ?? { x: 0.5, y: 0.5, inside: true };
    return { t, vt: vt ?? videoTimeAt(sorted, t, paused), x: p.x, y: p.y, inside: p.inside, zoom: zoomAt(sorted, t), kinds: [kind], reasons: [reason] };
  };

  const cands: Candidate[] = [];
  const first = samples[0];
  cands.push(at(first?.t ?? 0, 'pause', 'pause', first ?? { x: 0.5, y: 0.5, inside: true }, paused));

  for (const e of sorted) if (e.type === 'click') cands.push(at(e.t, 'click', 'click', e));

  for (const d of detectDwells(samples, durationMs))
    cands.push(at(d.t, 'dwell', `dwell ${(d.ms / 1000).toFixed(1)}s`, d));

  for (const w of input.transcript?.words ?? []) {
    const word = norm(w.word);
    if ((DEICTIC_WORDS as readonly string[]).includes(word)) {
      const t = Math.round(w.start * 1000);
      cands.push(at(t, 'word', `word '${word}' at ${w.start.toFixed(1)}s`));
    }
  }

  const seeks = sorted.filter((e): e is Extract<CaptureEvent, { type: 'seek' }> => e.type === 'seek');
  seeks.forEach((s, i) => {
    const next = seeks[i + 1];
    const collapsed = s.via === 'key' && next?.via === 'key' && next.t - s.t <= KEY_STEP_COLLAPSE_MS;
    if (!collapsed) cands.push(at(s.t, 'seek', `scrolled to ${formatVideoTime(s.to)}`, undefined, s.to));
  });

  let zoomStart: Candidate | null = null;
  for (const e of sorted) {
    if (e.type !== 'zoom') continue;
    if (e.state === 'start') {
      zoomStart = at(e.t, 'zoom', 'zoom in');
      cands.push(zoomStart);
    } else if (zoomStart) {
      const end = pointerAt(samples, e.t);
      if (end && distance(end, zoomStart) > ZOOM_END_MOVE) {
        const c = at(e.t, 'zoom', 'zoomed view, moved', end);
        c.zoom = zoomAt(sorted, e.t - 1);
        cands.push(c);
      }
      zoomStart = null;
    }
  }

  // merge
  cands.sort((a, b) => a.t - b.t);
  const merged: Candidate[] = [];
  for (const c of cands) {
    const m = merged.find((x) => Math.abs(x.t - c.t) <= MERGE_MS && distance(x, c) <= MERGE_DIST);
    if (!m) { merged.push({ ...c, kinds: [...c.kinds], reasons: [...c.reasons] }); continue; }
    const better = rank(c.kinds) < rank(m.kinds);
    if (better) Object.assign(m, { t: c.t, vt: c.vt, x: c.x, y: c.y, inside: c.inside, zoom: c.zoom ?? m.zoom });
    for (const k of c.kinds) if (!m.kinds.includes(k)) m.kinds.push(k);
    m.reasons.push(...c.reasons);
  }

  const kept = [...merged]
    .sort((a, b) => rank(a.kinds) - rank(b.kinds) || a.t - b.t)
    .slice(0, MAX_MOMENTS)
    .sort((a, b) => a.t - b.t);

  return kept.map((c, i) => ({
    id: `moment-${String(i + 1).padStart(2, '0')}`,
    t: c.t, vt: c.vt, x: c.x, y: c.y, inside: c.inside, zoom: c.zoom,
    kinds: [...c.kinds].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b)),
    reasons: c.reasons,
  }));
}

function rank(kinds: MomentKind[]): number {
  return Math.min(...kinds.map((k) => PRIORITY.indexOf(k)));
}

/** Pointer position at the time each word was spoken (for feedback.json). */
export function wordsWithPointer(transcript: Transcript, events: CaptureEvent[], pausedAt: number | null) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const samples = pointerSamples(sorted);
  return transcript.words.map((w) => {
    const t = Math.round(w.start * 1000);
    const p = pointerAt(samples, t);
    return {
      ...w,
      pointer: p && pausedAt !== null ? { x: p.x, y: p.y, inside: p.inside, vt: videoTimeAt(sorted, t, pausedAt) } : null,
    };
  });
}
```

- [ ] **Step 1: Failing tests** using `test/fixtures/events-basic.json` and `transcript-basic.json` plus small inline cases:
```ts
const base = { kind: 'moment' as const, pausedAtVideoTime: 12.4, durationMs: 12000 };

it('returns nothing for general comments', () =>
  expect(selectMoments({ ...base, kind: 'general', pausedAtVideoTime: null, events, transcript })).toEqual([]));

it('always includes a pause moment at the paused frame', () => {
  const m = selectMoments({ ...base, events: [], transcript: null });
  expect(m).toHaveLength(1);
  expect(m[0]).toMatchObject({ id: 'moment-01', vt: 12.4, x: 0.5, y: 0.5, kinds: ['pause'] });
});

it('detects a dwell only when the pointer rests 400ms or more', () => {
  const ev = [p(0, 0.3, 0.3), p(100, 0.305, 0.3), p(450, 0.6, 0.6), p(500, 0.9, 0.9)];
  const d = detectDwells(pointerSamples(ev), 1000);
  expect(d.map((x) => [x.x, Math.round(x.ms)])).toEqual([[0.3, 450], [0.9, 500]]);
});

it("aligns the word 'this' with where the pointer was at 3.2s", () => {
  const m = selectMoments({ ...base, events, transcript });
  const word = m.find((x) => x.reasons.some((r) => r.startsWith("word 'this'")))!;
  expect(word.x).toBeCloseTo(0.12); expect(word.y).toBeCloseTo(0.08);
  expect(word.kinds).toContain('dwell'); // merged with the dwell at the same spot
});

it('uses the seek destination as video time after scrolling', () => {
  const m = selectMoments({ ...base, events, transcript });
  expect(m.find((x) => x.kinds.includes('click'))!.vt).toBe(9.0);
});

it('collapses rapid arrow-key steps into the final frame', () => {
  const ev = [seek(1000, 12.4, 12.36, 'key'), seek(1200, 12.36, 12.32, 'key'), seek(1400, 12.32, 12.28, 'key')];
  const seeks = selectMoments({ ...base, events: ev, transcript: null }).filter((x) => x.kinds.includes('seek'));
  expect(seeks).toHaveLength(1); expect(seeks[0].vt).toBe(12.28);
});

it('records zoom state on moments taken while zoomed', () => {
  const m = selectMoments({ ...base, events, transcript });
  const z = m.find((x) => x.kinds.includes('zoom'))!;
  expect(z.zoom).toEqual({ scale: 2.5, originX: 0.48, originY: 0.81 });
});

it('caps at 12 moments, keeping clicks before dwells, in time order', () => {
  const ev = Array.from({ length: 20 }, (_, i) => click(i * 1000, (i % 10) / 10 + 0.05, 0.5));
  const m = selectMoments({ ...base, durationMs: 21000, events: ev, transcript: null });
  expect(m).toHaveLength(12);
  expect(m.every((x) => x.kinds.includes('click'))).toBe(true);
  expect(m.map((x) => x.t)).toEqual([...m.map((x) => x.t)].sort((a, b) => a - b));
  expect(m.map((x) => x.id)).toEqual(Array.from({ length: 12 }, (_, i) => `moment-${String(i + 1).padStart(2, '0')}`));
});

it('attaches pointer positions to every word', () => {
  const w = wordsWithPointer(transcript, events, 12.4);
  expect(w.find((x) => x.word.trim() === 'this')!.pointer).toMatchObject({ x: 0.12, y: 0.08 });
});
```
(`p`, `click`, `seek` are tiny event factory helpers defined in the test file.)
- [ ] **Step 2-4:** Fail, implement, pass, `yarn check`. **Step 5:** Commit `feat(moments): key-moment selection with merge, cap and word alignment`.

### Task 2.4: Media helpers — `build` (worktree)

**Files:** `lib/media/{run,probe,ops}.ts` and tests. Tests use `test/fixtures/generated/*` (via the Vitest global setup from Task 1.2).

**Contract:**
```ts
// run.ts: every child process runs at low priority
export interface RunResult { code: number; stdout: Buffer; stderr: string }
export function lowPrioArgv(cmd: string, args: string[]): [string, string[]]; // ['ionice', ['-c2','-n7','nice','-n19',cmd,...args]] or nice-only fallback
export async function run(cmd: string, args: string[], opts?: { input?: Buffer | NodeJS.ReadableStream; timeoutMs?: number }): Promise<RunResult>;
export function spawnLowPrio(cmd: string, args: string[]): import('node:child_process').ChildProcess;
// probe.ts
export async function probe(file: string): Promise<ProbeInfo>;
export function checkBrowserSafe(p: ProbeInfo, container: string): { ok: true } | { ok: false; reason: string };
// ops.ts
export async function remuxFaststart(src: string, dst: string): Promise<void>;     // -c copy -movflags +faststart, writes dst.tmp then renames
export async function extractFrame(src: string, vt: number, maxWidth: number): Promise<Buffer>; // PNG, accurate seek (-ss after -i)
export async function toWav16k(src: string, dst: string): Promise<void>;
export async function detectSpeech(wav: string): Promise<{ hasSpeech: boolean; speechSeconds: number }>; // silencedetect noise=-40dB:d=0.5
export async function concatChunks(chunkPaths: string[], dst: string): Promise<void>; // byte concat
export async function audioDuration(file: string): Promise<number>;
```

- [ ] **Step 1: Failing tests**
```ts
it('wraps commands in ionice and nice', () => {
  const [cmd, args] = lowPrioArgv('ffmpeg', ['-version']);
  expect([cmd, ...args].join(' ')).toMatch(/^(ionice -c2 -n7 nice -n19|nice -n19) ffmpeg -version$/);
});
it('probes the h264 fixture', async () => {
  const p = await probe(fx('h264.mp4'));
  expect(p).toMatchObject({ codec: 'h264', pixFmt: 'yuv420p', width: 640, height: 360, hasAudio: true });
  expect(p.fps).toBeCloseTo(25); expect(p.frameDuration).toBeCloseTo(0.04); expect(p.duration).toBeCloseTo(4, 0);
});
it('rejects non-h264 and 10-bit', async () => {
  expect(checkBrowserSafe(await probe(fx('mpeg4.mp4')), 'mp4')).toEqual({ ok: false, reason: expect.stringMatching(/H\.264/) });
  if (existsSync(fx('h264-10bit.mp4')))
    expect(checkBrowserSafe(await probe(fx('h264-10bit.mp4')), 'mp4')).toEqual({ ok: false, reason: expect.stringMatching(/8-bit/) });
});
it('remuxes to faststart (moov before mdat)', async () => {
  await remuxFaststart(fx('h264-nofaststart.mp4'), out('fast.mp4'));
  const head = (await readFile(out('fast.mp4'))).subarray(0, 4096).toString('latin1');
  expect(head.indexOf('moov')).toBeGreaterThan(-1);
  expect(head.indexOf('moov')).toBeLessThan(head.indexOf('mdat') === -1 ? Infinity : head.indexOf('mdat'));
});
it('extracts a frame scaled to max width', async () => {
  const png = await extractFrame(fx('h264.mp4'), 2.0, 320);
  const meta = await sharp(png).metadata();
  expect(meta.width).toBe(320); expect(meta.height).toBe(180);
});
it('tells speech from silence', async () => {
  expect((await detectSpeech(fx('speech-like.wav'))).hasSpeech).toBe(true);
  expect((await detectSpeech(fx('silence.wav'))).hasSpeech).toBe(false);
});
```
Validation rules: codec must be `h264`, `pix_fmt` must be `yuv420p` or `yuvj420p` (reason for others: "Video is 10-bit or uses an unusual colour format; export as 8-bit 4:2:0 H.264"), container must include `mp4`, duration > 0. Reason for wrong codec: "Video must be H.264 (this file is <codec>)".
- [ ] **Step 2-4:** Fail, implement, pass. **Step 5:** Commit `feat(media): low-priority ffmpeg wrappers, probe, validation`.

### Task 2.5: Admin auth — `build` (worktree)

**Files:** `lib/auth/access.ts`, `lib/auth/guard.ts`, tests.

**Contract:**
```ts
// access.ts
export interface AccessIdentity { email: string | null; serviceToken: boolean; sub: string }
export async function verifyAccessJwt(jwt: string, opts: { teamDomain: string; aud: string; jwks?: JWTVerifyGetKey }): Promise<AccessIdentity>;
// guard.ts
export async function checkAdmin(req: Request): Promise<{ ok: true; identity: AccessIdentity | null } | { ok: false; response: Response }>;
export function withAdmin<C>(handler: (req: Request, ctx: C) => Promise<Response>): (req: Request, ctx: C) => Promise<Response>;
export async function requireAdminPage(): Promise<AccessIdentity | null>; // for server components; uses next/headers, calls notFound() on failure
```
Behaviour: reads `Cf-Access-Jwt-Assertion` header; verifies RS256 against `https://<teamDomain>/cdn-cgi/access/certs` (cached remote JWKS), issuer `https://<teamDomain>`, audience `CF_ACCESS_AUD`. Service tokens have no `email` claim but have `common_name`. With `adminAuth === 'off'`, returns ok with identity null. Failures return `401 {"error":"unauthorised"}` with no detail.

- [ ] **Step 1: Failing tests** (generate an RSA key pair with `jose.generateKeyPair('RS256')`, build a local JWKS with `createLocalJWKSet`, sign tokens with `SignJWT`):
```ts
it('accepts a valid user token', async () => {
  const id = await verifyAccessJwt(await sign({ email: 'tim@example.com' }), { teamDomain, aud, jwks });
  expect(id).toEqual({ email: 'tim@example.com', serviceToken: false, sub: expect.any(String) });
});
it('accepts a service token (no email, has common_name)', async () => {
  const id = await verifyAccessJwt(await sign({ common_name: 'abc.access' }), { teamDomain, aud, jwks });
  expect(id.serviceToken).toBe(true);
});
it.each([
  ['wrong audience', { aud: 'other' }],
  ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }],
  ['wrong issuer', { iss: 'https://evil.cloudflareaccess.com' }],
])('rejects %s', async (_n, over) => {
  await expect(verifyAccessJwt(await sign({ email: 'x@y.z' }, over), { teamDomain, aud, jwks })).rejects.toThrow();
});
it('withAdmin returns 401 without header and calls through with ADMIN_AUTH=off', async () => {
  process.env.ADMIN_AUTH = 'cloudflare'; process.env.CF_ACCESS_TEAM_DOMAIN = teamDomain; process.env.CF_ACCESS_AUD = aud; resetConfigForTests();
  const h = withAdmin(async () => new Response('ok'));
  expect((await h(new Request('http://x/api/admin/videos'), {})).status).toBe(401);
  process.env.ADMIN_AUTH = 'off'; resetConfigForTests();
  expect(await (await h(new Request('http://x/api/admin/videos'), {})).text()).toBe('ok');
});
```
- [ ] **Step 2-4:** Fail, implement, pass. **Step 5:** Commit `feat(auth): Cloudflare Access JWT verification and admin guard`.

### Task R2: No per-task review in Phase 2
Phase 2 modules are small and pure or thin, with complete tests written into this plan. The workflow builds them as three agents (2.1 + 2.5, 2.2 + 2.3, 2.4) and relies on TDD plus the T2 test gate. Their security points (path traversal, timing-safe compare, JWT pinning) are re-checked in the Phase 6 security lens.

### Task I2: Integrate Phase 2 — `build` (main tree)
Merge each Phase 2 branch into `feat/video-feedback` (`git merge --no-ff <branch>`), resolve conflicts, apply any `sharedChangesNeeded`, run `yarn install` (if lockfile changed) and `yarn check`. Remove merged worktrees (`git worktree remove`). Output `{ merged: string[], checkPassing: boolean, failures: string[] }`.

### Task T2: Test gate Phase 2 — `test`
Run `yarn check` and `yarn test:coverage`. Compare tests to the contracts above and spec sections; add missing tests for any untested contract item (for example an id kind, a validation branch, a zoom edge case). Commit `test(core): ...`. Output `{ passing: boolean, failures: string[], testsAdded: string[] }`. If `passing` is false, a `fix-tests` agent fixes the code (not the tests, unless the test contradicts the spec) and re-runs until green (max 2 rounds).

---

## Phase 3: Server features and capture library (parallel, worktrees)

### Task 3.1: Video import and inbox API — `build` (worktree)

**Files:** `lib/videos/import.ts`, `lib/videos/import.test.ts`, `app/api/admin/inbox/route.ts`, `app/api/admin/videos/route.ts`, `scripts/cli/import.ts`, `lib/admin/summary.ts`, `lib/admin/summary.test.ts`

**Contract:**
```ts
export async function listInbox(): Promise<InboxFile[]>;                    // *.mp4 / *.m4v / *.mov in inboxDir, sorted newest first
export async function importFromInbox(req: ImportRequest): Promise<ImportResult>;
export async function summariseVideos(publicBaseUrl: string): Promise<AdminVideoSummary[]>; // lib/admin/summary.ts
```
`importFromInbox`: rejects filenames containing `/` or `..`; probes; validates with `checkBrowserSafe`; for `new` creates the video; for `version` uses `latestVersion + 1`; remuxes into `versions/<n>/source.mp4`; writes `probe.json`; updates `video.json` (`latestVersion`, `versions[]`) atomically; deletes the inbox file only after success. A per-video in-process lock prevents two versions racing.

Routes (wrapped in `withAdmin`): `GET /api/admin/inbox` returns `InboxFile[]`; `POST /api/admin/inbox` body `ImportRequest` returns `ImportResult` (400 on `ok:false`); `GET /api/admin/videos` returns `AdminVideoSummary[]` with `reviewUrl = ${publicBaseUrl}/r/${token}`. CLI: `yarn import <file> --title "..."` or `--video <videoId>` (copies an arbitrary path into the inbox first, then imports, then prints the review URL).

- [ ] **Step 1: Failing tests**
```ts
it('imports a new video and removes it from the inbox', async () => {
  await copyFile(fx('h264-nofaststart.mp4'), join(inboxDir(), 'film.mp4'));
  const r = await importFromInbox({ filename: 'film.mp4', mode: 'new', title: 'Launch film' });
  expect(r).toEqual({ ok: true, videoId: expect.stringMatching(/^launch-film-[a-z0-9]{4}$/), version: 1 });
  expect(existsSync(join(inboxDir(), 'film.mp4'))).toBe(false);
  expect(existsSync(sourcePath(r.ok ? r.videoId : '', 1))).toBe(true);
});
it('adds version 2 to an existing video', async () => { /* import twice, second with mode 'version' */ });
it('rejects a non-H.264 file and leaves it in the inbox', async () => {
  await copyFile(fx('mpeg4.mp4'), join(inboxDir(), 'bad.mp4'));
  const r = await importFromInbox({ filename: 'bad.mp4', mode: 'new', title: 'x' });
  expect(r).toEqual({ ok: false, reason: expect.stringMatching(/H\.264/) });
  expect(existsSync(join(inboxDir(), 'bad.mp4'))).toBe(true);
});
it('rejects traversal in filenames', async () =>
  expect(await importFromInbox({ filename: '../etc/passwd', mode: 'new', title: 'x' })).toMatchObject({ ok: false }));
it('summarises counts per version including pending processing', async () => { /* seed sessions/comments with status files and assert counts */ });
it('inbox route requires admin', async () => { /* ADMIN_AUTH=cloudflare, no header -> 401 */ });
```
- [ ] **Step 2-4:** Fail, implement, pass. **Step 5:** Commit `feat(videos): inbox import with validation, versions, admin list API`.

### Task 3.2: Reviewer API — `build` (worktree)

**Files:** `lib/review/service.ts`, `lib/review/range.ts`, `lib/review/ratelimit.ts`, tests, and the six route files under `app/api/r/[token]/...`.

**Contract (service):**
```ts
export async function resolveToken(token: string): Promise<VideoRecord | null>;
export async function startSession(token: string, body: CreateSessionBody): Promise<CreateSessionResult | null>;
export async function readSession(token: string, sid: string): Promise<GetSessionResult | null>;
export async function receiveChunk(token: string, sid: string, cid: string, seq: number,
  form: { audio: Blob; events: CaptureEvent[]; meta?: CommentMeta }): Promise<{ status: 200 | 404 | 413 | 429 | 400; body: unknown }>;
export async function completeComment(token: string, sid: string, cid: string, body: CompleteBody):
  Promise<{ status: 200 | 404 | 409; body: CompleteResult | MissingChunksResult | unknown }>;
export async function finishSession(token: string, sid: string): Promise<boolean>;
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null;
```
Rules:
- Unknown token or session/video mismatch: 404 `{ "error": "not found" }`.
- `reviewerName` trimmed, 1 to 80 chars, else 400.
- `startSession` pins `version = video.latestVersion`.
- `seq` 0 must include `meta`; the service writes `meta.json` (`kind`, `pausedAtVideoTime`, `startedAt`, `audioMime`, `player`, `version` forced to the session's version) and `status.json` with `state: 'receiving'`.
- Chunk > `MAX_CHUNK_BYTES`: 413. Comment total > `MAX_COMMENT_BYTES`: 413. More than `MAX_CHUNK_REQUESTS_PER_MIN` per session per rolling minute: 429.
- `events` validated: array of objects with numeric `t` and a known `type`, max 20,000 per chunk; invalid entries dropped, not fatal.
- `completeComment`: 409 with `missing` if chunks are absent; otherwise updates meta (`totalChunks`, `endedAt`, `durationMs`, `player`, `micLost`), sets status `queued`, calls `notifyCommentComplete(ref)`, returns 200. Idempotent: completing twice returns 200 and does not enqueue twice (status already beyond `receiving`).
- Video route: `GET /api/r/<token>/video?version=<n>`: 200 full or 206 partial with `Accept-Ranges: bytes`, `Content-Range`, `Content-Type: video/mp4`, `Cache-Control: private, max-age=3600`; 416 for unsatisfiable ranges. Streams with `fs.createReadStream` converted via `Readable.toWeb`. Version must exist on that video.
- Routes are thin: parse request, call service, map to `Response.json`. Route params are awaited (`const { token } = await params`).

- [ ] **Step 1: Failing tests** (service-level, with `withTmpData()` and a seeded video):
```ts
it('starts a session pinned to the latest version', async () => {
  expect(await startSession(token, { reviewerName: ' Sarah ', userAgent: 'ua' })).toEqual({ sessionId: expect.any(String), version: 2 });
});
it('404s for a wrong token', async () => expect(await startSession('nope', { reviewerName: 'S', userAgent: '' })).toBeNull());
it('stores chunks idempotently and completes when all are present', async () => {
  await receiveChunk(token, sid, cid, 0, { audio: blob('a'), events: [ev], meta });
  expect((await completeComment(token, sid, cid, { ...complete, totalChunks: 2 })).status).toBe(409);
  await receiveChunk(token, sid, cid, 1, { audio: blob('b'), events: [] });
  await receiveChunk(token, sid, cid, 1, { audio: blob('b'), events: [] });
  const notified: CommentRef[] = []; setCommentCompleteHandler((r) => notified.push(r));
  expect((await completeComment(token, sid, cid, { ...complete, totalChunks: 2 })).status).toBe(200);
  expect((await completeComment(token, sid, cid, { ...complete, totalChunks: 2 })).status).toBe(200);
  expect(notified).toHaveLength(1);
});
it('rejects oversized chunks with 413', async () => { /* Blob of MAX_CHUNK_BYTES + 1 */ });
it('rate-limits a flood with 429', async () => { /* 121 calls in a loop with fake timers */ });
it('rejects a session id from another video', async () => { /* 404 */ });
it.each([
  ['bytes=0-99', 1000, { start: 0, end: 99 }], ['bytes=900-', 1000, { start: 900, end: 999 }],
  ['bytes=-100', 1000, { start: 900, end: 999 }], ['bytes=2000-', 1000, 'invalid'], [null, 1000, null],
])('parseRange(%s)', (h, size, out) => expect(parseRange(h, size)).toEqual(out));
```
Plus one route-level test calling the `GET` export of `app/api/r/[token]/video/route.ts` with a `Range` header and asserting 206 and the `Content-Range`.
- [ ] **Step 2-4:** Fail, implement, pass. **Step 5:** Commit `feat(review-api): sessions, chunked uploads, completion, ranged video`.

### Task 3.3: Processing pipeline — `build` (worktree)

**Files:** `lib/pipeline/{queue,status,process}.ts`, `lib/pipeline/steps/{assemble,silence,transcribe,moments}.ts`, `instrumentation.ts`, `app/api/admin/videos/[videoId]/reprocess/route.ts`, `scripts/cli/reprocess.ts`, tests.

The `stills` and `clip` steps call into `lib/render` (Task 3.4). To keep tasks parallel, this task defines the step interface and registers render steps through an injectable map; Task 3.4 provides `lib/pipeline/steps/stills.ts` and `clip.ts`. Until integration, `process.ts` imports them from `lib/pipeline/steps/index.ts`, which this task creates with `stills` and `clip` entries that throw `new Error('render not wired')`; Task I3 replaces them with the real imports.

**Contract:**
```ts
// status.ts
export function initialStatus(): CommentStatus;   // state receiving, all steps pending
export async function readStatus(ref: CommentRef): Promise<CommentStatus | null>;
export async function updateStatus(ref: CommentRef, patch: Partial<CommentStatus> & { steps?: Partial<CommentStatus['steps']> }): Promise<CommentStatus>;
// steps: each is (ctx: StepContext) => Promise<void>, StepContext = { ref, dir, meta, probe, log }
export type StepFn = (ctx: StepContext) => Promise<void>;
// queue.ts
export class ProcessingQueue {
  constructor(opts: { process: (ref: CommentRef) => Promise<void>; priority?: (ref: CommentRef) => number });
  enqueue(ref: CommentRef): void;        // dedupes by commentId
  get size(): number;
  idle(): Promise<void>;                 // resolves when empty and not running (tests)
}
export async function scanForUnfinished(): Promise<CommentRef[]>;   // state queued or processing
export function getQueue(): ProcessingQueue;                        // globalThis singleton
// process.ts
export async function processComment(ref: CommentRef, opts?: { fromStep?: StepName; includeClip?: boolean }): Promise<void>;
// transcribe.ts
export interface Transcriber { transcribe(wavPath: string, language: string): Promise<Transcript> }
export function groqTranscriber(apiKey: string, baseUrl: string, fetchImpl?: typeof fetch): Transcriber;
export const fakeTranscriber: Transcriber;   // deterministic: words "so this logo is the old one and the text here runs on too long" spread across the audio duration
```
Behaviour:
- Order: `audio` (concat chunks to `audio.webm|mp4` by `audioMime`, merge events into `events.json` sorted by `t`, make `audio16k.wav`) → `silence` (if no speech: state `empty`, remaining steps `skipped`, stop) → `transcribe` (Groq, retries per `TRANSCRIBE_BACKOFF_MS`; on final failure: step `failed`, `state` will end as `failed`, continue) → `moments` (`selectMoments`, write `moments.json`) → `stills` → `clip`. `state` is `done` if no step failed, else `failed`. `error` holds the first error message.
- Two-tier priority: the queue processes all non-clip work before any clip work. Implement by queueing clip as a separate low-priority job (`{ ...ref, clip: true }` internally).
- `instrumentation.ts` `register()` (Node runtime only): set `setCommentCompleteHandler((ref) => getQueue().enqueue(ref))`, then `scanForUnfinished()` and enqueue each.
- Groq call: `POST {baseUrl}/audio/transcriptions`, multipart `file` (the wav), `model=whisper-large-v3`, `response_format=verbose_json`, `timestamp_granularities[]=word`, `timestamp_granularities[]=segment`, `language`. Map to `Transcript`. 429 and 5xx retry; 4xx other than 429 fails immediately.
- Reprocess route `POST /api/admin/videos/<id>/reprocess` body `{ version?: number, commentId?: string, fromStep?: StepName }` re-queues matching comments after deleting derived outputs for steps at and after `fromStep` (default `transcribe` for failed comments). CLI mirrors it and runs synchronously (`processComment` directly) with progress lines.

- [ ] **Step 1: Failing tests**
```ts
it('queue runs one job at a time and dedupes', async () => {
  let running = 0, max = 0; const seen: string[] = [];
  const q = new ProcessingQueue({ process: async (r) => { running++; max = Math.max(max, running); seen.push(r.commentId); await sleep(10); running--; } });
  q.enqueue(ref('a')); q.enqueue(ref('b')); q.enqueue(ref('a'));
  await q.idle();
  expect(max).toBe(1); expect(seen).toEqual(['a', 'b']);
});
it('processes a seeded comment end to end with the fake transcriber', async () => {
  // seed: chunk files from speech-like.webm split into 3 parts, events-basic.json split across chunk events, meta, status queued
  await processComment(ref, { includeClip: false });
  const s = await readStatus(ref);
  expect(s).toMatchObject({ state: 'done', steps: { audio: 'done', silence: 'done', transcribe: 'done', moments: 'done' } });
  expect(JSON.parse(await readFile(join(dir, 'moments.json'), 'utf8')).length).toBeGreaterThan(0);
});
it('marks silent comments empty and skips the rest', async () => { /* silence.wav -> webm chunks */ });
it('retries Groq on 429 then fails cleanly', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
  const p = groqTranscriber('k', 'https://api.groq.test', fetchImpl).transcribe(wav, 'en');
  const assertion = expect(p).rejects.toThrow(/429/);
  await vi.runAllTimersAsync(); await assertion;
  expect(fetchImpl).toHaveBeenCalledTimes(4);
});
it('maps Groq verbose_json to Transcript', async () => { /* fetch returns transcript-basic.json */ });
it('scanForUnfinished finds queued and processing comments', async () => { /* seed 3 statuses */ });
```
- [ ] **Step 2-4:** Fail, implement, pass. **Step 5:** Commit `feat(pipeline): persistent queue, assemble, silence, transcription, moments`.

### Task 3.4: Rendering — `build` (worktree)

**Files:** `lib/render/{overlay,stills,clip}.ts`, `lib/pipeline/steps/{stills,clip}.ts`, tests.

**Contract:**
```ts
// overlay.ts: pure SVG builders, coordinates in output pixels
export function pointerSvg(x: number, y: number, size: number): string;            // white arrow with dark outline + soft shadow, tip at (x,y)
export function trailSvg(points: { x: number; y: number }[], w: number, h: number, opts: { fade: boolean; colour: string }): string;
export function ringsSvg(points: { x: number; y: number }[], radius: number): string;
export function boxSvg(r: Rect, w: number, h: number): string;                     // zoom region outline
export function overlaySvg(w: number, h: number, parts: string[]): string;
// stills.ts
export async function renderMomentStill(src: string, m: Moment, events: CaptureEvent[], probe: ProbeInfo): Promise<{ full: Buffer; zoom: Buffer | null }>;
export async function renderOverview(src: string, meta: CommentMeta, events: CaptureEvent[], probe: ProbeInfo): Promise<Buffer>;
// clip.ts
export async function renderClip(opts: { src: string; audio: string; meta: CommentMeta; events: CaptureEvent[]; probe: ProbeInfo; out: string }): Promise<void>;
```
Rules:
- Frames come from `extractFrame(source, vt, STILL_MAX_WIDTH)`; overlays are composited with sharp; output JPEG quality 85. Sharp is configured once with `sharp.concurrency(1)`.
- Trail for a moment: pointer samples in `[t - 1000, t]` on the same `vt`. Rings: clicks in that window. If `m.zoom`, draw `boxSvg(visibleRegion(m.zoom))` on the full still and produce the zoom image by cropping `visibleRegion` from the full-resolution frame (no upscaling beyond source pixels) with the pointer drawn at its position within the crop.
- Overview: frame at `pausedAtVideoTime`; full path with fade from light (start) to dark (end) in amber; path after the first seek in cyan; all clicks as rings.
- Clip: distinct `vt` values are extracted once and cached; for each output frame at `CLIP_FPS`, compose frame for the current `vt` (cropped and scaled if zoomed at that time) plus pointer and 1s trail; pipe raw RGB into `spawnLowPrio('ffmpeg', ['-f','rawvideo','-pix_fmt','rgb24','-s',`${w}x${h}`,'-r','15','-i','-','-i',audio,'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-shortest', out])`. Width capped at `CLIP_MAX_WIDTH`, even dimensions.
- Steps write `render/moment-NN.jpg`, `render/moment-NN-zoom.jpg`, `render/overview.jpg`, `render/clip.mp4`.

- [ ] **Step 1: Failing tests**
```ts
it('pointerSvg places the tip at the given point', () => expect(pointerSvg(10, 20, 24)).toMatch(/M\s*10[ ,]20/));
it('renders a still with the pointer where the moment is', async () => {
  const m: Moment = { id: 'moment-01', t: 3000, vt: 2, x: 0.25, y: 0.5, inside: true, zoom: null, kinds: ['click'], reasons: ['click'] };
  const { full, zoom } = await renderMomentStill(fx('h264.mp4'), m, events, probe);
  const img = sharp(full); const meta = await img.metadata();
  expect([meta.width, meta.height]).toEqual([640, 360]); expect(zoom).toBeNull();
  const { data } = await img.extract({ left: 160 + 3, top: 180 + 6, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  expect(data[0]).toBeGreaterThan(230); // white pointer body just inside the tip
});
it('produces a zoom crop of the visible region', async () => {
  const m = { ...base, zoom: { scale: 2.5, originX: 0.5, originY: 0.5 } };
  const { zoom } = await renderMomentStill(fx('h264.mp4'), m, events, probe);
  const meta = await sharp(zoom!).metadata();
  expect(meta.width).toBe(256); expect(meta.height).toBe(144);
});
it('renders an overview image', async () => { /* jpeg, 640x360 */ });
it('renders a clip with audio matching the comment length', async () => {
  await renderClip({ src: fx('h264.mp4'), audio: fx('speech-like.webm'), meta, events, probe, out });
  const p = await probe(out); expect(p.codec).toBe('h264');
  expect(await audioDuration(out)).toBeCloseTo(3, 0);
}, 60_000);
```
- [ ] **Step 2-4:** Fail, implement, pass. **Step 5:** Commit `feat(render): pointer stills, zoom crops, overview, reconstructed clip`.

### Task 3.5: Client capture library — `build` (worktree)

**Files:** `lib/capture/{eventLog,recorder,uploader,idb,micLevel}.ts`, tests (jsdom project, `fake-indexeddb/auto`).

**Contract:**
```ts
// eventLog.ts
export class EventLog {
  constructor(now?: () => number);        // default performance.now
  begin(): void;                           // t=0 at recorder start
  push(e: DistributiveOmit<CaptureEvent, 't'>): void;
  drain(): CaptureEvent[];                 // returns and clears pending events
}
export function pointerToFrame(clientX: number, clientY: number, stage: DOMRect, video: { videoWidth: number; videoHeight: number }, zoom: ZoomState | null): { x: number; y: number; inside: boolean };
// recorder.ts
export function pickMime(isTypeSupported: (m: string) => boolean): string; // 'audio/webm;codecs=opus' > 'audio/mp4' > ''
export class CommentRecorder {
  constructor(stream: MediaStream, opts: { timesliceMs: number; onChunk: (blob: Blob, seq: number) => void; onStart: () => void });
  start(): void;
  stop(): Promise<number>;                 // resolves with totalChunks after the final dataavailable
  readonly mimeType: string;
}
// uploader.ts
export interface PendingChunk { key: string; token: string; sid: string; cid: string; seq: number; audio: Blob; events: CaptureEvent[]; meta?: CommentMeta }
export class Uploader {
  constructor(opts: { token: string; fetchImpl?: typeof fetch; store?: ChunkStoreIdb; now?: () => number; onTrouble: (trouble: boolean) => void });
  enqueue(chunk: Omit<PendingChunk, 'key' | 'token'>): Promise<void>;    // persists to IDB first, then sends
  complete(sid: string, cid: string, body: CompleteBody): Promise<void>; // waits for all chunks of cid, then POSTs complete; on 409 re-sends missing seqs
  resumePending(): Promise<void>;          // on load: re-send anything left in IDB for this token
  readonly pendingCount: number;
}
// micLevel.ts
export function rmsLevel(samples: Float32Array): number;   // 0..1
export class SpeechGate { constructor(threshold: number, holdMs: number); update(level: number, now: number): boolean } // true once level >= threshold for holdMs
```
Retry backoff 1s, 2s, 4s, ... capped at 30s; `onTrouble(true)` once any chunk has been failing for `SAVE_TROUBLE_AFTER_MS`, `onTrouble(false)` when the queue drains. Chunks are sent in seq order per comment, at most 2 requests in flight overall.

- [ ] **Step 1: Failing tests**
```ts
it('EventLog stamps t relative to begin()', () => {
  let now = 1000; const log = new EventLog(() => now);
  log.begin(); now = 1250; log.push({ type: 'visibility', state: 'blur' });
  expect(log.drain()).toEqual([{ t: 250, type: 'visibility', state: 'blur' }]);
  expect(log.drain()).toEqual([]);
});
it('pointerToFrame handles letterbox and zoom', () => {
  const stage = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
  expect(pointerToFrame(400, 300, stage, { videoWidth: 1920, videoHeight: 1080 }, null)).toEqual({ x: 0.5, y: 0.5, inside: true });
  const z = pointerToFrame(0, 75, stage, { videoWidth: 1920, videoHeight: 1080 }, { scale: 2, originX: 0.5, originY: 0.5 });
  expect(z.x).toBeCloseTo(0.25); expect(z.y).toBeCloseTo(0.25);
});
it('pickMime prefers opus webm then mp4', () => {
  expect(pickMime((m) => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
  expect(pickMime((m) => m === 'audio/mp4')).toBe('audio/mp4');
  expect(pickMime(() => false)).toBe('');
});
it('Uploader persists before sending and retries until success', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(Response.json({ received: 0 }));
  const up = new Uploader({ token: 'tok', fetchImpl, onTrouble: () => {} });
  await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
  expect(up.pendingCount).toBe(1);
  await vi.advanceTimersByTimeAsync(1100);
  expect(fetchImpl).toHaveBeenCalledTimes(2); expect(up.pendingCount).toBe(0);
});
it('Uploader signals trouble after 20s of failures and clears it on success', async () => { /* fake timers */ });
it('resumePending re-sends chunks left in IndexedDB by a previous page load', async () => { /* new Uploader on same fake IDB */ });
it('complete re-sends missing chunks reported by a 409', async () => { /* 409 {missing:[1]} then 200 */ });
it('SpeechGate needs the level held for holdMs', () => {
  const g = new SpeechGate(0.1, 300);
  expect(g.update(0.2, 0)).toBe(false); expect(g.update(0.2, 200)).toBe(false); expect(g.update(0.2, 310)).toBe(true);
  const g2 = new SpeechGate(0.1, 300); g2.update(0.2, 0); g2.update(0.01, 100); expect(g2.update(0.2, 350)).toBe(false);
});
```
`CommentRecorder` is tested with a fake `MediaRecorder` class installed on `globalThis` that emits `dataavailable` on a timer and on `stop()`.
- [ ] **Step 2-4:** Fail, implement, pass. **Step 5:** Commit `feat(capture): event log, recorder, resilient uploader, mic level`.

### Task R3.x, I3, T3
One `review` each for 3.2, 3.3, 3.4 and 3.5 (one round, at most one fix, no re-review). 3.1 has no dedicated review; its admin auth and path handling are covered by the T3 gate and the Phase 6 security lens. I3 integration also replaces the `render not wired` stubs in `lib/pipeline/steps/index.ts` with imports of Task 3.4's steps and adds an integration test: seeded comment through `processComment` with `includeClip: true` produces `moments.json`, stills, overview and clip. T3 test gate as in Phase 2.

---

## Phase 4: Export, reviewer UI, admin UI (parallel, worktrees)

### Task 4.1: Export bundle — `build` (worktree)

**Files:** `lib/export/{model,markdown,readme,zip}.ts`, tests, `app/api/admin/videos/[videoId]/export.zip/route.ts`, `app/api/admin/videos/[videoId]/export.json/route.ts`, `scripts/cli/export.ts`, `test/fixtures/export-seed.ts` (seeds a data dir with 2 reviewers, 3 moment comments, 1 general, 1 empty, 1 failed, v1 + v2).

**Contract:**
```ts
export interface ExportOptions { version: number | 'latest' | 'all'; clips: boolean; since: string | null; partial: boolean }
export interface ExportComment {
  commentId: string; sessionId: string; reviewerName: string; kind: CommentKind; version: number;
  pausedAtVideoTime: number | null; pausedAtFrame: number | null; durationMs: number;
  videoTimeRange: [number, number] | null; state: CommentState; micLost: boolean;
  transcript: { text: string; words: (TranscriptWord & { pointer: { x: number; y: number; inside: boolean; vt: number } | null })[] } | null;
  moments: (Moment & { image: string; zoomImage: string | null })[];
  files: { overview: string | null; audio: string; clip: string | null; events: string };
  updatedAt: string; startedAt: string;
}
export interface ExportModel {
  schemaVersion: 1; exportedAt: string;
  video: { videoId: string; title: string; version: number | 'all'; fps: number; width: number; height: number; duration: number };
  sessions: SessionRecord[]; comments: ExportComment[]; previous: { version: number; comments: ExportComment[] }[];
}
export async function buildExportModel(videoId: string, opts: ExportOptions, now: Date): Promise<ExportModel | { pending: number }>;
export function renderFeedbackMd(model: ExportModel): string;
export function renderReadme(model: ExportModel): string;
export function exportEtag(model: ExportModel): string;   // sha256 of sorted commentId:updatedAt pairs + options
export async function writeZip(model: ExportModel, opts: ExportOptions, out: NodeJS.WritableStream): Promise<void>;
export function zipFilename(model: ExportModel, now: Date): string; // <videoId>-v<n|all>-<YYYYMMDD-HHmm>.zip
```
Markdown rules (spec section 9): moment comments sorted by `pausedAtVideoTime`, ties by reviewer name then start; header `### <Name>, <m:ss.s> (paused <N>s)`, plus ` covering <a> to <b>` when `videoTimeRange` spans more than one frame; overview image; transcript in quotes with `[📍 moment-NN: <positionLabel>, <x%>/<y%>]` inserted after the word nearest each moment's `t` (add `, clicked` / `, zoomed in` when those kinds are present); then a `Moments:` list with each image and zoom image. Then `## General feedback` grouped by reviewer. Then `## Empty pauses` counts. Failed comments show `_Transcription failed; listen to media/<cid>/audio.webm_`. With `version: 'all'`, one `## Version N` section per version. The `previous/` folder gets its own `feedback.md` per earlier version.

README rules: spec section 9 "README.md" list, written plainly for a model reading it cold, no em-dashes.

API: `export.zip` streams `writeZip` into a `TransformStream` and returns it with `Content-Type: application/zip`, `Content-Disposition`, `ETag`; `202` + `Retry-After: 30` when `buildExportModel` returns `pending` (comments queued/processing; clip-only pending counts only when `clips=1`); `304` on matching `If-None-Match`. `export.json` returns the model. Both wrapped in `withAdmin`. CLI writes to `--out` (default cwd) and prints the path.

- [ ] **Step 1: Failing tests**
```ts
it('sorts moment comments by video time across reviewers', async () => {
  const md = renderFeedbackMd(model);
  expect(md.indexOf('### Sarah, 0:03.0')).toBeLessThan(md.indexOf('### Dev, 0:12.4'));
});
it('inlines moment markers after the spoken word', () => {
  expect(renderFeedbackMd(model)).toContain('so this [📍 moment-02: top-left, 12%/8%]');
});
it('lists general feedback and empty counts at the end', () => { /* assert headings and order */ });
it('flags failed transcription with the audio path', () => { /* contains 'Transcription failed' */ });
it('returns pending while comments are processing unless partial', async () => { /* seed one queued */ });
it('includes previous version feedback for v2 exports', async () => { /* previous[0].version === 1 */ });
it('ETag changes when a comment is updated and is stable otherwise', async () => { /* touch status.updatedAt */ });
it('zip contains README, feedback.md, feedback.json, media and raw', async () => {
  // write to a temp file, read entries with yauzl, assert names
  expect(names).toEqual(expect.arrayContaining(['README.md', 'feedback.md', 'feedback.json',
    `media/${cid}/overview.jpg`, `media/${cid}/moment-01.jpg`, `raw/${cid}/events.json`, 'previous/v1/feedback.md']));
  expect(names.some((n) => n.endsWith('clip.mp4'))).toBe(false);
});
it('feedback.md and README contain no em-dashes', () => {
  expect(renderFeedbackMd(model)).not.toContain('—'); expect(renderReadme(model)).not.toContain('—');
});
it('export route returns 401 without admin and a zip with it', async () => { /* call GET handler */ });
```
- [ ] **Step 2-4:** Fail, implement, pass. **Step 5:** Commit `feat(export): LLM-ready zip, markdown, readme, admin export API and CLI`.

### Task 4.2: Reviewer UI — `build` (worktree)

**Files:**
- `lib/review/machine.ts` + test: pure reducer for screen flow
- `app/r/[token]/page.tsx` (server component: `resolveToken`; invalid shows the invalid-link screen with HTTP 404 via `notFound()` and `app/r/[token]/not-found.tsx`; valid renders `<ReviewApp token title latestVersion frameDuration />`; `generateMetadata` returns `Feedback: <title>` and `robots: noindex`)
- `components/review/ReviewApp.tsx` (client; owns machine, mic stream, uploader, session)
- `components/review/screens/{MobileBlock,Welcome,MicExplain,MicCheck,MicDenied,EndScreen,GeneralComment,Thanks}.tsx`
- `components/review/player/{Player,VideoStage,Controls,ListeningOverlay,SaveStatus,MicLost}.tsx`
- `components/review/hooks/{useKeyboard,useHoldToZoom,usePointerCapture,useMicLevel,useSession}.ts`
- `components/review/*.module.css`
- Tests: `*.test.tsx` per screen and for Player behaviour

**State machine (`lib/review/machine.ts`):**
```ts
export type Screen = 'mobile' | 'welcome' | 'micExplain' | 'micCheck' | 'micDenied' | 'player' | 'end' | 'general' | 'thanks';
export interface ReviewState {
  screen: Screen; name: string; sessionId: string | null; version: number | null;
  playing: boolean; commentId: string | null; zoom: ZoomState | null; micLost: boolean; resumed: boolean;
}
export type ReviewAction =
  | { type: 'detectedMobile' }
  | { type: 'loadedResumable'; sessionId: string; version: number; name: string }
  | { type: 'submitName'; name: string }
  | { type: 'micExplained' } | { type: 'micGranted' } | { type: 'micDenied' } | { type: 'micRetry' } | { type: 'micHeard' }
  | { type: 'sessionStarted'; sessionId: string; version: number }
  | { type: 'play' } | { type: 'pause'; commentId: string }
  | { type: 'ended' } | { type: 'shareMore'; commentId: string } | { type: 'generalFinished' } | { type: 'scrollBack' }
  | { type: 'zoomStart'; zoom: ZoomState } | { type: 'zoomPan'; originX: number; originY: number } | { type: 'zoomEnd' }
  | { type: 'micLost' } | { type: 'micReconnected' } | { type: 'done' };
export function reducer(s: ReviewState, a: ReviewAction): ReviewState;
export const initialState: ReviewState;
```
Rules encoded and tested: `submitName` requires a trimmed non-empty name; resumed sessions skip `welcome` but still go through `micCheck`; `pause` while `playing` on `player` sets `commentId`; `play` clears `commentId` and `zoom`; zoom actions are ignored unless paused on `player`; `ended` goes to `end` (and ends any open comment, the component handles the upload); `scrollBack` from `end` returns to `player` paused with no comment; `shareMore` goes to `general` with a new `commentId`; `generalFinished` returns to `end`; `done` from `player` or `end` goes to `thanks`; `done` while a comment is open is allowed (the component completes it first).

**Behaviour (component layer, all from spec section 5):**
- `ReviewApp` on mount: `matchMedia('(pointer: coarse)')` and not `(any-pointer: fine)` → `detectedMobile`. Reads `localStorage['vf:' + token]` → `GET sessions/<sid>` → `loadedResumable` if it exists. Calls `uploader.resumePending()`.
- Mic: `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` on MicExplain continue. `NotAllowedError` → `micDenied` (show the browser-specific line using a simple UA check, plus all three as a fallback list). Track `ended` → `micLost`.
- MicCheck: `useMicLevel` (AnalyserNode, rAF) drives a Mantine `Progress`-based meter with 12 bars; `SpeechGate(0.08, MIC_SPEECH_HOLD_MS)`; the Start watching button is disabled until heard. On Start watching (new session) → `POST sessions`, store sid in localStorage.
- Player layout: dark stage (`#0b0b0f`), video `object-fit: contain`, controls bar below, never overlaying the picture. No timecode anywhere: `Slider` with `label={null}`, no `title` attributes with times, no `aria-valuetext` containing times (use `aria-valuetext="Position in video"`).
- Pause (button, space, or clicking the picture while playing) → generate `commentId` (crypto.randomUUID), `EventLog.begin()` on recorder start, start `CommentRecorder` with `CHUNK_MS`, each chunk → `uploader.enqueue` with drained events (seq 0 carries `meta`). Show `ListeningOverlay` (top of stage, max 60% width, `pointer-events: none`) with live level and both help lines.
- Play → stop recorder → `uploader.complete(...)` → `SaveStatus` shows Saving... then Saved for 1.5s when the promise resolves. Trouble banner from `onTrouble`.
- `usePointerCapture`: pointermove on the stage throttled to rAF; computes `pointerToFrame` with the current zoom; pushes `pointer` events only while a comment is open; pointerdown shorter than `HOLD_TO_ZOOM_MS` → `click` event; seeks while paused → `seek` (`via: 'scrollbar'`); visibility and blur/focus → `visibility`; resize/fullscreenchange → `layout`.
- `useHoldToZoom`: only while paused; after `HOLD_TO_ZOOM_MS` of pointerdown, set zoom `{ scale: ZOOM_SCALE, origin = pointer screen-normalised position }`, apply `transform-origin: <ox*100>% <oy*100>%; transform: scale(2.5)` to the video layer with a `ZOOM_ANIM_MS` transition; on move while held, update origin (`zoomPan` event); on pointerup/leave, zoom end. Cursor `zoom-in` while zoomed. Log `zoom` start/end and `zoomPan` events.
- `useKeyboard`: space toggles play/pause (`preventDefault`), ignored when focus is in an input or the screen is `general`; ←/→ step `frameDuration`, Shift+←/→ step 1s, only while paused; each step logs `seek` with `via: 'key'`.
- Fullscreen button calls `requestFullscreen` on the player container.
- End: `ended` event → `EndScreen` overlay inside the stage with the copy and buttons; the controls stay usable (scroll back → `scrollBack`).
- General comment: full overlay, `ListeningOverlay` style meter, the two prompts, Finished button; a recorder runs with `kind: 'general'`, `pausedAtVideoTime: null`.
- Done: completes any open comment, `POST done`, → `thanks`.
- Polish: Mantine `Transition` fades between screens (150ms), focus moves to each screen's heading for screen readers, buttons have visible focus rings, the overlay uses `role="status"` and `aria-live="polite"`, all text from `copy`, all test ids from `T`.

- [ ] **Step 1: Failing tests**
```ts
// machine.test.ts
it('walks welcome -> micExplain -> micCheck -> player', () => {
  let s = reducer(initialState, { type: 'submitName', name: '  Sarah ' });
  expect(s).toMatchObject({ screen: 'micExplain', name: 'Sarah' });
  s = reducer(s, { type: 'micExplained' }); s = reducer(s, { type: 'micGranted' });
  expect(s.screen).toBe('micCheck');
  s = reducer(s, { type: 'micHeard' }); s = reducer(s, { type: 'sessionStarted', sessionId: 'sid', version: 2 });
  expect(s).toMatchObject({ screen: 'player', sessionId: 'sid', version: 2, playing: false });
});
it('ignores an empty name', () => expect(reducer(initialState, { type: 'submitName', name: '  ' }).screen).toBe('welcome'));
it('resumed sessions skip the name but not the mic check', () => {
  const s = reducer(initialState, { type: 'loadedResumable', sessionId: 'sid', version: 1, name: 'Sarah' });
  expect(s.screen).toBe('micExplain'); expect(s.resumed).toBe(true);
});
it('ignores zoom while playing', () => {
  const playing = { ...playerState, playing: true };
  expect(reducer(playing, { type: 'zoomStart', zoom: { scale: 2.5, originX: 0.5, originY: 0.5 } }).zoom).toBeNull();
});
it('play clears the open comment and zoom', () => {
  const s = reducer({ ...playerState, playing: false, commentId: 'c', zoom: { scale: 2.5, originX: 0.1, originY: 0.1 } }, { type: 'play' });
  expect(s).toMatchObject({ playing: true, commentId: null, zoom: null });
});
it('general comment returns to the end screen', () => {
  let s = reducer({ ...playerState, screen: 'end' }, { type: 'shareMore', commentId: 'g1' });
  expect(s).toMatchObject({ screen: 'general', commentId: 'g1' });
  s = reducer(s, { type: 'generalFinished' }); expect(s).toMatchObject({ screen: 'end', commentId: null });
});

// Welcome.test.tsx
it('shows the instructions and disables Start until a name is typed', async () => {
  render(<Welcome title="Launch film" onSubmit={vi.fn()} />);
  expect(screen.getByText(/as if I'm sat right next to you/)).toBeInTheDocument();
  expect(screen.getByTestId(T.startButton)).toBeDisabled();
  await userEvent.type(screen.getByTestId(T.nameInput), 'Sarah');
  expect(screen.getByTestId(T.startButton)).toBeEnabled();
});

// Controls.test.tsx
it('never renders a timecode', () => {
  render(<Controls currentTime={754.2} duration={900} playing={false} {...handlers} />);
  expect(document.body.textContent).not.toMatch(/\d+:\d{2}/);
  expect(document.body.innerHTML).not.toMatch(/754|12:34/);
});

// useKeyboard.test.tsx
it('space toggles, arrows step one frame only while paused, input focus is ignored', async () => { /* render harness */ });

// Player.test.tsx (with fake MediaRecorder, fake Uploader injected via props)
it('pausing opens a comment and shows the listening overlay; play completes it and shows Saved', async () => { /* ... */ });
it('a short click while paused logs a click and does not resume playback', async () => { /* ... */ });
it('holding for 250ms zooms and releasing unzooms, logging zoom events', async () => { /* fake timers */ });
```
- [ ] **Step 2-4:** Fail, implement, pass, plus run `yarn dev` and look at each screen in a browser (use the Firefox DevTools MCP or Playwright screenshot) at 1440x900 and 1280x720 to check spacing, typography and that nothing overlaps the centre of the picture. **Step 5:** Commit `feat(review-ui): reviewer flow, player, capture wiring, zoom and frame stepping`.

### Task 4.3: Admin UI — `build` (worktree)

**Files:** `app/admin/layout.tsx` (calls `requireAdminPage()`, AppShell with header "Video feedback admin", nav: Videos, Inbox), `app/admin/page.tsx`, `app/admin/videos/[videoId]/page.tsx`, `app/admin/inbox/page.tsx`, `components/admin/{VideoTable,VersionCard,SessionTable,InboxTable,ImportModal,DownloadButton,CopyLinkButton}.tsx`, tests.

Pages are server components that read via `summariseVideos`, `listInbox`, `listSessions` directly; mutations are client components calling the admin API (`POST /api/admin/inbox`, `POST .../reprocess`). Download uses a plain link to `export.zip?version=<n>&clips=<0|1>` (with the toggle). If the API answers 202, the button shows "Still processing N comments, try again in a moment" (the button first issues a `HEAD`-style `fetch` with `partial=0` and checks status before navigating). Copy link uses `@mantine/hooks` `useClipboard` with "Copied" feedback.

Empty states: no videos ("Drop an MP4 into the inbox folder on the server, then import it here." with the absolute inbox path), empty inbox, no sessions yet ("Nobody has reviewed this version yet. Send them the link above.").

- [ ] **Step 1: Failing tests**
```tsx
it('lists videos with their review link and counts', () => {
  render(<VideoTable videos={[summary]} />);
  expect(screen.getByTestId(T.adminVideoRow)).toHaveTextContent('Launch film');
  expect(screen.getByTestId(T.adminVideoRow)).toHaveTextContent('3 comments');
});
it('shows the empty state when there are no videos', () => { /* ... */ });
it('import modal validates title and shows the server reason on failure', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ok: false, reason: 'Video must be H.264 (this file is mpeg4)' }, { status: 400 }));
  render(<ImportModal file={inboxFile} videos={[]} fetchImpl={fetchImpl} opened onClose={vi.fn()} />);
  await userEvent.type(screen.getByTestId(T.adminImportTitle), 'Launch');
  await userEvent.click(screen.getByTestId(T.adminImportSubmit));
  expect(await screen.findByTestId(T.adminImportError)).toHaveTextContent('H.264');
});
it('download builds the right URL from version and clips toggle', async () => { /* ... */ });
```
- [ ] **Step 2-4:** Fail, implement, pass, visual check in the browser. **Step 5:** Commit `feat(admin-ui): videos, versions, sessions, inbox import, downloads`.

### Task R4.x, I4, T4
One `review` each for 4.1 (spec section 9 fidelity: every field, sort order, no em-dashes, zip layout) and 4.2 (spec section 5 behaviour rules one by one: no timecode anywhere, click-while-paused does not play, space and arrows rules, zoom only while paused, overlay never covering the centre, copy matches). 4.3 has no dedicated review. I4 integration runs `yarn build` as well as `yarn check`.

---

## Phase 5: End-to-end tests (`test` writes, `fix-tests` fixes)

### Task 5.1: Playwright setup and reviewer flows — `test`

**Files:** `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/helpers.ts`, `e2e/review-flow.spec.ts`, `e2e/zoom-and-frames.spec.ts`, `e2e/resume-and-retry.spec.ts`, `e2e/edge-cases.spec.ts`, `e2e/admin-export.spec.ts`, `e2e/cross-browser.spec.ts`, `e2e/a11y.spec.ts`.

**Config:**
- `webServer`: `yarn build && HOSTNAME=127.0.0.1 PORT=3123 DATA_DIR=<tmp> ADMIN_AUTH=off TRANSCRIBER=fake PUBLIC_BASE_URL=http://127.0.0.1:3123 ./scripts/lowprio.sh node .next/standalone/server.js` (copy `.next/static` and `public` into standalone first, as `next start` would), `reuseExistingServer: !process.env.CI`, timeout 240s.
- `globalSetup`: runs `yarn fixtures`, creates the temp `DATA_DIR`, imports `h264.mp4` as "E2E film" via `yarn import` (v1) and again as v2, writes the review URL to `e2e/.state.json`.
- Projects: `chromium` (all specs) with `launchOptions.args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=<abs>/test/fixtures/generated/e2e-voice.wav']` and `permissions: ['microphone']`; `firefox` and `webkit` run only `cross-browser.spec.ts`. `workers: 2`, `fullyParallel: false` per file that shares a session.
- Every test uses `data-testid` selectors from `lib/testids.ts` (imported).

**Specs (each a multi-step flow; seed then assert both populated and empty states):**
```ts
// review-flow.spec.ts
test('reviewer gives a moment comment and a general comment', async ({ page }) => {
  await page.goto(reviewUrl);
  await expect(page.getByTestId(T.welcome)).toContainText("as if I'm sat right next to you");
  await expect(page.getByTestId(T.startButton)).toBeDisabled();
  await page.getByTestId(T.nameInput).fill('Playwright Pat');
  await page.getByTestId(T.startButton).click();
  await page.getByTestId(T.micContinue).click();
  await expect(page.getByTestId(T.micHeard)).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(T.startWatching).click();
  await page.getByTestId(T.playPause).click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.listening)).toBeVisible();
  const stage = await page.getByTestId(T.videoStage).boundingBox();
  await page.mouse.move(stage!.x + stage!.width * 0.2, stage!.y + stage!.height * 0.2, { steps: 10 });
  await page.waitForTimeout(600);                               // dwell
  await page.mouse.click(stage!.x + stage!.width * 0.6, stage!.y + stage!.height * 0.7);
  await expect(page.getByTestId(T.listening)).toBeVisible();     // click did not resume
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.savedToast)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/\b\d+:\d{2}\b/);   // no timecode anywhere
  await page.getByTestId(T.video).evaluate((v: HTMLVideoElement) => { v.currentTime = v.duration - 0.1; });
  await expect(page.getByTestId(T.endScreen)).toBeVisible();
  await page.getByTestId(T.shareMore).click();
  await expect(page.getByTestId(T.generalComment)).toContainText('Was there anything missing?');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');                           // must not end the general comment
  await expect(page.getByTestId(T.generalComment)).toBeVisible();
  await page.getByTestId(T.generalFinished).click();
  await expect(page.getByTestId(T.endScreen)).toBeVisible();
  await page.getByTestId(T.doneButton).click();
  await expect(page.getByTestId(T.thanks)).toContainText('Thanks, Playwright Pat.');
  // server side
  const comments = await readSessionComments('Playwright Pat');
  expect(comments.map((c) => c.meta.kind).sort()).toEqual(['general', 'moment']);
  const moment = comments.find((c) => c.meta.kind === 'moment')!;
  expect(moment.events.some((e) => e.type === 'click')).toBe(true);
  await waitForState(moment.ref, 'done');
  expect(moment.files).toEqual(expect.arrayContaining(['render/overview.jpg', 'render/moment-01.jpg']));
});

// zoom-and-frames.spec.ts
test('arrow keys step frames only while paused and hold-to-zoom logs zoom events', async ({ page }) => {
  // play 1s, pause; ArrowLeft x3; Shift+ArrowRight; assert currentTime moved by -3 frames then +1s
  // press and hold mouse 600ms at 30%/30%, move to 40%/40%, release; assert stage transform scale(2.5) while held and none after
  // play; ArrowRight while playing does not change time by more than playback drift
  // server: events include seek via key, zoom start/end, zoomPan; a moment has zoom set and moment-NN-zoom.jpg exists
});

// resume-and-retry.spec.ts
test('a reload mid-review resumes the same session', async ({ page }) => { /* comment, reload, mic check, no name screen, comment, both comments under one session */ });
test('going offline shows the trouble banner and recovers', async ({ page, context }) => {
  // pause, context.setOffline(true), wait > 20s (use a test-only env SAVE_TROUBLE_AFTER_MS override of 2000 via ?e2e=1 query read only when NODE_ENV!=='production' OR set via webServer env), play
  // expect save-trouble-banner visible; setOffline(false); expect saved-toast; server has all chunks
});

// edge-cases.spec.ts
test('invalid token shows the friendly page with 404', async ({ page }) => { /* response.status() === 404, invalid-link visible */ });
test('mobile devices get the computer notice', async ({ browser }) => { /* devices['Pixel 7'] context, mobile-block visible, no player */ });
test('denied microphone shows recovery steps', async ({ browser }) => { /* context without microphone permission and without fake-ui flag via separate project 'chromium-nomic' */ });
test('silent pause is stored but marked empty', async () => { /* use a project with silence.wav as fake capture */ });
test('a new version mid-session keeps the session on its version', async ({ page }) => { /* start session v2, import v3 via CLI, continue, session.version stays 2, a new context gets v3 */ });

// admin-export.spec.ts
test('admin imports from the inbox and downloads a zip with the feedback', async ({ page, request }) => {
  // copy fixture into inbox, open /admin/inbox, import as new video, copy link visible on /admin
  // run a quick review via API helpers (POST session, PUT chunks from speech-like.webm, complete)
  // poll /api/admin/videos until pendingProcessing 0
  // GET export.zip -> 200, unzip with yauzl, README.md + feedback.md + feedback.json + media
  // GET again with If-None-Match -> 304
});

// cross-browser.spec.ts (chromium, firefox, webkit)
test('welcome renders and the video plays and pauses', async ({ page }) => { /* no mic needed: stop at micExplain for non-chromium, separately load the video element via /api/r/<token>/video and assert it can play */ });

// a11y.spec.ts
test('reviewer screens have no serious axe violations', async ({ page }) => { /* AxeBuilder on welcome, micExplain, player, end, thanks; expect no 'serious' or 'critical' */ });
```
Note for implementers: the `SAVE_TROUBLE_AFTER_MS` override must not be reachable in production builds. Implement it as `NEXT_PUBLIC_E2E_FAST_TIMERS=1` read at build time in `lib/constants.ts` (the E2E build sets it; production builds never do). Changing `lib/constants.ts` here is allowed because Phase 5 runs on the main tree.

- [ ] **Step 1:** Write config, setup and specs. **Step 2:** `./scripts/lowprio.sh npx playwright install chromium firefox webkit` (if WebKit system deps are missing, mark the webkit project `test.skip` with the reason in the README). **Step 3:** Run `yarn test:e2e`. **Step 4:** Report failures with the failing assertion and trace path. Commit the specs even if red: `test(e2e): reviewer, zoom, resume, edge cases, admin export, a11y`.

### Task 5.2: Make E2E green — `fix-tests` (loop)
For each failure: reproduce with `yarn test:e2e --project=chromium <spec> --trace on`, read the trace, decide whether the app or the test is wrong against the spec (the spec wins), fix, re-run the single spec, then the whole suite. Do not weaken assertions or add sleeps longer than needed; prefer `expect.poll` and auto-waiting locators. Max 3 rounds; report anything still failing with diagnosis.

---

## Phase 6: Polish and hardening

### Task 6.1: Two-reviewer pass — `review` (parallel, read-only)
Two independent reviews of the whole `feat/video-feedback` diff: one covers lenses 1 and 3, the other lenses 2 and 4:
1. **Spec compliance:** walk spec sections 2 to 12 line by line; list every requirement with the file implementing it or "missing".
2. **Security:** token entropy and comparison, path traversal on every id and filename, admin auth on every `/admin` page and `/api/admin` route (grep for routes missing `withAdmin`), upload limits, header injection in `Content-Disposition`, JWT verification details, `127.0.0.1` binding, secrets not logged.
3. **Reviewer UX polish:** read every component against spec section 5 and the copy; check focus handling, keyboard support, visible focus rings, transitions, the overlay placement, loading and error states, no dead controls, no placeholder text, that nothing shows a timecode; look at screenshots from the last E2E run (`test-results/`).
4. **Robustness:** queue restart recovery, partial uploads, concurrent reviewers on one video, disk-full behaviour (write failures surface as 500 and do not corrupt JSON), very long comments (10 minutes), videos with no audio track, Safari `audio/mp4` path, low-priority wrapping of every spawned process (grep `spawn(` and `execFile(` for any call not going through `lib/media/run.ts`).
Output schema per reviewer: `{ findings: [{ severity, file, line, issue, fix }] }`.

### Task 6.2: Apply fixes — `build` (main tree)
Fix all critical, high and medium findings. For each, add or extend a test that would have caught it. Low findings: fix if under 10 minutes, else list in `docs/FOLLOW-UPS.md`. Commit per area.

### Task 6.3: Final gate — `test`, then `fix-tests` if red
`yarn check`, `yarn build`, `yarn test:e2e`. All green, or a written list of what is not and why.

---

## Phase 7: Deployment artefacts (`build`, main tree; deploying itself is Tim-gated)

### Task 7.1: Deploy files and docs — `build`

**Files:** `deploy/video-feedback.service`, `deploy/cloudflared.md`, `docs/DEPLOY.md`, `README.md` (usage section).

`deploy/video-feedback.service`:
```ini
[Unit]
Description=Video feedback (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tdobson
WorkingDirectory=/srv/video-feedback/app
EnvironmentFile=/srv/video-feedback/env
Environment=NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3000
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=on-failure
RestartSec=5
Nice=0
# ffmpeg and sharp work is lowered per process by lib/media/run.ts (ionice -c2 -n7 nice -n19)

[Install]
WantedBy=multi-user.target
```
`docs/DEPLOY.md` covers: build on geriatrix with `./scripts/lowprio.sh yarn build`, copying `.next/static` and `public` into the standalone folder, the env file (`DATA_DIR=/srv/video-feedback/data`, `GROQ_API_KEY`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `PUBLIC_BASE_URL`), the cloudflared ingress rule, creating the Cloudflare Access application for `/admin*` and `/api/admin/*` (with the exact paths), creating a service token and an example `curl` with `CF-Access-Client-Id` / `CF-Access-Client-Secret` against `/api/admin/videos`, backups with rsync, and a post-deploy smoke checklist (review link loads, mic check, one comment, admin list shows it, zip downloads).

- [ ] Commit `docs: deployment for geriatrix behind Cloudflare Tunnel and Access`.

### Task 7.2: Deploy to geriatrix — Tim only
Not part of the workflow. Run when Tim says so, following `docs/DEPLOY.md`.

---

## Phase dependency summary (for the workflow)

```
Phase 0  explore  ─┐ (parallel x2)
Phase 1  1.1 → 1.2 → R1 (sequential, main tree)
Phase 2  [2.1+2.5] [2.2+2.3] [2.4]   build(worktree) only                          then I2 → T2
Phase 3  3.1 3.2 3.3 3.4 3.5         build; 3.2-3.5 also review → [one fix]       then I3 → T3
Phase 4  4.1 4.2 4.3                 build; 4.1-4.2 also review → [one fix]       then I4 → T4
Phase 5  5.1 → 5.2 (max 3 fix rounds)
Phase 6  6.1 (x2 parallel) → 6.2 → 6.3 (max 2 fix rounds)
Phase 7  7.1
```
