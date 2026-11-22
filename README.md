# Talkie and video feedback

New here? Start with [docs/GUIDE.md](docs/GUIDE.md): which format to use, codecs, getting films on
and off the review platform, machines, deploys, and the traps.

Two tools in one repo, built to go together:

| | What it is | Live | Read |
| --- | --- | --- | --- |
| **Talkie** | A film format: vector drawings that move, plus a narration track. It plays in a web page like a video (scrub bar, chapters, captions, speed) but stays sharp at any size and is a fraction of an MP4's size. Films are written as code: scene files and SVG art (flat colours, gradients, clip paths) in, a `.lottie` film out. | [talkie.tdobson.net](https://talkie.tdobson.net): drop a `.lottie` and it plays | [AGENTS.md](AGENTS.md), then [docs/README.md](docs/README.md) |
| **Video feedback** | A review app. Send someone a link; they watch a film (MP4 or Talkie), pause wherever they like, talk and point at the picture. The app turns that into feedback a person or a model can act on: transcripts, timecodes, stills with the pointer drawn on, and for Talkie films the exact scene and frame. | [video-feedback.tdobson.net](https://video-feedback.tdobson.net) (admin behind Cloudflare Access) | [apps/video-feedback/README.md](apps/video-feedback/README.md), [docs/DEPLOY.md](docs/DEPLOY.md) |

## When to use which

- **Make an explainer, training or how-to film:** make it in Talkie. It is cheap to change (edit a
  scene file, rebuild in seconds), the narration is generated from the script, captions come free,
  and the file is small enough to send anywhere. Export an MP4 only when a site insists on one.
- **Screencast or screen recording of a real app:** not Talkie. Talkie is vector drawings only, with
  no video or bitmap scenes. Record it, encode an MP4 with H.264 video (`yuv420p`) and AAC audio,
  and put that on video feedback. See
  [docs/review-platform-for-agents.md](docs/review-platform-for-agents.md#screencasts-and-screen-recordings-mp4-not-talkie).
- **Get someone's reaction to a film, MP4 or Talkie:** put it on video feedback and send them the
  review link. No account needed for reviewers. Talking while pointing beats writing notes, and
  the export is precise enough for an agent to fix the film from it.
- **Just watch a `.lottie` someone sent you:** drop it on [talkie.tdobson.net](https://talkie.tdobson.net).
  Nothing is uploaded.

The loop we use: an agent makes a Talkie film, it goes on video feedback, the reviewer talks
through it, the agent downloads the export and changes the scenes, and the next version goes up
on the same review link.

## For agents

- Make or change a Talkie film: [AGENTS.md](AGENTS.md) and [docs/make-a-film.md](docs/make-a-film.md).
  Never render or export films on tragicomix.
- Put a film up for review and read the feedback back: [docs/review-platform-for-agents.md](docs/review-platform-for-agents.md).

## Deploying

```sh
scripts/deploy/video-feedback.sh   # build here, ship to geriatrix, smoke test, roll back on failure
scripts/deploy/talkie-player.sh    # the drop player, to Cloudflare Pages
```

Details in [docs/DEPLOY.md](docs/DEPLOY.md) and [sites/talkie-drop/README.md](sites/talkie-drop/README.md).

## Layout

```
packages/
  format/            @talkie/format: the film format, validation, the .lottie packer
  author/            @talkie/author: scene code and SVG art in, Lottie JSON out
  player/            @talkie/player: the <talkie-player> element and its engine
  react/             @talkie/react: the React wrapper
  cli/               @talkie/cli: the talkie command
apps/
  video-feedback/    the review app (Next.js), with its own tests, scripts and deploy/ folder
sites/
  talkie-drop/       the drop-a-film player at talkie.tdobson.net (static, Cloudflare Pages)
examples/            a sample film project and two embeds
spec/                the Talkie format spec
docs/                Talkie guides, DEPLOY.md for the app, plans and designs
scripts/low          runs a command at the lowest CPU and IO priority
scripts/deploy/      one-command deploys for both sites
```

Everything is one yarn workspace tree with one `yarn.lock`. Talkie keeps its toolchain (oxlint,
oxfmt, Jest) and the app keeps its own (Biome, Prettier, Vitest); `yarn check` runs both.

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
yarn vf test:chromium        # the app's Talkie stills tests, against a real Chromium
```

`yarn vf <script>` is short for `yarn workspace video-feedback <script>`, so every script in
`apps/video-feedback/package.json` runs from the root: `yarn vf test`, `yarn vf typecheck`,
`yarn vf import`, `yarn vf export`. The Talkie stills need a Chromium, installed once with
`scripts/low yarn vf playwright-core install chromium-headless-shell`.

Every heavy command runs at the lowest CPU and IO priority. The yarn scripts wrap themselves;
for anything else, prefix it with `scripts/low`. Never run two builds or two end-to-end suites
at once.

`docs/` holds the Talkie guides, the deploy guide for the app, and the plans and designs for
both projects.

## Licence

Copyright (C) 2026 Tim Dobson.

This repository is free software: you can redistribute it and/or modify it under the terms of
the GNU Affero General Public License as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version. It is distributed in the hope
that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.
Every package in it (`@talkie/*`, the app, the examples, the drop player) is under the same
licence (SPDX `AGPL-3.0-or-later`).

Two things in it come from elsewhere and keep their own licences:

- **Work Sans** (`label.ttf` and `WorkSans.ttf`), the label font, is under the SIL Open Font
  License 1.1. The text is in `OFL.txt` next to each copy.
- **`examples/next-mantine`** started from the Mantine Next.js template, MIT licensed. Its
  notice is kept in `examples/next-mantine/LICENCE-MIT-template`.

The AGPL covers use over a network: anyone who runs a changed version of the review app for
other people must offer those people its source.
