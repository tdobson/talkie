# Talkie: narrated vector films that play like video

Status: design, approved in brainstorming on 2026-11-21. Working name "Talkie" (easy to change).

## 1. What this is

A way to make and play narrated vector animations as if they were ordinary videos. A film is
vector animation plus a single narration or soundtrack, and the viewer gets the controls they
expect from a video: play, pause, seek, skip, chapters, captions, speed, fullscreen, lock-screen
controls. It is a playback format, not an interactive or game format.

It is a building block like Opus or MP3: a format, a reference player, and reference build
tools. It is not a hosting or sharing service. The docs explain how to host, share and cache
films; the project does not do it for you.

### Goals

- Resolution independent: sharp at any size, from a phone to a 4K screen.
- Much smaller than H.264 or H.265 for the same film. A one-hour narrated film should be
  around 15 to 20 MB rather than hundreds of MB.
- Plays in evergreen desktop and mobile browsers (Chrome, Edge, Firefox, Safari, iOS and
  iPadOS Safari 16+), and in React Native (phase 2).
- Easy for developers: one tag or one component, with an API shaped like `<video>`.
- Feels like YouTube to the viewer.
- Authored in code by people or agents, using art drawn in Inkscape, Figma or similar.
- Rebuilds are deterministic: the same inputs give byte-identical output.

### Non-goals

- Interactivity, branching, state machines, games.
- A GUI timeline editor (code-first authoring only in v1).
- Hosting, a share page service, upload or a download manager. These could be a separate
  project built on top.
- Porting the existing GSE, Viridian and Solfit films (one GSE scene is ported as the proof;
  full ports are later work).

## 2. Prior art and the decision

We looked for an existing agreed format before designing one.

- **Lottie** is the open standard for vector animation as data (JSON). Its spec is governed by
  the Lottie Animation Community under the Linux Foundation (v1.0 September 2024, v1.0.1
  April 2025, media type `video/lottie+json`). There are official players for web, iOS,
  Android and React Native.
- **dotLottie** (`.lottie`) is Lottie's container: a zip with a manifest, several animations,
  images, fonts and (v2) audio. Audio is marked experimental, the authoring library accepts
  MP3 only, and iOS and React Native audio support landed in November 2026. Audio played
  inside the Lottie engine does not get lock-screen controls, background playback or
  pitch-preserving speed changes.
- **Rive** is interactive and state-machine based, with a proprietary editor. Wrong fit.
- **Remotion and Motion Canvas** are authoring tools that render to MP4. Not distribution
  formats.
- **SVG with SMIL** has no audio sync. **MPEG-4 LASeR / SVG Tiny 1.2 audio** were standardised
  and never shipped in browsers.

**Decision (approach B):** use Lottie for the pictures and the dotLottie container for
packaging, and add a small convention on top: one narration track played by the platform's own
media player as the master clock, plus captions and chapters. We do not invent an animation
codec. If the Phase 0 spike shows Lottie cannot draw the films' style acceptably, we fall back
to approach C (our own SVG and keyframe format) with that evidence.

## 3. Architecture

```
packages/
  format/        talkie.json schema, types, validator, readers for both forms
  player/        <talkie-player> web component + React wrapper
  author/        TypeScript scene library that emits Lottie JSON; SVG art import
  cli/           talkie voice | dev | build | qa | check | export
  react-native/  phase 2
examples/        watch.html, minimal React page, (phase 2) React Native screen
docs/            how to author, serve, cache offline, embed, export
spec/            the Talkie format spec (the normative document)
```

pnpm monorepo, TypeScript throughout. Each package can be understood and tested on its own:
`format` has no dependencies on the others; `player` and `author` depend only on `format`;
`cli` uses `author` and `format`, and uses `player` for headless rendering in `export`.

## 4. The format

### 4.1 Two forms, same contents

```
film/                        folder form: served from any static host, streams
  manifest.json              standard dotLottie v2 manifest (lists a/*.json)
  talkie.json                Talkie film description (this spec)
  a/s01.json ... a/sNN.json  one Lottie animation per scene
  u/narration.opus           whole-film narration, Opus, ~32 kbps mono, 48 kHz
  u/narration.m4a            AAC-LC fallback, ~64 kbps mono
  captions/en.vtt            WebVTT captions, one file per language
  poster.svg                 first frame, vector
  poster.png                 first frame, raster (link previews, OS media controls)

film.lottie                  packed form: the same tree as a zip
```

- The folder form is for streaming. The browser plays the audio natively with HTTP range
  requests, the player fetches scene JSON as needed, and the client downloads only the one
  audio format it can play.
- The packed form is for downloads, offline use, app bundles and sending as a file. It is a
  valid dotLottie file, so stock LottieFiles tools open it and ignore Talkie's extras.
- Talkie data lives in its own `talkie.json` at the root, rather than in custom keys inside
  `manifest.json`, so we do not depend on how strictly other tools read the manifest.

### 4.2 `talkie.json`

```json
{
  "talkie": 1,
  "title": "GSE in-roof: battens and the reference line",
  "duration": 214.6,
  "size": [1920, 1080],
  "audio": [
    { "src": "u/narration.opus", "type": "audio/webm; codecs=opus" },
    { "src": "u/narration.m4a",  "type": "audio/mp4; codecs=mp4a.40.2" }
  ],
  "scenes": [
    { "id": "s01", "src": "a/s01.json", "start": 0,    "end": 18.4 },
    { "id": "s02", "src": "a/s02.json", "start": 18.4, "end": 41.0 }
  ],
  "chapters": [ { "title": "Setting out", "start": 0 } ],
  "captions": [ { "lang": "en", "label": "English", "src": "captions/en.vtt" } ],
  "poster": { "svg": "poster.svg", "png": "poster.png" }
}
```

Rules:

- `talkie` is the format major version. Players refuse a higher major version with a clear
  message.
- Times are seconds on the film timeline. Scenes are contiguous and non-overlapping, sorted by
  `start`; the last scene's `end` equals `duration`.
- A scene's Lottie animation plays from its own frame 0 at the scene's `start`. Film time `t`
  in scene `s` maps to frame `(t - s.start) * fr` of that scene's animation.
- `audio` is listed in order of preference. The player picks the first type
  `canPlayType` accepts. Every film must include an AAC track so that every supported
  platform has something it can play.
- All `src` paths are relative to the film root and must stay inside it.
- Unknown keys are ignored, so minor additions do not need a version bump.
- Text in scenes is converted to outlines at build time. Captions are the only text track.

The Opus container (WebM or Ogg) is fixed by Phase 0, based on which plays most reliably in
Safari. The JSON schema lives in `packages/format` and is published with the spec.

## 5. The player (`@talkie/player`)

### 5.1 Sync model

The audio element is the only clock. On each `requestAnimationFrame`, the player reads
`audio.currentTime`, finds the scene that contains it, and sets that scene's Lottie animation to
the matching frame. When the audio pauses, buffers or seeks, the picture holds. Speed changes
(0.5x to 2x) use the audio element's own pitch-preserving `playbackRate`. Nothing drifts,
because there is no second clock.

### 5.2 Rendering

LottieFiles' `dotlottie-web` (Rust and ThorVG compiled to WASM, MIT licensed) draws to a canvas
sized to the element's CSS size times `devicePixelRatio`, and redraws on resize, so it stays
sharp at any size. It is the same engine as the official iOS, Android and React Native players,
so films look the same everywhere. The player keeps the current and next scene loaded and
prefetches ahead during playback.

### 5.3 Viewer experience

- Big play button over the poster until first play (browsers block sound until a tap).
- Controls: play/pause, scrub bar split into chapter segments, current time and duration,
  speed, captions on/off, volume and mute, fullscreen. Controls hide after 3 s of playback.
- Scrub-bar hover preview is a live render of the film at that time.
- Chapter list. Resume from the last position per film (stored locally).
- Keyboard: space or k play/pause, j and l back/forward 10 s, left and right arrows 5 s,
  f fullscreen, c captions, m mute, 0 to 9 jump to that tenth of the film.
- Touch: tap shows controls, double-tap left or right half skips 10 s, fullscreen locks to
  landscape where the platform allows.
- Media Session API: title, chapter, poster artwork, play/pause/seek from the lock screen and
  notification shade. Audio continues with the screen off.
- Captions are drawn by the player on a plate at the bottom, sized from user preferences.

### 5.4 Developer API

```html
<script type="module" src="https://.../talkie-player.js"></script>
<talkie-player src="https://cdn.example.com/films/gse/"></talkie-player>
```

- `src` accepts a folder URL, a `.lottie` URL, or (via the `source` property) a `File`,
  `Blob` or `ArrayBuffer` holding a `.lottie`.
- Properties and methods mirror `HTMLMediaElement` where they make sense: `play()`, `pause()`,
  `currentTime`, `duration`, `paused`, `playbackRate`, `volume`, `muted`, `ended`.
- Events mirror it too: `loadedmetadata`, `play`, `pause`, `timeupdate`, `seeking`, `seeked`,
  `waiting`, `ended`, `error`, plus `chapterchange`.
- Attributes: `controls` (default on), `autoplay` (muted autoplay only, as browsers require),
  `start`, `captions="en"`, `poster` override.
- React: `<TalkiePlayer src=... onEnded=... ref=... />`, a thin wrapper around the element.

### 5.5 Errors

- A scene that fails to load or render: show the poster for that span, keep the audio going,
  emit a warning event. Narration never stops because one drawing failed.
- Network failure: a retry state like other video players, resuming at the same time.
- No playable audio type, or an unsupported `talkie` major version: a clear message in the
  player and an `error` event with a code.
- Invalid `talkie.json`: an `error` event naming the failing rule.

## 6. Authoring (`@talkie/author`)

Scenes are TypeScript modules that describe drawings and motion. Running a scene produces Lottie
JSON; scenes do not ship code to viewers.

```ts
export default scene("s07-batten-gauge", ({ T, art, draw, fade, rise, label }) => {
  const batten = art("timber/batten", { at: [400, 600] });
  rise(batten, T("l2"));
  draw(gaugeLine, T("l3", 0.5), 1.2);
  label("345 mm", { near: gaugeLine, at: T("l3", 1) });
});
```

- `T(lineId, offset)` times beats to voice lines, as in the existing toolchain. Re-voicing a
  line moves everything timed to it.
- Motion vocabulary maps to Lottie keyframes: `fade`, `rise`, `pop`, `draw` (trim path),
  `tween`, `cameraEase` (slow scale on a wrapping group), with named easings.
- `art(name)` loads an SVG from the project's `art/` library and converts it to Lottie shape
  layers. Parts stay to scale and shared across scenes.
- `label()` converts text to outlines with a font bundled in the project and keeps the
  fail-closed number gate: it refuses any figure listed as a source conflict.
- Anything Lottie cannot represent (for example complex SVG filters) fails the build with a
  message naming the element. It never silently renders differently.
- The SVG-to-Lottie converter is chosen in Phase 0 (candidates: python-lottie's importer,
  Glaxnimate's, or a focused converter of our own covering paths, basic shapes, fills, strokes,
  gradients, groups, transforms and clip paths).

## 7. The CLI (`talkie`)

- `talkie voice`: voices every script line through a pluggable TTS provider. Default provider:
  OpenRouter `openai/gpt-audio`, voice "ballad", Received Pronunciation prompt. Cached by text
  hash, lexicon respellings applied, every take checked with Whisper and misreads flagged.
- `talkie dev`: live preview in the real player, reload on save, jump to scene, frame step.
- `talkie build`: builds scenes to Lottie; mixes narration (-16 LUFS by linear gain, true-peak
  limiter run at 4x sample rate); encodes Opus and AAC; writes WebVTT captions from script
  lines (with per-line caption overrides so numerals show while the voice says words); renders
  poster SVG and PNG; writes `talkie.json` and `manifest.json`; emits both the folder and
  `.lottie` forms.
- `talkie check`: validates a film (either form) against the format spec.
- `talkie qa`: `check` plus content gates: stale or missing voice, caption line length, no em
  or en dashes, loudness and true peak, no picture frozen over 8 s (from keyframe activity),
  art clear of the caption band, size report.
- `talkie export`: headless render through the player to a conventional video file.
  - `--codec h264` (default, plays everywhere including WhatsApp), `h265` (tagged `hvc1`
    for Apple playback; patchy elsewhere), `av1`.
  - `--audio aac` (default, MP4) or `opus` (MKV/WebM).
  - `--size 720p|1080p|4k`, `--captions burn|track|none`.
  - Runs on a render box (xebit-dev1, xebit-dev3 or asterix), never tragicomix.

## 8. Delivery is documentation

The project ships no hosting. `docs/` explains:

- Serving a film from any static host: range requests required for audio seeking; MIME types
  (`application/json`, `audio/webm`, `audio/mp4`, `text/vtt`, `application/zip` or
  `application/x-lottie` for `.lottie`); CORS when the film is on another origin; brotli or
  gzip for JSON recommended. Recipes for Cloudflare R2, S3, nginx and `npx serve`.
- When to use the folder form and when to use `.lottie`.
- Offline: cache the `.lottie` (service worker recipe for web, device storage for React Native)
  and pass it to the player as a `Blob`.
- Link previews: Open Graph tags on your own page using `poster.png`, title and duration.
- Sending as a file: use `talkie export`.
- Embedding: web component, React, React Native (phase 2).

`examples/` contains a standalone `watch.html` that can sit next to any film folder, and a
minimal React page.

## 9. React Native (phase 2)

`@talkie/react-native` uses the same sync model: `dotlottie-react-native` draws the picture and
`react-native-track-player` plays the narration as the clock (lock-screen controls and
background audio on iOS and Android). It reads the same `talkie.json`, plays the folder form
from a URL or a `.lottie` from device storage, and has the same props and events as the React
web component. Expo works through a development build. If the native renderer cannot keep up on
low-end Android, the fallback is a WebView running the web player.

## 10. Phase 0: the spike

Before building the packages properly, prove the risky parts. Each check passes or fails.

1. **Style.** Port one real GSE scene (a joint section, labels, a draw-on, water drops and a
   camera ease) to Lottie through a rough authoring prototype. Pass: Tim judges it acceptable
   side by side with the current MP4 frame at the same times.
2. **Sync.** Opus (WebM and Ogg tried) as the clock, `dotlottie-web` following. Pass: picture
   within one frame (40 ms at 25 fps) of the audio after 10 minutes of playback, after 20
   random seeks, and at 0.5x, 1.5x and 2x, on desktop Chrome, Firefox and Safari, and on a real
   iPhone and Android phone.
3. **Size.** Measure the scene and one full chapter. Pass: the Talkie folder form is smaller
   than an H.265 export of the same chapter at 1080p.
4. **Compatibility.** Pass: the packed `.lottie` (with `talkie.json` and Opus/AAC in `u/`)
   opens in stock LottieFiles web tools without error.

If check 1 fails, stop and reconsider approach C. Failures in 2 to 4 are fixed within the design.

## 11. Testing

- **format:** JSON schema tests with valid and invalid fixtures; reader tests for both forms.
- **author:** unit tests that each helper produces the right keyframes; golden-file tests (scene
  in, Lottie JSON out, byte-identical); SVG import tests against a fixture set.
- **player:** unit tests for time to scene to frame mapping, including scene boundaries, the
  last frame and seeks past the end. Playwright on Chromium, Firefox and WebKit for play,
  pause, seek, speed, captions, keyboard, a missing scene and a network drop. Screenshot tests
  of frames at fixed times.
- **cli:** end-to-end build of a tiny sample film (two scenes, three lines) with a fake TTS
  provider so tests cost nothing; then `qa` and `export --codec h264`, decoded with ffmpeg.
- **Release checklist:** manual check on a real iPhone and Android phone for lock-screen
  controls, background audio and autoplay behaviour, which CI cannot fully cover.

## 12. Open items decided later

- Final project name and npm scope.
- Opus container (WebM or Ogg), from Phase 0 check 2.
- SVG-to-Lottie converter, from Phase 0 check 1.
