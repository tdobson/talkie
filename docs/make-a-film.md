# Make a film

This walkthrough starts with an empty folder and ends with a playing film. The film has two
scenes, one imported SVG drawing, one label, a camera move, narration and captions. It uses the
fake voice, so it needs no network and no API key. It takes about ten minutes.

Every step shows the exact file or command, then what you should see.

## Before you start

You need Node 22 or newer, `ffmpeg` on your `PATH`, and this repo installed and built:

```sh
cd /path/to/talkie
scripts/low yarn install --immutable
yarn build
```

Then, in the shell you will work in, point at the repo and make a short name for the CLI:

```sh
export TALKIE=/path/to/talkie
alias talkie="$TALKIE/scripts/low node $TALKIE/packages/cli/dist/bin.js"
```

`scripts/low` runs the command at the lowest CPU and disk priority. Keep it in the alias.

## 1. Make the project folder

```sh
mkdir shelf-film
cd shelf-film
mkdir -p scenes script art fonts node_modules/@talkie
ln -s "$TALKIE/packages/author" node_modules/@talkie/author
ln -s "$TALKIE/packages/cli" node_modules/@talkie/cli
cp "$TALKIE/packages/cli/test/fixtures/mini-film/fonts/label.ttf" fonts/label.ttf
```

The two links let your scene files import `@talkie/author` and `@talkie/cli`. The packages are
not on npm, so a film folder outside the repo needs them. `fonts/label.ttf` is the font that
labels are drawn with (here Work Sans). Any TTF or OTF works.

You should see: `ls` prints `art fonts node_modules scenes script`.

## 2. Write the config

`talkie.config.ts`:

```ts
import { defineConfig } from '@talkie/cli';

export default defineConfig({
  title: 'Putting up a shelf',
  chapters: [
    { title: 'The bracket', scenes: ['s01-bracket'] },
    { title: 'The shelf', scenes: ['s02-shelf'] },
  ],
  voice: { provider: 'fake' },
});
```

`chapters` sets the scene order. Each scene id names three files: `scenes/<id>.ts`,
`script/<id>.json` and, in the built film, `a/<id>.json`. The stage is 1920 by 1080 unless you
set `size`.

## 3. Write the narration

Each scene has a script. `text` is what the voice says. `caption` is what the viewer reads, when
that differs (here the voice says the words and the caption shows the numerals).

`script/s01-bracket.json`:

```json
{
  "lines": [
    { "id": "s01-a", "text": "Start with a level line on the wall." },
    {
      "id": "s01-b",
      "text": "Fix the bracket two hundred millimetres in from the end.",
      "caption": "Fix the bracket 200 mm in from the end."
    }
  ]
}
```

`script/s02-shelf.json`:

```json
{
  "lines": [{ "id": "s02-a", "text": "Then rest the shelf on top and screw it down." }]
}
```

Line ids must be unique across the whole film.

## 4. Add one SVG drawing

`art/bracket.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <path id="arm" d="M10 10 H110 V26 H26 V110 H10 Z" fill="#c9772b"/>
  <circle id="screw" cx="18" cy="60" r="5" fill="#1d3b47"/>
</svg>
```

A scene loads it by name: `art('bracket')` reads `art/bracket.svg`. Art must be plain filled and
stroked shapes. See "Art rules" in [authoring.md](authoring.md).

## 5. Write the first scene

`scenes/s01-bracket.ts`:

```ts
import { scene } from '@talkie/author';

export default scene('s01-bracket', (c) => {
  const ink = { stroke: '#1d3b47', strokeWidth: 6, lineCap: 'round' } as const;
  const level = c.line([360, 620], [1560, 620], ink, 'level line');
  const bracket = c.art('bracket', { at: [560, 380], scale: 2 });
  const size = c.label('200 mm', { at: [460, 360], size: 48, anchor: 'middle' });
  c.add(level, bracket, size);

  c.draw(level, c.T('s01-a'), 1.2);
  c.rise(bracket, c.T('s01-b'));
  c.fade(size, c.T('s01-b', 1));
  c.camera(c.T('s01-b', 1.5), { dur: 4, scaleTo: 106 });
});
```

What it does:

- `c.line`, `c.art` and `c.label` make nodes. `c.add` puts them on the stage, back to front.
- `c.T('s01-b', 1)` is the time line `s01-b` starts, plus one second. Motion is timed to the
  narration, so a longer or shorter voice take moves the picture with it.
- `draw` draws the line on, `rise` lifts the bracket in, `fade` brings the label up.
- `camera` is the camera move: a slow push in to 106 percent over four seconds.

The scene id must match the file name.

## 6. Write the second scene

`scenes/s02-shelf.ts`:

```ts
import { scene } from '@talkie/author';

export default scene('s02-shelf', (c) => {
  const bracket = c.art('bracket', { at: [560, 380], scale: 2 });
  const shelf = c.rect(360, 340, 1200, 40, { fill: '#e8d3a9' }, 'shelf');
  c.add(bracket, shelf);

  c.rise(shelf, c.T('s02-a'), { dy: -60 });
  c.pop(bracket, c.T('s02-a', 2));
});
```

## 7. Voice the lines

```sh
talkie voice "$PWD"
```

You should see:

```
line   scene        state  seconds
s01-a  s01-bracket  new    3.67
s01-b  s01-bracket  new    4.48
s02-a  s02-shelf    new    4.48
3 new, 0 cached
```

The fake voice is a quiet tone as long as a real voice would take. The takes are cached in
`.talkie/voice/`. Run it again and every line says `cached`.

`talkie voice` needs the full path of the project folder, which is why the command passes
`"$PWD"`. The other commands work on the current folder. For a real voice, see "Change the
narration" in [authoring.md](authoring.md).

## 8. Build the film

```sh
talkie build
```

You should see (the paths are your own):

```
Built Putting up a shelf: 2 scenes (2 rebuilt), 21.681 s
  /path/to/shelf-film/dist/film
  /path/to/shelf-film/dist/film.lottie
```

`dist/film/` is the folder form. `dist/film.lottie` is the packed form: the same files in one
zip. `talkie build` always writes both, so packing the `.lottie` is not a separate step.

```sh
find dist -type f | sort
```

You should see these ten files (the order can differ with your locale):

```
dist/film/a/s01-bracket.json
dist/film/a/s02-shelf.json
dist/film/captions/en.vtt
dist/film.lottie
dist/film/manifest.json
dist/film/poster.png
dist/film/poster.svg
dist/film/talkie.json
dist/film/u/narration.m4a
dist/film/u/narration.webm
```

The captions come from the scripts. `cat dist/film/captions/en.vtt` shows the second cue as
`Fix the bracket 200 mm in from the end.`

## 9. Check it

```sh
talkie check dist/film
talkie check dist/film.lottie
```

You should see:

```
dist/film: OK
dist/film.lottie: OK
```

`check` reads a built film in either form and tests it against the format spec.

## 10. Run the quality gates

```sh
talkie qa
```

You should see every gate pass (the size figures can differ a little with your `ffmpeg`):

```
PASS  check
PASS  voice
PASS  captions
PASS  dashes
PASS  loudness
      u/narration.webm: -16 LUFS
      u/narration.m4a: -16 LUFS
PASS  true peak
      u/narration.webm: -11.4 dBTP
      u/narration.m4a: -11.7 dBTP
PASS  still
PASS  caption band
INFO  size
      animation: 2.2 kB after brotli (2 scenes)
      u/narration.webm: 73.9 kB, total 0.08 MB, 0.21 MB per minute
      u/narration.m4a: 111.3 kB, total 0.11 MB, 0.31 MB per minute
qa: all gates passed
```

`qa` rebuilds the film, runs `check`, then tests the content: every line voiced, captions short
enough, no em or en dashes, loudness, nothing frozen for more than 8 seconds, and no art in the
caption band (below y 845 on a 1080 stage).

## 11. Watch it

`examples/watch.html` is a page with a player that plays the `film/` folder next to it. Put the
page and the player script beside the film and serve the folder:

```sh
cp "$TALKIE/examples/watch.html" dist/
cp "$TALKIE/packages/player/dist/talkie-player.js" dist/
cd dist
python3 -m http.server 8000
```

Open `http://localhost:8000/watch.html` and press play. You should see the level line draw on,
the bracket rise with its `200 mm` label, a slow push in, then the shelf drop on to the bracket,
with captions along the bottom. Press Ctrl+C to stop the server, then `cd ..`.

Two things to know:

- `python3 -m http.server` does not answer range requests, so seeking can fail in some
  browsers. It is fine for a first look. See [serving.md](serving.md) for real hosting.
- The page needs a web server. Opened as a `file://` URL it cannot fetch the film.

While you are still editing, use the live preview instead. It rebuilds and reloads on every
save, and has scene buttons and frame stepping:

```sh
talkie dev
```

You should see `Preview at http://localhost:4321/`. Press Ctrl+C to stop it.

## 12. Use the `.lottie`

`dist/film.lottie` is one file with the whole film in it. The player takes it the same way as a
folder: `<talkie-player src="./film.lottie">`. Use the folder to stream from a web server and the
`.lottie` for downloads and offline use. See [serving.md](serving.md) and
[offline.md](offline.md).

## Common errors

The CLI prints the message on its own, without the name of the error class. The class is given
here so you can find it in the code. These are the ones you will meet.

| You see | It means | Fix |
| --- | --- | --- |
| `1 line has no current voice: s01-a. Run talkie voice first.` | The script or the voice settings changed since that line was voiced, or it never was. | Run `talkie voice "$PWD"`, then build again. |
| `scene s01-bracket: no voice line with id "s01-x"` (`TimingError`) | `T()` names a line that is not in `script/<scene>.json`. | Fix the id in the scene or add the line to the script. |
| `opacity on "label 200 mm" (n5) has a key at 15.267 s, outside the scene (0 to 13.248 s)` (`TimingError`) | A motion starts or ends after the scene does. | Use a smaller offset or `dur`, or set `"minDuration"` in the script to make the scene longer. |
| `opacity on "bracket" (n4) is animated twice at once: 6.267 to 6.667000000000001 s overlaps 6.267 to 6.867 s` (`MotionConflictError`; the long decimal is as printed) | Two motions change the same property of the same node at the same time. `rise` and `pop` both fade the node in, so a `fade` at the same moment clashes. | Remove one, or move it so the spans do not overlap. |
| `bracket: <linearGradient id="g1"> is a gradient, which cannot be drawn` (`UnsupportedSvgError`) | The SVG uses something the importer will not draw: gradients, filters, masks, clip paths, patterns, bitmaps, live text, dashed strokes. | Redraw that element as plain filled or stroked shapes. Convert text to paths, or use `label()`. |
| `scene s01-bracket: label "200 mm" states 200 mm, and "200 mm" is listed as a figure the sources disagree about. Take the figure out, or settle it and remove it from conflicts.` (`FactConflictError`) | The label shows a figure listed in `conflicts` in `talkie.config.ts`. | Settle the figure and remove it from `conflicts`, or take it off the screen. |
| `scenes/s01-bracket.ts exports scene "s01"; the id must match the file name` | The id in `scene('...')` differs from the file name. | Make them the same. |
| `no drawing called "brakcet" (art/brakcet.svg)` | `art()` names a file that is not there. | Fix the name. `art('roof/tile')` reads `art/roof/tile.svg`. |
| `labels need a font, and fonts/label.ttf does not exist` | A scene calls `label()` and the font is missing. | Add the font, or set `font` in the config. |
| `scene s01-bracket: node "label 200 mm" (n5) is animated but was never added to the scene` | You animated a node and forgot `c.add`. | Add it. |
| `Cannot find module 'talkie.config.ts'` | `talkie voice` was run without the full path of the project. | Run `talkie voice "$PWD"`. |

`talkie check` reports the `validateFilm` messages, each with the field at fault. You only see
these if a film was edited by hand or made by another tool:

| Message | Fix |
| --- | --- |
| `audio: every film must include an audio/mp4 (AAC) track` | Add the `.m4a` track. Every film needs one. |
| `scenes[1].start: scene s02 starts at 18.5 but the previous scene ends at 18.4` | Scenes must follow on with no gap or overlap. |
| `scenes: the last scene ends at 41 but duration is 42` | Make `duration` equal the last scene's `end`. |
| `audio[0].src: audio src must be a relative path inside the film` | Paths must be relative, with no `..`, leading `/`, spaces, `%`, `?` or `#`. |
| `chapters[1]: chapters must be sorted by start` | Put chapters in time order. |
| `talkie: film uses format version 2; this reader supports up to 1` | The film is newer than the tools. Update them. |
| `a/s01.json is missing` | A file named in `talkie.json` is not in the film. Rebuild. |

The full rules are in [the format spec](../spec/talkie-format-1.md).
