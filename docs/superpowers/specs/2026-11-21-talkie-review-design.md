# Talkie films in the feedback tool: design

Date: 2026-11-21. Status: draft for Tim's review. It adds to
`2026-11-21-video-feedback-design.md` (called "the base spec" below). Everything in the base
spec still applies unless this document says otherwise.

## 1. Purpose

Reviewers can already watch an H.264 MP4 and give spoken, pointed feedback. This change lets
them do exactly the same with a **Talkie film**: a narrated vector film made of Lottie scenes in a
dotLottie container (see `docs/superpowers/specs/2026-11-21-talkie-design.md` on the
`svg-animation-codec-or-container` branch). The reviewer experience stays the same and the
timecode stays hidden. The export gains what only a Talkie film can offer: the scene, the
scene-local frame, the chapter and the caption at every key moment, so the LLM reading the
bundle can point straight at the scene source to change.

## 2. Scope

In scope:

- One monorepo holding both projects (section 3).
- A media kind per version: `mp4` (today) or `talkie`.
- Importing a Talkie film from a packed `.lottie` file (admin upload, inbox, CLI) or a film
  folder (CLI and inbox only).
- Reviewer playback of Talkie films through `TalkieEngine` from `@talkie/player`, with captions
  shown by default.
- Server-side stills and clips for Talkie moments, rendered by a headless Chromium.
- Talkie fields in `feedback.md`, `feedback.json` and the zip.

Out of scope for now:

- Hit-testing the pointer against Lottie layer names ("the reviewer pointed at layer
  `logo/wordmark`"). Recorded as a follow-up; the data needed for it (scene id, scene frame,
  normalised x/y) is exported, so it can be computed later from the bundle alone.
- Reviewing a film while it is still being authored (`talkie dev` live reload).
- Any change to Talkie's own packages beyond what is needed to consume them (bugs found are
  fixed in `packages/*` with a test, as normal).

## 3. Repository structure

Both projects move into one yarn 4 workspace on a new branch `feat/monorepo`:

```
/package.json            root: private, workspaces ["apps/*", "packages/*", "examples/*"]
/yarn.lock               one lockfile
/scripts/low             Talkie's low-priority wrapper (root tooling uses it)
/apps/video-feedback/    everything that is at the root of feat/video-feedback today
/packages/format         @talkie/format
/packages/player         @talkie/player
/packages/author         @talkie/author
/packages/cli            @talkie/cli
/packages/react          @talkie/react
/packages/react-native   @talkie/react-native (if P2 was built)
/examples/*              Talkie examples
/spike/                  Talkie spike, unchanged, not a workspace
/docs/                   both projects' docs (file names do not clash)
```

`apps/video-feedback/scripts/lowprio.sh` stays (the systemd unit and DEPLOY.md use it). It
and `scripts/low` do the same thing: `ionice -c2 -n7 nice -n19`.

### Toolchains

The two projects chose different tools: video-feedback uses Biome, Prettier and Vitest; Talkie
uses oxlint, oxfmt and Jest. Both use TypeScript 7.0.2 (tsgo) and Playwright 1.65.

**Decision (default, changeable by Tim): keep both, scoped by folder.** Root tooling (oxlint,
oxfmt, Jest, root `tsconfig.json`) covers `packages/*` and `examples/*` and ignores `apps/*`.
`apps/video-feedback` keeps its own Biome, Prettier, Vitest and tsconfig. The root `yarn check`
runs Talkie's `yarn test` and then `yarn workspace video-feedback check`. That means no reformatting
churn and no rewriting of either project's tests in the merge. Unifying on one set is a later, separate
change.

### Consuming Talkie from the app

`apps/video-feedback/package.json` depends on `@talkie/format` and `@talkie/player` as
`workspace:*`. The packages export `dist/`, so:

- The app's `build`, `dev` and `test:e2e` scripts first build their workspace dependencies
  (`yarn workspaces foreach -Rpt --from video-feedback --exclude video-feedback run build`).
- Vitest and tsgo resolve `@talkie/*` to `packages/*/src` through aliases and `paths`, the same
  way Talkie's root tsconfig does, so unit tests need no build.
- `@lottiefiles/dotlottie-web` loads WebAssembly. Next bundles the engine for the browser only
  (dynamic import inside the client component, `ssr: false`).

## 4. Storage

A version gains a media kind. Additions to the base spec section 4:

```
videos/<videoId>/versions/<n>/
  source.mp4            (mp4 versions only, as today)
  probe.json            (both kinds; see below)
  film.lottie           (talkie versions: the packed film as imported, or packed from a folder)
  film/                 (talkie versions: the same film unpacked, served to the browser)
    talkie.json
    a/<scene>.json
    u/<narration>.opus | .m4a
    captions/<lang>.vtt
    poster.png | poster.svg
```

`VersionRecord` gains `mediaKind: 'mp4' | 'talkie'` (absent means `mp4`, so existing data is
read unchanged).

`probe.json` for a Talkie version is written at import from `talkie.json` and the first scene:

| field | value |
|---|---|
| width, height | `film.size` |
| fps | the first scene's Lottie `fr` |
| frameDuration | `1 / fps` |
| duration | `film.duration` |
| codec | `'talkie'` |
| pixFmt | `'vector'` |
| hasAudio | `film.audio.length > 0` |

## 5. Import

- **Packed `.lottie`**: read the bytes and open them with `openFilm(bytes)` from `@talkie/format`.
  This validates `talkie.json` (`validateFilm`) and rejects unsupported major versions. Then
  check every scene, audio, caption and poster path with `isSafeRelativePath` and unpack into
  `film/`. Refuse zip entries outside the listed paths, total unpacked size over 500 MB, and
  more than 2,000 entries.
- **Folder** (CLI `yarn import --film <dir>` and inbox folders): validate in place, copy the listed
  files into `film/`, and pack `film.lottie` with `@talkie/format`'s packer.
- The admin import modal accepts `.mp4` and `.lottie`. The inbox lists `*.mp4`, `*.lottie` and
  folders that contain a `talkie.json`.
- The kind is chosen by what was imported, not by a form field. Versions of one video may mix
  kinds (v1 an MP4 render, v2 the Talkie film); the reviewer always gets the session's version.
- Error copy (admin only): "This film did not pass validation: <first three errors>" and
  "This film needs Talkie version <n>, which this tool does not read yet."

## 6. Serving the film

`GET /api/r/<token>/film/<version>/<path...>` serves one file from `film/` for a `talkie`
version. It shares token and session checks with the video route. It allows only paths listed in
`talkie.json` plus `talkie.json` itself, each checked with `isSafeRelativePath`. The
Content-Type comes from `mimeFor`. Audio supports HTTP Range (`lib/review/range.ts`), and responses
carry `Cache-Control: private, max-age=3600`. The video route returns 404 for a `talkie` version
and the film route returns 404 for an `mp4` version.

The client opens the film with `openFilm(<folder URL>)`, so scenes load one by one and the
narration streams with Range requests. The reviewer never downloads the whole `.lottie`.

## 7. Reviewer experience

Base spec section 5 applies unchanged, screen for screen. The differences:

- **Player surface.** A `MediaAdapter` (section 9) wraps either the `<video>` element or a
  `TalkieEngine` mounted in the same letterboxed stage, sized by `film.size`. The
  `<talkie-player>` element is **not** used. It has its own visible timecode, scrubber and j/k/l
  keys, which would break the no-timecode rule and clash with our arrow keys.
- **Captions on by default.** The active caption cue (from `engine.cues` and the current time) is
  drawn as a plate at the bottom of the picture, `pointer-events: none`, so clicks still land on
  the picture. A small "Captions" toggle sits in the controls. The plate is part of the page,
  not the picture, so it never appears in stills or clips.
- **Frame step.** Left and Right step `1 / fr` of the scene under the playhead, read from that scene's
  Lottie JSON. Shift steps one second, as before. At a scene boundary the step lands on the first
  frame of the next scene.
- **Hold-to-zoom** works as before (CSS transform on the stage). While zoomed, the adapter asks
  the engine to redraw at `devicePixelRatio * zoom scale` when the renderer supports it, so
  vector edges stay sharp. If it does not, the softer zoom is accepted on screen. The server
  stills are always sharp (section 8).
- **Load failure.** A `TalkieError` (`invalid-film`, `unsupported-version`, `network`,
  `no-playable-audio`) shows the existing video error panel with its Reload button. Missing
  scenes (`scenewarning`) do not interrupt the reviewer. They are logged to the comment event log as
  `{ type: 'sceneWarning', sceneId }`.
- **Poster.** The film's poster is shown on the welcome screen where the MP4 poster frame is
  today.

## 8. Processing

The pipeline (base spec section 7) does not change, except for where frames come from.

```ts
interface FrameSource {
  /** PNG of the picture at time vt, at most maxWidth wide, aspect kept. */
  frame(vt: number, maxWidth: number): Promise<Buffer>;
  close(): Promise<void>;
}
```

- `ffmpegFrameSource(sourcePath)`: today's `extractFrame`, unchanged.
- `talkieFrameSource(filmDir, size)`: one headless Chromium from `playwright-core`, started
  lazily under `ionice -c2 -n7 nice -n19` with `--disable-gpu`. It loads a tiny local page, served
  from `film/` over a loopback-only ephemeral HTTP server, that mounts `TalkieEngine` on a canvas
  of the requested width, muted. `frame(vt, w)` calls `await engine.renderAt(vt)` and then takes
  a PNG screenshot of the canvas. Only one page is used at a time. The browser closes after 2 minutes
  idle and when the queue drains. Every call has a 30-second limit; on timeout the browser is
  killed and the step fails as other render failures do.
- Stills: the full still renders at `STILL_MAX_WIDTH`. The zoom crop renders the whole frame at
  `ceil(still width * zoom scale)` and then crops, so a 2.5x crop of a vector film is sharp,
  where an MP4 crop is upscaled.
- Clips: frames come from the same source at the clip's frame rate. Clips are still the last
  work in the queue.
- If `@talkie/cli` exposes a reusable headless frame renderer (Task T11 `talkie export`), the
  Talkie frame source wraps that instead of its own page. The plan's explore step decides.

**Deployment cost:** geriatrix needs Chromium for `playwright-core` (about 400 MB on disk and
200 to 300 MB of RAM while rendering, released when idle). `DEPLOY.md` gains the install step.

## 9. MediaAdapter (client)

```ts
interface MediaAdapter extends EventTarget {
  readonly kind: 'mp4' | 'talkie';
  readonly naturalSize: { width: number; height: number } | null;
  readonly duration: number;
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  play(): Promise<void>;
  pause(): void;
  /** Seconds per frame at the current time (constant for mp4). */
  frameDuration(): number;
  /** Active caption text at the current time, or null. Always null for mp4. */
  caption(): string | null;
  destroy(): void;
}
```

Both adapters emit `play`, `pause`, `seeking`, `seeked`, `timeupdate`, `waiting`, `playing`,
`ended`, `loadedmetadata` and `error`. `Player.tsx` and the hooks talk only to the adapter, never to
the `<video>` element directly. The MP4 behaviour must not change: every existing unit and
end-to-end test passes unchanged except for import paths.

## 10. Export

Additions to base spec section 9, for comments on `talkie` versions only:

- Each moment in `feedback.json` gains:
  ```json
  "talkie": {
    "sceneId": "s03",
    "sceneIndex": 2,
    "sceneSrc": "a/s03.json",
    "sceneTime": 1.84,
    "sceneFrame": 55,
    "chapter": "How it works",
    "caption": "Tap the card to see your balance."
  }
  ```
  `sceneFrame` is `round(frameFor(sceneTime, fr, ip, op))`. `chapter` and `caption` are null when
  none applies.
- In `feedback.md`, each moment line gains `scene s03 frame 55` and the caption in quotes, after
  the position label. Example:
  `- moment-02 (click, word "this"): bottom-centre, scene s03 frame 55, caption "Tap the card to see your balance."`
- The zip gains `media/talkie.json` and `media/captions/*.vtt` (small, and they let the LLM map scene
  ids to source). The film itself is not included, as the MP4 is not today.
- `README.md` in the zip explains the Talkie fields in two sentences.
- `meta.json` per comment records `mediaKind`.

## 11. Errors

| Situation | Behaviour |
|---|---|
| Invalid or unsupported film at import | Refused with the admin copy in section 5; nothing written |
| Unsafe path or zip bomb in a `.lottie` | Refused; nothing written |
| Reviewer browser cannot decode the narration | Video error panel; the reviewer can still give a general comment |
| A scene fails to load in the browser | Poster for that span, playback continues, `sceneWarning` event logged |
| Chromium missing on the server | Stills and clip steps fail with "Chromium is not installed for Talkie stills; see DEPLOY.md"; transcript and moments still export |
| Chromium hangs | 30 s limit per frame, browser killed, step failed, reprocess available |

## 12. Testing

- A tiny fixture film checked in at `apps/video-feedback/test/fixtures/talkie-mini/`: 2 scenes,
  4 seconds, 320x180, a sine-tone narration in Opus and M4A, a two-cue VTT, a 2-chapter
  `talkie.json`, plus its packed `talkie-mini.lottie`. Scene 1 is a solid red rectangle and scene 2 a
  solid blue one, so pixel checks are trivial. Built by a script with `@talkie/author`, or
  copied from a Talkie test fixture if one fits.
- Unit: import (packed, folder, every refusal), film route (paths, Range, kind mismatch), the
  adapters (both, behind the same contract test suite), frame step at scene boundaries, the
  caption plate, the export fields, and the Talkie frame source with a fake browser.
- Integration (Vitest, node, low priority, opt-in tag `@chromium`): the real
  `talkieFrameSource` renders the fixture at t=1 (red) and t=3 (blue).
- End-to-end (Playwright, chromium project): import `talkie-mini.lottie` through the admin API, review
  it with the fake mic, click on the picture, finish, export, and assert the moment carries
  `talkie.sceneId`, that the still exists and is mostly red or blue as expected, and that no
  timecode text appears anywhere. The whole existing MP4 suite runs unchanged.

## 13. Deployment

Unchanged except:

- The app's working directory on geriatrix is `apps/video-feedback` inside the monorepo checkout.
  The systemd unit's `WorkingDirectory` and `ExecStart` paths change.
- Install Chromium for `playwright-core` at low priority. `DEPLOY.md` gives the command and the
  smoke check: import the fixture film and export it.
- Nothing is deployed without Tim saying so.
