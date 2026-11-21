# Authoring

How to write a film project. New here? Do [make-a-film.md](make-a-film.md) first: it builds a
working project step by step. This page is the reference you come back to.

## Project layout

```
my-film/
  talkie.config.ts     the film: title, chapters, voice, size
  scenes/<id>.ts       one file per scene
  script/<id>.json     the narration of that scene
  art/**/*.svg         drawings
  fonts/label.ttf      the label font (TTF or OTF)
  .talkie/             caches: voice takes and built scenes. Safe to delete.
  dist/                the built film. Do not edit.
```

A scene id is letters, digits, `-` and `_`. It names the scene file, the script file and the
animation in the built film.

## The config

`talkie.config.ts`, with every option:

```ts
import { defineConfig } from '@talkie/cli';

export default defineConfig({
  title: 'Putting up a shelf', // required
  size: [1920, 1080], // the stage, in pixels. This is the default.
  chapters: [
    // required. Sets the scene order and the chapter marks.
    { title: 'The bracket', scenes: ['s01-bracket'] },
    { title: 'The shelf', scenes: ['s02-shelf', 's03-load'] },
  ],
  voice: {
    provider: 'openrouter', // or 'fake'. Default 'openrouter'.
    voice: 'ballad', // default
    prompt: 'Read this narration in a calm, clear Received Pronunciation English voice, at an even pace.',
    lexicon: { soffit: 'soff it' }, // word to how the voice should say it
  },
  font: 'fonts/label.ttf', // default
  conflicts: ['345 mm'], // figures the fact gate refuses (see below)
  timing: { lead: 1.4, gap: 0.7, tail: 2.2 }, // seconds. These are the defaults.
  captionsLang: 'en', // default
});
```

## Add a scene

1. Add the id to a chapter in `talkie.config.ts`.
2. Write `script/<id>.json` with its lines.
3. Write `scenes/<id>.ts`. The id in `scene('<id>', ...)` must match the file name.
4. Run `talkie voice "$PWD"`, then `talkie build`.

```ts
import { scene } from '@talkie/author';

export default scene('s03-load', (c) => {
  const shelf = c.rect(360, 340, 1200, 40, { fill: '#e8d3a9' }, 'shelf');
  c.add(shelf);
  c.fade(shelf, c.T('s03-a'));
});
```

Shared helpers can live in other files under `scenes/` and be imported by any scene.

## Timing to lines

A script is a list of lines:

```json
{
  "lines": [
    { "id": "s03-a", "text": "The shelf carries ten kilograms.", "caption": "The shelf carries 10 kg." }
  ],
  "minDuration": 12
}
```

- `id`: unique across the whole film.
- `text`: what the voice says.
- `caption`: what the viewer reads, when it differs. Optional.
- `minDuration`: the least the scene may last, in seconds. Optional.

The build places the lines on the scene's clock. The first line starts after `lead`. Each
caption stays up for at least 3 seconds, long enough to read (words / 3 + 1.5 seconds), and
never less than its voice plus 0.3 seconds. The next line starts `gap` after that. The scene ends
`tail` after the last caption.

In a scene, `c.T('s03-a')` is the time that line starts, in seconds from the start of the scene.
`c.T('s03-a', 0.5)` is half a second later. Time everything from `T()`. Then a re-voiced line
moves its motion with it, and nothing needs retiming by hand. Never write a bare number of
seconds for a start time.

## Every helper

All helpers are on the context your scene's function receives (called `c` here). The full
interface is `SceneContext` in `packages/author/src/scene.ts`.

Coordinates are stage pixels: `[0, 0]` is the top left, `[1920, 1080]` the bottom right. Colours
are `#rgb` or `#rrggbb`.

### Drawing

| Helper | Makes |
| --- | --- |
| `c.path(d, style, name?)` | A path from SVG path data. |
| `c.rect(x, y, w, h, style, name?)` | A rectangle. |
| `c.line(from, to, style, name?)` | A straight line between two points. |
| `c.circle(centre, r, style, name?)` | A circle. |
| `c.group(name, children)` | A group, so its children move as one. |
| `c.art(name, { at, scale? })` | A drawing from `art/`, top left corner at `at`. |
| `c.label(text, { at, size?, color?, anchor? })` | Text as outlines. `at` is on the baseline. `anchor` is `'start'` (default), `'middle'` or `'end'`. Default size 34, colour `#1d3b47`. |
| `c.add(...nodes)` | Puts nodes on the stage. The first is at the back. |

`style` is `{ fill?, stroke?, strokeWidth?, lineCap?, lineJoin? }`.

Nothing shows until you `c.add` it. A node inside a group is added with its group.

### Motion

`at` is a time in seconds, from `c.T()`. Durations are seconds.

| Helper | Does | Defaults |
| --- | --- | --- |
| `c.fade(node, at, { dur?, from?, to?, ease? })` | Changes opacity. With `from: 0` the node is hidden until `at`. | `dur 0.4`, `from 0`, `to 100` |
| `c.rise(node, at, { dur?, dy? })` | Moves up into place from `dy` pixels below while fading in. A negative `dy` drops it in from above. | `dur 0.6`, `dy 40` |
| `c.pop(node, at, { dur? })` | Scales up from nothing with a small overshoot while fading in. | `dur 0.35` |
| `c.draw(node, at, dur?)` | Draws a stroked path on, start to end. | `dur 1` |
| `c.tween(node, prop, keys)` | Any keyframes on `'position'`, `'scale'`, `'rotation'`, `'opacity'` or `'trimEnd'`. | |
| `c.camera(at, { dur?, scaleTo?, origin? })` | Scales the whole stage about `origin`: a slow push in. | `dur 6`, `scaleTo 103.5`, `origin` the centre |

Scale and opacity are percentages. Rotation is degrees, clockwise. Eases are `'linear'`, `'in'`,
`'out'` and `'inOut'`.

```ts
c.tween(arrow, 'rotation', [
  { t: c.T('s03-a'), v: 0 },
  { t: c.T('s03-a', 1.5), v: 90, ease: 'out' },
]);
c.fade(shelf, c.T('s03-b'), { from: 100, to: 0 }); // fade out
```

Two rules the build enforces:

- Every key must be inside the scene, or you get a `TimingError`.
- Two motions must not change the same property of the same node at the same time, or you get a
  `MotionConflictError`. `rise` and `pop` already include a fade.

## Art rules

`c.art('roof/tile', { at: [400, 600] })` loads `art/roof/tile.svg`. Each element of the drawing
becomes a node named after its `id`, so give ids to the parts you care about.

The importer reads:

- `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` and `g`.
- Solid fills and strokes, as `#rgb`, `#rrggbb`, `rgb()` or a basic colour name.
- `stroke-width`, `stroke-linecap`, `stroke-linejoin`, opacity, inline `style`.
- `transform` on any element, and the `viewBox` origin.
- Lengths as plain numbers or `px`.

It refuses, with an `UnsupportedSvgError` that names the element:

- Gradients, patterns, filters, masks and clip paths.
- Bitmap images.
- Live text. Convert it to paths in your drawing tool, or use `c.label`.
- Dashed strokes and the `evenodd` fill rule.

It refuses rather than guesses, so a film never shows something different from the drawing. When
you export from a drawing tool: convert text to outlines, expand gradients to flat colour, and
save as plain SVG.

Keep art above y 845 on a 1080 stage. Below that is the caption band, and `talkie qa` fails art
that reaches into it.

## The fact gate

Sometimes two sources disagree about a figure. List the figure in `conflicts` and the build
refuses to put it on screen until someone settles it:

```ts
conflicts: ['345 mm'],
```

Now `c.label('345 mm', ...)` stops the build with a `FactConflictError`. So do `345mm` and
`345 millimetres`: the gate reads the number and the unit, not the spelling. A bare `345` is
refused too. When the figure is settled, remove it from `conflicts`.

The gate covers labels. It does not read the narration.

## Change the narration

1. Edit `text` in `script/<id>.json`.
2. Run `talkie voice "$PWD"`. Only the changed lines are voiced. The rest say `cached`.
3. Run `talkie build`. Motion timed with `T()` moves to fit the new takes.

A take is current while its provider, voice, prompt and spoken text are unchanged. Change any of
them and the line needs voicing again.

For a real voice, set `voice.provider` to `'openrouter'` (or leave it out) and set the
`OPENROUTER_API_KEY` environment variable. While drafting, use `provider: 'fake'`: a quiet tone
of the right length, with no network.

`talkie build` reads the takes of the provider named in the config. `--provider` on
`talkie voice` voices with another provider, but the build will not use those takes until the
config names it too.

If the voice says a word wrongly, add it to `voice.lexicon`. The voice gets the respelling and
the caption keeps the real word:

```ts
voice: { lexicon: { soffit: 'soff it', PV: 'P V' } },
```

`talkie voice "$PWD" --check` listens to every take with Whisper (it needs `GROQ_API_KEY`) and
flags the lines it heard differently from the script.

## Captions

Captions are built from the scripts. You do not write the VTT file. A long line is split into
chunks at sentence and clause breaks, and numbers are kept with their units. `talkie qa` fails a
chunk over 112 characters: split the line in two.

Do not use em or en dashes in titles, scripts, captions or labels. `talkie qa` fails them.
