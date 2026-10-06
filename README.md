# Tinkerbell

A self-hosted companion for Plex. You write rules over your library, and
Tinkerbell uses them to manage collections, overlays, labels, playlists, cleanup
and notifications on a schedule.

> [Screenshots](screenshots/) · [Development guide](DEVELOPMENT.md)

## Features

- **Rules**: build Plex collections from your library on a schedule, with a
  history of every run.
- **Smart filters**: match on Plex metadata, IMDb ratings and Overseerr
  requests, or describe a filter in words and let AI build it.
- **Collections**: sort order, pinning to the home screen, and shuffled hubs.
- **Overlays**: draw ratings, badges and labels on posters.
- **Because you watched**: recommendation collections for each user.
- **Personalized home screens**: each Plex user sets their own tastes.
  [More](#personalized-home-screens)
- **Prerolls**: upload videos for Plex to play before a movie.
  [More](#prerolls)
- **Labels**: apply and undo Plex labels in bulk, with a preview.
- **Discover**: search TMDb, see what Plex and Radarr/Sonarr already have, and
  send the rest to Radarr or Sonarr.
- **Watchlist sync**: send new Plex watchlist items to Radarr or Sonarr.
- **Notifications**: Discord, Slack, Telegram, Gotify, Pushbullet, Pushover,
  LunaSea, email and webhooks.
- **Backup, export and change history**.
  [More](#backup-export-and-change-history)
- **Stats and events**: library stats, an activity feed and playback history.
- **Stress test**: find how many streams your server can handle.
  [More](#stress-test)
- **Users**: invite people, choose their libraries, set limits, and see or stop
  what they're streaming.

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

| Item        | Value                                                    |
| ----------- | -------------------------------------------------------- |
| Images      | `linux/amd64`, `linux/arm64` on GHCR                     |
| Tags        | `latest` and version tags per release; `edge` per commit |
| Port `3000` | Admin app                                                |
| Port `3100` | User portal                                              |
| `/config`   | Database and settings                                    |
| `/prerolls` | Optional. Only for prerolls; mount it into Plex too      |
| `PUID/PGID` | Owner of `/config`. Default `99:100`                     |
| `TZ`        | Timezone for schedules. Jobs → Schedule can override it  |

To build the image yourself: `docker build -t tinkerbell .`

### Unraid

1. Download the template:

   ```sh
   wget -O /boot/config/plugins/dockerMan/templates-user/my-Tinkerbell.xml \
     https://raw.githubusercontent.com/sdgluck/tinkerbell/master/unraid/tinkerbell.xml
   ```

2. Go to **Docker → Add Container** and choose `Tinkerbell` under
   _User templates_.
3. Check the paths and click **Apply**.

Defaults: `/config` → `/mnt/user/appdata/tinkerbell`, `/prerolls` →
`/mnt/user/prerolls` (map the same host path into Plex).

## Security

### Admin sign-in

Admin sign-in is off by default. Turn it on under **Settings → Security**. After
that, only the Plex account that owns your server can sign in.

- Sessions last 7 days and renew while you use the app.
- The user portal has its own separate sign-in.
- **Locked out?** Set `TINKERBELL_DISABLE_AUTH=1` and restart. Remove it once
  you're back in.

### Network

| Variable    | Default        | Meaning                                             |
| ----------- | -------------- | --------------------------------------------------- |
| `HOST`      | `127.0.0.1`    | Admin app address. The Docker image sets `0.0.0.0`. |
| `PORT`      | `3000`         | Admin app port                                      |
| `USER_HOST` | same as `HOST` | Portal address                                      |
| `USER_PORT` | `3100`         | Portal port                                         |

- **Don't expose port `3000` to the internet** unless admin sign-in is on.
- Port `3100` (the portal) is safe to expose. It only runs while a portal
  feature is on.
- Set the portal's public address under **Settings → Portal → Address**.

## API and MCP

AI assistants and scripts can read a Tinkerbell instance through a read-only
API. Create a key under **Settings → API & MCP**; the page shows the exact
command to connect.

- **MCP** at `http://<host>:3000/mcp` (Streamable HTTP). For Claude Code:
  `claude mcp add --transport http tinkerbell http://<host>:3000/mcp --header "Authorization: Bearer <key>"`
- **JSON over HTTP** at `/api/v1/tools/<tool>` — `GET` with query parameters
  or `POST` with a JSON body. `/api/v1` lists the tools and
  `/api/v1/openapi.json` describes them.
- Send the key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`. A key is
  always required, even with admin sign-in off.
- Tools cover rules and their runs (logs, changes, why an item does or doesn't
  match), jobs, collections, media, cleanup, health, events, library changes,
  watch statistics, users, AI usage and settings. Secrets stay redacted, and
  nothing can be changed.
- Keys are stored hashed and shown once. Revoke one and it stops working
  immediately. Keys aren't included in an export.

## Personalized home screens

Each user gets their own recommendation collections, and only they can see them.
Turn it on under **Settings → Personalization**.

- **Enable** labels your libraries and limits each shared user to their own
  collections. Each user's previous sharing settings are saved first.
- **Disable** removes the per-user collections and restores those settings.
- Users set their tastes in the portal by signing in with Plex. Admins can also
  set them under **Settings → User Preferences**.

Limits:

- The server owner can't be restricted, so the owner sees everyone's
  collections.
- Click **Reconcile users** after sharing with someone new.

## Prerolls

A preroll is a short video that Plex plays before a movie. Prerolls need Plex
Pass.

1. Mount the same folder into both Tinkerbell and Plex:

   ```yaml
   services:
     tinkerbell:
       volumes:
         - ./prerolls:/prerolls
     plex:
       volumes:
         - ./prerolls:/prerolls
   ```

2. If Plex mounts the folder at a different path, enter that path under
   **Settings → Prerolls**.
3. Upload videos on the **Prerolls** page.

Videos that Plex can't play directly are converted to H.264/AAC MP4. The Docker
image includes `ffmpeg`; outside Docker, install it yourself. Set
`PREROLLS_DIR` to change where Tinkerbell keeps prerolls.

### Portal preroll

**Settings → Portal → Preroll** makes a short video telling users where to find
the portal. It shows a message, the portal address and an optional QR code. It
plays alongside your other prerolls.

## Backup, export and change history

### Backups

A compressed copy of the database is made every night at 03:30, and the last 7
are kept. Configure it under **Settings → Backup & Restore**. In Docker, keep the
backup folder on a mounted volume.

To restore:

1. Stop the container.
2. Unzip the backup: `gunzip tinkerbell-20260820T033000.db.gz`
3. In your data folder, replace `tinkerbell.db` with the unzipped file. Delete
   `tinkerbell.db-wal` and `tinkerbell.db-shm` if they exist.
4. Start the container.

### Export and import

Export saves your rules, job schedules, overlay presets and settings to a JSON
file that another Tinkerbell can import.

- Passwords and API keys are left out unless you tick the box to include them.
- Import shows a preview first. Items that differ from yours keep your version
  unless you choose otherwise.

### Change history

Every change to a rule, setting, job schedule, overlay preset or preroll is
logged with its old value and who made it. See **Settings → Change History**, or
**Change history** in a rule's menu to restore an older version. Secrets are
hidden, and entries are kept for 180 days.

The **Changes** page is different: it lists what Tinkerbell did to Plex.

## Stress test

**Settings → Stress Test** starts real Plex streams one at a time until your
server can't keep up, then reports how many it handled.

- Modes: **Transcode**, **Direct Play** or **Mixed**. Up to 50 sessions.
- It puts real load on the server, so don't run it while people are watching.
- It only plays unwatched items, and marks them unwatched again afterwards.
- Test streams are left out of your stats and playback history.
- You can watch the run live and replay past runs.

## Running unattended

- **Timezone:** set it in **Jobs → Schedule**. Otherwise `TZ` is used.
- **Missed schedules** run once at the next start. Jobs that run more often than
  hourly are skipped.
- **Time limits:** a job that runs too long is stopped (most jobs: 30 minutes;
  generate: 4 hours; preroll processing: 6 hours).
- **Restarts:** `generate` and `sync-media` carry on where they stopped if
  restarted within 24 hours. Cancelling a run starts it over next time.
- **Job settings** are on each job's page. Add optional features from
  **Jobs → Add Feature**.
- **Run one copy only.** Two copies on the same database will run every job
  twice.

### Logging

| Variable     | Values                                     |
| ------------ | ------------------------------------------ |
| `LOG_LEVEL`  | `debug`, `info` (default), `warn`, `error` |
| `LOG_FORMAT` | `json` for one JSON object per line        |

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).
