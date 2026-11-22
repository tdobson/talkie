# The guide: Talkie and video feedback, from scratch

Read this first if you are new to this repo, as a person or an agent. It tells you what each tool
is, which one to use, how to get films on and off the review platform, where everything runs, and
the traps that have already caught people out. Every section links to the doc with the detail.

## 1. What is here

| Thing | What it is | Where |
| --- | --- | --- |
| **Talkie** | A film format: vector drawings that move, plus narration. Plays in a web page like a video, stays sharp at any size, a fraction of an MP4's size. Written as code: scene files and SVG art in, one `.lottie` file out. | `packages/` (format, author, player, react, cli), `examples/` |
| **Video feedback** | The review platform. A reviewer opens a link, watches, pauses, talks and points. You get transcripts, timecodes, stills with the pointer drawn on, and for Talkie the exact scene. | https://video-feedback.tdobson.net, code in `apps/video-feedback` |
| **Drop player** | A static page: drop a `.lottie` and it plays. Nothing is uploaded. | https://talkie.tdobson.net, code in `sites/talkie-drop` |

The repo is https://github.com/tdobson/talkie (private, branch `main`). Tim and Edward can commit.
On tragicomix it is checked out at `~/dev/video-feedback.tdobson.net`.

## 2. Choose the format

| You are making | Use | Why |
| --- | --- | --- |
| An explainer, training or how-to film with drawn pictures | **Talkie** | Change a scene and rebuild in seconds, narration from a script, captions free, tiny file. Feedback names the exact scene. |
| A screencast, screen recording, or Playwright video of a real app | **MP4, H.264** | Talkie has no video or bitmap scenes (by design). A recording is pixels. |
| Camera footage, or a film made elsewhere | **MP4, H.264** | Same reason. |
| An MP4 of a Talkie film for a site that insists on one | `talkie export` on a render host | See [exporting.md](exporting.md). Never on tragicomix. |
| Just watching a `.lottie` someone sent | https://talkie.tdobson.net | Plays locally, nothing uploaded. |

### Codecs and settings that work

- **MP4 for the review platform:** H.264 video in `yuv420p`, AAC audio, `+faststart`. The platform
  refuses every other video codec (H.265/HEVC, VP8, VP9, AV1), so H.264 is the one to use.
  Playwright records VP8 WebM: always re-encode.

  ```bash
  scripts/low ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow \
    -c:a aac -b:a 128k -movflags +faststart out.mp4
  ```

- **Burn captions into an MP4** if you want them seen: the review player shows no subtitle track,
  and stills are frames of the video.
- **Talkie narration** is mastered to -16 LUFS integrated, true peak at most -1 dBTP, and encoded
  twice: WebM Opus (`u/narration.webm`) and AAC (`u/narration.m4a`). `talkie qa` checks both.
- **Talkie art** is flat SVG: no gradients, clip paths, masks, filters, bitmaps or live text
  ([authoring.md](authoring.md#art-rules)). Soft shadows are drawn as several flat copies, which
  makes scene JSON big but is fine.
- **Size on the platform:** a Talkie film may take 500 MB on disk (scene JSON is stored gzipped)
  and unpack to 2000 MB. A one-hour film with soft shadows (583 MB unpacked) takes 72 MB.
- The evidence for Talkie's choices (WebM Opus, own SVG converter, sizes against H.264 and H.265)
  is in [spike/REPORT.md](../spike/REPORT.md).

## 3. Get films on and off the review platform

Full detail, from a shell, with no browser: [review-platform-for-agents.md](review-platform-for-agents.md).

1. **On:**
   - `rsync` the `.mp4` or `.lottie` to `geriatrix:/srv/video-feedback/data/inbox/`.
   - `POST /api/admin/inbox` with `{"filename","mode":"new","title"}`, or with
     `{"filename","mode":"version","videoId"}` to add the next version of a video already there.
   - `GET /api/admin/videos` gives the `reviewUrl`.
2. **Hand the review link to Tim**, not to reviewers. Anything sent to a person needs Tim's
   sign-off on the exact words.
3. **Off:**
   - `GET /api/admin/videos/<id>/export.json?version=latest` is for a model.
   - `export.zip` adds stills, plus clips with `&clips=1`.
   - A `202` means it is still processing.
4. **Act on it:**
   - Talkie: each moment names `sceneId`, `sceneTime` and `caption`. Change `scenes/<id>.ts`,
     rebuild, then import the result as the next version.
   - MP4: keep a `steps.json` next to the film (step id, start and end in seconds, caption, click
     positions as 0..1 fractions). Match each comment's `pausedAtVideoTime` to a step.
5. **Delete:** not in the API. Ask Tim.

Admin API calls need the Cloudflare Access service token from
`~/.config/video-feedback/service-token.env` on tragicomix. Source it; never print it or copy it
anywhere. People log in to `/admin` with a one-time PIN sent to their email (Tim and Edward are
allowed).

## 4. Make a Talkie film

- [AGENTS.md](../AGENTS.md) is the map: the commands and the machine rules.
- [make-a-film.md](make-a-film.md) goes from an empty folder to a film, and
  [authoring.md](authoring.md) covers scenes, art and narration.
- [cli.md](cli.md) covers `voice`, `build`, `check`, `qa`, `dev` and `export`.
- [how-it-works.md](how-it-works.md) shows how the pieces connect, and
  [spec/talkie-format-1.md](../spec/talkie-format-1.md) is the format itself.
- [embedding.md](embedding.md), [serving.md](serving.md), [offline.md](offline.md) and
  [link-previews.md](link-previews.md) cover putting a film on a page.
- Film projects live outside the repo, in `~/dev/talkie-films/<film>/` on tragicomix, with
  `node_modules/@talkie/{author,cli}` symlinked to this repo's `packages/`.
- Converters from the old animated-SVG films:
  - MD films: on asterix, in `~/md-roofkit-films-bulk/talkie/converter/`.
  - Solfit: on xebit-dev1, in `~/dev/solfit-install-film/tools/talkie-port/`.
  - Copy one rather than editing it in place.

## 5. Machines

| Machine | Use it for | Never |
| --- | --- | --- |
| **tragicomix** (Tim's desktop, shared) | Editing, builds and tests, always through `scripts/low` | Render or export films; encode video |
| **geriatrix** (the live server) | Runs video-feedback, in a systemd unit behind a Cloudflare tunnel | Build on it (old CPU, 2 cores). Deploy from tragicomix instead. |
| **asterix, xebit-dev1, xebit-dev3** | `talkie export`, ffmpeg encodes, big renders | |
| **judithix** (quiet) | Timing and sync measurements | |

geriatrix in brief:
- It is an AMD Turion II with no SSE4, so the prebuilt `sharp` crashes with SIGILL. The deploy
  swaps in a build made from source.
- The app lives in `/srv/video-feedback`, which links to `/srv/data/video-feedback`. In there:
  - `releases/<stamp>/`, with a `current` symlink pointing at the live one;
  - `data/`, which holds `videos/` and `inbox/`;
  - `env`, the secrets file (mode 600);
  - `ms-playwright/`, the Chromium build used for Talkie stills.
- The root filesystem is almost full, so everything goes under `/srv/data`.

## 6. Deploy

One command each, from the repo root on tragicomix:

- `scripts/deploy/video-feedback.sh` does the whole video-feedback deploy:
  - builds;
  - swaps in the old-CPU sharp;
  - puts Chromium on geriatrix;
  - uploads a new release next to the old ones and switches to it;
  - smoke tests it, rolling back if the test fails;
  - keeps three releases.

  Then run `node scripts/deploy/smoke-talkie.mjs <review-url> <videoId>` against the "Talkie smoke
  check" video, with the service token loaded. It runs a whole review with a fake microphone and
  checks for a server-drawn still. See [DEPLOY.md](DEPLOY.md).
- `scripts/deploy/talkie-player.sh` deploys talkie.tdobson.net (Cloudflare Pages). Its header says
  where the credentials come from.

Deploy only when asked. The gate before a deploy:
- `yarn check` from the root, which covers the Talkie tests and the app check;
- `yarn vf test:e2e`.

## 7. Traps that have caught people out

- **Next.js 16 route handlers drop `Content-Encoding` and `Content-Length`**, and Next gzips JSON
  responses itself. So a route cannot send pre-gzipped bytes: the browser gets gzip it cannot
  read. Scenes are stored gzipped and unzipped as they stream out of the film route, and Next
  compresses them again. The stills render server is plain Node, so it sends the gzip as is.
- **Peaky voices failed loudness:** the ballad TTS voice peaks about 24 dB above its loudness, and
  the -4 dBFS limiter ate 2 LU. The master now measures after the limiter and corrects the gain,
  up to 6 passes.
- **The smoke test's fake microphone** loops with gaps shorter than the 600 ms of quiet that the
  onboarding "Got that" waits for, so the smoke test skips the practice with play. The e2e tests
  use fast timers and cover "Got that".
- **Agent worktrees under `.claude/worktrees/`** make the root `yarn check` fail: jest finds every
  package twice, and the format check reads the worktree's files. Remove finished worktrees with
  `git worktree remove` before running the gate.
- `yarn workspace @talkie/cli build` cannot find esbuild. Build the packages with `yarn build` from
  the root.
- Headless browsers play sound out loud on tragicomix. Mute them in any browser script.
- Timing numbers measured on tragicomix are not reliable (it is often under heavy load). Measure
  on judithix.
- `talkie qa` on a one-hour film takes most of an hour and about 4 GB of memory.
- Big imports run inside the request, and Cloudflare cuts a request off after about 100 s. If a
  `curl` import times out, check `GET /api/admin/videos` before you retry.
- Do not build in another agent's film project: two agents may be editing it, and a build from
  outside overwrites their output. Copy the project first.
- No em or en dashes in anything a person reads: docs, captions, UI and comments. Tests check the
  main docs.

## 8. Where the rest is

- [docs/README.md](README.md): every Talkie doc.
- [apps/video-feedback/README.md](../apps/video-feedback/README.md): how the app is built.
- [DEPLOY.md](DEPLOY.md): deploying, first install, rollback and troubleshooting.
- [SNAGGING.md](SNAGGING.md): known issues still to do, and what is done.
- [phone-checks.md](phone-checks.md): checking playback on real phones.
- `docs/plans/` and `docs/superpowers/specs/`: the original plans and designs. Where they differ
  from the code, the code is right.
