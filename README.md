# Tinkerbell

A self-hosted companion for Plex. You write rules over your library, and
Tinkerbell uses them to manage collections, overlays, labels, playlists, cleanup
and notifications on a schedule.

> [Screenshots](screenshots/) · [Development guide](DEVELOPMENT.md)

## Features

- **Rules**: build Plex collections from your library on a schedule, with a
  history of every run.
- **Smart filters**: match on Plex metadata, IMDb ratings, Overseerr
  requests, or let AI build with prompts. Describe a filter in a sentence and
  AI drafts the clauses for you to check, using your library's own genres and
  users.
- **Collections**: sort order, pinning to the home screen, and shuffled hubs.
- **Overlays**: draw ratings, badges and labels on posters.
- **Because you watched**: recommendation collections for each user.
- **We think you'd like**: one collection per user per library, picked by AI
  from their recent watch history. [More](#we-think-youd-like)
- **Pick it back up**: one collection per user per TV library of the shows
  they started and stopped watching. [More](#pick-it-back-up)
- **Finish the franchise**: one collection per user per film library of the
  next film in each series they've started. [More](#finish-the-franchise)
- **Season collections**: a Christmas, Halloween or other holiday collection
  in each library while the holiday is on. [More](#season-collections)
- **Leaving soon**: a collection in each library of what cleanup is about to
  remove. [More](#leaving-soon)
- **Personalized home screens**: each Plex user sets their own tastes.
  [More](#personalized-home-screens)
- **Movie match**: a group swipes through a movie library together until
  everyone likes the same film. [More](#movie-match)
- **Prerolls**: upload videos for Plex to play before a movie.
  [More](#prerolls)
- **Problems**: one page for what is wrong across Plex, Radarr/Sonarr and your
  rules. [More](#problems)
- **Labels**: apply and undo Plex labels in bulk, with a preview.
- **Discover**: search TMDb, see what Plex and Radarr/Sonarr already have, and
  send the rest to Radarr or Sonarr.
- **Watchlist sync**: send new Plex watchlist items to Radarr or Sonarr.
- **Unused 4K**: find 4K films nobody watches in 4K and swap them to 1080p
  without a gap. [More](#unused-4k)
- **Home Assistant**: streams, jobs, failing rules and health as MQTT
  sensors. [More](#home-assistant)
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

## Unused 4K

**Managers → Unused 4K** lists 4K films that nobody has watched in 4K: every
play was a transcode, or there were none. Films added in the last 30 days are
left out, and so is any film with a play whose details weren't recorded.

Radarr doesn't downgrade a film by itself, so Tinkerbell runs the swap:

1. Sets the 1080p quality profile you picked.
2. Searches for a 1080p release, one film at a time.
3. Grabs Radarr's best acceptable 1080p release.
4. Once the download finishes, imports it over the 4K file.

The 4K file stays until that import, which deletes it or moves it to Radarr's
recycle bin. If a swap fails or you cancel it, the original profile is put
back. Each swap's progress is on the page. "4K Replaced With 1080p" and "4K
Replacement Failed" are available as notifications.

## Home Assistant

Tinkerbell can publish its state to an MQTT broker with Home Assistant
discovery. Turn it on under **Settings → Home Assistant** with the broker's
address (the Mosquitto add-on listens on `mqtt://<ha-host>:1883`).

- A **Tinkerbell** device appears in Home Assistant by itself, with streams,
  transcodes, stream bandwidth, now playing (each session is an attribute),
  the current job, a "working" sensor, failing rules, problems, cleanup due
  soon, services down, library totals and the version.
- It is publish-only. Tinkerbell never subscribes to anything, so nothing on
  the broker can make it act.
- State updates within 30 seconds of a change. Messages are retained, so a
  restarted Home Assistant gets the current state straight away. While
  Tinkerbell is stopped, its entities show as unavailable.
- Change the topic prefix to run a second Tinkerbell against the same broker.
  The entities under the old prefix are removed.

## Mobile apps

Tinkerbell has one phone app, for iOS and Android. The people you share your
server with use its **Portal** part: their collections, tastes, movie match and
what's leaving soon. If you run the server, the same app also has an **Admin**
part, with a switch between the two.

- **Connecting yourself.** Open **Settings → Mobile app** in a browser and scan
  the code with your phone. The code carries both the admin and the portal
  address.
- **Connecting the people you share with.** Save the portal's address under
  **Settings → Portal → Address**. A code for the portal then appears there.
  Either way, you can also type an address into the app, and the app always
  asks before it connects to a server.
- **Signing in.** You sign in with Plex inside the app. The app then signs in
  to the portal and to the admin server separately, and each one checks your
  Plex account for itself. The portal never learns the admin address, and a
  portal session can't open the admin part. The app keeps its sessions in the
  phone's keychain and doesn't keep your Plex token at all.
- **Movie match invites.** An invite link opens in the app if it's installed,
  even for a room on someone else's server, where you join as a guest. Without
  the app, the link opens the web portal.
- **The admin part** covers the overview and health, jobs and rule runs,
  cleanup and protections, collections, and users. Everything else has a link
  to the web admin.
- **App lock.** You can turn on Face ID, Touch ID or fingerprint unlock in the
  app's settings.
- **At home and away.** On your home network, a plain address like
  `http://192.168.1.10:3000` works. Away from home, your phone needs an address
  that reaches the server from outside, served over HTTPS by a reverse proxy.
  The admin server listens only on `127.0.0.1` unless you set `HOST`, and a
  phone can't reach that. **Settings → Mobile app** warns when that is the case.
- **Admin sign-in.** Turn on admin sign-in before you make the admin server
  reachable from outside. The admin part still works with sign-in off, but it
  shows a warning that anyone who can reach the server can change it.

**Upgrading from the old apps.** Tinkerbell used to have two separate phone
apps, "Tinkerbell" and "Tinkerbell Portal". They are replaced by the one app
above, and no longer work with this version of the server. Install
the new app and connect it with the code in **Settings → Mobile app**.

The app's sign-in hands the session back to the app itself, so the server
refuses it from a web browser. Exposing the server for the app doesn't let a
web page sign in on anyone's behalf.

## Personalized home screens

Each user gets their own recommendation collections, and only they can see them.
Turn it on under **Settings → Personalization**.

- **Enable** labels your libraries and limits each shared user to their own
  collections. Each user's previous sharing settings are saved first.
- **Disable** removes the per-user collections and restores those settings.
- Users set their tastes in the portal by signing in with Plex. Admins can also
  set them under **Settings → User Preferences**.
- Mark a rule **Personalizable** and every run of it also builds a copy for each
  user who opted in, without the titles they excluded, pinned to their Home.

Limits:

- The server owner can't be restricted. Your Home and each library's
  Recommended tab show only your own rows, but each library's Collections list
  shows everyone's.
- Plex has one Recommended setting per row for everyone, so a shared user's rows
  appear on their Home and not on their Recommended tab.
- Click **Reconcile users** after sharing with someone new.

## We think you'd like

Each user gets one "We Think You'd Like" collection in each library. The AI
picks it from their taste over the whole history window, not from the last few
things they watched. Install it from **Jobs**. It runs weekly.

- The taste comes from Tinkerbell's own playback history: genres, eras and
  ratings of what each person watches, weighted toward what they finish and
  watched recently. A film they gave up on early counts against its genres.
- Nothing they have already played is picked. A user's portal preferences
  steer the picks, and **Not for me** on the row removes it.
- The collection's description in Plex says what the picks have in common.
- A run updates each collection in place, so it keeps its pin and position. If
  the AI's answer is unusable, last week's collection is kept.

Limits:

- It needs Personalized Home Screens, an AI provider and recorded watch
  history. On a new install, run **Import Plex Watch History** first.
- Users who watched fewer titles than the **Least history** setting in the
  window are skipped.
- Playback retention limits how far back it can read.

## Pick it back up

Each user gets a "Pick It Back Up" collection in each TV library, holding the
shows they started and then stopped watching. Plex's Continue Watching only
holds what someone watched lately; this brings back the show they drifted away
from three weeks ago. Install it from **Jobs**. It runs nightly and uses no AI.

- A show is in it when the user last played it between **Stopped after** (14
  days) and **Given up after** (365 days) ago, finished at least two episodes,
  and still has episodes left. Shows they are still watching, only tried, have
  finished or left long ago are not.
- The collection's description in Plex names the next episode of the first few
  shows. A show they stopped partway through an episode picks up on that
  episode.
- A run updates each collection in place, so it keeps its pin and position.
  When nothing is left in it, the collection is removed. It comes back when
  there is something to pick up.
- **Not for me** on the row in the portal removes it, and the user's excluded
  titles are left out.

Limits:

- It needs Personalized Home Screens and recorded watch history. On a new
  install, run **Import Plex Watch History** first.
- It reads Tinkerbell's own playback history, so playback retention limits how
  far back **Given up after** can reach.

## Finish the franchise

Each user gets a "Finish the Franchise" collection in each film library,
holding the next film in each series they've started — watched Alien and
Aliens, and Alien 3 is waiting. Install it from **Jobs**. It runs every
morning and uses no AI.

- "Next" is the first film after the furthest one they've finished, in
  release order, using TMDb's collections. Someone who skipped from Alien to
  Alien 3 is offered Alien Resurrection, not Aliens.
- When the next film isn't in the library, that series is left out rather
  than skipping ahead. **Skip gaps** offers the one after it instead.
- Films not yet released aren't offered. A series nobody has played for
  **Left alone after** (365 days) drops out.
- Most recently watched series come first. The collection is updated in
  place, removed when there is nothing next, and **Not for me** in the portal
  removes it.

Limits:

- It needs Personalized Home Screens, a TMDb API key and recorded watch
  history. On a new install, run **Import Plex Watch History** first.
- A film is matched by its TMDb id from the library index, so run **Sync
  Media** first. A watched film that has since been deleted still counts when
  Radarr remembers it.

## Season collections

Each library gets a collection for a holiday while it is on, such as
"Christmas" from 1 to 26 December, and loses it the morning after. Install it
from **Jobs**. It runs every morning.

- A title is in a holiday's collection when TMDb files it under one of that
  holiday's keywords, such as _christmas_ or _santa claus_. The release month
  doesn't count.
- The built-in seasons are Christmas, Halloween, Valentine's Day, New Year's
  Eve, Thanksgiving and Summer. Thanksgiving and Summer are off by default.
- On the job's **Seasons** card you can turn a season on or off, rename it,
  change its dates and pick its keywords from TMDb. **Reset** puts a built-in
  season back to how it shipped. **Add a season** makes one of your own, for
  example Easter or Diwali.
- When a season's keywords find fewer titles than **Fewest items** and an AI
  provider is set, the AI suggests more from the library. Titles already in
  the collection stay in it, so the AI is usually asked once per season.
- **Who it's for** is _Everyone_ (the default): one collection that everybody
  sees. _Each person_ gives every user "Christmas picks for you", ordered by
  their own watch history.
- A run updates each collection in place, so it keeps its pin and position
  while the season lasts.

Limits:

- It needs a TMDb API key. The first run reads TMDb details for every title in
  the library, which takes a while on a big one; the cache is shared with the
  grouped rules.
- _Each person_ needs Personalized Home Screens. **Not for me** on the row in
  the portal removes it for that user.
- A date window repeats every year on the same days, so a holiday whose date
  moves, such as Easter, needs its dates updating each year.

## Leaving soon

Each library gets a "Leaving Soon" collection on everyone's home screen,
holding the titles cleanup rules are about to remove — a last chance to watch
them. Install it from **Jobs**. It runs every morning, after the night's
cleanup.

- It shows exactly what the Cleanup page says will go: titles from rules that
  delete or unmonitor, which aren't held, protected or waiting for approval.
  The portal's Leaving soon tab and the digest use the same list.
- **Look ahead** (6 runs) sets how far ahead it looks. A rule's streak
  advances once a day, so that is about a week. Soonest first.
- The collection is updated in place. Titles leave it once they are removed
  or spared, and it is taken down when nothing is leaving.
- While cleanup is switched off, or the library index is too stale for
  cleanup to act, nothing is leaving and there is no collection.

Removing the feature deletes its collections only. What cleanup removes is
unchanged.

## Movie match

A group picks a film by swiping through one of your movie libraries in the
portal. A film everyone in the room likes is a match. Turn it on under
**Settings → Portal → Movie match**. It is off by default.

- Only users of your Plex server can make a room, and only from a movie library
  shared with them. They can narrow the films by genre, length and release year,
  or start from a suggestion such as "hidden gem Thriller of the 90s".
- Everyone in a room sees the films in the same shuffled order. Swiping right
  likes a film and swiping left skips it. The arrow keys and the buttons under
  the card do the same.
- **Invite link**: anyone with a room's link can join as a guest with just a
  name. They don't need a Plex account. A guest sees that room's films (titles,
  posters and synopses) and nothing else in the portal. They can't play
  anything.
- **Room code**: typing a room's four-letter code works only for a user of your
  server who already has the room's library.
- Matches list the films everyone liked, then the films more than one person
  liked. Each person can vote for one of them.

Limits:

- Guests open the link in a browser, so the portal must be reachable from where
  they are. Set its public address under **Settings → Portal → Address**.
- A room closes after 30 days without a visit. It also closes when whoever made
  it loses access to its library or leaves your server.

## Problems

**Library → Problems** lists what is wrong across Plex, Radarr/Sonarr and your
rules. Some problems have a **Fix** button. The rest link to where you can fix
them. Dismiss anything you mean to leave as it is.

- **Episode ordering doesn't match your files.** Plex numbers some shows from
  TMDb, and Sonarr names files from TheTVDB. Where they differ, files land on the
  wrong episodes in Plex. The Office (US) is the usual example: its hour-long
  episodes are split in two on TheTVDB. Fix sets the show's episode ordering to
  TheTVDB (Aired) and refreshes it. Shows on a legacy Plex agent can't be fixed
  this way.
- **Episodes missing from Plex**: Sonarr has a file that Plex doesn't list.
  Fix scans the show's folder.
- **File sizes unknown**: Plex has no size for some of a show's episodes. Fix
  asks Plex to analyse the show.
- **Downloaded but not in Plex**, **failed imports**, **rules that failed or
  stopped matching**, and **rules in conflict**.
- For information only: items Plex couldn't match, items on a legacy agent,
  items no Radarr or Sonarr manages, and films held by more than one instance.

Limits:

- Nothing is fixed until you press Fix. Each fix changes Plex.
- Comparing episodes takes two requests per show. It runs as the **Scan for
  Problems** job at 00:50 each night, or when you press **Scan now**. After the
  first run it only rechecks shows that changed. Every other check runs when
  you open the page.
- A dismissed problem comes back if its details change, for example if a second
  season starts to disagree.
- New problems can be sent as a **New Problems Found** notification. Each one is
  sent once, not every night.

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
