# Tinkerbell

A self-hosted Plex companion for automating library curation. Define rules over
your Plex media — using metadata from IMDb/OMDb and requests from Overseerr — to
drive collections, overlays, labels, and notifications on a schedule.

> [Screenshots of every page](screenshots/) · [Development guide](DEVELOPMENT.md)

## Features

- **Rules engine** — rules that produce Plex collections from your library,
  refreshed on a schedule, with full run history.
- **Smart filters** — compose criteria over Plex metadata, IMDb ratings, and
  Overseerr requests. AI-assisted filter generation via Anthropic.
- **Collections** — auto-managed Plex collections with sort order, pinning, and
  shuffle hubs for a randomised home screen.
- **Overlays** — stamp ratings, badges, and labels onto poster artwork.
- **Because you watched** — per-user recommendation collections.
- **Personalized home screens** — an opt-in, server-wide mode where each Plex
  user tunes their own recommendations. [See below](#personalized-home-screens).
- **Prerolls** — upload the videos Plex plays before a movie; Tinkerbell
  transcodes anything Plex wouldn't direct play and manages the server setting.
  [See below](#prerolls).
- **Labels** — bulk apply and undo Plex labels from rules, with a preview of
  what will change.
- **Discover** — search TMDb for films and shows, see at a glance what your
  \*Arrs and Plex already hold, and send anything else to Radarr or Sonarr with
  the profile, root folder and monitoring you choose. Records get a detail page
  with an interactive release picker for grabbing a specific release yourself.
- **Watchlist sync** — anything you add to your Plex watchlist that isn't
  already in your library is sent to Radarr or Sonarr, with a per-run cap, a
  dry-run mode, and a ledger so a request is never made twice.
- **Notifications** — Discord, Slack, Telegram, Gotify, Pushbullet, Pushover,
  LunaSea, and generic webhooks.
- **Backup, export and change history** — nightly copies of the database, a
  portable JSON export of your configuration, and a record of every settings
  change with the previous value. [See below](#backup-export-and-change-history).
- **Stats & events** — library stats, an activity feed, and playback history.
- **Stress test** — ramps real playback sessions against your server until it
  stops keeping up, and reports how many it handled. [See below](#stress-test--how-many-streams-can-this-server-actually-serve).
- **Multi-user** — per-user settings and integrations (Plex, \*Arrs, Overseerr).
- **User management** — invite people to the server, choose the libraries each
  one gets, set downloads / Live TV / content-rating limits, watch what they're
  streaming and stop a stream, all without leaving for app.plex.tv.

## Install

### Docker

```sh
docker run -d --name tinkerbell \
  -v /path/to/config:/config \
  -v /path/to/prerolls:/prerolls \
  -p 3000:3000 -p 3100:3100 \
  -e PUID=99 -e PGID=100 -e TZ=Europe/London \
  ghcr.io/sdgluck/tinkerbell:latest
```

Images are published to GHCR for `linux/amd64` and `linux/arm64`: `latest` plus
the semver tags on each release, and `edge` on every push to `master`. Or build
your own with `docker build -t tinkerbell .`.

One Node process serves the admin UI, the tRPC API, and the user portal.
Persistent state (SQLite database and config) lives in `/config`, and is chowned
to `PUID:PGID` (default `99:100`, Unraid's `nobody:users`) by the entrypoint,
which drops from root before starting the server. The `/prerolls` volume is only
needed for the Prerolls feature, and must be mounted into Plex too.

### Unraid

`unraid/tinkerbell.xml` is a Community Applications template. Until it is listed
in the CA appfeed, install it by hand:

1. Copy the template onto the array:

   ```sh
   wget -O /boot/config/plugins/dockerMan/templates-user/my-Tinkerbell.xml \
     https://raw.githubusercontent.com/sdgluck/tinkerbell/master/unraid/tinkerbell.xml
   ```

2. **Docker → Add Container**, and pick `Tinkerbell` from the _Template_
   dropdown (under "User templates").
3. Check the paths and hit **Apply**.

| Setting            | Default                        | Notes                                                                              |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| WebUI port (admin) | `3000`                         | Unauthenticated until you turn on auth. See [Network exposure](#network-exposure). |
| User Portal port   | `3100`                         | Sign in with Plex; safe to expose.                                                 |
| `/config`          | `/mnt/user/appdata/tinkerbell` | SQLite database and settings. Back this up.                                        |
| `/prerolls`        | `/mnt/user/prerolls`           | Optional. Map the **same host path** into the Plex container.                      |
| `PUID` / `PGID`    | `99` / `100`                   | Unraid's `nobody:users`.                                                           |
| `TZ`               | `Europe/London`                | The zone cron schedules run in; Settings → Schedules overrides it.                 |

## Network exposure

### Admin authentication

Off by default, and worth turning on. Under **Settings → Security**, "Turn on"
makes the admin app require a Plex sign-in: Tinkerbell asks plex.tv which
account owns the server behind your configured Plex token, and lets in that
account and no other. There's no password to store, no reset flow, and no
second identity system — you already have a Plex account, and the app is
useless without a Plex token anyway.

Details worth knowing:

- The session is an opaque cookie; only its SHA-256 reaches the database. It
  lasts 7 days and slides forward while you're using the app. `Secure` is set
  when the request arrived over HTTPS — directly, or via
  `X-Forwarded-Proto: https` from a reverse proxy — and omitted on plain HTTP
  so a LAN install still works.
- `/api/plex-image` and `/api/prerolls/…` are gated too. Plex reads preroll
  files from the shared filesystem path, never over HTTP, so nothing on the
  Plex side breaks.
- The user portal on `3100` is unaffected: it has its own sign-in, its own
  cookie, and its own session scope. A portal session can't authorise an admin
  call.
- **Locked out?** Set `TINKERBELL_DISABLE_AUTH=1` and restart. That bypasses
  the check entirely — it needs shell access on the host, which is the right
  bar — and logs a warning every 60 seconds for as long as it's set. Unset it
  once you're back in.
- Turning auth on doesn't happen on upgrade. An existing install keeps
  behaving exactly as it did.

### The bind address

With auth off, anyone who can reach the server port can call every mutation.
So the server binds to `127.0.0.1` by default.

- `HOST=127.0.0.1` (default) — loopback only, safe.
- `HOST=0.0.0.0` — all interfaces. The Docker image sets this so the container
  is reachable from the host. With auth off, only do this behind a trusted
  reverse proxy or firewall, and **do not port-forward `3000`**.

A `[security]` warning is logged at startup whenever the server binds to a
non-loopback interface with auth off — that combination is the dangerous one.
With auth on, startup notes that instead.

The **user portal** (Sign in with Plex) runs on its own port so it can be
exposed publicly without exposing the admin API: `USER_PORT` (default `3100`)
and `USER_HOST` (default: same as `HOST`). For a public deployment, expose only
`3100`. The portal listener only runs while Personalized Home Screens is
enabled.

Set the address users reach it at under **Settings → Portal → Address**. Plex
sign-in returns people there, cleanup warnings link to it, and the portal
preroll shows it. Left blank, sign-in falls back to whichever address the
visitor arrived from.

## Personalized home screens

Per-user recommendations (Because You Watched, and any rule marked
_personalizable_) work by giving each user a `User:<name>`-labelled collection
and restricting their Plex sharing so they only see their own. Isolation only
holds when **every** shared user is restricted, so this sits behind a single
server-wide switch under **Settings → Personalization**.

- **Enable** stamps the `Tinkerbell` label on every item in your configured
  libraries (so restricted users keep full library access) and restricts each
  shared user to `[Tinkerbell, User:<self>]`, snapshotting their prior sharing
  settings first.
- **Disable** deletes every per-user collection _before_ lifting restrictions
  (so nothing briefly leaks to everyone), restores each snapshot, and removes
  the `Tinkerbell` labels — leaving the server as if it had never been enabled.
- Users set their own tastes (loved/liked/hated genres, moods, rating floor,
  excluded titles, …) in the **portal** by signing in with Plex; an admin can
  also set them under **Settings → User Preferences**. Preferences are inert
  until the user opts in.

Caveats: the Plex server **owner cannot be restricted**, so the owner sees every
user's personalized collections. Newly shared users are not restricted
automatically — use **Reconcile users** after adding someone.

## Prerolls

A preroll is a short video Plex plays before every movie. Plex stores them as a
list of paths **on its own filesystem** (the `CinemaTrailersPrerollID` server
preference), which means Tinkerbell and Plex have to share a directory.

Mount one directory into both containers:

```yaml
services:
  tinkerbell:
    volumes:
      - ./config:/config
      - ./prerolls:/prerolls
  plex:
    volumes:
      - ./prerolls:/prerolls # must be readable by Plex
```

Then set **Settings → Prerolls → "The same directory, as Plex sees it"** to
whatever path Plex mounts it at. If both containers use `/prerolls`, the default
is already correct.

Uploads are probed with `ffprobe` and left untouched when Plex would already
direct play them; anything else is normalised to H.264/AAC in an MP4 so a
ten-second clip can't occupy a transcode session. `ffmpeg` ships in the Docker
image; for a bare install, put it on `PATH` (`brew install ffmpeg`,
`apt install ffmpeg`).

Two things worth knowing:

- **Prerolls are a Plex Pass feature.** Without a subscription Plex stores the
  setting and plays nothing.
- **A wrong path mapping fails silently.** Plex accepts the setting and then
  finds no file. The Prerolls page reports whether Plex is in sync, and the
  health check watches for drift.

Set `PREROLLS_DIR` to move Tinkerbell's side of the directory; it defaults to
`$DATA_DIR/prerolls` outside Docker.

### The portal preroll

**Settings → Portal → Preroll** makes a card that tells your users where to
sign in to the portal and customise their Plex: a headline, a short message, the
portal's address and (optionally) a QR code, in your colours. Tinkerbell renders
it to a few seconds of H.264/AAC video and adds it to the pool like any other
preroll — so it follows the same random or in-order playback, and can be
switched off or reordered from the Prerolls page. Editing the card re-renders
it in place.

The address defaults to the one under **Settings → Portal → Address**. It has to be one your users can
reach from their phones — the portal port, not the admin one — and the portal
only listens while one of its features (personalization, cleanup warnings or
digests) is on; the page warns when it isn't.

## Backup, export and change history

Three separate things, because they answer three separate questions.

### Backups — "the disk had a bad day"

A gzipped copy of the whole database, taken nightly at 03:30 and kept for the
last 7 runs. **On by default**: a backup nobody enabled is a backup nobody has.
Settings → Backup & Restore.

The copy is taken with SQLite's online backup API rather than by copying the
file. That matters — the database runs in WAL mode, and `cp` of a live one
produces a file that opens cleanly, looks fine, and is missing whatever was in
the write-ahead log.

**In Docker, put the backup directory on a mounted volume.** The default is
`<DATA_DIR>/backups`, which is inside the volume you already mount for
`tinkerbell.db`. A path outside it lives on the container's own filesystem and
disappears when the container is replaced, which is worse than having no backup
because it looks like one.

**Restoring is a manual procedure**, and deliberately not a button — a restore
that runs while the app has the database open produces two corrupt files rather
than one good one:

1. Stop the container.
2. `gunzip tinkerbell-20260820T033000.db.gz`
3. Replace `tinkerbell.db` in your data directory with the result, and delete
   any `tinkerbell.db-wal` and `tinkerbell.db-shm` sitting beside it.
4. Start the container.

### Export — "I'm moving hosts", "here's my broken rule"

One JSON file holding rules, job schedules, overlay presets and settings, in a
form another Tinkerbell can read. Library-specific values are translated on the
way out: genre and director tag ids become names, section references become
library titles. Without that a rule imports cleanly on another server and
matches nothing, silently.

**Credentials are excluded by default.** There is a checkbox to include them,
which warns first and marks the file — but an export is the kind of thing people
paste into issues, so the default is the safe one.

Importing always previews first. Every item is classified as new, identical, or
different from what you already have, and anything different defaults to keeping
your copy until you say otherwise. Replacements are recorded in the change
history, so you can see what they were and put them back.

### Change history — "what did I change last Tuesday?"

Every edit to a rule, a setting, a job schedule, an overlay preset or a preroll,
with the previous value and who made it — a signed-in admin, a job, or an
import. Rules get a **Change history** entry in their row menu with a
"restore this version" action; the full log is at Settings → Change History.

Secrets are recorded redacted, so this never becomes a plaintext history of
every API key you have entered. Transient job state and dashboard layout are not
recorded at all — they would bury everything else. Entries are kept for 180 days.

This is the counterpart to the **Changes** page, which is what Tinkerbell did to
_Plex_: collections built, metadata written, files removed. This one is what you
did to Tinkerbell.

## Stress test — "how many streams can this server actually serve?"

Settings → Stress Test ramps real playback sessions against your Plex server,
one at a time, and stops when the server stops keeping up. The number it reports
is the last session count that was still healthy.

It is a genuine load test, not a simulation: each step starts a real transcode
(or a real direct-play stream), pulls the segments, and reports a timeline so
Plex counts the session. Expect real transcoding, disk and network load for the
duration, and don't run it while other people are watching.

Choose **Transcode**, **Direct Play**, or **Mixed** with a transcode share, and
a session cap (1–50). What each mode measures differs:

- **Transcode** watches the transcoder's speed. Below 1.0x it is producing less
  than a second of video per second of wall clock — the point a real viewer
  starts buffering.
- **Direct Play** has no transcoder to read, so it watches whether Plex is still
  reporting the sessions and whether the bytes are still flowing. A server that
  quietly kills streams under load shows up as sessions disappearing.

Watch-state hygiene is deliberate. Only never-watched items are used, and the
run marks every one of them unwatched again when it finishes — including when
you cancel it, or when it fails. Anything already watched or part-watched is
skipped rather than played, so the cleanup can never erase history you cared
about.

A step that looks degraded is re-measured before the run stops, so a single
unlucky reading doesn't understate your server. Runs are kept with their full
log, so a failed run can be read back afterwards.

**Watching it happen.** While a run is in flight the page becomes a live view of
what your server is doing: bandwidth (what Plex says it is sending against what
the harness actually receives — the two diverging is what a server failing to
deliver a stream it still reports looks like), encode speed with the slowest
single session shaded beneath the average, one lane per simulated session, and a
strip showing which phase each moment belonged to. When the run ends it keeps the
whole series, so an old run replays its charts and you can hover any moment to
read every number at that instant. The capacity curve — sessions against speed
and throughput — is drawn for every run, including ones recorded before any of
this existed.

**It stays out of your statistics.** The sessions are real ones as far as Plex is
concerned, so without care a twenty-session ramp would land in playback history
as twenty plays and put a spike in the bandwidth chart nobody watching caused.
Every simulated player carries a reserved client identifier, and the poller,
Stats, the per-user session lists and the bandwidth test all exclude them. A run
started while somebody is genuinely watching still records _their_ play.

## Running it unattended

Scheduled work runs through a background job queue. A few things worth knowing:

- **Schedules are timezone-aware.** Set the zone in Settings → Schedules; it
  falls back to `TZ`, then the container's clock. Cron expressions are evaluated
  in that zone, so "3am" means 3am there across daylight-saving changes.
- **Missed schedules run once on the next boot**, staggered a few seconds apart.
  On a server only powered on in the evenings, expect several jobs catching up
  at each boot — every decision is logged. Jobs scheduled more often than hourly
  are never caught up.
- **Every run has a deadline** (6h for preroll processing, 4h for generate,
  30min for most things). A watchdog fails anything past it, so one wedged job
  can't stop the queue forever.
- **Long jobs checkpoint.** `generate` and `sync-media` resume where they left
  off if the container restarts mid-run. Checkpoints expire after 24 hours, and
  cancelling a run discards its checkpoint — so an explicit cancel followed by
  "Run now" starts over rather than resuming.
- **Run one instance.** Cron schedules and the "already running" guard both
  assume a single process. Pointing two replicas at one database will
  double-fire every schedule.

**Logging:** `LOG_LEVEL` (`debug` | `info` | `warn` | `error`, default `info`)
controls verbosity, including the job engine's own output — raise it to `debug`
when a job misbehaves. Set `LOG_FORMAT=json` for one JSON object per line if you
ship container logs to a collector.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the stack, local setup, tests, and
release process.
