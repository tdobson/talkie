# Talkie and video feedback

One repo, two projects, one `yarn install`.

| Project | Where | What it is | Read |
| --- | --- | --- | --- |
| Talkie | `packages/`, `examples/`, `spec/` | A film format: vector drawings that move, plus narration. It plays in a web page like a video. | [AGENTS.md](AGENTS.md), then [docs/README.md](docs/README.md) |
| Video feedback | `apps/video-feedback/` | A Next.js app. A reviewer watches a film, pauses, talks and points; the app exports that as feedback a model can read. | [apps/video-feedback/README.md](apps/video-feedback/README.md), [docs/DEPLOY.md](docs/DEPLOY.md) |

The app uses `@talkie/format` and `@talkie/player` straight from `packages/`.

## Commands

Run these at the repo root. Node 22 or newer, yarn 4, ffmpeg.

```sh
scripts/low yarn install     # every workspace, one lockfile
yarn check                   # the gate: Talkie's tests, then the app's
yarn build                   # build the Talkie packages
yarn vf build                # build the app ("yarn vf <script>" runs any app script)
yarn vf dev                  # run the app locally
yarn e2e                     # Talkie's Playwright suite
yarn vf test:e2e             # the app's Playwright suite
```

Every heavy command runs at the lowest CPU and IO priority. The yarn scripts wrap themselves;
for anything else, prefix it with `scripts/low`. Never run two builds or two end-to-end suites
at once.

`docs/` holds the Talkie guides, the deploy guide for the app, and the plans and designs for
both projects.
