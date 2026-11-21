# Talkie

Talkie is a film format: vector drawings that move, plus narration. It plays in a web page like
a video, with a scrub bar, chapters, captions and speed control, but it is sharp at any size and
a fraction of the weight of an MP4. The audio is the clock, so picture and sound cannot drift.

**Start with [AGENTS.md](AGENTS.md).** It maps the repo and links every guide.

## Quick start

```sh
scripts/low yarn install --immutable                           # Node 22+, yarn 4, ffmpeg
yarn build                                                     # build the packages
yarn sample                                                    # build the sample film (fake voice)
scripts/low yarn talkie check examples/sample-film/dist/film   # prints "...: OK"
scripts/low yarn talkie dev examples/sample-film               # preview at localhost:4321
```

Put a film on any page:

```html
<script type="module" src="./talkie-player.js"></script>
<talkie-player src="./film/"></talkie-player>
```

To make your own film from an empty folder, follow [docs/make-a-film.md](docs/make-a-film.md).
The format is defined in [spec/talkie-format-1.md](spec/talkie-format-1.md).
