# Putting a film on a page

Three ways: a script tag, React, or Next.js with Mantine. All three use the same
`<talkie-player>` element.

You need a built film on a web server first. See [serving.md](serving.md).

## Script tag

Copy `packages/player/dist/talkie-player.js` to your site (run `yarn build` to make it). It is
one file with everything in it.

```html
<script type="module" src="/talkie-player.js"></script>
<talkie-player src="/films/shelf/"></talkie-player>
```

`src` is a film folder URL or a `.lottie` URL. The element is as wide as its container and
takes its height from the film's aspect ratio. Size it with CSS:

```css
talkie-player {
  max-width: 960px;
}
```

`examples/watch.html` is this, ready to copy next to a `film/` folder.

The page must come from a web server. Opened as a `file://` URL, the browser blocks the fetches.

### Attributes

| Attribute | Meaning |
| --- | --- |
| `src` | A film folder URL or a `.lottie` URL. |
| `controls` | Controls are on by default. `controls="false"` hides them. |
| `autoplay` | Start playing at once, muted (browsers block sound until a tap). A "Tap to unmute" button shows. |
| `start` | Time to start at, in seconds. |
| `captions` | A language to show, for example `captions="en"`. `off` or no attribute hides them. |
| `poster` | An image URL to show before play, instead of the film's own poster. |
| `wasm-url` | Where to fetch the drawing engine's WASM from. See below. |

### Properties, methods and events

They mirror `<video>`, so code written for a video element mostly works.

```js
const player = document.querySelector('talkie-player');

await player.play();
player.pause();
player.currentTime = 30;
player.playbackRate = 1.5;
player.volume = 0.8;
player.muted = true;
console.log(player.duration, player.paused, player.ended);
console.log(player.film.chapters); // the parsed talkie.json

player.addEventListener('ended', () => console.log('finished'));
player.addEventListener('chapterchange', (e) => console.log('chapter', e.detail.index));
player.addEventListener('error', (e) => console.log(e.detail.code, e.detail.message));
```

Events: `loadedmetadata`, `play`, `playing`, `pause`, `timeupdate`, `seeking`, `seeked`,
`waiting`, `ended`, `ratechange`, `volumechange`, `error`, plus `chapterchange` and
`scenewarning`.

To play a `.lottie` held in memory, set the `source` property to a `Blob`, `File`,
`ArrayBuffer` or `Uint8Array`. See [offline.md](offline.md).

### Hosting the WASM yourself

The player draws with `dotlottie-web`, which needs a WASM file. By default it comes from a
public CDN. To serve it yourself (for offline use, or a strict content security policy), copy it
and point the player at it:

```sh
cp node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm public/
```

```html
<talkie-player src="/films/shelf/" wasm-url="/dotlottie-player.wasm"></talkie-player>
```

## Theming

Set CSS variables on the element or any ancestor:

```css
talkie-player {
  --talkie-accent: #e8590c; /* play button, progress, focus ring. Default #228be6 */
  --talkie-radius: 4px; /* corner radius. Default 8px */
  --talkie-font: 'Work Sans', sans-serif; /* controls and captions. Default system-ui */
  --talkie-caption-scale: 1.25; /* caption size. Default 1 */
}
```

For deeper changes, style the parts: `root`, `stage`, `poster`, `captions`, `controls`,
`scrubber`, `time`, `chapter-title`, `volume`, `menu`, `unmute`, `error`, `retry`.

```css
talkie-player::part(controls) {
  background: rgba(0, 0, 0, 0.8);
}
```

## React

`@talkie/react` wraps the element. It is a client component, and it is safe to render on a
server: the element is registered in an effect.

```tsx
import { TalkiePlayer } from '@talkie/react';

export function Film() {
  return (
    <TalkiePlayer
      src="/films/shelf/"
      captions="en"
      accentColor="#e8590c"
      onEnded={() => console.log('finished')}
      onChapterChange={(index) => console.log('chapter', index)}
    />
  );
}
```

| Prop | Meaning |
| --- | --- |
| `src` | A film folder URL or a `.lottie` URL. |
| `source` | A `.lottie` in memory: `Blob`, `ArrayBuffer` or `Uint8Array`. |
| `controls` | `false` hides the controls. |
| `autoPlay` | Start at once, muted. |
| `start` | Time to start at, in seconds. |
| `captions` | Caption language, for example `en`. |
| `poster` | Poster image URL. |
| `wasmUrl` | Where the WASM is. |
| `accentColor` | Sets `--talkie-accent`. |
| `className`, `style` | Passed to the element. |
| `ref` | The `TalkiePlayerElement`, for `play()`, `pause()`, `currentTime` and the rest. |
| `onPlay`, `onPause`, `onEnded` | No arguments. |
| `onTimeUpdate(time)`, `onLoadedMetadata(duration)` | Seconds. |
| `onChapterChange(index)` | The index into the film's `chapters`. |
| `onError(error)` | An error with a `code`. |

```tsx
const player = useRef<TalkiePlayerElement>(null);
// ...
<TalkiePlayer ref={player} src="/films/shelf/" />
<button onClick={() => player.current?.play()}>Play</button>
```

## Next.js app router with Mantine

`examples/next-mantine` is a working copy of this. The steps:

1. Add the package, and tell Next.js to compile the Talkie packages.

   `next.config.mjs`:

   ```js
   export default {
     transpilePackages: ['@talkie/react', '@talkie/player'],
   };
   ```

2. Copy the film and the WASM into `public/` before `dev` and `build`. This is the WASM copy
   step: without it the player fetches the WASM from a CDN.

   `package.json`:

   ```json
   {
     "scripts": {
       "copy:film": "mkdir -p public/films && cp -r ../sample-film/dist/film public/films/sample && cp node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm public/",
       "predev": "yarn copy:film",
       "prebuild": "yarn copy:film"
     }
   }
   ```

   In a monorepo the WASM may be in the root `node_modules`. Use the path where
   `@lottiefiles/dotlottie-web` is installed.

3. Render the player. The page can be a server component: `TalkiePlayer` marks itself as a
   client component.

   `app/watch/page.tsx`:

   ```tsx
   import { Container, Paper, Title } from '@mantine/core';
   import { TalkiePlayer } from '@talkie/react';

   export default function WatchPage() {
     return (
       <Container size="md" py="xl">
         <Title order={1} mb="md">
           Putting up a shelf
         </Title>
         <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
           <TalkiePlayer
             src="/films/sample/"
             wasmUrl="/dotlottie-player.wasm"
             accentColor="var(--mantine-primary-color-filled)"
           />
         </Paper>
       </Container>
     );
   }
   ```

`accentColor="var(--mantine-primary-color-filled)"` makes the player follow the Mantine theme,
light and dark.

To list the chapters, read `public/films/sample/talkie.json` on the server and render
`film.chapters`. Each has a `title` and a `start` in seconds. To jump to one, set
`player.currentTime` through the `ref`.

## Errors

The player shows a message over the picture and fires an `error` event. `event.detail` is a
`TalkieError` with a `code`:

| Code | Meaning | What to do |
| --- | --- | --- |
| `network` | A file could not be fetched. The player shows "Try again". | Check the URL, the host and CORS. |
| `invalid-film` | `talkie.json` breaks a rule. `detail.details` lists each one. | Run `talkie check` on the film. |
| `unsupported-version` | The film is a newer format than the player. | Update the player. |
| `no-playable-audio` | The browser can play none of the tracks. | Make sure the film has its `.m4a` track and it is served as `audio/mp4`. |

One scene failing to load is not an error. The player fires `scenewarning`
(`event.detail.sceneId`), shows the poster for that scene and keeps the narration going.

## Keyboard

Space or K: play and pause. J and L: back and forward 10 seconds. Left and right arrows: 5
seconds. Up and down arrows: volume. Home and End: the start and the end. F: fullscreen.
C: captions. M: mute. 0 to 9: jump to that tenth of the film.
