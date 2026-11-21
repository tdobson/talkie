# Talkie drop player

A static page: drop or choose a `.lottie` film and it plays in `<talkie-player>`. The file is read
in the browser and never uploaded. Live at https://talkie.tdobson.net (Cloudflare Pages project
`talkie-player`).

## Build and deploy

```sh
scripts/deploy/talkie-player.sh            # build, assemble and deploy (see its header for credentials)
scripts/deploy/talkie-player.sh --no-build # reuse the player and sample film already built
```

`_headers` sets a strict Content Security Policy: everything comes from this site, including the
dotLottie WASM, so the page makes no third-party requests.
