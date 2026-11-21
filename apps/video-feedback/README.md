# Video feedback

A reviewer opens a link, watches a video, pauses and talks while pointing at the frame. The app
turns that into timecoded, word-aligned, pointer-annotated feedback and exports it as a zip that an
LLM can read.

- Design spec: `docs/superpowers/specs/2026-11-21-video-feedback-design.md`
- Implementation plan: `docs/plans/2026-11-21-video-feedback.md`

## Stack

Next.js 16 (App Router), React 19, Mantine 9, plain files on disk under `DATA_DIR`, ffmpeg and
ffprobe, sharp, Groq Whisper for transcription.

## Getting started

```bash
nvm use            # Node 24 (anything from 22 up works)
yarn install
cp .env.example .env.local
yarn dev
```

`ffmpeg` and `ffprobe` must be on the `PATH`.

## Usage

The whole loop: put a video in, send the link, collect the feedback as a zip.

### 1. Add a video

Source videos are copied to the server, not uploaded through the browser. They must be MP4 with
H.264 video in `yuv420p`.

```bash
# from the shell, on the machine that holds DATA_DIR
yarn import film.mp4 --title "Spring promo"      # new video, prints the review link
yarn import film-v2.mp4 --video <videoId>        # next version of an existing video
```

Or drop the file into `DATA_DIR/inbox/` (rsync, scp) and import it at `/admin/inbox`.

### 2. Send the review link

Each video has one link, `/r/<token>`, shown by `yarn import` and by Copy review link on `/admin`.
Anyone with the link can review; there is no account. It always plays the latest version.

The reviewer types a name, passes a short mic check, and watches. To comment they pause and
talk, pointing at the frame with the mouse while they do. Pressing play ends the comment. It
needs a computer: phones and tablets get a page asking the reviewer to switch.

### 3. Collect the feedback

`/admin/videos/<videoId>` lists the sessions per version, with a Download zip button (and a
"with clips" toggle) and a Reprocess button for comments that failed.

From the shell:

```bash
yarn export <videoId>                         # latest version, zip in this folder
yarn export <videoId> --version all --clips --out ~/exports/
yarn export <videoId> --since 2026-11-21T09:00:00Z
yarn reprocess <videoId>                      # retry failed comments
yarn reprocess <videoId> --from-step moments  # rebuild from one step onwards
```

Over HTTP, for scripts (behind Cloudflare Access in production, see `docs/DEPLOY.md`):

| Request                                       | Answer                                   |
| --------------------------------------------- | ---------------------------------------- |
| `GET /api/admin/videos`                       | Videos, review links and counts, as JSON |
| `GET /api/admin/videos/<videoId>/export.zip`  | The zip                                  |
| `GET /api/admin/videos/<videoId>/export.json` | `feedback.json` only                     |
| `POST /api/admin/videos/<videoId>/reprocess`  | Retry failed comments                    |

Both exports take `version=latest|<n>|all`, `clips=1`, `since=<ISO time>` and `partial=1`. While
comments are still being processed the answer is `202` with `Retry-After: 30`, unless `partial=1`.

### 4. Hand the zip to an LLM

The zip opens with a `README.md` written for the model, then `feedback.md` (every comment with
its timecode, transcript and what was pointed at), `feedback.json` (the same, structured), and a
still per key moment with the pointer drawn on. Unzip it and point the model at the folder.

### Local development without Cloudflare or Groq

In `.env.local`, `ADMIN_AUTH=off` opens the admin pages and `TRANSCRIBER=fake` skips the network.
Both are refused when `NODE_ENV=production`.

## Deployment

Runs as one Node process under systemd behind a Cloudflare Tunnel, with Cloudflare Access on
`/admin` and `/api/admin`. See `docs/DEPLOY.md`, `deploy/video-feedback.service` and
`deploy/cloudflared.md`.

## Commands

| Command                                        | What it does                                            |
| ---------------------------------------------- | ------------------------------------------------------- |
| `yarn check`                                   | prettier --check, biome lint, tsc, vitest run           |
| `yarn test` / `yarn test:watch`                | Vitest                                                  |
| `yarn test:e2e`                                | Playwright                                              |
| `yarn typecheck`                               | `tsc --noEmit` (TypeScript 7, the Go-native compiler)   |
| `yarn lint` / `yarn lint:fix`                  | Biome lint                                              |
| `yarn format` / `yarn format:check`            | Prettier                                                |
| `yarn dev` / `yarn build` / `yarn start`       | Next.js                                                 |
| `yarn fixtures`                                | Generate media fixtures into `test/fixtures/generated/` |
| `yarn import`, `yarn export`, `yarn reprocess` | Command line tools                                      |

## Low priority by default

Every heavy script (install, build, lint, typecheck, tests, Playwright, ffmpeg, dev server) runs
through `scripts/lowprio.sh`, which is `ionice -c2 -n7 nice -n19`: best-effort IO at its lowest
level and the lowest CPU priority. The yarn scripts wrap themselves, so `yarn check` needs no
prefix. For anything else, prefix it: `./scripts/lowprio.sh yarn install`.

Parallelism is capped too: Vitest `maxWorkers: 2`, Next build `experimental.cpus: 2`, Playwright
`workers: 2`. `yarn start` is the one exception and runs at normal priority.

## Toolchain notes

- **TypeScript 7.** `typescript@7` ships the Go-native compiler as `tsc`. `yarn typecheck` uses it
  directly, and `next build` (16.4) runs its own type check against it with no workaround.
- **Lint and format are split.** Biome lints (its formatter is switched off) and Prettier formats.
- **Tests.** Vitest runs two projects: `node` for library and route tests, and `jsdom` for
  `*.test.tsx`, `lib/capture` and the review state machine.
