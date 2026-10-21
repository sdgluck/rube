#!/bin/sh
set -e

PUID=${PUID:-99}
PGID=${PGID:-100}

if ! getent group "$PGID" >/dev/null 2>&1; then
  addgroup -g "$PGID" app
fi
if ! getent passwd "$PUID" >/dev/null 2>&1; then
  adduser -D -u "$PUID" -G "$(getent group "$PGID" | cut -d: -f1)" app
fi

chown -R "$PUID:$PGID" /config
# Prerolls are written here by Rube and read by Plex, so it needs the
# same ownership treatment. Skipped when the volume isn't mounted.
[ -d /prerolls ] && chown -R "$PUID:$PGID" /prerolls

# Apply pending DB migrations as a discrete step before the app process
# starts. Runs as the app user so the DB file picks up the right ownership.
su-exec "$PUID:$PGID" node node_modules/@rube/db/src/migrate.ts

exec su-exec "$PUID:$PGID" "$@"
