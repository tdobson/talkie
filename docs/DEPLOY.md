# Deploying to geriatrix

One Node process under systemd, listening on `127.0.0.1:3000`, reached through a Cloudflare
Tunnel, with Cloudflare Access in front of the admin side. No database: everything the app knows
is plain files under `DATA_DIR`.

geriatrix has 2 cores and 9GB of RAM and does other jobs, so every heavy step below runs at low
priority. The web server itself runs at normal priority so playback and uploads stay responsive.

## Deploying: one command

From the repo root on your own machine (not on geriatrix):

```bash
scripts/deploy/video-feedback.sh              # build, then deploy
scripts/deploy/video-feedback.sh --no-build   # deploy the build that is already there
scripts/deploy/video-feedback.sh --rollback   # back to the release the other slot holds
```

It runs `yarn vf build` here, swaps in a sharp that runs on geriatrix's CPU
(`scripts/deploy/sharp-old-cpu.sh`), makes sure the headless Chromium for Talkie stills is on the
host and named by `TALKIE_CHROMIUM_PATH` in the env file, and uploads a new release. Then it
switches with no downtime (blue/green):

1. It waits (up to `VF_DEPLOY_WAIT` seconds, 900 by default) for the processing queue to empty.
2. The new release starts on the idle app slot, `video-feedback@3001` or `@3002`, beside the
   live one, and is checked on its own port. Not healthy: it is stopped, and the live site was
   never touched.
3. The old slot is stopped. The front proxy, `video-feedback-proxy` (a Caddy of its own on
   127.0.0.1:3000, where the Cloudflare tunnel points), always lists both slots and sends traffic
   to the one that is up, retrying on the other any request a stopping slot cannot take. So
   nothing is dropped, and its config never changes. It is never reloaded: the Caddy 2.6.2 on
   geriatrix panics on a reload.
4. The public site is checked. If that fails the old slot is started again and the new one
   stopped.
5. The new slot then takes over comment processing: only one server processes at a time
   (`pipeline.lock` in the data directory, `lib/pipeline/leader.ts`), and work a stopped server
   was in the middle of is left pending and carried on, never failed.

It keeps the newest three releases, and any a slot still points at, so `--rollback` (start the
other slot again, check it, stop this one) is a few seconds with no downtime either. Checked on
2026-11-23 with a probe twice a second on the public site: no failed request.

The first deploy with this script hands port 3000 from the old single `video-feedback` service to
the proxy: a gap of a second or two, once.

Needs: ssh to `geriatrix` with passwordless sudo, and docker on your machine the first time (to
build sharp; the result is cached in `~/.cache/video-feedback/sharp-old-cpu`). Set `VF_HOST` to
deploy somewhere else.

Why build elsewhere: geriatrix has 2 cores and its root disk is 96% full, and its CPU (AMD Turion
II, no SSE4) cannot run prebuilt sharp, which dies with SIGILL, or sharp's WebAssembly build,
which needs Wasm SIMD. Headless Chromium and the dotLottie WASM do run on it (checked 2026-11-21).

## Layout on the host

```
/srv/video-feedback -> /srv/data/video-feedback   (the root disk is full, so it all lives on /srv/data)
  releases/<stamp>/    one standalone build each; the server is releases/<stamp>/apps/video-feedback/server.js
  current              symlink to the live release (what the CLI tools on the host run)
  slot-3001, slot-3002 symlinks to the release each app slot runs (video-feedback@<port>)
  proxy/               the proxy's Caddyfile, admin socket and data
  data/                DATA_DIR: inbox, videos, sessions, comments
  env                  settings and secrets, mode 600
  ms-playwright/       chromium_headless_shell-<rev>, for Talkie stills
```

The deploy script never touches `data/`, and touches `env` only to set `TALKIE_CHROMIUM_PATH`.

## 1. First install

Needs on the host: Node 22 or newer at `/usr/local/bin/node` (24 preferred), `ffmpeg` and
`ffprobe`, Debian's libvips for the self-built sharp, and a running `cloudflared`.

```bash
sudo apt install ffmpeg libvips42t64
sudo mkdir -p /srv/data/video-feedback/data/inbox
sudo ln -s /srv/data/video-feedback /srv/video-feedback
sudo chown -R tdobson: /srv/data/video-feedback
```

Write the env file (section 2), then run the deploy script from your machine. Then enable the
service once: `sudo systemctl enable video-feedback`.

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
PUBLIC_BASE_URL=https://feedback.migratingdragons.com
OTHER_BASE_URLS=https://video-feedback.tdobson.net
```

| Variable                | What it is                                                                 |
| ----------------------- | -------------------------------------------------------------------------- |
| `DATA_DIR`              | Where everything is stored. Absolute path, outside the checkout.           |
| `GROQ_API_KEY`          | Groq key for Whisper transcription.                                        |
| `CF_ACCESS_TEAM_DOMAIN` | Your Zero Trust team domain. Used to fetch the keys that sign Access JWTs. |
| `CF_ACCESS_AUD`         | Audience tag of the Access application (section 5).                        |
| `PUBLIC_BASE_URL`       | Public address, no trailing slash. Review links are built from it, and admin POSTs from any other origin are refused. |
| `OTHER_BASE_URLS`       | Optional. Other addresses the same app answers on, separated by commas or spaces. Admin POSTs from these are accepted too; links still use `PUBLIC_BASE_URL`. |

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

## 3. What the build is

`yarn vf build` first builds the Talkie packages the app depends on and the page that draws
Talkie stills, then the app. It writes a self-contained server to
`apps/video-feedback/.next/standalone/apps/video-feedback/` (the path repeats because the
standalone output mirrors the repo from its root). The deploy script adds the static assets
(`.next/static` and `public/`) that the standalone build leaves out. Without them pages load
unstyled and a Talkie film does not draw for the reviewer.

### Chromium, for Talkie stills

Stills and clips of a Talkie film are drawn by a headless Chromium (Playwright's
`chromium-headless-shell`, the revision `playwright-core` asks for) that the server starts when it
needs one and closes after 2 minutes idle. About 280MB on disk and 200 to 300MB of RAM while it
renders. The deploy script copies it from your own `~/.cache/ms-playwright` and sets
`TALKIE_CHROMIUM_PATH`. Check it by hand with:

```bash
ssh geriatrix '. /srv/video-feedback/env; "$TALKIE_CHROMIUM_PATH" --version'
```

MP4 videos do not use Chromium at all. Without it a Talkie film still plays and exports its
transcript, with the stills and clips steps marked failed.

## 4. The service

Three units from `apps/video-feedback/deploy/`, installed by the deploy script: the app slots
`video-feedback@.service` (one of `video-feedback@3001` and `@3002` runs at a time, apart from
the moment of a deploy), and the front proxy `video-feedback-proxy.service` with its `Caddyfile`.
There is another Caddy on geriatrix for other sites; this one has its own config and admin socket
and touches nothing else.

```bash
systemctl is-active video-feedback@3001 video-feedback@3002                        # one is live
systemctl status video-feedback-proxy 'video-feedback@*'
journalctl -u video-feedback@3001 -u video-feedback@3002 -n 50
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/                  # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/admin/videos  # 401
ss -ltnp | grep -E ':300[012]'                                                    # 127.0.0.1 only
```

The 401 is right: the request carries no Access JWT. ffmpeg, Chromium and the still and clip
rendering are lowered per process by the app (`ionice -c2 -n7 nice -n19`), so the unit keeps
`Nice=0`.

## 5. Cloudflare Tunnel and Access

The settings, with dashboard paths, are in [`apps/video-feedback/deploy/cloudflared.md`](../apps/video-feedback/deploy/cloudflared.md).
In short:

The live app answers on two hostnames: `feedback.migratingdragons.com` (the one links use) and
`video-feedback.tdobson.net` (the first address, kept so old links work). Each needs its own ingress
rule, DNS record and pair of Access paths below, in the same Access application.

1. **Ingress rule**: `feedback.migratingdragons.com` to `http://127.0.0.1:3000`.
2. **Access application** (self-hosted) covering exactly two paths on that hostname:
   - `feedback.migratingdragons.com/admin` (covers `/admin` and `/admin/*`)
   - `feedback.migratingdragons.com/api/admin` (covers `/api/admin/*`)

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
  https://feedback.migratingdragons.com/api/admin/videos
```

Download the feedback on a video:

```bash
curl -sS -OJ \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "https://feedback.migratingdragons.com/api/admin/videos/<videoId>/export.zip?version=latest"
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

### Importing from a script (agents use this)

The inbox import is an admin API, so a script with the service token does the whole thing:

```bash
. ~/.config/video-feedback/service-token.env   # CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET
H=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
VF=https://feedback.migratingdragons.com

rsync -P --bwlimit=20000 dist/film.lottie geriatrix:/srv/video-feedback/data/inbox/roof-v1.lottie
curl -sS "${H[@]}" $VF/api/admin/inbox                     # lists the inbox
curl -sS "${H[@]}" -H 'Content-Type: application/json' \
  -d '{"filename":"roof-v1.lottie","mode":"new","title":"Roof"}' $VF/api/admin/inbox
# -> {"ok":true,"videoId":"...","version":1}
curl -sS "${H[@]}" $VF/api/admin/videos                    # each video has its reviewUrl
```

For the next version of a video: `{"filename":"roof-v2.lottie","mode":"version","videoId":"<id>"}`.
The review link stays the same and reviewers see the newest version. See
[`docs/review-platform-for-agents.md`](review-platform-for-agents.md) for the whole agent workflow.

The `yarn import`, `yarn export` and `yarn reprocess` command line tools need a checkout with
`node_modules`, so they run from a dev machine against a local `DATA_DIR`, not on geriatrix.
On geriatrix use the admin pages or the API (`POST /api/admin/videos/<id>/reprocess`).

## 7. Updating and rolling back

Updating is the deploy script again, with no downtime (see "Deploying: one command"). It is
safe for data: processing is driven by `status.json` files and picks up where it stopped, and a
reviewer mid-review carries on (their requests go to whichever slot is live).

Rolling back to the release before: `scripts/deploy/video-feedback.sh --rollback`. By hand:

```bash
ssh geriatrix 'ls -l /srv/video-feedback/slot-*; systemctl is-active video-feedback@3001 video-feedback@3002'
# say 3001 is live: start 3002 (the release before), check it, then stop 3001
ssh geriatrix 'sudo systemctl start video-feedback@3002 && sleep 3 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/'
ssh geriatrix 'sudo systemctl stop video-feedback@3001 && sudo systemctl enable video-feedback@3002 && sudo systemctl disable video-feedback@3001'
```

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

- [ ] `systemctl is-active video-feedback-proxy video-feedback@<live slot>` says `active` twice, and the journal has no errors.
- [ ] `ss -ltnp | grep 3000` shows `127.0.0.1:3000` only.

From a browser on a computer that is not signed in to Access (a private window):

- [ ] `https://feedback.migratingdragons.com/admin` sends you to the Cloudflare login page.
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

- [ ] Import `apps/video-feedback/test/fixtures/talkie-mini.lottie` with the script route in
      section 6 (title "Talkie smoke check") and open its review link.
- [ ] The film plays on the review link. Record one comment while pointing at the frame, then
      click "I'm done".
- [ ] Export it: Download zip on the video's admin page, or the export API (section 5). The zip
      holds stills of the film with the pointer drawn on, and no step is marked failed.

## Troubleshooting

| What you see                               | Likely cause                                                        |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Service dies with SIGILL, or sharp fails to load | The release has prebuilt sharp. Rerun the deploy script (it swaps in `sharp-old-cpu.sh`'s build). |
| Service exits at once                      | A required variable is missing. `journalctl -u video-feedback -n 30` names it. |
| Unstyled pages, 404s on `/_next/static/`   | The release was not made by the deploy script (static and public folders missing). |
| `/admin` answers 401 after signing in      | `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` does not match the Access application, or the path is not covered by it. |
| Admin buttons answer 403                   | `PUBLIC_BASE_URL` is not the address in the browser bar.            |
| Talkie stills fail: "Chromium is not installed for Talkie stills" | `TALKIE_CHROMIUM_PATH` in the env file points at nothing. Rerun the deploy script, then reprocess the video. |
| Talkie stills fail after 30 seconds        | Chromium started but did not draw the frame. Run the `--version` check in section 3 and read the journal. |
| A Talkie film stays blank for the reviewer | `public/talkie/` missing from the release (`/talkie/dotlottie-player.wasm` answers 404). |
| Review link answers 507                    | Under 1GB free in `DATA_DIR`.                                       |
| Comments stay "failed" at transcription    | Groq key wrong or out of quota. Fix it, restart, reprocess the video. |
| 502 or error 1033 from Cloudflare          | The service or cloudflared is down.                                 |
