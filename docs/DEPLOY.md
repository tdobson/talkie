# Deploying to geriatrix

One Node process under systemd, listening on `127.0.0.1:3000`, reached through a Cloudflare
Tunnel, with Cloudflare Access in front of the admin side. No database: everything the app knows
is plain files under `DATA_DIR`.

geriatrix has 2 cores and 9GB of RAM and does other jobs, so every heavy step below runs at low
priority. The web server itself runs at normal priority so playback and uploads stay responsive.

## Layout on the host

```
/srv/video-feedback/
  app/                         git checkout of this repo (the monorepo), built in place
    packages/                  the Talkie packages the app is built with
    apps/video-feedback/       the app: the service runs from this folder
      .next/standalone/apps/video-feedback/    the built server (server.js)
  data/    DATA_DIR: inbox, videos, sessions, comments
  env      settings and secrets, mode 600
```

`data/` sits outside `app/` on purpose. A fresh checkout or a `git clean` cannot touch it.

The checkout is the whole monorepo: Talkie in `packages/`, the app in `apps/video-feedback`.
Install and build from the repo root, where `yarn vf <script>` runs any script of the app. The
command line tools (section 6) run from `apps/video-feedback`.

## 1. First install

Needs on the host: Node 22 or newer (24 preferred), `ffmpeg` and `ffprobe`, `ionice` and `nice`
(util-linux and coreutils, already there on Debian), git, and a running `cloudflared`. Chromium
for the stills of Talkie films is installed in section 3.

```bash
sudo apt install ffmpeg
node --version && ffmpeg -version | head -1 && command -v ionice

sudo mkdir -p /srv/video-feedback/data/inbox
sudo chown -R tdobson: /srv/video-feedback

git clone <repo-url> /srv/video-feedback/app
cd /srv/video-feedback/app
corepack enable            # yarn 4, pinned by package.json
```

## 2. The env file

`/srv/video-feedback/env`, readable only by you:

```bash
install -m 600 /dev/null /srv/video-feedback/env
$EDITOR /srv/video-feedback/env
```

```ini
DATA_DIR=/srv/video-feedback/data
GROQ_API_KEY=gsk_...
CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
CF_ACCESS_AUD=<the application's AUD tag>
PUBLIC_BASE_URL=https://video-feedback.tdobson.net
```

| Variable                | What it is                                                                 |
| ----------------------- | -------------------------------------------------------------------------- |
| `DATA_DIR`              | Where everything is stored. Absolute path, outside the checkout.           |
| `GROQ_API_KEY`          | Groq key for Whisper transcription.                                        |
| `CF_ACCESS_TEAM_DOMAIN` | Your Zero Trust team domain. Used to fetch the keys that sign Access JWTs. |
| `CF_ACCESS_AUD`         | Audience tag of the Access application (section 5).                        |
| `PUBLIC_BASE_URL`       | Public address, no trailing slash. Review links are built from it, and admin POSTs from any other origin are refused. |

Optional: `WHISPER_LANGUAGE` (default `en`), and `TALKIE_CHROMIUM_PATH` to use a Chromium other
than the one section 3 installs.

Leave these out of the file:

- `NODE_ENV`, `HOSTNAME`, `PORT`: the unit sets them, and a value in the env file would win.
- `ADMIN_AUTH`, `TRANSCRIBER`: the defaults (`cloudflare`, `groq`) are the production values.
- `E2E_TEST_MODE`: Playwright only. It switches off the checks that stop the server starting
  with no admin auth.

The server refuses to start in production if `GROQ_API_KEY`, `PUBLIC_BASE_URL` or either
`CF_ACCESS_*` value is missing. The reason is in the journal.

No quotes and no `export` in this file: systemd reads it as plain `KEY=value` lines.

## 3. Build

```bash
cd /srv/video-feedback/app
scripts/low yarn install --immutable        # one install at the repo root covers every workspace
yarn vf build
```

`scripts/low` is `ionice -c2 -n7 nice -n19`. `yarn vf build` wraps itself the same way. The build
is capped at 2 workers. Expect it to take a few minutes, and never run two at once.

`yarn vf build` first builds the Talkie packages the app depends on and the page that draws
Talkie stills, then the app. It writes a self-contained server to
`apps/video-feedback/.next/standalone/apps/video-feedback/`. The path repeats because the
standalone output mirrors the repo from its root. The build leaves out the static assets, so copy
them in after every build:

```bash
A=apps/video-feedback
S=$A/.next/standalone/apps/video-feedback
rm -rf $S/.next/static $S/public
cp -r $A/.next/static $S/.next/static
cp -r $A/public $S/public
```

Miss this step and pages load with no styles or scripts (404s under `/_next/static/`), and a
Talkie film does not draw for the reviewer (its renderer is served from `public/talkie/`).

### Chromium, for Talkie stills

Stills and clips of a Talkie film are drawn by a headless Chromium that the server starts when
it needs one and closes after 2 minutes idle. It takes about 400MB on disk, and 200 to 300MB of
RAM while it renders. Install it once, as the user the service runs as, from the repo root:

```bash
ionice -c2 -n7 nice -n19 yarn vf playwright install chromium
```

If Chromium then fails to start because system libraries are missing, install them once, as root:

```bash
sudo ionice -c2 -n7 nice -n19 yarn vf playwright install --with-deps chromium
```

Run as root, that command also leaves a second copy of the browser in root's own cache, which
nothing uses: `sudo rm -rf /root/.cache/ms-playwright` gets the space back.

The browser lands in `~/.cache/ms-playwright/` of the user who ran the first command, which is
where the service looks. Check that it starts on this machine:

```bash
cd apps/video-feedback
"$(node -e "console.log(require('playwright-core').chromium.executablePath())")" --version
```

That prints a version number. An error naming a `.so` file means the `--with-deps` step is
needed. MP4 videos do not use Chromium at all: without it they work as before, and a Talkie film
still plays and still exports its transcript, with the stills and clips steps marked failed.

## 4. The service

```bash
command -v node      # the unit expects /usr/bin/node; edit ExecStart if this differs
sudo cp apps/video-feedback/deploy/video-feedback.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now video-feedback
systemctl status video-feedback
journalctl -u video-feedback -n 50
```

Check it from the host before touching Cloudflare:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/                  # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/admin/videos  # 401
ss -ltnp | grep 3000                                                              # 127.0.0.1 only
```

The 401 is right: the request carries no Access JWT. If `ss` shows `0.0.0.0:3000` or `*:3000`,
stop and fix `HOSTNAME` before going further.

ffmpeg, ffprobe, Chromium and the still and clip rendering are lowered per process by the app
(`ionice -c2 -n7 nice -n19`), so the unit keeps `Nice=0`.

## 5. Cloudflare Tunnel and Access

The settings, with dashboard paths, are in [`apps/video-feedback/deploy/cloudflared.md`](../apps/video-feedback/deploy/cloudflared.md).
In short:

1. **Ingress rule**: `video-feedback.tdobson.net` to `http://127.0.0.1:3000`.
2. **Access application** (self-hosted) covering exactly two paths on that hostname:
   - `video-feedback.tdobson.net/admin` (covers `/admin` and `/admin/*`)
   - `video-feedback.tdobson.net/api/admin` (covers `/api/admin/*`)

   Both in one application, because the app checks one audience tag. Policy 1: `Allow`, your
   email. Cookie setting Same Site Attribute: `Lax` or `Strict`.
   Do not cover `/r/*` or `/api/r/*`. Reviewers have no account.
3. **Service token** for scripts, attached with a second policy whose action is `Service Auth`.
4. Put the AUD tag and team domain in the env file and `sudo systemctl restart video-feedback`.

Do the Access application before the ingress rule if you can. In the other order the admin pages
are public for a moment, protected only by the app's own JWT check (which does hold: 401).

### Calling the admin API from a script

```bash
curl -sS \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  https://video-feedback.tdobson.net/api/admin/videos
```

Download the feedback on a video:

```bash
curl -sS -OJ \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "https://video-feedback.tdobson.net/api/admin/videos/<videoId>/export.zip?version=latest"
```

A `202` with `Retry-After: 30` means comments are still being processed: wait and ask again, or
add `&partial=1`. `&clips=1` includes the reconstructed clips. `&since=<ISO time>` limits it to
newer comments. Send the `ETag` back as `If-None-Match` and you get `304` when nothing changed.

## 6. Getting videos in

Source videos do not go through the browser (Cloudflare caps request bodies at 100MB). Copy them
to the inbox, then import from `/admin/inbox` or the shell:

```bash
rsync -P --bwlimit=20000 film.mp4 geriatrix:/srv/video-feedback/data/inbox/
rsync -P --bwlimit=20000 film.lottie geriatrix:/srv/video-feedback/data/inbox/
```

A video is one of two things:

- An MP4 with H.264 video in `yuv420p`.
- A Talkie film, packed as one `.lottie` file (`dist/film.lottie` of a film project).

Anything else is refused with the reason and left in the inbox.

### Command line tools on the host

The CLIs read `DATA_DIR` directly and need no auth. They do need the env file loaded:

```bash
cd /srv/video-feedback/app/apps/video-feedback
set -a; . /srv/video-feedback/env; set +a

yarn import /path/to/film.mp4 --title "Spring promo"     # prints the review link
yarn import /path/to/film-v2.mp4 --video <videoId>       # next version of a video
yarn import --film /path/to/film.lottie --title "Roof"   # a Talkie film (or its film/ folder)
yarn export <videoId> --out ~/exports/                   # prints the path of the zip
yarn reprocess <videoId>                                 # retry failed comments
```

They run at low priority on their own. `yarn reprocess` does the work in its own process, so
avoid running it on a comment the server is processing at that moment.

## 7. Updating

```bash
cd /srv/video-feedback/app
git pull --ff-only
scripts/low yarn install --immutable
yarn vf build
A=apps/video-feedback
S=$A/.next/standalone/apps/video-feedback
rm -rf $S/.next/static $S/public
cp -r $A/.next/static $S/.next/static
cp -r $A/public $S/public
ionice -c2 -n7 nice -n19 yarn vf playwright install chromium
sudo systemctl restart video-feedback
```

The Chromium line does nothing when the right browser is already there. It downloads a new one
only when the update moved `playwright-core` to a release that wants a newer Chromium.

The build replaces `.next/` under the running server, so restart straight after it finishes and
do not update while someone is reviewing. A restart is safe for data: processing is driven by
`status.json` files and picks up where it stopped, and a reviewer's browser retries chunks that
failed to upload. If the unit file changed, copy it again and `sudo systemctl daemon-reload`.

Rolling back is `git checkout <previous commit>` and the same build, copy and restart.

## 8. Backups

Everything worth keeping is in `DATA_DIR`, plus the env file. Pull both from another machine:

```bash
rsync -a --delete --exclude 'inbox/' \
  geriatrix:/srv/video-feedback/data/ /backups/video-feedback/data/
rsync -a geriatrix:/srv/video-feedback/env /backups/video-feedback/env
```

Or from cron on geriatrix, at low priority (daily at 03:15):

```cron
15 3 * * * ionice -c2 -n7 nice -n19 rsync -a --delete --exclude 'inbox/' /srv/video-feedback/data/ <backup-host>:/backups/video-feedback/data/
```

Notes:

- Files are written atomically (write, then rename), so a copy taken while the server runs is
  consistent file by file. A comment that is mid-upload is simply completed by the next run.
- `--delete` mirrors deletions too. If the backup target has no snapshots of its own, drop
  `--delete` or add `--backup-dir` so a mistake on the host is not copied faithfully.
- To save space, `--exclude 'render/'` is safe: stills and clips are derived and
  `yarn reprocess <videoId> --from-step <step>` rebuilds them. Do not exclude anything else.
  The audio, chunks and event logs are the raw captures and cannot be recreated.
- The backup holds reviewers' voices and names. Keep it somewhere private.

Restore: stop the service, rsync the data back to `/srv/video-feedback/data/`, start the
service. Unfinished processing resumes on start.

### Disk space

New sessions and uploads are refused with `507` when `DATA_DIR` has less than 1GB free. Watch it
with `df -h /srv/video-feedback/data`. Old source versions are the big files.

## 9. Smoke checklist after every deploy

On the host:

- [ ] `systemctl is-active video-feedback` says `active`, and the journal has no errors.
- [ ] `ss -ltnp | grep 3000` shows `127.0.0.1:3000` only.

From a browser on a computer that is not signed in to Access (a private window):

- [ ] `https://video-feedback.tdobson.net/admin` sends you to the Cloudflare login page.
- [ ] A review link (`/r/<token>`) loads with no login and the video plays.

As a reviewer, on that review link:

- [ ] The mic check hears you and lets you through.
- [ ] Record one comment: pause, talk for ten seconds while pointing at the frame, carry on.
      The comment shows as saved.
- [ ] Click "I'm done" to finish the session.

As admin:

- [ ] `/admin` loads after signing in, and the video shows one more session and comment.
- [ ] Within a minute or two "pending processing" drops to 0 and nothing is marked failed.
      If a comment fails, the journal says why (most often the Groq key).
- [ ] Download zip gives a zip. `feedback.md` in it has your words with timecodes, and the
      stills show the pointer where you pointed.
- [ ] The service-token `curl` against `/api/admin/videos` (section 5) returns JSON that lists
      the video.

Talkie stills, after the first install and after any update that downloaded a new Chromium. The
repo carries a 4 second film for this:

- [ ] Import it and open the review link it prints:

      ```bash
      cd /srv/video-feedback/app/apps/video-feedback
      set -a; . /srv/video-feedback/env; set +a
      yarn import --film test/fixtures/talkie-mini.lottie --title "Talkie smoke check"
      ```

- [ ] The film plays on the review link. Record one comment while pointing at the frame, then
      click "I'm done".
- [ ] Export it: Download zip on the video's admin page, or `yarn export <videoId>`. The zip
      holds stills of the film with the pointer drawn on, and no step is marked failed.

## Troubleshooting

| What you see                               | Likely cause                                                        |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Service exits at once                      | A required variable is missing. `journalctl -u video-feedback -n 30` names it. |
| Unstyled pages, 404s on `/_next/static/`   | The static and public folders were not copied after the build.      |
| `/admin` answers 401 after signing in      | `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` does not match the Access application, or the path is not covered by it. |
| Admin buttons answer 403                   | `PUBLIC_BASE_URL` is not the address in the browser bar.            |
| Talkie stills fail: "Chromium is not installed for Talkie stills" | Chromium is missing for the service's user, or an update needs a newer one. Run the install in section 3, then `yarn reprocess <videoId>`. |
| Talkie stills fail after 30 seconds        | Chromium started but did not draw the frame. Run the `--version` check in section 3 and read the journal. |
| A Talkie film stays blank for the reviewer | `public/` was not copied after the build (`/talkie/` answers 404).  |
| Review link answers 507                    | Under 1GB free in `DATA_DIR`.                                       |
| Comments stay "failed" at transcription    | Groq key wrong or out of quota. Fix it, restart, `yarn reprocess <videoId>`. |
| 502 or error 1033 from Cloudflare          | The service or cloudflared is down.                                 |
