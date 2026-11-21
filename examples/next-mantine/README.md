# Talkie in a Next.js and Mantine app

This is the [Mantine Next.js template](https://github.com/mantinedev/next-app-template) (app
router) with one page added: `/watch`, which plays the sample film with `@talkie/react`.

## Run it

From the repo root:

```sh
yarn build      # the Talkie packages
yarn sample     # the sample film, into examples/sample-film/dist/film
yarn workspace @talkie/example-next-mantine dev
```

Then open http://localhost:3000/watch.

`dev` and `build` first run `scripts/copy-film.mjs`. It copies the film to `public/films/sample/`
and the dotLottie drawing engine (`dotlottie-player.wasm`) to `public/`. The app serves both
itself, so the page works with no network. Neither copy is committed.

## What to look at

- `app/watch/page.tsx` is a server component. It reads `talkie.json` on each request for the
  title and the chapter list, and renders `<TalkiePlayer>` inside a Mantine `Paper`.
- `accentColor="var(--mantine-primary-color-filled)"` makes the player controls follow the
  Mantine theme.
- `wasmUrl="/dotlottie-player.wasm"` points the player at the local copy of the drawing engine.
- `next.config.mjs` lists `@talkie/react` and `@talkie/player` under `transpilePackages`.
- `app/watch/page.test.tsx` renders the page with the template's `test-utils`.

## Scripts

Every script runs at low priority through `scripts/low`.

- `dev`: copy the film, then start the dev server
- `build`: copy the film, then build for production
- `start`: serve the production build
- `typecheck`: check the TypeScript types
- `lint`: run oxlint and stylelint
- `format:test` and `format:write`: check or fix formatting with oxfmt
- `jest`: run the tests (also `yarn test:examples` from the repo root)
- `test`: all of the checks above
- `storybook` and `storybook:build`: the template's Storybook
