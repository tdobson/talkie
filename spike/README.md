# Talkie spike (Phase 0, Task S1)

A throwaway prototype for the four checks in section 10 of the design spec. It has its own
`package.json` and uses npm. It is not part of the workspace and nothing here is meant to survive.

The scene is `g01-s01`, "In the roof, not on it", from the GSE film: two roof sections at 22 degrees,
two headings, a label with a drawn leader, 60 rain streaks and two water drops. It runs 27.24 s.

## What is here

| Path | What it is |
|---|---|
| `proto/capture.mjs` | Runs the original scene code once in headless Chromium and writes the built drawing and its animations to `scene/g01-s01.nodes.json`. No frames are rendered. |
| `proto/emit.mjs` | The emitter: a node tree in, Lottie JSON at 60 fps out. |
| `proto/port.mjs` | Runs the emitter and writes the two scene files. |
| `scene/g01-s01.json` | The port. 265 KB raw, 17 KB with brotli. |
| `scene/g01-s01-camera.json` | The same scene with a slow camera ease added (100% to 106%). |
| `scene/g01-s01.nodes.json` | The captured node tree, kept so the Lottie can be rebuilt without the film repo. |
| `make-audio.sh` | Builds the narration and encodes it. |
| `audio/n.webm`, `n.ogg`, `n.m4a` | The scene narration: Opus in WebM, Opus in Ogg (both 32 kbps) and AAC (64 kbps). |
| `audio/n-x20.*` | The same narration 20 times over (544.8 s), for the sync harness. |
| `compare.html` | MP4 on the left, Lottie on the right, one slider for both. |
| `stills.mjs` | Writes the five side by side stills to `out/compare-<t>.png`. |
| `sync.html` | The sync harness. |
| `proto/check-pages.mjs` | Loads both pages headless and fails on any console error. |
| `proto/serve.mjs` | A small static server with byte ranges. |
| `REPORT.md` | The Task S2 results: the four checks with their numbers, and the manual steps. |
| `sync.mjs` | Check 2: drives `sync.html` in Chromium, Firefox and WebKit and writes `out/sync-<browser>.json`. |
| `sizes.mjs` | Check 3: Talkie sizes against the H.264 and H.265 files on asterix, into `out/check3.json`. |
| `pack.mjs`, `compat.html` | Check 4: packs `out/scene.lottie` and opens it with stock dotlottie-web. |
| `proto/probe-clock.mjs` | Diagnostic: how a browser reports `audio.currentTime`, frame by frame. |

## Running it

Everything heavy runs at the lowest priority, because this machine is a shared desktop.

```sh
cd spike
nice -n19 ionice -c2 -n7 npm install

# the chapter MP4 is not in git (31 MB); media/ is ignored
mkdir -p media && cp ~/Videos/md-roofkit-courses/gse/chapters/g01.mp4 media/g01.mp4

node proto/serve.mjs 8787        # then open http://localhost:8787/compare.html or sync.html
nice -n19 ionice -c2 -n7 node stills.mjs
nice -n19 ionice -c2 -n7 node proto/check-pages.mjs
```

`npx serve spike` from the repo root works as well, and is the easy way to reach the pages from a
phone on the LAN.

To rebuild from the film source:

```sh
# the scene file and the gse-kit art code are only on asterix, so sync a copy first
rsync -a --exclude='*.png' asterix:dev/md-roofkit-films/ /tmp/s1src/root/
ssh asterix 'cat ~/dev/md-roofkit-films-media/gse/units/g01-s01/scene.json' > /tmp/s1src/unit.json
nice -n19 ionice -c2 -n7 node proto/capture.mjs --src /tmp/s1src/root --unit /tmp/s1src/unit.json --id g01-s01
node proto/port.mjs
./make-audio.sh                  # REPEATS=24 ./make-audio.sh makes a track longer than 10 minutes
```

## How the port was made

The plan asked for a hand port: read `scene.html` and the helpers it calls, and retype each drawing.
The scene turned out to be about 60 lines that call roughly 3,000 lines of parametric art code
(`tools/lib/art/*.js` and `scenes/gse-kit/**`), so retyping would have meant copying coordinates by
eye and getting some wrong. Instead `capture.mjs` lets the original code build its SVG, then reads
back what it built: 495 elements and 292 animations, each with its start, duration and easing. The
two water drops are moved by per-frame code, so their positions and trails are sampled at 60 fps and
thinned to the keyframes a straight line needs. Text becomes outlines from the project's Work Sans
file through opentype.js.

`emit.mjs` then maps that to Lottie:

- Plain art becomes shape layers of nested groups (`gr`, `sh`, `st`, `fl`, `tr`).
- A group that fades as a whole, or that has a mask, gets its own layer. Lottie applies group
  opacity shape by shape, which lets overlapping parts show through each other mid fade. A layer
  fades as one piece, the way SVG does. Where such groups nest, the outer one is a precomp.
- Every top level layer is parented to one null layer, the camera.
- CSS `cubic-bezier` easings map to Lottie keyframe handles exactly, so the timing is the original's
  to the millisecond and is not resampled.
- The draw-on (the label's leader line) is a trim path.
- The paper's dot grid was an SVG pattern. It is one dot and two repeaters.
- The break line masks on the sections and the roof map mask are Lottie layer masks.

The emitter throws on anything it cannot represent: clip paths, filters, skew, gradient
transforms, an animated property it does not know. It does not approximate quietly.

## What to look at (check 1)

Open `out/compare-3.00.png`, `-9.50`, `-12.60`, `-18.20` and `-23.00`. Each has the MP4 frame on the
left and the Lottie canvas on the right at the same scene time. Those times cover the dimmed left
half, the tiles lifting off, the system arriving, the label with rain, and the water drops.

Things that differ on purpose:

- The MP4 has burned-in captions, the dragon bug in the corner and its own sound mix. In Talkie the
  player draws captions and branding, so the scene leaves them out.
- The original scene has no camera move. Pick "with a slow camera ease added" in `compare.html` to
  see the camera null working. That variant will not line up with the MP4, since the MP4 never moves.

Things that differ and are not on purpose:

- A shape with both a fill and a stroke, faded on its own, fades the two paints separately. In SVG
  the stroke hides the fill's edge during the fade. I could not see it in the stills.
- Antialiasing differs a little between Chromium's SVG renderer and ThorVG.

## Findings for the next tasks

- `DotLottie.setWasmUrl` is static and has to run before the first player is created. The pages do that.
- The installed `playwright-core` (1.65.1) wants Chromium build 1255. The machine has 1243, so
  `proto/chromium.mjs` points at the installed headless shell and nothing is downloaded.
- That headless shell has no H.264 decoder, so the MP4 pane of `compare.html` only works in a real
  browser. `stills.mjs` reads MP4 frames with ffmpeg for that reason.
- The scene starts 23.88 s into `g01.mp4` (ident 3.48 s, card 3.00 s, `g01-s00` 17.40 s). The stills
  line up at that offset.
- opentype.js 2.0.0 handles the Work Sans variable font (`font.variation.set({ wght })`). It was
  added to the spike's dependencies; the plan's list did not have it.
- `SVGTextElement.getStartPositionOfChar` ignores `dominant-baseline`. The capture corrects for it
  from the text's bounding box. The real `label()` should set the baseline itself.
- Two repeaters stacked (rows of a row) render correctly in dotlottie-web 0.83.2.
- The 20x narration is 544.8 s, which is short of the 10 minutes that check 2 asks for. Use
  `REPEATS=24 ./make-audio.sh` and `sync.html?repeats=24` for that run.
- On the converter question: this capture step is close to a small SVG to Lottie converter already
  (paths, basic shapes, fills, strokes, a linear gradient, groups, transforms, masks). It took the
  whole scene without a fallback, which is some evidence for writing our own.

## The sync harness

`sync.html` plays the narration track and treats the film as the scene 20 times end to end. On each
animation frame it reads `audio.currentTime` through the smoothing clock from the plan (Task T5,
copied as is), works out the scene and frame, calls `setFrame`, then reads the audio time again and
records the gap. `window.__sync` exposes:

- `samples`: one `{ wall, audio, film, drift, rate, render }` per drawn frame while playing
- `seek(t)`, `rate(r)`, `play()`, `pause()`, `reset()`
- `stats()`: sample count with p50, p95, p99 and max drift in ms
- `info`: the chosen track and the `canPlayType` answer for each audio type

`?audio=webm`, `?audio=ogg` or `?audio=m4a` forces a track. Without it the page takes the first
type the browser says it can play, in that order.

The real measurements are Task S2. `proto/check-pages.mjs` only proves the pages load and the
harness records samples.
