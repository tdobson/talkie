# Making a film work offline

The idea: download the `.lottie` once, keep it, and hand it to the player as a `Blob`. The
`.lottie` holds the whole film, so nothing else is fetched when it plays.

## The short version

```js
const response = await fetch('/films/shelf.lottie');
const blob = await response.blob();
document.querySelector('talkie-player').source = blob;
```

`source` is a property, not an attribute. It takes a `Blob`, `File`, `ArrayBuffer` or
`Uint8Array`. Setting it replaces `src`.

## Keep it with the Cache API

This works from a page, with no service worker. It keeps the film across visits.

```js
const FILM = '/films/shelf.lottie';

export async function saveFilm() {
  const cache = await caches.open('talkie-films');
  await cache.add(FILM);
}

export async function loadFilm(player) {
  const cache = await caches.open('talkie-films');
  const response = (await cache.match(FILM)) ?? (await fetch(FILM));
  player.source = await response.blob();
}
```

Call `saveFilm()` from a "Download for offline" button. Call
`loadFilm(document.querySelector('talkie-player'))` when the page opens.

## Make the page itself work offline

A cached film is no use if the page will not load. A service worker caches the page, the
player script, the WASM and the film.

`sw.js`:

```js
const CACHE = 'talkie-v1';
const FILES = [
  '/watch.html',
  '/talkie-player.js',
  '/dotlottie-player.wasm',
  '/films/shelf.lottie',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});
```

In the page:

```html
<script type="module" src="/talkie-player.js"></script>
<talkie-player wasm-url="/dotlottie-player.wasm"></talkie-player>
<script type="module">
  navigator.serviceWorker.register('/sw.js');
  const response = await fetch('/films/shelf.lottie');
  document.querySelector('talkie-player').source = await response.blob();
</script>
```

Three things matter here:

- **Host the WASM yourself.** By default the drawing engine fetches its WASM from a public CDN,
  which fails offline. Copy
  `node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm` to your site and point
  `wasm-url` at it.
- **Pass a `Blob`, not the `.lottie` URL.** A service worker answers range requests poorly, and
  a `Blob` avoids them: the player reads the audio from memory.
- **Bump `CACHE`** (`talkie-v2`) when you replace a film, so visitors get the new one.

## How big is it?

The `.lottie` carries both audio tracks (Opus at about 32 kbit/s and AAC at about 64 kbit/s), so
it is roughly 0.7 MB per minute of film, plus a little for the animation. Run `talkie qa` for
the figures of your film.

## React

```tsx
const [film, setFilm] = useState<Blob>();
useEffect(() => {
  void fetch('/films/shelf.lottie')
    .then((r) => r.blob())
    .then(setFilm);
}, []);
return <TalkiePlayer source={film} wasmUrl="/dotlottie-player.wasm" />;
```

## React Native

Phase 2, not built yet. The plan is the same shape: download the `.lottie` to device storage and
give the player the file.
