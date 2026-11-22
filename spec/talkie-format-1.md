# The Talkie film format, version 1

Status: normative. This is the definition of format major version 1.

The words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. A "writer" makes
films. A "reader" opens them: a player, a checker or any other tool.

The reference implementation is `@talkie/format` in [`packages/format`](../packages/format). Its
`validateFilm` function enforces every rule in section 4 that carries a rule name. A JSON Schema
for the shape of `talkie.json` is at
[`packages/format/talkie.schema.json`](../packages/format/talkie.schema.json). The schema checks
shape only. The rules that compare one field with another are in this document and in
`validateFilm`.

## 1. What a film is

A film is a set of files: one Lottie animation per scene, one narration track in two encodings,
captions, a poster, and `talkie.json`, which describes how they fit together. The narration is
the clock. A reader shows, at each moment, the frame of the scene that matches the audio time.

## 2. Two forms

A film exists in two forms with the same contents.

- **Folder form.** The files sit in a folder on a web server or a disk. It is addressed by the
  URL of the folder. This form is for streaming: the reader fetches `talkie.json`, then each
  scene as it needs it, and the browser plays one audio file with range requests.
- **Packed form.** The same tree in one zip file with the extension `.lottie`. This form is for
  downloads, offline use and app bundles. It is a dotLottie file, so dotLottie tools open it and
  ignore the files they do not know.

Rules:

1. Both forms MUST contain the same files at the same relative paths.
2. A reader given a URL whose path ends in `.lottie` MUST treat it as the packed form. A reader
   given any other URL MUST treat it as the folder form and MUST resolve file paths against that
   URL with a trailing `/` added if it has none.
3. A reader given bytes (a `Blob`, `ArrayBuffer` or byte array) MUST treat them as the packed
   form.
4. In the packed form, entry names are the relative paths, with `/` as the separator and no
   leading `/`. `talkie.json` and `manifest.json` MUST be at the root of the zip.
5. A writer SHOULD store audio and PNG entries without compression and deflate the rest. The
   reference packer stores `.webm`, `.ogg`, `.opus`, `.m4a` and `.png`.
6. A writer SHOULD produce the same bytes for the same input. The reference packer sorts the
   entries by path and gives every entry the time 1980-01-01 00:00:00.

## 3. File layout

```
film/
  talkie.json            the film description (section 4). MUST be present.
  manifest.json          dotLottie manifest (section 5). MUST be present.
  a/<scene id>.json      one Lottie animation per scene
  u/narration.webm       narration, Opus in WebM
  u/narration.m4a        narration, AAC-LC in MP4
  captions/<lang>.vtt    WebVTT captions, one file per language
  poster.svg             the first frame as SVG (optional)
  poster.png             the first frame as PNG
```

Only `talkie.json` and `manifest.json` have fixed names. A reader MUST find every other file
through the paths in `talkie.json`, and MUST NOT assume the names shown above. A writer SHOULD
use this layout.

Every file that `talkie.json` names MUST exist in the film.

Animations live under `a/` because that is where dotLottie version 2 keeps them. A writer that
wants the packed form to open in dotLottie tools MUST store each scene as `a/<scene id>.json`.

## 4. `talkie.json`

`talkie.json` is a UTF-8 JSON document whose top level is an object. If it is not an object, the
film is invalid (rule `type`).

```json
{
  "talkie": 1,
  "title": "Putting up a shelf",
  "duration": 21.681,
  "size": [1920, 1080],
  "audio": [
    { "src": "u/narration.webm", "type": "audio/webm" },
    { "src": "u/narration.m4a", "type": "audio/mp4" }
  ],
  "scenes": [
    { "id": "s01-bracket", "src": "a/s01-bracket.json", "start": 0, "end": 13.248 },
    { "id": "s02-shelf", "src": "a/s02-shelf.json", "start": 13.248, "end": 21.681 }
  ],
  "chapters": [
    { "title": "The bracket", "start": 0 },
    { "title": "The shelf", "start": 13.248 }
  ],
  "captions": [{ "lang": "en", "label": "English", "src": "captions/en.vtt" }],
  "poster": { "svg": "poster.svg", "png": "poster.png" }
}
```

All nine top-level fields are required. All times are seconds on the film timeline, which starts
at 0. "Number" below means a finite JSON number.

Where two times must be equal, a reader MUST accept a difference of up to 0.001 seconds.

### 4.1 Fields

Each rule is followed by the rule name that `validateFilm` reports when it is broken.

| Field | Rule | Rule name |
| --- | --- | --- |
| `talkie` | MUST be an integer of 1 or more. It is the format major version. | `required` |
| `talkie` | A reader MUST refuse a value higher than the version it supports. | `version` |
| `title` | MUST be a non-empty string. | `required` |
| `duration` | MUST be a number above 0: the length of the film in seconds. | `required` |
| `size` | MUST be an array of exactly two integers above 0: width and height in pixels. | `required` |
| `audio` | MUST be an array with at least one track. | `required` |
| `audio[].src` | MUST be a safe relative path (section 4.2). | `path` |
| `audio[].type` | MUST be a string that starts with `audio/`. | `required` |
| `audio` | At least one track MUST have a `type` that starts with `audio/mp4`. | `aac-required` |
| `scenes` | MUST be an array with at least one scene. | `required` |
| `scenes[].id` | MUST be a non-empty string. | `required` |
| `scenes[].id` | MUST NOT repeat within the film. | `unique-id` |
| `scenes[].src` | MUST be a safe relative path. | `path` |
| `scenes[].start`, `scenes[].end` | MUST be numbers with `start` below `end`. | `range` |
| `scenes[].start` | The first scene MUST start at 0. Every other scene MUST start where the scene before it ends. | `contiguous` |
| `scenes` | The last scene's `end` MUST equal `duration`. | `duration-match` |
| `chapters` | MUST be an array. It MAY be empty. | `required` |
| `chapters[]` | `title` MUST be a string. `start` MUST be a number, 0 or more and below `duration`. | `required` |
| `chapters[]` | Each chapter's `start` MUST be above the `start` of the one before it. | `chapter-order` |
| `captions` | MUST be an array. It MAY be empty. | `required` |
| `captions[]` | `lang` and `label` MUST be strings. | `required` |
| `captions[].src` | MUST be a safe relative path. | `path` |
| `poster` | MUST be an object. `poster.png` MUST be a safe relative path. | `required` |
| `poster.svg` | Optional. If present it MUST be a safe relative path. | `path` |

Notes on meaning:

- `size` is the stage the scenes were drawn on. It sets the aspect ratio. It is not a pixel size
  for playback: the picture is vector and a reader draws it at whatever size it is shown.
- `scenes` is in playing order. Because scenes are contiguous, sorting by `start` gives the same
  order.
- `chapters[].start` is where the chapter begins. A chapter runs until the next one starts.
- `captions[].lang` SHOULD be a BCP 47 language tag such as `en` or `en-GB`. `label` is the
  name a viewer sees in a menu.
- `poster.png` is required because link previews and operating system media controls need a
  bitmap.

### 4.2 Paths

Every `src`, and both poster paths, are relative to the film root: the folder in the folder
form, the top of the zip in the packed form. A path is safe only if all of these hold:

1. It is a non-empty string.
2. It does not start with `/`.
3. It contains no backslash.
4. It does not start with a URL scheme (letters, digits, `+`, `.` or `-`, then `:`).
5. Split on `/`, no segment is empty, `.` or `..`.
6. It contains no control character (U+0000 to U+001F, U+007F), no space, and none of `%`, `?`
   and `#`.

These rules keep every path inside the film, both as a file path and once a browser has resolved
it as a URL. A reader MUST reject a film with an unsafe path and MUST NOT fetch it.

### 4.3 Scenes and time

1. Each scene's `src` MUST be a Lottie animation: a JSON object with numeric `fr` (frames per
   second, above 0), `ip` (first frame) and `op` (the frame after the last), with `op` above
   `ip`.
2. The animation's length, `(op - ip) / fr` seconds, MUST equal the scene's length,
   `end - start`, to within one frame.
3. A scene's animation plays from its own first frame at the scene's `start`. At film time `t`
   inside scene `s`, a reader MUST show frame `ip + (t - s.start) * fr`, limited to the range
   `ip` to `op - 1`. The frame number MAY be fractional.
4. A time that falls exactly on a boundary between two scenes belongs to the later scene.
5. Scenes MUST NOT contain live text. Text is converted to outlines when the film is built, so
   a reader needs no fonts. Captions are the only text track.
6. Besides flat fills and strokes, a scene MAY use gradient fills and strokes (`gf` and `gs`,
   linear and radial, a radial one with a focal point), layer masks in add mode (how clip paths
   are drawn), and precomp layers whose asset is in the same animation. A reader MUST draw all of
   them. Talkie's own writer uses shape layers, null layers, trim paths and the features above,
   and writes no expressions, images or text layers.

### 4.4 Audio

1. Every track holds the whole narration, from film time 0 to `duration`. All tracks MUST have
   the same content and the same length.
2. `audio` is in order of preference. A reader MUST play the first track whose `type` the
   platform says it can play (in a browser, a `canPlayType` answer of `probably` or `maybe`).
3. If no track can be played, the reader MUST report an error (code `no-playable-audio`) and
   MUST NOT play the picture alone.
4. Every film MUST include an AAC track in MP4 (`audio/mp4`), so that every supported platform
   has one track it can play. This is rule `aac-required`.
5. A writer SHOULD also include an Opus track, listed first. It is about half the size. In this
   version the Opus track is in WebM (`audio/webm`): the phase 0 tests found WebM Opus played in
   every browser engine tested. That choice is provisional until it has been confirmed on an
   iPhone. A reader on a platform that cannot play it falls back to AAC under rule 2, so films
   stay playable either way.
6. A writer SHOULD master the narration to about -16 LUFS with a true peak no higher than
   -1 dBTP, mono, 48 kHz.

The audio is the only clock. A reader MUST derive the picture from the audio position, and
MUST hold the picture when the audio pauses, buffers or seeks.

### 4.5 Captions and poster

1. Each captions file MUST be WebVTT, with cue times on the film timeline.
2. A film MAY have no captions. It SHOULD have one file per language it offers.
3. `poster.png`, and `poster.svg` when present, SHOULD show the first frame of the film.

## 5. `manifest.json`

`manifest.json` is a dotLottie version 2 manifest. It exists so that the packed form is a valid
dotLottie file. Talkie's own data is in `talkie.json` and never in the manifest, so a film does
not depend on how strictly other tools read manifest keys.

```json
{
  "version": "2",
  "generator": "talkie",
  "animations": [{ "id": "s01-bracket" }, { "id": "s02-shelf" }]
}
```

1. `version` MUST be the string `"2"`.
2. `animations` MUST list one entry per scene, in scene order, each with the scene's `id`. The
   ids MUST equal the `id` values in `talkie.json`, in the same order.
3. The manifest lists ids, not paths. By the dotLottie convention, the animation with id `X` is
   the file `a/X.json`.
4. `generator` SHOULD name the tool that wrote the film.
5. A Talkie reader MUST NOT need the manifest to play a film. It reads `talkie.json`. A checker
   SHOULD report a film whose manifest is missing or does not match its scenes.

The reference writer emits exactly these three keys. The manifest of this shape was loaded by
`dotlottie-web` 0.83.2 in the phase 0 tests. It has not been tested against the full published
dotLottie 2 schema.

## 6. MIME types

A server SHOULD send these types. A browser will refuse audio and captions sent with the wrong
type.

| File | `Content-Type` |
| --- | --- |
| `talkie.json`, `manifest.json`, `a/*.json` | `application/json` |
| `*.webm` | `audio/webm` |
| `*.m4a` | `audio/mp4` |
| `*.ogg`, `*.opus` | `audio/ogg` |
| `*.vtt` | `text/vtt` |
| `*.svg` | `image/svg+xml` |
| `*.png` | `image/png` |
| `*.lottie` | `application/zip` |

1. A `.lottie` file SHOULD be served as `application/zip`. A reader MUST NOT depend on the type
   of a `.lottie` response: it decides the form from the URL (section 2).
2. A server SHOULD answer HTTP range requests for the audio files. Seeking needs them.
3. Inside a packed film there are no headers. A reader gives each file the type in this table,
   chosen by its extension, and `application/octet-stream` for any other extension.
4. The `type` of an audio track in `talkie.json` MAY carry a codecs parameter, for example
   `audio/mp4; codecs=mp4a.40.2`.

## 7. Versioning and unknown keys

1. `talkie` is the major version. This document defines version 1.
2. A reader MUST refuse a film whose `talkie` is higher than the version it supports, with a
   message that says so (rule `version`, error code `unsupported-version`). It MUST NOT try to
   play it.
3. A reader MUST ignore keys it does not know, at every level of `talkie.json`. It MUST NOT
   treat them as errors.
4. A change that old readers can safely ignore (a new optional key) does not change the major
   version. A change that would make an old reader play a film wrongly MUST raise it.
5. A writer MAY add its own keys.
6. There is no minor version field.

## 8. Errors

A reader that finds a film invalid SHOULD say which rule failed and where. The reference
implementation reports each problem as `{ path, rule, message }`, for example:

```json
{
  "path": "audio",
  "rule": "aac-required",
  "message": "every film must include an audio/mp4 (AAC) track"
}
```

It raises a `TalkieError` with one of these codes:

| Code | When |
| --- | --- |
| `invalid-film` | `talkie.json` is not valid JSON, breaks a rule in section 4, or a file is missing from a `.lottie`. |
| `unsupported-version` | `talkie` is higher than the reader supports. |
| `no-playable-audio` | The platform can play none of the audio tracks. |
| `network` | A file could not be fetched. |
| `scene-failed` | One scene could not be loaded or drawn. |

A player SHOULD keep the narration going when a single scene fails, and show the poster for
that scene.

## 9. Checking a film

```sh
talkie check path/to/film
talkie check path/to/film.lottie
```

`talkie check` applies sections 3 to 5: every rule in the table, that every named file exists,
that each scene's animation length matches its scene (4.3 rule 2), and that the manifest matches
the scenes. See [docs/cli.md](../docs/cli.md#talkie-check).
