# Reviewer inboxes: design

Status: draft for Tim, 2026-11-23. Nothing is built. Tim chose: Cloudflare Access email code, and the backend identifies people by it (2026-11-23).

## What Tim asked for

Graham, Kath, Edward and Tim each get a login. Logged in, each sees their own queue: the films
they have been asked to review, priority ones first, and they work through it one by one. The
platform keeps track of which version each person has reviewed, so when a new version of a film
they reviewed is imported, it comes back into their queue to re-review.

## The shape of it

```
 Tim (or an agent) asks Graham to review "Eco2 hubs"  ──►  Graham's queue
 new version of "Eco2 hubs" imported                    ──►  back in Graham's queue ("v4 is up, you reviewed v2")

 graham logs in ──► /me  (his inbox)
                     ┌──────────────────────────────────────────────┐
                     │  Your reviews                    [Start next] │
                     │  ★ Eco2 hubs            new version: v4 (you  │
                     │                         reviewed v2)          │
                     │    UPOWA forecast       to review             │
                     │    Roof kit, part 3     in progress           │
                     │  ▸ Done (6)                                    │
                     └──────────────────────────────────────────────┘
                     Start next ──► the review page, as now, but no name to type and no
                     onboarding (it knows him) ──► Done ──► "Next in your queue: UPOWA"
```

Review links stay as they are. Anyone with a link can still review without an account; the
inbox is an extra way in for the people who review often.

## 1. Logging in

**Cloudflare Access, the login we already use for `/admin`, is the only identity (Tim's call).**
It sends a one-time code to your email (Edward already logs in this way), so nobody has a
password to forget, and the app holds no passwords, logins or sessions of its own.

- A second Access application covers everything a logged-in person uses: `/me/*` (the inbox and
  the review page reached from it) and `/api/me/*` (their API). Cloudflare checks the code
  before a request reaches the server and adds a signed token with their email to every request.
- The server reads the email from that token on every request, as `lib/auth/guard.ts` does for
  admin today (verified against Cloudflare's keys and that application's audience). The email
  is the person's id. There is no ticket and no cookie of ours to forge or expire.
- The Access policy is the door: an "Access group" of reviewer emails. The app's People page
  adds and removes emails in that group through the Cloudflare API (a token with Access edit
  rights only, in the server's env file), so Tim never has to open Cloudflare to add someone.
- Free for up to 50 people on Cloudflare's free plan. Google login can be added in Cloudflare
  later without code changes.

Why not the Migrating Dragons login: MD's apps (snowy, solfit-api) check their own email and
password and hand out their own tokens. They offer no single sign-on another site can use, so
"log in with MD" means building a login provider in MD first. Worth it only if many MD staff
will review. If that happens, the user list below does not change: only how you prove who you
are.

## 2. What is stored

Plain JSON files in the data directory, like everything else:

- `users/<email>.json` (the email, lower case, is the id): `{ email, name, role: 'reviewer' |
  'admin', createdAt, onboarded }`. The name is what shows on their comments. Someone who logs
  in through Access with no file yet gets one, named from their email, which they can change.
- `videos/<videoId>/requests.json`: who has been asked to review this film.
  `[{ email, priority: boolean, requestedAt, requestedBy, note? }]`. A request is for the film,
  not a version: "review the latest".
- Sessions gain `email` (null for anonymous link reviewers, as all sessions are today).

Everything else is worked out from what is already there (sessions, their version, `doneAt`),
so there is no second copy of "who reviewed what" to drift out of step.

## 3. The queue

For each film a person has been asked to review, with `L` the latest version:

| State | When | In the queue? |
| --- | --- | --- |
| To review | no finished session of theirs on any version | yes |
| New version | they finished a session on an older version than `L` | yes, "you reviewed v2, v4 is up" |
| In progress | a session of theirs on `L` they have not pressed Done on | yes, "carry on" |
| Done | they pressed Done on a session on `L` | no, under "Done" |

Order: priority (★) first, then oldest request first. "New version" and "To review" mix by
request date; a re-review is not more or less urgent than a first look unless it is flagged.

"Done" means they pressed Done (the session has `doneAt`), not "left at least one comment":
watching a film through and having nothing to say is a review too.

## 4. Going through it

- `/me` lists the queue and a **Start next** button.
- The review page knows who they are: no name to type, and the "once per browser" onboarding
  becomes "once per person" (stored on the user, so a new laptop does not ask again).
- How the review page knows who they are: from the inbox they open `/me/r/<token>`, the same
  review page served under `/me`, and its calls go to `/api/me/r/<token>/...`, the same
  handlers as the public `/api/r/<token>/...` with the person's email from the Access token.
  Sessions started there store the email. The public `/r/<token>` page and its API are
  untouched, so anonymous link reviewers carry on exactly as now.
- On the Thanks screen, a logged-in reviewer gets **Next in your queue: <film>**, so they can go
  one by one without going back to the inbox.

## 5. Asking people

- Admin video page: a **Reviewers** panel. Add people from the user list, flag priority, remove.
- Admin **People** page: add a person (name, email), see their queue.
- API, for agents with the admin token: `POST /api/admin/videos/<id>/requests`
  `{ "email": "...", "priority": true }`, and the import call can take `"reviewers": [...]`, so
  an agent that puts a film up can ask Graham and Kath in the same call. Asking stays Tim's
  call: the docs say agents ask Tim first, as they do for sending links today.
- When a new version is imported, everyone asked about that film sees it again as "New version".
  Nothing has to be done for that.

## 6. Telling people (later)

The first version does not send anything: people check their inbox. A second step could email
"Tim asked you to review X" and "new version of X" (one email per change, or a daily summary).
Sending email to people is outward-facing, so it would go through a template Tim signs off.

## 7. What changes for agents and the export

- Comments in `export.json` gain `reviewerEmail` (null for anonymous ones).
- The watcher prints them as they are.
- `GET /api/admin/videos/<id>/requests` shows who has reviewed which version, so an agent can
  say "Graham has not looked at v4 yet".

## Build order

1. Users, the Access application for `/me`, the inbox page (read-only, worked out as above),
   admin Reviewers panel and People page, the `/me` review page and API with the email on sessions. Tests for the
   queue states, the Access identity, and an e2e test of an inbox reviewer going through two films.
2. Next in your queue on Thanks, onboarding once per person, the agent API.
3. Email notifications, if wanted.

Step 1 is about two days of work, step 2 one more.

## Decisions for Tim

1. Login: decided, Cloudflare Access email code, the backend identifies people by it.
2. Who can be asked: only people Tim has added, or anyone by email (their account is made the
   first time they log in).
3. Does Done mean "pressed Done" (recommended) or "left at least one comment"?
4. Notifications: none at first (recommended), or email from day one.
