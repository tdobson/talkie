# Exporting a video file

A Talkie film needs the player. To send a film somewhere the player cannot go (WhatsApp, email,
a slide deck, a video site), export it to a normal video file.

```sh
talkie export dist/film -o shelf.mp4
```

That writes H.264 video with AAC audio at 1080p and 25 frames a second. It plays everywhere.

## Where to run it

**Not on tragicomix.** Export draws every frame in headless Chromium and encodes it with
`ffmpeg`. On tragicomix the command refuses to run. Use xebit-dev1, xebit-dev3 or asterix:

```sh
rsync -a dist/film asterix:/tmp/shelf/
ssh asterix
cd /path/to/talkie
scripts/low node packages/cli/dist/bin.js export /tmp/shelf/film -o /tmp/shelf/shelf.mp4
```

The render machine needs this repo installed and built (`yarn build`), `ffmpeg`, and a Chromium
that Playwright can start (`scripts/low yarn playwright install chromium` if it has none).

Always start it through `scripts/low`. If you do not, it warns you and lowers its own priority.

`--allow-here` overrides the tragicomix rule. It is for the test suite's 2 second, 320x180
exports. Do not use it for a film.

## Which codec

| You want | Command | Notes |
| --- | --- | --- |
| It must play everywhere: WhatsApp, old phones, PowerPoint | `-o film.mp4` | H.264 and AAC. The default. Use this unless you have a reason not to. |
| A smaller file for Apple devices and modern browsers | `-o film.mp4 --codec h265` | Often about half the size. Tagged `hvc1` so Apple players accept it. Patchy elsewhere: some Windows and Android players will not open it. |
| The smallest file, for the web | `-o film.webm --codec av1` | AV1 and Opus. Plays in current Chrome, Firefox and Edge, and recent Safari on newer hardware. Slowest to encode. |
| AV1 in an MP4 | `-o film.mp4 --codec av1` | AV1 with AAC. |
| An archive copy with the Opus track | `-o film.mkv --audio opus` | MKV takes any pairing. |

The rules the command enforces:

- `.webm` needs `--codec av1` and Opus audio (it picks Opus for you).
- `.mp4` cannot hold Opus here. Use `.mkv` or `.webm` for `--audio opus`.
- The audio is copied from the film, never encoded again. So `--audio aac` needs the film's
  `.m4a` track and `--audio opus` needs its Opus track.

## Size

```sh
talkie export dist/film -o film.mp4 --size 720p
talkie export dist/film -o square.mp4 --size 1080x1080
```

`720p`, `1080p` (default), `4k`, or `<W>x<H>` with even numbers. The film is vector, so any size
is sharp. `720p` is plenty for messaging apps and makes a much smaller file.

## Captions

| Flag | Result |
| --- | --- |
| `--captions none` | No captions. The default. |
| `--captions burn` | Captions drawn into the picture. Use this for WhatsApp and social sites, which ignore subtitle tracks. |
| `--captions track` | A subtitle track the viewer can switch on. Works in VLC and most desktop players. |

## Part of a film

```sh
talkie export dist/film -o clip.mp4 --from 13.2 --to 21.6
```

Times are film seconds. Use the chapter starts in `dist/film/talkie.json` to cut by chapter.

## Frame rate

`--fps 25` is the default and suits narrated drawings. Use `--fps 50` if fast motion looks
steppy. The file grows with it.

## What you should see

Something like this, with your own numbers:

```
Exported 542 frames (310 held) at 1920x1080, h264 and aac
  shelf.mp4
```

"Held" frames are ones where nothing moved, so the picture before was reused. Export reads this from
each scene's Lottie JSON, including the precomps that clipped art makes. A scene that uses
expressions, or a precomp with its own timing, has no held frames: every frame is drawn.
