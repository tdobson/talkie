# Talkie review: monorepo and second media kind, implementation plan

> **For agentic workers:** this plan is run by `.claude/workflows/integrate-talkie.js`. Build tasks
> run in their own git worktree. Risky tasks get one adversarial review and at most one fix round.
> Each phase ends with a test gate. Steps use checkbox (`- [ ]`) syntax.

**Goal:** one monorepo holding video-feedback and Talkie, where reviewers can give spoken, pointed
feedback on a Talkie film exactly as they do on an MP4.

**Architecture:** video-feedback moves to `apps/video-feedback` and Talkie's packages stay at the
root (`packages/*`). The app consumes `@talkie/format` and `@talkie/player` as workspace packages.
A client `MediaAdapter` hides `<video>` versus `TalkieEngine`. A server `FrameSource` hides ffmpeg
versus a headless Chromium calling `engine.renderAt(t)`.

**Spec:** `docs/superpowers/specs/2026-11-21-talkie-review-design.md` (the "Talkie spec"), plus the base
spec `docs/superpowers/specs/2026-11-21-video-feedback-design.md`.

**Codebases:** `apps/video-feedback` (the app), `packages/*` (Talkie, changes only to fix bugs found).

**Start condition (hard):** both builds are completely finished. The video-feedback build is done
(head `599fd2b` or later on `feat/video-feedback`). The Talkie build is done when
`/tmp/talkie-done-watch.sh` printed `TALKIE_DONE`, which means W8 (T15 end-to-end QA) is merged into
`svg-animation-codec-or-container` and no `talkie/*` worktree is locked by a live process. Tim
confirms before the workflow starts.

---

## 0. Rules for every task

1. **Low priority, always.** Every install, build, lint, typecheck, test, Playwright, ffmpeg,
   Chromium and dev-server command runs at `ionice -c2 -n7 nice -n19`: use `scripts/low <cmd>` at
   the root, `./scripts/lowprio.sh <cmd>` inside `apps/video-feedback`, or the yarn scripts,
   which already wrap themselves. Vitest and Jest use 2 workers, Playwright 2 workers, and Next
   `experimental.cpus: 2`. Never run two builds or two end-to-end runs in one tree at once.
2. **No film renders on tragicomix** beyond the 4-second 320x180 fixture (Talkie rule 2).
3. **TDD.** Failing test, see it fail, implement, see it pass, commit.
4. **Branches.** All work lands on `feat/monorepo`. Build tasks create `task-t<id>` branches in
   their worktree and the integration step merges them.
5. **Frozen after Phase 2:** root `package.json`, `yarn.lock`, `apps/video-feedback/package.json`,
   `apps/video-feedback/lib/types.ts`, `lib/media-kind.ts`, `lib/testids.ts`, `lib/review/copy.ts`,
   `lib/constants.ts`, tsconfigs and the lint and format configs. Report needed changes as
   `sharedChangesNeeded`.
6. **The MP4 path must not regress.** Every existing test passes with only import-path changes.
7. **No em-dashes** in user-facing text, docs or copy.
8. **Gate command:** `yarn check` at the root (runs Talkie's `yarn test`, then
   `yarn workspace video-feedback check`). It must pass before every final commit.

---

## Phase 0: preflight and explore

### Task 0.1: preflight (explore agent, read-only)

- [ ] Confirm the start condition with commands, not memory:

```bash
cd /home/tdobson/dev/video-feedback.tdobson.net
git rev-parse feat/video-feedback svg-animation-codec-or-container
git show svg-animation-codec-or-container:e2e/player.spec.ts >/dev/null && echo W8-present
git worktree list --porcelain | grep -A3 'branch refs/heads/talkie/' || echo no-talkie-worktrees
pgrep -af 'talkie-build|workflow' || true
```

- [ ] Run each project's own gate on its own branch tip, read-only, in throwaway worktrees under
      `/tmp`, at low priority: `yarn check` for video-feedback, `yarn test` for Talkie. Record the
      pass or fail counts.
- [ ] Return `{ ready: boolean, vfHead, talkieHead, vfCheck, talkieTest, notes }`. If either build
      is unfinished or its gate fails, `ready` is false and the workflow stops.

### Task 0.2: map what Talkie actually built (explore agent, read-only)

Read `packages/format/src`, `packages/player/src`, `packages/cli/src/commands` and
`examples/` on the Talkie branch. Return facts on:

- The `TalkieEngine` constructor options, events, `cues`, `renderAt`, `resize` and any device-pixel or
  scale hook on the renderer.
- Whether `@talkie/cli` exports a headless frame renderer (T11 `export`), and its signature.
- The packer in `@talkie/format` (`pack.ts`): its signature, and whether it reads a folder from disk
  or takes a file map.
- Any existing small test film under `packages/*/test`, `test/` or `examples/` that could serve as
  the fixture.
- The Talkie root configs that must ignore `apps/` (oxlint, oxfmt, Jest, tsconfig, Playwright).

---

## Phase 1: monorepo restructure

### Task 1.1: move, merge, reconcile (build agent, main tree, sequential)

**Files:** everything at the root of `feat/video-feedback` moves to `apps/video-feedback/`. The
root files are reconciled as described below.

- [ ] Create the branch and move the app, keeping history:

```bash
cd /home/tdobson/dev/video-feedback.tdobson.net
git switch -c feat/monorepo feat/video-feedback
mkdir -p apps/video-feedback
git ls-files -z | grep -zv '^\.claude/' | grep -zv '^docs/' \
  | xargs -0 -I{} sh -c 'mkdir -p "apps/video-feedback/$(dirname "{}")" && git mv "{}" "apps/video-feedback/{}"'
git commit -m "chore: move video-feedback into apps/video-feedback"
```

  `docs/` and `.claude/` stay at the root, because they belong to the repo, not the app.
  `apps/video-feedback/README.md` keeps the app README.

- [ ] Merge Talkie: `git merge --no-ff svg-animation-codec-or-container`. Resolve conflicts:

| File | Resolution |
|---|---|
| `package.json` (root) | Talkie's root manifest, plus `"apps/*"` added to `workspaces`, plus scripts `check` = `yarn test && yarn workspace video-feedback check`, `vf` = `yarn workspace video-feedback`. |
| `yarn.lock` | Regenerate: `scripts/low yarn install` (one lockfile for every workspace). |
| `.gitignore` | Union of both. |
| `.nvmrc`, `.yarnrc.yml` | Talkie's (both are Node 22+ and yarn 4 with node-modules linker; check they match). |
| `README.md` (root) | New short root README: what the repo holds and where each project's README lives. |
| `playwright.config.ts`, `tsconfig.json`, `jest.config.cjs`, oxlint and oxfmt configs | Talkie's stay at the root. Add `apps/**` to their ignore lists. |
| `docs/` | Both sets of files kept (names do not clash). |
| `.claude/workflows/` | Both sets kept. |

- [ ] In `apps/video-feedback/package.json`: rename stays `video-feedback`. Add
      `"@talkie/format": "workspace:*"` and `"@talkie/player": "workspace:*"` to dependencies, and
      `"playwright-core": "^1.65.1"` (the server-side Talkie frame source needs it; the app already
      depends on `@playwright/test` for dev only).
- [ ] Add `"predeps": "yarn workspaces foreach -Rpt --from video-feedback --exclude video-feedback run build"`
      and call `yarn predeps &&` at the start of the app's `build`, `dev` and `test:e2e` scripts.
- [ ] In `apps/video-feedback/tsconfig.json` add `paths` for `@talkie/*` to `../../packages/*/src`. In
      `vitest.config.ts` add the same aliases.
- [ ] Fix every path that assumed the repo root: `scripts/make-fixtures.sh`, `playwright.config.ts`
      `webServer.cwd`, `deploy/video-feedback.service` (`WorkingDirectory=.../apps/video-feedback`),
      `docs/DEPLOY.md` (moved paths), and the `.claude/workflows/build-video-feedback.js` constants
      (note only; that workflow is finished).
- [ ] `scripts/low yarn install`, then `yarn check` at the root, `yarn workspace video-feedback build`,
      and `yarn build` (Talkie packages). All pass.
- [ ] Commit: `chore: merge Talkie into one monorepo with apps/video-feedback`.

### Task 1.2: gate (test agent)

Run `yarn check`, `yarn vf test:e2e` and Talkie's `yarn e2e` (one at a time). Both end-to-end
suites must pass as they did on their own branches. Fix only restructure breakage (paths, configs).

---

## Phase 2: contracts and fixture (sequential)

### Task 2.1: shared contracts (build agent, main tree)

**Files (all under `apps/video-feedback/`):**
- Modify: `lib/types.ts`, `lib/testids.ts`, `lib/review/copy.ts`, `lib/constants.ts`
- Create: `lib/media-kind.ts`, `lib/media/frame-source.ts` (interface only),
  `components/review/media/adapter.ts` (interface only)
- Delete: `lib/review/additions.ts` (folded in, see FOLLOW-UPS)

- [ ] First, fold in the Phase 6 leftovers from `docs/FOLLOW-UPS.md`: `moreCopy` into `copy.ts`,
      `MORE_T` into `testids.ts`, the full stop on `copy.micCheck.heard`, `cutShort?: boolean` on
      `CommentMeta`. Update the imports and delete `additions.ts`.
- [ ] `lib/types.ts` additions:

```ts
export type MediaKind = 'mp4' | 'talkie';

export interface VersionRecord {
  version: number;
  importedAt: string;
  originalFilename: string;
  /** Absent on data written before Talkie support: read as 'mp4'. */
  mediaKind?: MediaKind;
}

// ProbeInfo is unchanged; codec is 'talkie' and pixFmt 'vector' for Talkie versions.

export interface CommentMeta {
  // ...existing fields...
  mediaKind?: MediaKind;
  cutShort?: boolean;
}

export interface SceneWarningEvent extends Base {
  type: 'sceneWarning';
  sceneId: string;
}
// Add SceneWarningEvent to the CaptureEvent union.

export interface TalkieMomentInfo {
  sceneId: string;
  sceneIndex: number;
  sceneSrc: string;
  sceneTime: number; // seconds, scene-local, 3 decimals
  sceneFrame: number; // integer Lottie frame
  chapter: string | null;
  caption: string | null;
}
```

- [ ] `lib/media-kind.ts`:

```ts
import type { MediaKind, VersionRecord } from '@/lib/types';

export function mediaKindOf(v: Pick<VersionRecord, 'mediaKind'>): MediaKind {
  return v.mediaKind ?? 'mp4';
}
```

  Test: `mediaKindOf({})` is `'mp4'`; `mediaKindOf({ mediaKind: 'talkie' })` is `'talkie'`.

- [ ] `lib/media/frame-source.ts`:

```ts
export interface FrameSource {
  /** PNG of the picture at video time vt (seconds), at most maxWidth wide, aspect kept. */
  frame(vt: number, maxWidth: number): Promise<Buffer>;
  /** Release processes. Safe to call twice. */
  close(): Promise<void>;
}

export type FrameSourceFactory = (videoId: string, version: number) => Promise<FrameSource>;
```

- [ ] `components/review/media/adapter.ts`: the `MediaAdapter` interface from Talkie spec section 9,
      word for word, plus:

```ts
export type MediaAdapterEvent =
  | 'play' | 'pause' | 'seeking' | 'seeked' | 'timeupdate' | 'waiting'
  | 'playing' | 'ended' | 'loadedmetadata' | 'error';
```

- [ ] `lib/testids.ts`: add `captionPlate: 'caption-plate'` and `captionsToggle: 'captions-toggle'`.
- [ ] `lib/review/copy.ts`: add
      `player.captionsOn: 'Captions on'`, `player.captionsOff: 'Captions off'`,
      `admin.filmInvalid: 'This film did not pass validation: {errors}'`,
      `admin.filmVersion: 'This film needs Talkie version {major}, which this tool does not read yet.'`,
      `admin.chromiumMissing: 'Chromium is not installed for Talkie stills; see DEPLOY.md'`.
- [ ] `lib/constants.ts`: `FILM_MAX_UNPACKED_BYTES = 500 * 1024 * 1024`, `FILM_MAX_ENTRIES = 2000`,
      `TALKIE_FRAME_TIMEOUT_MS = 30_000`, `TALKIE_BROWSER_IDLE_MS = 120_000`.
- [ ] `yarn check`, commit `feat(contracts): media kind, frame source and media adapter contracts`.

### Task 2.2: fixture film (build agent, main tree)

**Files:** `apps/video-feedback/scripts/make-talkie-fixture.ts`,
`apps/video-feedback/test/fixtures/talkie-mini/**`, `apps/video-feedback/test/fixtures/talkie-mini.lottie`.

- [ ] If Task 0.2 found a suitable small Talkie test film, copy it and adjust it to the shape below. Otherwise
      write `make-talkie-fixture.ts` using `@talkie/author` to emit two scenes (320x180, 30 fps,
      2 s each; scene `s01` solid `#ff0000`, scene `s02` solid `#0000ff`). Generate a 4 s 440 Hz
      sine narration with ffmpeg at low priority (`u/narration.opus` and `u/narration.m4a`),
      `captions/en.vtt` with two cues (0 to 2 s "Red scene.", 2 to 4 s "Blue scene."),
      chapters `[{ title: 'Red', start: 0 }, { title: 'Blue', start: 2 }]`, and `poster.png`.
      Pack it with the `@talkie/format` packer.
- [ ] Test (`test/fixtures/talkie-mini.test.ts`): `validateFilm` passes on the folder, and
      `openFilm(bytes)` on the `.lottie` gives the same `talkie.json`.
- [ ] Commit the generated files (small, deterministic) and the script.

---

## Phase 3: parallel builds (worktrees)

### Task 3.1: import, storage and film route (build agent; reviewed)

**Files (app):** `lib/videos/import.ts`, `lib/videos/import-film.ts` (new),
`lib/storage/paths.ts` (`filmDir`, `filmPackedPath`), `app/api/r/[token]/film/[...path]/route.ts` (new),
`app/api/r/[token]/video/route.ts` (404 for talkie), `scripts/cli/import.ts` (`--film`),
`components/admin/ImportModal.tsx`, `lib/review/page.ts` (pass `mediaKind` and poster URL to the
client), and their tests.

- [ ] Tests first, one per behaviour:
  - importing `talkie-mini.lottie` writes `film.lottie`, unpacks `film/`, writes `probe.json`
    `{ width: 320, height: 180, fps: 30, frameDuration: 1/30, duration: 4, codec: 'talkie', pixFmt: 'vector', hasAudio: true }`
    and records `mediaKind: 'talkie'`;
  - importing the folder gives the same result plus a packed `film.lottie`;
  - refusals, each leaving nothing on disk: a bad `talkie.json` (admin copy `filmInvalid`), a major
    version 2 (`filmVersion`), an entry path `../x`, an entry not listed in `talkie.json`, more
    than `FILM_MAX_ENTRIES` entries, and an unpacked size over the limit (checked while streaming,
    not after);
  - the inbox lists `*.lottie` and folders that contain `talkie.json`;
  - the film route serves `talkie.json`, a scene, a caption and the audio with Range (206), refuses
    unlisted paths, `..` and encoded traversal with 404, returns 404 for an mp4 version, and the
    video route returns 404 for a talkie version;
  - token and session checks are the same as the video route's (reuse its helpers).
- [ ] Implement, `yarn vf check`, commit.

Review focus: zip traversal and bombs, the size check while streaming, path allow-list, kind
mismatches, Range edge cases, that nothing is half-written on failure.

### Task 3.2: client media adapters (build agent; reviewed)

**Files (app):** `components/review/media/VideoAdapter.ts`, `components/review/media/TalkieAdapter.ts`,
`components/review/media/adapterContract.ts` (a shared test suite run against both),
`components/review/media/CaptionPlate.tsx`, `components/review/player/Player.tsx`,
`components/review/player/VideoStage.tsx` (renamed in place to accept either surface),
`components/review/player/Controls.tsx` (captions toggle), `components/review/hooks/useKeyboard.ts`
(frame step through `adapter.frameDuration()`), and their tests.

- [ ] Write `adapterContract.ts`: `runAdapterContract(name, makeAdapter)` asserts play then pause
      fires `play` then `pause`, setting `currentTime` fires `seeking` then `seeked`,
      `naturalSize` is known after `loadedmetadata`, `destroy` stops events, and `frameDuration() > 0`.
      Run it against `VideoAdapter` with a fake `HTMLVideoElement` and against `TalkieAdapter`
      with a fake engine (the `TalkieEngine` public surface, faked in jsdom).
- [ ] `VideoAdapter` wraps the existing `<video>` element. Refactor `Player.tsx` to use only the
      adapter. **Every existing `Player.test.tsx` test must pass unchanged except for setup.**
- [ ] `TalkieAdapter`: `await import('@talkie/player')` inside an effect (never on the server),
      mount `TalkieEngine` in the stage container, `load(<film folder URL>)`. `frameDuration()`
      reads `fr` from the scene at the current time (`sceneAt`, then the scene JSON through the film
      source, cached per scene). `caption()` finds the cue covering `currentTime` in `engine.cues`.
      Map `TalkieError` codes to the adapter's `error` event, and `scenewarning` to a
      `sceneWarning` capture event.
- [ ] Frame-step tests: at t = 1.98 in the fixture, Right lands on 2.0 (scene 2's first frame); at
      t = 2.0, Left lands on 2 - 1/30.
- [ ] `CaptionPlate`: shows `adapter.caption()` at the bottom of the picture, `pointer-events: none`,
      `data-testid={T.captionPlate}`, on by default, toggled by `T.captionsToggle` (label from copy).
      Hidden for mp4. Test: a click on the plate area still produces a pointer event on the picture
      with coordinates under the plate.
- [ ] While zoomed, call the engine's scale hook if Task 0.2 found one. If there is none, do nothing (the spec
      accepts the softer zoom on screen).
- [ ] `yarn vf check`, commit.

Review focus: base spec section 5 rule by rule for both kinds (no timecode anywhere, including
anything the engine might render; space and arrow rules; click while paused never plays; zoom only
while paused), MP4 behaviour unchanged, no SSR import of `@talkie/player`, and listener cleanup.

### Task 3.3: server frame sources (build agent; reviewed)

**Files (app):** `lib/media/frame-source-ffmpeg.ts`, `lib/media/frame-source-talkie.ts`,
`lib/media/talkie-render-page/` (static HTML and a small esbuild-bundled script, built by
`predeps` or a `build:render-page` script), `lib/media/frame-sources.ts` (the factory that picks by
`mediaKind`), `lib/render/stills.ts`, `lib/render/clip.ts`, `lib/pipeline/steps/{stills,clip}.ts`,
and their tests.

- [ ] Refactor first: `renderMomentStill`, `renderOverview` and `renderClip` take a `FrameSource`
      instead of `src`. `ffmpegFrameSource(path)` wraps `extractFrame`. All existing render tests pass
      with the ffmpeg source.
- [ ] Zoom crops for Talkie: render the full frame at `ceil(STILL_MAX_WIDTH * zoom.scale)` and crop,
      instead of extracting at `probe.width` and upscaling. Unit test with a fake source records the
      requested widths.
- [ ] `talkieFrameSource(filmDir, size)`. If Task 0.2 found a reusable renderer in `@talkie/cli`, wrap
      it. Otherwise:
  - start a loopback HTTP server on port 0 serving `filmDir` and the render page (path allow-list
    as in Task 3.1);
  - launch Chromium with `playwright-core`'s `chromium.launch({ args: ['--disable-gpu', '--mute-audio'] })`
    through the low-priority wrapper (`executablePath` plus `ionice` and `nice` via a wrapper
    script, or `spawnLowPrio` and `connectOverCDP`). The process must run at nice 19, so the test
    checks `/proc/<pid>/stat`;
  - the page exposes `window.renderAt(t, width)`, which resizes the canvas, awaits
    `engine.renderAt(t)` and resolves. Node then takes `locator('canvas').screenshot()`;
  - one page and one call at a time (a promise chain), a `TALKIE_FRAME_TIMEOUT_MS` limit per call
    that kills the browser on timeout, close after `TALKIE_BROWSER_IDLE_MS` idle, and `close()` is
    idempotent;
  - a missing Chromium gives `copy.admin.chromiumMissing`.
- [ ] Unit tests with a fake browser for the queueing, timeout, idle close and error mapping. Add an
      integration test tagged `@chromium` (run by `yarn vf test:chromium`, excluded from
      `yarn check`): the fixture at t=1 is mostly red and at t=3 mostly blue (sharp `stats()`
      dominant channel), and a 2.5x zoom crop is sharper than an upscale (edge contrast).
- [ ] `yarn vf check` and `yarn vf test:chromium`, commit.

Review focus: zombie Chromium processes, low priority actually applied, timeouts, loopback-only
binding, memory on a 2-core 9 GB host, and the MP4 path unchanged.

### Task 3.4: export enrichment (build agent; not reviewed)

**Files (app):** `lib/export/talkie.ts` (new: `talkieInfoFor(film, sceneFps, vt, cues): TalkieMomentInfo`),
`lib/export/model.ts`, `lib/export/markdown.ts`, `lib/export/readme.ts`, `lib/export/zip.ts`, and
their tests, plus a seed in `test/fixtures/export-seed.ts` for one talkie session.

- [ ] Tests: at vt 1.0 in the fixture, `{ sceneId: 's01', sceneIndex: 0, sceneSrc: 'a/s01.json', sceneTime: 1, sceneFrame: 30, chapter: 'Red', caption: 'Red scene.' }`;
      at vt 3.5, scene `s02`, `sceneTime` 1.5, `sceneFrame` 45, chapter 'Blue'; past the last cue,
      caption null; boundary vt 2.0 belongs to `s02` (`sceneAt` rule).
- [ ] `feedback.json` moments gain `talkie` for talkie versions only (absent for mp4: snapshot test of
      the existing mp4 export unchanged). `feedback.md` moment lines gain
      `, scene s01 frame 30, caption "Red scene."` (Markdown-escaped). The zip gains
      `media/talkie.json` and `media/captions/*.vtt`. The README gains the two-sentence explanation.
- [ ] `yarn vf check`, commit.

### Integration and gate

Merge `task-t3-1` to `task-t3-4`, wire `frame-sources.ts` into the pipeline steps, apply
`sharedChangesNeeded`, run `yarn check` and `yarn vf build`, and fix breakage. Gate: `yarn check`,
`yarn vf test:chromium`, `yarn vf build`.

---

## Phase 4: end-to-end

### Task 4.1: Talkie review flow (test agent)

**Files:** `apps/video-feedback/e2e/talkie-review.spec.ts`, and helpers in `e2e/helpers.ts`.

- [ ] Global setup imports `talkie-mini.lottie` through `POST /api/admin/videos` (E2E test mode)
      next to the existing MP4 fixture.
- [ ] Spec (chromium project): open the review link, pass the mic check (fake mic), play, wait for
      the caption plate to read "Red scene.", pause, assert there is no text matching
      `/\d+:\d\d/` anywhere on the page, click the picture centre, speak (fake mic), resume,
      press Right while paused across the scene boundary, finish, request the export until it is
      ready, unzip it, and assert: one moment comment, its moment has `talkie.sceneId` `s01`,
      `stills/<cid>/moment-01.png` exists and its centre pixel is red, and `media/talkie.json` is present.
- [ ] A load failure case: route the film's `talkie.json` to 500 and assert the video error panel
      and its Reload button.
- [ ] Run `yarn vf test:e2e` in full: the MP4 specs pass unchanged.

Fix loop: up to 3 rounds (fix-tests agent).

---

## Phase 5: polish

### Task 5.1: review (one reviewer, read-only)

One lens covering Talkie spec compliance, reviewer UX on a Talkie film (screenshots from
`test-results/`), and the security of import and the film route. Report findings with evidence.

### Task 5.2: fixes, then a final gate

Fix critical, high and medium findings with tests, and quick lows. Record the rest in
`docs/FOLLOW-UPS.md` under a "Talkie" heading. Then the final gate: `yarn check`,
`yarn vf test:e2e`, Talkie's `yarn e2e`, `yarn vf test:chromium`, `yarn vf build` (one at a time).

---

## Phase 6: deployment docs

### Task 6.1: docs only (build agent)

- [ ] `docs/DEPLOY.md`: the checkout is the monorepo, the app builds from `apps/video-feedback`
      (`yarn install`, `yarn vf build`), and the standalone output and static copy paths are updated.
      Chromium is installed with
      `ionice -c2 -n7 nice -n19 yarn vf playwright install chromium` (add `--with-deps` once, as
      root, if libraries are missing). Smoke check: import `talkie-mini.lottie` and export it.
- [ ] `deploy/video-feedback.service`: the new `WorkingDirectory` and `ExecStart` paths.
- [ ] Root `README.md`: the layout and the `yarn check` and `yarn vf ...` commands.
- [ ] Commit `docs: monorepo layout and Talkie stills on geriatrix`.

### Task 6.2: deploy (Tim only)

Not run by the workflow.
