# Tinkerbell

> [!WARNING]
> Tinkerbell is in beta. Expect rough edges and changes between releases, and
> keep [backups](#backups) before upgrading.

Tinkerbell runs rules over your Plex library and turns them into collections,
playlists, poster overlays and cleanup. Everyone you share with gets their own
home screen, with rows picked from what they watch, and a portal where they sign
in with Plex to set their tastes. Groups can swipe through your films to agree
on one.

> [Screenshots](screenshots/) · [Development guide](DEVELOPMENT.md)

## Features

- **Rules**: build and update Plex collections and playlists from your library on a schedule.
- **Smart filters**: match on Plex metadata, IMDb ratings and Overseerr requests, or let AI draft one.
- **Collections**: control sort order, pin collections to the home screen, and shuffle hubs.
- **Overlays**: drag ratings, badges and labels onto a live poster preview, then apply in bulk.
- **Ready-made collections**: picks for each user from what they watch, plus holiday and leaving-soon rows. [More](#ready-made-collections)
- **Portal**: people you share with sign in with Plex to see their collections and set their tastes. [More](#the-portal)
- **Personalized home screens**: each Plex user sees only their own recommendations. [More](#personalized-home-screens)
- **Movie match**: a group swipes through a movie library until everyone likes the same film. [More](#movie-match)
- **Prerolls**: manage videos for Plex to play before a movie, converted if Plex can't play them. [More](#prerolls)
- **Problems**: one page for what's wrong across Plex, Radarr/Sonarr and your rules, with fixes. [More](#problems)
- **Labels**: apply and undo Plex labels in bulk, with a preview first.
- **Discover**: search TMDb, see what you already have, and send the rest to Radarr or Sonarr.
- **Watchlist sync**: send new Plex watchlist items to Radarr or Sonarr automatically.
- **Unused 4K**: find 4K films nobody watches in 4K and swap them to 1080p without a gap. [More](#unused-4k)
- **Home Assistant**: streams, jobs, failing rules and health as MQTT sensors. [More](#home-assistant)
- **Notifications**: Discord, Slack, Telegram, Gotify, Pushover, email, webhooks and more.
- **Backups**: nightly database backups, JSON export/import and a history of every change. [More](#backup-export-and-change-history)
- **Stats and events**: library stats, an activity feed and full playback history.
- **Stress test**: find how many streams your server can handle before it falls behind. [More](#stress-test)
- **Users**: invite people, choose their libraries, set limits and see or stop streams.
- **API and MCP**: a read-only API and MCP server for AI assistants and scripts. [More](#api-and-mcp)

## Contents

- [Install](#install)
- [Security](#security)
- [For your users](#for-your-users)
  - [The portal](#the-portal)
  - [Personalized home screens](#personalized-home-screens)
  - [Movie match](#movie-match)
- [Ready-made collections](#ready-made-collections)
  - [We think you'd like](#we-think-youd-like)
  - [Pick it back up](#pick-it-back-up)
  - [Finish the franchise](#finish-the-franchise)
  - [Your requests are here](#your-requests-are-here)
  - [Watch it again](#watch-it-again)
  - [New for you](#new-for-you)
  - [More from…](#more-from)
  - [Season collections](#season-collections)
  - [Leaving soon](#leaving-soon)
- [Library](#library)
  - [Problems](#problems)
  - [Unused 4K](#unused-4k)
  - [Prerolls](#prerolls)
- [Integrations](#integrations)
  - [API and MCP](#api-and-mcp)
  - [Home Assistant](#home-assistant)
- [Operations](#operations)
  - [Backup, export and change history](#backup-export-and-change-history)
  - [Stress test](#stress-test)
  - [Running unattended](#running-unattended)
- [Development](#development)

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

## For your users

What the people you share your server with get.

### The portal

The people you share your server with sign in to the portal with their Plex
account, in any browser. It runs on its own port (`3100`), separate from the
admin app, and only while a portal feature is on. There they can:

- see the collections Tinkerbell built for them, and press **Not for me** on any
  that miss;
- set their tastes, which steer their personal collections;
- see what's leaving soon;
- start or join a [movie match](#movie-match).

Set the portal's public address under **Settings → Portal → Address**.

### Personalized home screens

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

### Movie match

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

## Ready-made collections

Collections Tinkerbell builds for you, besides the ones your rules make. Most
are per user, built from what each person watches; the last two are one per
library.

### We think you'd like

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

### Pick it back up

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

### Finish the franchise

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

### Your requests are here

Each user gets a "Your Requests Are Here" collection in each library, holding
what they asked for in Overseerr that has arrived and they haven't watched
yet. Install it from **Jobs**. It runs every morning and uses no AI.

- A request is theirs when Overseerr's requester matches them on the Users
  page: by Plex account first, then by username, then by email. Requests from
  someone with no match are listed in the run log and get no collection.
- A film leaves the collection once they've watched it; a show once they've
  played any of it since it arrived. Anything that arrived more than **Keep
  for** (60 days) ago leaves either way.
- Newest arrivals come first. The collection is updated in place, removed
  when it's empty, and **Not for me** in the portal removes it.

Limits:

- It needs Overseerr, Personalized Home Screens and recorded watch history.
- It reads the 500 most recent available requests each run. An arrival has to
  be in the library index, so it shows after the next **Sync Media**.

### Watch it again

Each user gets a "Watch It Again" collection in each film library, holding
films they watched through and haven't played since — favourites they may be
ready to see again. Install it from **Jobs**. It runs every morning and uses
no AI.

- A film is in it when they finished it and haven't played it for **Not
  watched for** (2 years). A play of any copy, 4K or not, counts.
- The films they've rewatched most come first, then the better rated.
- The collection is updated in place, removed when it holds fewer than
  **Fewest items**, and **Not for me** in the portal removes it.

Limits:

- It needs Personalized Home Screens and recorded watch history. Most of
  what it looks back over happened before Tinkerbell, so run **Import Plex
  Watch History** once.
- Films only.

### New for you

Each user gets a "New For You" collection in each library, holding what was
added in the last **Added within** (30 days) that they haven't watched,
ordered by their taste. Plex's Recently Added is one list for everyone; this
is the same arrivals, theirs first. Install it from **Jobs**. It runs every
morning and uses no AI.

- With the built-in recommender on (Settings → AI), titles are ordered by how
  close they are to what the person watches. Without it, by how well they
  match their favourite genres.
- Someone with no history yet still gets a collection, newest first.
- Anything they've ever watched is left out. The collection is updated in
  place, removed when fewer than **Fewest items** are new to them, and **Not
  for me** in the portal removes it.

It needs Personalized Home Screens and recorded watch history.

### More from…

Each user gets up to **Rows per person** (2) collections in each film
library, such as "More from Denis Villeneuve", for the directors and lead
actors whose films they keep finishing. Each holds that person's films in
the library they haven't seen. Install it from **Jobs**. It runs every
morning and uses no AI.

- A name counts once the user has finished **Films seen to count** (2) of
  their films. Recent viewing counts for more than viewing years ago.
- Actors count only when billed in the top three, so a familiar face in a
  small part doesn't. **Include lead actors** off leaves directors only.
- A name with fewer than **Fewest items** unseen films in the library is
  skipped for the next one down.
- As favourites change, old collections are removed and new ones made. A
  collection for a name still on top is updated in place. **Not for me** on
  one of them in the portal drops that name, and the next one down takes its
  place.

It needs Personalized Home Screens, a TMDb API key and recorded watch
history. Each run asks TMDb for the filmography of every name in play, once
per name however many users share it.

### Season collections

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

### Leaving soon

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

## Library

Tools for keeping your Plex library in shape.

### Problems

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

### Unused 4K

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

### Prerolls

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

#### Portal preroll

**Settings → Portal → Preroll** makes a short video telling users where to find
the portal. It shows a message, the portal address and an optional QR code. It
plays alongside your other prerolls.

## Integrations

Ways for other tools to read Tinkerbell.

### API and MCP

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

### Home Assistant

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

## Operations

Keeping an instance safe and healthy.

### Backup, export and change history

#### Backups

A compressed copy of the database is made every night at 03:30, and the last 7
are kept. Configure it under **Settings → Backup & Restore**. In Docker, keep the
backup folder on a mounted volume.

To restore:

1. Stop the container.
2. Unzip the backup: `gunzip tinkerbell-20260820T033000.db.gz`
3. In your data folder, replace `tinkerbell.db` with the unzipped file. Delete
   `tinkerbell.db-wal` and `tinkerbell.db-shm` if they exist.
4. Start the container.

#### Export and import

Export saves your rules, job schedules, overlay presets and settings to a JSON
file that another Tinkerbell can import.

- Passwords and API keys are left out unless you tick the box to include them.
- Import shows a preview first. Items that differ from yours keep your version
  unless you choose otherwise.

#### Change history

Every change to a rule, setting, job schedule, overlay preset or preroll is
logged with its old value and who made it. See **Settings → Change History**, or
**Change history** in a rule's menu to restore an older version. Secrets are
hidden, and entries are kept for 180 days.

The **Changes** page is different: it lists what Tinkerbell did to Plex.

### Stress test

**Settings → Stress Test** starts real Plex streams one at a time until your
server can't keep up, then reports how many it handled.

- Modes: **Transcode**, **Direct Play** or **Mixed**. Up to 50 sessions.
- It puts real load on the server, so don't run it while people are watching.
- It only plays unwatched items, and marks them unwatched again afterwards.
- Test streams are left out of your stats and playback history.
- You can watch the run live and replay past runs.

### Running unattended

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

#### Logging

| Variable     | Values                                     |
| ------------ | ------------------------------------------ |
| `LOG_LEVEL`  | `debug`, `info` (default), `warn`, `error` |
| `LOG_FORMAT` | `json` for one JSON object per line        |

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).
