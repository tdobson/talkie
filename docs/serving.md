# Serving a film

Talkie ships no hosting. A film is static files, so any static host works. This page says what
the host must do, then gives recipes.

## Folder or `.lottie`?

- **Folder** (`dist/film/`): use this to play on a web page. It streams. The player fetches each
  scene as it needs it, and the browser downloads only the one audio track it can play.
- **`.lottie`** (`dist/film.lottie`): use this for downloads, offline use and app bundles. The
  player must fetch the whole file before it can start.

Upload the folder for watching. Upload the `.lottie` as well if you offer offline viewing.

## What the host must do

1. **Range requests.** The host must answer `Range` requests on the audio files with
   `206 Partial Content`. Without them, seeking does not work in some browsers. Most hosts do
   this already.
2. **MIME types.** Browsers refuse audio and captions sent with the wrong type.

   | File | `Content-Type` |
   | --- | --- |
   | `*.json` | `application/json` |
   | `*.webm` | `audio/webm` |
   | `*.m4a` | `audio/mp4` |
   | `*.vtt` | `text/vtt` |
   | `*.svg` | `image/svg+xml` |
   | `*.png` | `image/png` |
   | `*.lottie` | `application/zip` |

3. **CORS**, only if the film is on a different origin from the page. Send
   `Access-Control-Allow-Origin` with your page's origin (or `*`) on every film file, and allow
   the `Range` request header.
4. **Compression.** Serve the JSON files with brotli or gzip. Scene JSON shrinks a great deal
   (`talkie qa` reports the size after brotli). Do not compress the audio or the `.lottie`: they are compressed already.
5. **Caching.** A film's files never change once built, so if each film gets its own URL you can
   cache them for a long time.

Check a host with:

```sh
curl -sI https://example.com/films/shelf/talkie.json | grep -i content-type
curl -sI -H 'Range: bytes=0-99' https://example.com/films/shelf/u/narration.m4a | head -1
```

The second command should print a `206` status.

## `npx serve`

For a quick look on your own machine. It answers range requests and sets the usual types.

```sh
cd dist
npx serve --cors .
```

Then the film is at `http://localhost:3000/film/`.

`python3 -m http.server` also works for a first look, but it does not answer range requests,
so seeking can fail.

## nginx

```nginx
server {
  listen 443 ssl;
  server_name films.example.com;
  root /srv/films;

  types {
    application/json  json;
    audio/webm        webm;
    audio/mp4         m4a;
    text/vtt          vtt;
    image/svg+xml     svg;
    image/png         png;
    application/zip   lottie;
  }

  gzip on;
  gzip_types application/json text/vtt image/svg+xml;

  location / {
    add_header Access-Control-Allow-Origin "https://www.example.com" always;
    add_header Access-Control-Allow-Headers "Range" always;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
}
```

nginx answers range requests for static files without being asked. For brotli, add the
`ngx_brotli` module and `brotli on; brotli_types application/json text/vtt image/svg+xml;`.
Drop the `Access-Control` lines if the page and the film share an origin.

## Amazon S3

Upload the folder, then fix the types S3 cannot guess:

```sh
aws s3 sync dist/film s3://my-bucket/films/shelf/ \
  --cache-control "public, max-age=31536000, immutable"
aws s3 cp dist/film/captions/ s3://my-bucket/films/shelf/captions/ --recursive \
  --content-type text/vtt
aws s3 cp dist/film/u/narration.m4a s3://my-bucket/films/shelf/u/narration.m4a \
  --content-type audio/mp4
aws s3 cp dist/film/u/narration.webm s3://my-bucket/films/shelf/u/narration.webm \
  --content-type audio/webm
aws s3 cp dist/film.lottie s3://my-bucket/films/shelf.lottie \
  --content-type application/zip
```

S3 answers range requests. For CORS, save this as `cors.json`:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://www.example.com"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["Range"],
      "ExposeHeaders": ["Content-Range", "Accept-Ranges", "Content-Length"]
    }
  ]
}
```

```sh
aws s3api put-bucket-cors --bucket my-bucket --cors-configuration file://cors.json
```

S3 does not compress. Put CloudFront in front with "Compress objects automatically" on to get
brotli for the JSON.

## Cloudflare R2

R2 speaks the S3 API, so use the same `aws` commands with your R2 endpoint:

```sh
export AWS_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
aws s3 sync dist/film s3://my-bucket/films/shelf/
aws s3 cp dist/film/captions/ s3://my-bucket/films/shelf/captions/ --recursive \
  --content-type text/vtt
aws s3 cp dist/film/u/narration.m4a s3://my-bucket/films/shelf/u/narration.m4a \
  --content-type audio/mp4
aws s3 cp dist/film/u/narration.webm s3://my-bucket/films/shelf/u/narration.webm \
  --content-type audio/webm
aws s3 cp dist/film.lottie s3://my-bucket/films/shelf.lottie --content-type application/zip
aws s3api put-bucket-cors --bucket my-bucket --cors-configuration file://cors.json
```

Then connect a custom domain to the bucket in the Cloudflare dashboard. Served through a custom
domain, R2 answers range requests and Cloudflare compresses the JSON for you.

## After uploading

Check the types with the two `curl` commands above, then load the film in a page (see
[embedding.md](embedding.md)) and seek to the middle. If seeking jumps back to the start, the
host is not answering range requests.
