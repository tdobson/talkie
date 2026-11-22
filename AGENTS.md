# Talkie: start here

Talkie is a film format: vector drawings that move, plus a narration track. It plays like a
video in a web page, with a scrub bar, chapters, captions and speed control, but it stays sharp
at any size and weighs a fraction of an MP4. The audio is the clock: the picture always shows the
frame that matches the sound.

Read this file first. It tells you what each piece is, where to go next, and the commands. New to
all of it, or not sure whether to use Talkie or an MP4? Read [docs/GUIDE.md](docs/GUIDE.md).

## Map of the repo

| Path | What it is | Touch it when |
| --- | --- | --- |
| `packages/format` (`@talkie/format`) | The film format: `talkie.json` types, `validateFilm`, readers for both forms, the `.lottie` packer. No dependencies on the other packages. | You change what a film file contains. Change the spec with it. |
| `packages/author` (`@talkie/author`) | The scene library. Scene code and SVG art go in, Lottie JSON comes out. | You add a drawing or motion helper, or SVG support. |
| `packages/player` (`@talkie/player`) | The `<talkie-player>` web component and the playback engine under it. | You change playback, controls, captions or theming. |
| `packages/react` (`@talkie/react`) | `<TalkiePlayer>`, a thin React wrapper around the element. Safe to render on a server. | You change the React props or events. |
| `packages/cli` (`@talkie/cli`) | The `talkie` command: `voice`, `build`, `check`, `qa`, `dev`, `export`. | You change how a project becomes a film. |
| `examples/sample-film` | A small complete film project that uses every author helper. | You want a working project to copy. |
| `examples/watch.html` | A standalone page that plays the `film/` folder next to it. | You want the smallest possible embed. |
| `examples/next-mantine` | A Next.js app router page with Mantine that plays the sample film. | You embed in a React app. |
| `spec/talkie-format-1.md` | The normative format spec. | You need the exact rules. |
| `docs/` | Task guides (see the table below). | Always, before guessing. |
| `spike/` | The phase 0 experiments and `spike/REPORT.md`, which records why WebM Opus and our own SVG converter were chosen. | You want the evidence behind a decision. |
| `scripts/low` | Runs a command at the lowest CPU and disk priority. | Every time you run a build tool. |

How the packages depend on each other: `format` stands alone. `author` and `player` use `format`.
`react` uses `player`. `cli` uses `author` and `format`, and uses `player` for `dev` and `export`.

## I want to...

| I want to | Read |
| --- | --- |
| Start from scratch: which format, codecs, machines, deploys, traps | [docs/GUIDE.md](docs/GUIDE.md) |
| Understand how the pieces connect | [docs/how-it-works.md](docs/how-it-works.md) |
| Make a film from an empty folder | [docs/make-a-film.md](docs/make-a-film.md) |
| Add a scene | [docs/authoring.md](docs/authoring.md#add-a-scene) |
| Import SVG art | [docs/authoring.md](docs/authoring.md#art-rules) |
| Change the narration | [docs/authoring.md](docs/authoring.md#change-the-narration) |
| Check a film | [docs/cli.md](docs/cli.md#talkie-check) and [docs/cli.md](docs/cli.md#talkie-qa) |
| Play a film on a web page | [docs/embedding.md](docs/embedding.md#script-tag) |
| Use it in Next.js with Mantine | [docs/embedding.md](docs/embedding.md#nextjs-app-router-with-mantine) |
| Serve a film | [docs/serving.md](docs/serving.md) |
| Make it work offline | [docs/offline.md](docs/offline.md) |
| Export an MP4 | [docs/exporting.md](docs/exporting.md) |
| Get a link preview | [docs/link-previews.md](docs/link-previews.md) |
| Change the player | [docs/how-it-works.md](docs/how-it-works.md#talkieplayer), then `packages/player/src/element.ts` |
| Change the format | [spec/talkie-format-1.md](spec/talkie-format-1.md), then `packages/format/src/validate.ts` |
| Put a film up for review and read the feedback | [docs/review-platform-for-agents.md](docs/review-platform-for-agents.md) |
| Make a screencast or screen recording | Not Talkie: an H.264 MP4. [docs/review-platform-for-agents.md](docs/review-platform-for-agents.md#screencasts-and-screen-recordings-mp4-not-talkie) |
| Just watch a `.lottie` | Drop it on https://talkie.tdobson.net (nothing is uploaded) |
| Deploy the review app or the drop player | [docs/DEPLOY.md](docs/DEPLOY.md), `scripts/deploy/` |

## Machine rules

These are not optional. The main machine (tragicomix) is a shared desktop.

```
1. Run every build tool through scripts/low (nice -n19, ionice -c2 -n7):
   tsc, oxlint, oxfmt, jest, playwright, esbuild, next build, ffmpeg, yarn install.
   The yarn scripts already do this, so prefer `yarn <script>`.
   For anything else, type it: scripts/low <command>
2. Never render or export a film on tragicomix. `talkie export` refuses to run there.
   Use xebit-dev1, xebit-dev3 or asterix (ssh in, still through scripts/low).
   `--allow-here` is for the tiny test exports only (320x180, 2 seconds).
3. Jest runs with 2 workers (`yarn jest` sets --maxWorkers=2). Playwright runs with 2 workers.
4. Do not add dependencies or change yarn.lock without being asked. The repo is AGPL-3.0-or-later,
   so any dependency must be compatible: MIT, BSD, ISC, Apache-2.0, MPL-2.0, LGPL, GPL-3 are fine;
   GPL-2.0-only, SSPL, BUSL and non-commercial licences are not.
5. No em or en dashes in anything a person reads: docs, captions, UI text, comments.
6. Build output is deterministic: no Date.now(), Math.random() or clock reads in build paths.
```

## Commands

Run these from the repo root. The package manager is yarn 4 and Node must be 22 or newer.

```sh
scripts/low yarn install --immutable   # install
yarn build                             # build every package into packages/*/dist
yarn jest                              # unit tests (2 workers)
yarn jest packages/format              # the tests of one package
yarn e2e                               # Playwright tests
yarn lint                              # oxlint
yarn typecheck                         # tsc --noEmit
yarn format:test                       # check formatting (yarn format:write fixes it)
yarn test                              # format, lint, typecheck and jest in one go
yarn sample                            # build the sample film with the fake voice
```

## Make a film and put it on a page

The short version. [docs/make-a-film.md](docs/make-a-film.md) is the full walkthrough.

```sh
yarn build                                                      # the CLI runs from its build
yarn sample                                                     # voice (fake, no network) and build
scripts/low yarn talkie check examples/sample-film/dist/film    # test it against the format spec
scripts/low yarn talkie qa examples/sample-film                 # check plus the content gates
scripts/low yarn talkie dev examples/sample-film                # live preview, localhost:4321
```

`yarn sample` runs `talkie voice` then `talkie build`, which writes `dist/film/` and
`dist/film.lottie` in the project. `yarn talkie <command>` is the CLI, run from the repo root.

Then copy `dist/film/` to any static host and put this on a page:

```html
<script type="module" src="./talkie-player.js"></script>
<talkie-player src="./film/"></talkie-player>
```

`talkie-player.js` is `packages/player/dist/talkie-player.js`, one file with everything in it.

## A film project, at a glance

```
my-film/
  talkie.config.ts     title, chapters (which set the scene order), voice, size
  scenes/<id>.ts       one scene: drawings and motion, timed to voice lines
  script/<id>.json     the narration lines of that scene, and caption overrides
  art/**/*.svg         drawings, loaded by name with art('roof/tile')
  fonts/label.ttf      the font labels are outlined with
  .talkie/             caches (voice takes, built scenes). Safe to delete.
  dist/film/           the built film, folder form
  dist/film.lottie     the built film, packed form
```

## A built film, at a glance

```
film/
  talkie.json          what the film is: scenes, audio, chapters, captions, poster
  manifest.json        dotLottie manifest, so LottieFiles tools open the .lottie
  a/<scene>.json       one Lottie animation per scene
  u/narration.webm     narration, Opus
  u/narration.m4a      narration, AAC (every film has one)
  captions/en.vtt      WebVTT captions
  poster.svg, poster.png
```

## When something is wrong

- A build fails: the message names the scene, line or file. The common ones are listed at the
  end of [docs/make-a-film.md](docs/make-a-film.md#common-errors).
- A film will not play: run `talkie check <film>` on the folder or the `.lottie`.
- The player shows an error: it carries a code (`invalid-film`, `unsupported-version`,
  `no-playable-audio`, `network`, `scene-failed`). See [docs/embedding.md](docs/embedding.md#errors).
- The plan and the design live in `docs/plans/` and `docs/superpowers/specs/`. Where they differ
  from the code, the code and the spec in `spec/` are right.
