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

exec su-exec "$PUID:$PGID" "$@"
