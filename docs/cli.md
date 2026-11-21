# The `talkie` command

Six commands: `voice`, `build`, `check`, `qa`, `dev`, `export`.

## Running it

The CLI runs from its build. Build once, then make a short name for it:

```sh
cd /path/to/talkie
yarn build
export TALKIE=$PWD
alias talkie="$TALKIE/scripts/low node $TALKIE/packages/cli/dist/bin.js"
```

From the repo root you can also run `scripts/low yarn talkie <command>`. Paths are then relative
to the repo root.

### Always at low priority

`scripts/low` is `nice -n 19 ionice -c 2 -n 7`: the lowest CPU and disk priority. Run every
`talkie` command through it, as the alias above does. The build machine (tragicomix) is a shared
desktop, and encoding audio or rendering frames at normal priority makes it stutter. The CLI
starts its own `ffmpeg` runs at low priority too, and `talkie export` warns you if it was not
started that way.

### The project argument

`voice`, `build`, `qa` and `dev` take a film project folder, `.` by default. `check` and `export`
take a built film: a folder or a `.lottie`.

`talkie voice` needs the full path of the project. Run it as `talkie voice "$PWD"`. A relative
path, the default `.` included, fails with `Cannot find module 'talkie.config.ts'`.

## `talkie voice`

Voices every script line that has no current take, and caches the takes in `.talkie/voice/`.

```sh
talkie voice "$PWD"
talkie voice "$PWD" --only s02-shelf
talkie voice "$PWD" --check
```

| Flag | Meaning |
| --- | --- |
| `--provider <fake\|openrouter>` | Voice with this provider instead of the one in the config. |
| `--only <sceneId>` | Voice the lines of one scene only. |
| `--check` | Listen to every line with Whisper and flag likely misreads. Needs `GROQ_API_KEY`. |

The `openrouter` provider needs `OPENROUTER_API_KEY`. The `fake` provider needs nothing: it
makes a quiet tone as long as a real voice would take.

It prints one row per line, `new` or `cached`. With `--check`, a flagged line makes the command
exit 1.

`talkie build` reads the takes of the provider named in `talkie.config.ts`. If you voice with
`--provider fake` while the config says `openrouter`, the build still asks for the real takes.

## `talkie build`

Builds the project into `dist/film/` (folder form) and `dist/film.lottie` (packed form).

```sh
talkie build
talkie build path/to/project
```

| Flag | Meaning |
| --- | --- |
| `--opus <webm\|ogg>` | Container of the Opus track. Default `webm`. Leave it alone unless you are testing. |

It needs `ffmpeg` on the `PATH`. It stops if any line has no current take: run `talkie voice`
first. Scenes that have not changed come from the cache in `.talkie/build/`, and the summary
says how many were rebuilt. The same project always gives the same bytes.

## `talkie check`

Tests a built film against [the format spec](../spec/talkie-format-1.md).

```sh
talkie check dist/film
talkie check dist/film.lottie
```

It checks `talkie.json` with `validateFilm`, that every file it names is there, that each
scene's animation is as long as its scene, and that `manifest.json` lists the same scenes. It
prints `<film>: OK`, or one line per problem and exits 1. It has no flags.

## `talkie qa`

Builds the project, runs `check` on both forms, then runs the content gates.

```sh
talkie qa
```

| Gate | Fails when |
| --- | --- |
| `check` | `talkie check` finds a problem in `dist/film` or `dist/film.lottie`. |
| `voice` | A line has no take, or its take is stale. |
| `captions` | A caption chunk is over 112 characters. |
| `dashes` | A title, script line, caption or label has an em or en dash. |
| `loudness` | A track is more than 1 LU from -16 LUFS. |
| `true peak` | A track peaks above -1 dBTP. |
| `still` | Nothing moves for more than 8 seconds in a scene (the tail at the end is not counted). |
| `caption band` | Art reaches below y 845 on a 1080 stage, where captions sit. |
| `size` | Never. It reports the bytes of the animation and each audio track. |

It takes the same `--opus` flag as `build`. It exits 1 if any gate fails.

## `talkie dev`

Builds the project and serves a live preview in the real player. Saving a file rebuilds and
reloads the page at the same time in the film.

```sh
talkie dev
talkie dev --port 5000
```

| Flag | Meaning |
| --- | --- |
| `--port <port>` | Port to serve on. Default `4321`. `0` picks a free one. |

The page has a button per scene and buttons to step one frame back or forward. A build error
shows on the page. Press Ctrl+C to stop.

## `talkie export`

Renders a built film to a video file. See [exporting.md](exporting.md) for which codec to use.

```sh
talkie export dist/film -o shelf.mp4
talkie export dist/film.lottie -o shelf.mp4 --size 720p --captions burn
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `-o, --out <file>` | The video to write: `.mp4`, `.mkv` or `.webm`. Required. | |
| `--codec <codec>` | `h264`, `h265` or `av1`. | `h264` |
| `--audio <codec>` | `aac`, or `opus` for `.mkv` and `.webm`. | `aac`, or `opus` for `.webm` |
| `--size <size>` | `720p`, `1080p`, `4k` or `<W>x<H>` with even numbers. | `1080p` |
| `--from <seconds>` | Film time to start at. | `0` |
| `--to <seconds>` | Film time to stop at. | the end |
| `--captions <mode>` | `burn` (drawn into the picture), `track` (a subtitle track) or `none`. | `none` |
| `--fps <fps>` | Frames per second, 1 to 120. | `25` |
| `--allow-here` | Render even on tragicomix. For small test exports only. | off |

### The tragicomix rule

`talkie export` draws every frame in headless Chromium and encodes with `ffmpeg`. That is far
too heavy for the shared desktop. On a machine named `tragicomix` it refuses to run:

```
Render on xebit-dev1, xebit-dev3 or asterix, not tragicomix
```

Copy the film to one of those machines and export there, still through `scripts/low`.
`--allow-here` exists for the test suite's tiny exports (320x180, 2 seconds). Do not use it for
a real film.

## Exit codes

Every command exits 0 when it worked and 1 when it did not, with the reason on stderr.
