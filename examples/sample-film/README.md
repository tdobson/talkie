# Sample film: How a batten gauge works

A small original film, about 50 seconds long, that uses every `@talkie/author` helper. The job,
the street and the sizes in it are all made up.

## Build it

From the repo root, build the packages once, then the film:

```sh
yarn build
yarn sample
```

`yarn sample` runs `build:fake` here. It voices the six lines with the fake provider (tones in
place of speech, no key and no network), then writes `dist/film/` and `dist/film.lottie`.

Check the result:

```sh
yarn workspace @talkie/example-sample-film check
yarn workspace @talkie/example-sample-film qa
```

## Watch it

`examples/watch.html` is a standalone page. Drop it next to a film folder and the player script:

```sh
mkdir /tmp/watch
cp examples/watch.html /tmp/watch/
cp packages/player/dist/talkie-player.js /tmp/watch/
cp -r examples/sample-film/dist/film /tmp/watch/film
npx serve /tmp/watch
```

Then open `watch.html` at the address the server prints. Any static web server will do. The page
must come over http, not from a `file://` address.

## What is in here

| Path                   | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `talkie.config.ts`     | Title, size, the two chapters and their scenes, the voice                |
| `script/<scene>.json`  | The lines each scene says. A line can carry its own caption text         |
| `scenes/<scene>.ts`    | The picture for each scene, timed to the lines with `c.T('line-id')`     |
| `art/`                 | SVG parts: `batten.svg`, `tile.svg` and `roof/rafter.svg`                |
| `fonts/label.ttf`      | Work Sans, used to draw labels as outlines                               |

Where each helper is used:

- `roof`: `rect`, `art`, `group`, `label`, `add`, `fade`, `rise`, `pop`, `camera`
- `gauge`: `line`, `path`, `circle`, `draw`, `tween`, plus a line with its own caption
- `setting-out`: `node`, a `position` tween, and a fade out

`art/tile.svg` shows the two paint features art can carry: the clay is a `linearGradient`, and a
`clipPath` stops the grooves at the curve of the tile's foot.

Keep the picture above y 560 on this 1280 by 720 stage. The strip below is kept clear for
captions, and `talkie qa` fails a scene that draws into it.
