# How Talkie works

One page: the pipeline, then each package. For the commands, see [cli.md](cli.md).

## The pipeline

```
  YOU WRITE                         THE CLI                       YOU SHIP

  talkie.config.ts  ---+
  script/<id>.json  ---+--> talkie voice --> .talkie/voice/*.wav (one take per line)
                       |                          |
  scenes/<id>.ts    ---+                          v
  art/**/*.svg      ---+--> talkie build ------------------+
  fonts/label.ttf   ---+      |                            |
                              |  per scene:                |  whole film:
                              |  planLines (line times)    |  join scene audio,
                              |  compileScene (the model)  |  master to -16 LUFS,
                              |  emitLottie (the JSON)     |  encode Opus and AAC,
                              |  svgAt(0) (the poster)     |  write captions (VTT),
                              |                            |  write talkie.json
                              v                            v
                      dist/film/                    dist/film.lottie
                        talkie.json                 (the same files, zipped)
                        manifest.json
                        a/<id>.json   one Lottie animation per scene
                        u/narration.webm, u/narration.m4a
                        captions/en.vtt
                        poster.svg, poster.png
                              |                            |
                 any static web host                 download, cache,
                              |                      app bundle
                              v                            v
               <talkie-player src="https://.../film/">   player.source = blob
                              |
                 openFilm -> validateFilm -> pick an audio track
                 audio element plays; each frame the player reads its time,
                 finds the scene, and sets that scene's Lottie frame
```

Scene code runs only at build time. Viewers get JSON, audio and captions. No film code ships.

## The sync model

- One `<audio>` element plays the narration. It is the only clock.
- On every animation frame the player reads the audio time, finds the scene that contains it
  (`sceneAt`), and sets that scene's animation to the matching frame (`frameFor`).
- When the audio pauses, buffers or seeks, the picture holds. Nothing can drift, because
  nothing else keeps time.
- Speed (0.5x to 2x) is the audio element's own `playbackRate`, which keeps the pitch.
- `SmoothClock` sits between the audio and the picture. Some browsers update
  `audio.currentTime` only every 20 to 40 ms, which would make motion judder. `SmoothClock`
  fills in between updates from the wall clock, never runs more than 250 ms ahead, and never
  steps back unless the jump is a real seek (300 ms or more).
- There is one Lottie animation per scene, not one for the film. Scenes stay small, load on
  demand, and a broken scene cannot stop the rest.
- Two canvases are stacked. One is visible. The other loads the next scene out of sight, so a
  scene change is a visibility swap and never shows a half-loaded picture.
- If a scene fails to load, the poster shows for that span and the narration carries on.

## `@talkie/format`

The format itself. No dependencies on the other packages. Runs in browsers and in Node.

- In: a parsed `talkie.json`, a folder URL, a `.lottie` URL or the bytes of a `.lottie`.
- Out: a checked `TalkieFilm`, a `FilmSource` to read its files, or a packed `.lottie`.

| Export | What it does |
| --- | --- |
| `validateFilm(input: unknown): ValidationResult` | Checks a parsed `talkie.json`. Returns `{ ok: true, film }` or `{ ok: false, errors }`, each error `{ path, rule, message }`. |
| `openFilm(input, opts?): Promise<{ film, source }>` | Opens either form, validates it, and gives a `FilmSource` with `json(path)`, `url(path)` and `dispose()`. |
| `sceneAt(film, t): ScenePosition` | The scene at film time `t`, and the time inside it. |
| `frameFor(localTime, fr, ip, op): number` | The Lottie frame for a time inside a scene. |
| `chapterAt(film, t): number` | The index of the chapter playing at `t`. |
| `packFilm(files): Uint8Array` | Zips a path-to-bytes map into a `.lottie`. Same input, same bytes. |
| `dotLottieManifest(film)` | The `manifest.json` for a film. |
| `mimeFor(path): string` | The MIME type of a film file, from its extension. |
| `isSafeRelativePath(p): boolean` | The path rule every `src` must pass. |
| `TalkieError` | The error readers throw, with a `code`. |
| `TALKIE_MAJOR` | The format version this code reads: `1`. |

Read first: `src/types.ts` (the whole shape of a film in 35 lines), then `src/validate.ts`,
then `src/open.ts`. The rules are written out in [the spec](../spec/talkie-format-1.md).

## `@talkie/author`

The scene library. It never touches the file system: the caller hands it loaders.

- In: a scene definition, the planned voice lines, the stage size, and loaders for art and font.
- Out: a `SceneModel`, then Lottie JSON (for the film) or SVG (for the poster).

| Export | What it does |
| --- | --- |
| `scene(id, build): SceneDef` | Declares a scene. `build` gets the context with every helper. |
| `planLines(lines, opts?): { lines, duration }` | Places voice lines on the scene clock and gives the scene's length. |
| `readHold(words): number` | How long a caption of that many words stays up. |
| `compileScene(def, input): SceneModel` | Runs a scene's `build` and returns the model. |
| `emitLottie(model): LottieAnimation` | The model as Lottie JSON, 60 frames a second. Each top level node is a layer. A node below that which fades and has more than one paint gets a layer of its own, so it fades as one picture. Gradients become gradient fills and strokes (`gf`, `gs`). A clipped node gets a layer with one mask per clip outline, and becomes a precomp when it sits under a fade or has layers of its own under it. |
| `svgAt(model, t): string` | The picture at time `t` as an SVG string, with the same gradients and clip paths. |
| `importSvg(svg, file, base?): ArtNode` | Turns an SVG drawing into shapes with flat or gradient paint, and clip outlines. Throws `UnsupportedSvgError` for anything it cannot draw exactly. |
| `labelPaths(font, text, options): BezierPath[]` | Text as outlines. |
| `assertNoConflict(text, conflicts): void` | The fact gate. Throws `FactConflictError`. |
| `fade`, `rise`, `pop`, `draw`, `tween`, `camera` | The motion helpers, also on the scene context. |
| `stillSpans(model)`, `outOfBand(model, band)` | What `talkie qa` uses to find frozen pictures and art in the caption band. |
| `TimingError`, `MotionConflictError`, `UnsupportedSvgError`, `FactConflictError` | The errors a scene can raise. |

Read first: `src/scene.ts` (the `SceneContext` interface is the whole authoring API), then
`src/motion.ts`, then `src/model.ts`. Gradient maths is in `src/paint.ts`, and the rule for
dropping a clip that cuts nothing is in `src/clip.ts`. How to use it: [authoring.md](authoring.md).

## `@talkie/player`

The `<talkie-player>` element and the engine under it.

- In: a film, by `src` attribute (folder URL or `.lottie` URL) or `source` property (bytes).
- Out: pixels on a canvas, sound, and events that mirror `HTMLMediaElement`.

| Export | What it does |
| --- | --- |
| `TalkiePlayerElement` | The custom element class: controls, captions, keyboard, touch, resume. |
| `defineTalkiePlayer(tag?)` | Registers the element. Importing `@talkie/player/define` does this for you. |
| `TalkieEngine` | Playback with no UI: `load(input)`, `play()`, `pause()`, `currentTime`, events. |
| `setWasmUrl(url): void` | Where to fetch the dotLottie WASM from. Call before the first film loads. |
| `keyAction`, `formatTime` | The keyboard map and the time formatter, for custom UIs. |

`SmoothClock` is internal: `src/engine/smooth-clock.ts`. Drawing is done by
`@lottiefiles/dotlottie-web` (ThorVG compiled to WASM), the same engine as the LottieFiles
players on iOS and Android.

Three builds come out of `yarn build`:

- `dist/talkie-player.js`: one file with everything in it, for a `<script type="module">` tag.
- `dist/define.js`: registers the element, for bundlers. `@lottiefiles/dotlottie-web` stays external.
- `dist/index.js`: no side effects, safe to import on a server.

Read first: `src/engine/engine.ts` (the frame loop), `src/engine/scene-slots.ts` (the two
canvases), then `src/element.ts` (the UI). How to use it: [embedding.md](embedding.md).

## `@talkie/react`

- In: props (`src`, `source`, `captions`, `accentColor`, `wasmUrl`, event handlers).
- Out: a `<talkie-player>` element. The element is registered in an effect, so server rendering
  emits the tag and never touches `window`.

| Export | What it does |
| --- | --- |
| `TalkiePlayer(props: TalkiePlayerProps)` | The component. `ref` gives the `TalkiePlayerElement`. |

Read first: `src/TalkiePlayer.tsx`. It is 120 lines and is the whole package.

## `@talkie/cli`

The `talkie` command. It joins the other packages together.

- In: a film project folder.
- Out: `dist/film/` and `dist/film.lottie`, reports, a preview server, or a video file.

| Command | Code | What it does |
| --- | --- | --- |
| `talkie voice` | `src/commands/voice.ts` | Voices script lines that have no current take. |
| `talkie build` | `src/build.ts` | Project in, film out, in both forms. |
| `talkie check` | `src/check.ts` | Tests a built film against the format spec. |
| `talkie qa` | `src/qa/run.ts` | Builds, checks, then runs the content gates. |
| `talkie dev` | `src/dev/server.ts` | Builds, serves a preview and rebuilds on save. |
| `talkie export` | `src/export/export.ts` | Renders a film to MP4, MKV or WebM in headless Chromium. |

It exports `defineConfig(config: TalkieConfig)` for `talkie.config.ts`.

Read first: `src/build.ts` (`buildFilm` is the pipeline above, top to bottom), then
`src/project.ts` (how a project folder is read), then `src/config.ts`.

The build caches each scene in `.talkie/build/`. A scene is rebuilt only when its source, script,
voice takes, art, font or config changed. The same project always gives the same bytes.

## Decisions worth knowing

These come from the phase 0 tests in `spike/REPORT.md`.

- **Opus in WebM, then AAC.** WebM Opus played in every browser engine tested. Ogg Opus was
  dropped. This is provisional until checked on an iPhone. Every film also carries AAC, so a
  wrong guess costs bytes and never playback.
- **Our own SVG converter.** `importSvg` covers paths, basic shapes, fills, strokes, groups and
  transforms. Anything else stops the build with the element named. It never draws something
  different from the SVG.
- **A limit to watch for.** The phase 0 report noted that a shape with both a fill and a stroke
  that fades on its own fades the two paints separately, so the stroke can show through the fill
  part way. If you see it, fade the group or give the shape one paint.
