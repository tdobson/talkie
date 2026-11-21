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
