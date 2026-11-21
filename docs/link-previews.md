# Link previews

When someone pastes a link to your page into WhatsApp, Slack, iMessage or a social site, the
preview comes from Open Graph tags in the page's HTML. Talkie does not make these for you, but
the built film has everything you need:

- `poster.png`: the picture.
- `talkie.json`: the `title`, the `duration` in seconds and the `size`.

## The tags

Put these in the `<head>` of the page that holds the player. Use full URLs: previews are fetched
by a server that does not know your page's address.

```html
<title>Putting up a shelf</title>
<meta property="og:type" content="video.other">
<meta property="og:title" content="Putting up a shelf">
<meta property="og:description" content="A 22 second film on fixing a bracket and a shelf.">
<meta property="og:url" content="https://www.example.com/watch/shelf">
<meta property="og:image" content="https://films.example.com/shelf/poster.png">
<meta property="og:image:width" content="1920">
<meta property="og:image:height" content="1080">
<meta property="og:image:alt" content="A bracket on a wall under a level line">
<meta property="video:duration" content="22">
<meta name="twitter:card" content="summary_large_image">
```

- `og:image` is the film's `poster.png`.
- `og:image:width` and `og:image:height` are `size` from `talkie.json`.
- `video:duration` is `duration`, rounded to whole seconds.

The tags must be in the HTML the server sends. Preview fetchers do not run JavaScript, so tags
added in the browser are never seen.

## The poster is the first frame

`poster.png` is the film at time 0. If your first scene fades in from nothing, the poster is
blank and so is the preview. Either open on a picture that is already there (add a node and do
not fade it in), or point `og:image` at an image you made yourself.

## Next.js

In the app router, read `talkie.json` on the server and return the tags from `generateMetadata`:

```tsx
import { readFile } from 'node:fs/promises';
import type { Metadata } from 'next';

const FILM = 'https://www.example.com/films/sample';

export async function generateMetadata(): Promise<Metadata> {
  const film = JSON.parse(await readFile('public/films/sample/talkie.json', 'utf8'));
  return {
    title: film.title,
    openGraph: {
      type: 'video.other',
      title: film.title,
      url: 'https://www.example.com/watch',
      images: [{ url: `${FILM}/${film.poster.png}`, width: film.size[0], height: film.size[1] }],
    },
    twitter: { card: 'summary_large_image' },
    other: { 'video:duration': String(Math.round(film.duration)) },
  };
}
```

## Sending the film itself

A link preview shows a picture and a title. It does not play the film in the chat. To send
something that plays in the chat, export a video file: see [exporting.md](exporting.md).

## Check it

```sh
curl -s https://www.example.com/watch/shelf | grep -i 'og:'
```

You should see your tags. Then paste the link into the app you care about. Most apps cache
previews for days, so add `?v=2` to the link to force a fresh one while testing.
