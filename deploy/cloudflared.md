# Cloudflare Tunnel and Access

The app listens on `127.0.0.1:3000` only. The tunnel is the one way in, and Cloudflare Access
guards the admin side. The full deployment procedure is in `docs/DEPLOY.md`; this file holds the
Cloudflare settings on their own.

Hostname used below: `video-feedback.tdobson.net`. Change it everywhere if you pick another.

## 1. Ingress rule

### Tunnel managed from a config file

Add the hostname to `/etc/cloudflared/config.yml`, above the catch-all rule that ends the list:

```yaml
ingress:
  # ... existing hostnames ...
  - hostname: video-feedback.tdobson.net
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Then create the DNS record, check the file and restart:

```bash
cloudflared tunnel route dns <tunnel-name> video-feedback.tdobson.net
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://video-feedback.tdobson.net/admin
sudo systemctl restart cloudflared
```

`ingress rule` prints the rule a URL matches. It should name `http://127.0.0.1:3000`.

### Tunnel managed from the dashboard

Zero Trust > Networks > Tunnels > the geriatrix tunnel > Public hostname > Add a public hostname:

| Field     | Value            |
| --------- | ---------------- |
| Subdomain | `video-feedback` |
| Domain    | `tdobson.net`    |
| Path      | leave empty      |
| Type      | `HTTP`           |
| URL       | `127.0.0.1:3000` |

The DNS record is created for you and cloudflared picks the change up without a restart.

### Limits worth knowing

- Cloudflare refuses request bodies over 100MB. Reviewer audio goes up in small chunks, so that
  is fine. Source videos never go through the tunnel: copy them into `DATA_DIR/inbox` with rsync.
- The app reads the visitor address from `CF-Connecting-IP`, which only Cloudflare sets. That is
  what the per-address session limit counts.

## 2. Access application for the admin side

Zero Trust > Access > Applications > Add an application > Self-hosted.

| Field             | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| Application name  | `Video feedback admin`                                |
| Session duration  | `24 hours`, or what suits you                         |
| Public hostname 1 | domain `video-feedback.tdobson.net`, path `admin`     |
| Public hostname 2 | domain `video-feedback.tdobson.net`, path `api/admin` |

Both paths must sit in the same application. The app checks every admin request against one
audience tag (`CF_ACCESS_AUD`), and each Access application has its own.

A path covers itself and everything below it, so `admin` protects `/admin`, `/admin/inbox` and
`/admin/videos/<videoId>`, and `api/admin` protects `/api/admin/videos`, `/api/admin/inbox`
and the export and reprocess routes. Nothing else is covered. `/r/<token>` and `/api/r/<token>/...`
must stay open, because reviewers have no account: the review link is their credential.

Policies, in this order:

1. Name `Tim`, action `Allow`, include `Emails` with your email address.
2. Name `Scripts`, action `Service Auth`, include `Service Token` with the token from step 3.
   The action has to be `Service Auth`. With `Allow`, a script is sent to the login page.

Under the application's cookie settings, set **Same Site Attribute** to `Lax` (or `Strict`). The
app refuses cross-site admin POSTs on its own; this is the second layer.

After saving, copy two values into `/srv/video-feedback/env`:

- `CF_ACCESS_AUD`: the **Application Audience (AUD) Tag** on the application's overview page.
- `CF_ACCESS_TEAM_DOMAIN`: your team domain, `<team>.cloudflareaccess.com`. The team name is
  under Zero Trust > Settings > Custom Pages.

The team domain may be written with or without `https://`. Restart the service after changing
the env file: `sudo systemctl restart video-feedback`.

## 3. Service token for scripts

Zero Trust > Access > Service Auth > Service Tokens > Create Service Token. Name it
`video-feedback-scripts`. The client secret is shown once, so save both halves somewhere private
straight away, for example a file only you can read:

```bash
# ~/.config/video-feedback/token   (chmod 600)
CF_ACCESS_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.access
CF_ACCESS_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Then add the token to the `Scripts` policy from step 2.

Use it:

```bash
. ~/.config/video-feedback/token

curl -sS \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  https://video-feedback.tdobson.net/api/admin/videos
```

That prints the list of videos as JSON. What the other answers mean:

| Answer                                                | Cause                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 302 to `cloudflareaccess.com`, or 403 from Cloudflare | Token wrong or expired, or not in a `Service Auth` policy                                                                    |
| 401 from the app                                      | Access let the request through but `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` in the env file does not match the application |
| 502 or 1033 from Cloudflare                           | The service or the tunnel is down                                                                                            |

Tokens expire (one year by default). Renew from the same dashboard page.
