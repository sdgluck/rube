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
- **Notifications** — Discord, Slack, Telegram, Gotify, Pushbullet, Pushover,
  LunaSea, and generic webhooks.
- **Stats & events** — library stats, an activity feed, and playback history.
- **Multi-user** — per-user settings and integrations (Plex, \*Arrs, Overseerr).

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
