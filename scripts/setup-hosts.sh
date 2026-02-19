#!/usr/bin/env bash
# Ensures tinkerbell.local resolves to 127.0.0.1.
# Run once per machine: yarn dev:setup

HOSTNAME="tinkerbell.local"
ENTRY="127.0.0.1 $HOSTNAME"

if grep -qF "$HOSTNAME" /etc/hosts 2>/dev/null; then
  echo "$HOSTNAME already in /etc/hosts"
  exit 0
fi

echo "Adding $ENTRY to /etc/hosts (requires sudo)..."
echo "$ENTRY" | sudo tee -a /etc/hosts >/dev/null
echo "Done. $HOSTNAME now resolves to 127.0.0.1"
