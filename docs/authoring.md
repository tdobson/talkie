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
4. Run `talkie voice`, then `talkie build`.

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

`style` is `{ fill?, stroke?, strokeWidth?, lineCap?, lineJoin? }`. A fill or stroke is a colour or
a gradient, with points in the same stage pixels as the shape:

```ts
const sky = {
  type: 'linear',
  from: [0, 0],
  to: [0, 600],
  stops: [
    { offset: 0, colour: '#2b4c7e', opacity: 1 },
    { offset: 1, colour: '#f6e7c1', opacity: 1 },
  ],
};
c.rect(0, 0, 1920, 600, { fill: sky }, 'sky');
// A radial one: { type: 'radial', centre, radius, focal, stops }. Put focal on the centre for
// an even fade.
```

Most gradients come from art, where the importer works all this out for you (see
[Art rules](#art-rules)).

Nothing shows until you `c.add` it. A node inside a group is added with its group.

### Motion

`at` is a time in seconds, from `c.T()`. Durations are seconds.

| Helper | Does | Defaults |
| --- | --- | --- |
| `c.fade(node, at, { dur?, from?, to?, ease? })` | Changes opacity. With `from: 0` the node is hidden until `at`. | `dur 0.4`, `from 0`, `to 100` |
| `c.rise(node, at, { dur?, dy? })` | Moves up into place from `dy` pixels below while fading in. A negative `dy` drops it in from above. | `dur 0.6`, `dy 40` |
| `c.pop(node, at, { dur? })` | Scales up from nothing with a small overshoot while fading in. | `dur 0.35` |
| `c.draw(node, at, dur?)` | Draws a stroked path on, start to end. Refused on a node filled with a stretched radial gradient (see [Gradients, clips and motion](#gradients-clips-and-motion)). | `dur 1` |
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

Rules the build enforces:

- Every key must be inside the scene, and every `dur` must be above 0, or you get a `TimingError`.
- Two motions must not change the same property of the same node at the same time, or you get a
  `MotionConflictError`. `rise` and `pop` already include a fade.
- One motion may start at the instant another ends, but only if both give the same value there.
  A fade that ends at 100 followed by a tween that starts at 50 is a `MotionConflictError`.
- Every `c.camera` call in a scene must use the same `origin`. The camera is one node, so a second
  origin would move the first push as well. It is a `MotionConflictError` too.
- `c.rect`, `c.line` and `c.circle` take finite numbers. `NaN` or `Infinity` is a `TypeError`.

## Art rules

`c.art('roof/tile', { at: [400, 600] })` loads `art/roof/tile.svg`. Each element of the drawing
becomes a node named after its `id`, so give ids to the parts you care about.

The importer reads:

- `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` and `g`.
- Flat fills and strokes, as `#rgb`, `#rrggbb`, `rgb()` or a basic colour name.
- Linear and radial gradients as fills and as strokes (`fill="url(#id)"`). See
  [Gradients](#gradients).
- Clip paths (`clip-path="url(#id)"`) on a shape, a group or the whole drawing. See
  [Clip paths](#clip-paths).
- `stroke-width`, `stroke-linecap`, `stroke-linejoin`, opacity, inline `style`.
- `transform` on any element, and the `viewBox` origin.
- Lengths as plain numbers or `px`.

It refuses, with an `UnsupportedSvgError` that names the element and says why:

- Filters, masks, patterns and blend modes (`mix-blend-mode`). Blurs and drop shadows from a
  drawing tool are filters.
- Bitmap images.
- Live text. Convert it to paths in your drawing tool, or use `c.label`.
- `<style>` sheets. Export with presentation attributes instead (see the tips below).
- Dashed strokes and the `evenodd` fill rule.
- A `url(#id)` or `href` that points at nothing, into another file, or at an id two elements
  share.
- The gradient and clip path forms listed below.

It refuses rather than guesses, so a film never shows something different from the drawing.
One known gap, on the [snagging list](SNAGGING.md): a shape whose fill and stroke are both
see-through (the same `fill-opacity` and `stroke-opacity` below 1) fades as one picture in the
film, so the fill does not show through the inner half of the stroke as it does in a browser.
Keep the stroke solid, or draw the fill and the stroke as two shapes.

Keep art above y 845 on a 1080 stage. Below that is the caption band, and `talkie qa` fails art
that reaches into it. A background is the exception: a node that covers the whole stage, such as
`c.rect(0, 0, 1920, 1080, ...)`, should fill the frame, and `qa` lets it through.

### Gradients

`linearGradient` and `radialGradient` work as a fill or a stroke. The importer reads:

- Stops, with `offset`, `stop-color` and `stop-opacity`. A see-through stop stays see-through.
- `gradientUnits`, both `objectBoundingBox` (the default) and `userSpaceOnUse`.
- `gradientTransform`.
- `href` and `xlink:href`, so a gradient can take its stops and attributes from another one, as
  Inkscape writes them.
- `spreadMethod="pad"` (the default).
- For a radial gradient: `cx`, `cy`, `r`, `fx` and `fy`.

It does what a browser does with the odd cases. A gradient with one stop, or with stops that are
all the same, is a flat colour. A linear gradient whose two ends meet, or a radial one with `r` of
0, paints its last stop.

Refused, each with the reason:

- `spreadMethod="reflect"` or `"repeat"`. Use `pad`.
- A focal radius (`fr` above 0), or a focal point on or outside the circle. Move it inside.
- `color-interpolation="linearRGB"`.
- A `stop-color` of `currentColor` or `inherit`. Write the colour out.
- An `href` loop, or an `href` that points at something that is not a gradient.
- `objectBoundingBox` on a shape with no width or height, such as a straight line: browsers draw
  nothing there. Use `userSpaceOnUse`.
- A radial gradient on a stroke when the shape stretches its circle into an oval. A radial fill
  can be stretched, a radial stroke cannot.

### Clip paths

`clip-path="url(#id)"` must point at a `clipPath`. The importer reads:

- `path`, `rect`, `circle`, `ellipse`, `polyline` and `polygon` inside the `clipPath`. Several
  shapes make one clip: whatever is inside any of them shows.
- `clipPathUnits`, both `userSpaceOnUse` (the default) and `objectBoundingBox`.
- `transform` on the clipped element, on the `clipPath` and on each shape in it.
- Shapes that are hidden, and lines, add nothing, as in a browser. A clip with no area hides the
  element.

A clip that cuts nothing costs nothing. Figma wraps every export in a rectangle clip the size of
the frame. When the art sits inside it and does not move, the build drops the clip.

Refused, each with the reason:

- A `g`, `use` or `text` inside a `clipPath`. Browsers ignore a group there, so put the shapes
  straight in the `clipPath`.
- `clip-rule="evenodd"`. Use `nonzero`.
- One shape in a clip whose parts overlap, such as a ring drawn as two circles in one path. Its
  hole cannot be drawn as a clip.
- A clip path on a `clipPath` or on a shape inside one.
- `clip-path` written as a CSS shape, such as `circle(50%)` or `inset(10px)`.
- `objectBoundingBox` on an element with no width or height.

### Soft shadows

Draw a soft shadow as one ellipse with a radial gradient that fades to nothing:

```svg
<defs>
  <radialGradient id="soft">
    <stop offset="0" stop-color="#000" stop-opacity="0.45"/>
    <stop offset="1" stop-color="#000" stop-opacity="0"/>
  </radialGradient>
</defs>
<ellipse id="shadow" cx="960" cy="680" rx="230" ry="40" fill="url(#soft)"/>
```

That replaces the old trick of stacking several see-through copies or rings, and it is smaller.
For one shadow under a card, the scene came to 1978 bytes (456 gzipped) with the gradient,
against 6646 (736) with 8 stacked copies and 9650 (992) with 12 rings. The test is
`packages/author/test/shadow-size.test.ts`. The gradient's circle is stretched to fit the oval,
so `c.draw` will not trim it. Bring a shadow in with `fade` or `rise` instead.

### Gradients, clips and motion

- A gradient belongs to its shape. When the shape moves, turns, scales or fades, the gradient
  goes with it.
- A clip belongs to the element it is on. Move that element and the clip moves with it. Move a
  child inside a clipped group and the child slides under the clip, which stays put.
- `c.draw` and a `trimEnd` tween refuse a node filled with a stretched radial gradient: a trim
  would not follow the drawing. A radial gradient is stretched when its circle becomes an oval,
  which is what `objectBoundingBox` does on any shape that is not square.
- There is no colour motion, so stops never change during a scene. To change a colour, fade one
  node out and another in.
- `pop` and the caption band check in `talkie qa` count only the part of a clipped node that
  shows.
- A clipped node inside a fading node, or with layers of its own under it, is drawn as a
  precomp (a small animation inside the scene). Its art must stay within 7680 pixels of the
  node's origin at every frame. Stage art never comes close.

### Exporting from a drawing tool

- Convert text to outlines.
- Save as plain SVG, with each part you want to move given an id (its layer name).
- Leave gradients as gradients. There is no need to expand them to flat colour any more.
- Remove blurs, drop shadows and other effects: they are filters. Draw the shadow as a radial
  gradient instead.
- **Illustrator:** in Export As SVG or Save As SVG, set Styling to Presentation Attributes (the
  default, Internal CSS, writes a `<style>` sheet), Font to Convert to Outlines, and Object IDs to
  Layer Names. Freeform and mesh gradients become bitmaps, so use linear or radial ones.
- **Figma:** in the SVG export settings tick Outline text, and Include "id" attribute so the
  parts keep their layer names. The frame's rectangle clip is dropped when it cuts nothing.
- **Inkscape:** save as Plain SVG. Its gradients point at each other with `xlink:href`, which is
  fine.
- If two elements end up with the same id (copy and paste can do this), rename one. The importer
  will not guess which one a `url(#id)` means.

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
2. Run `talkie voice`. Only the changed lines are voiced. The rest say `cached`.
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

`talkie voice --check` listens to every take with Whisper (it needs `GROQ_API_KEY`) and
flags the lines it heard differently from the script.

## Captions

Captions are built from the scripts. You do not write the VTT file. A long line is split into
chunks at sentence and clause breaks, and numbers are kept with their units. `talkie qa` fails a
chunk over 112 characters: split the line in two.

Do not use em or en dashes in titles, scripts, captions or labels. `talkie qa` fails them.
