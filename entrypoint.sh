#!/bin/sh
set -eu

# library-book entrypoint: prepare the data volume, optionally drop privileges,
# then exec the server. Single-user, no auth.

DATA_DIR="${DATA_DIR:-/data}"
USER_ID="${USER_ID:-1000}"
GROUP_ID="${GROUP_ID:-1000}"

mkdir -p \
    "$DATA_DIR/db" \
    "$DATA_DIR/library/books" \
    "$DATA_DIR/library/papers" \
    "$DATA_DIR/covers" \
    "$DATA_DIR/import/.failed" \
    "$DATA_DIR/import/.processing" \
    "$DATA_DIR/tmp"

# If running as root, fix ownership and drop to the requested UID/GID.
if [ "$(id -u)" = "0" ]; then
    chown -R "$USER_ID:$GROUP_ID" "$DATA_DIR" 2>/dev/null || true
    exec su-exec "$USER_ID:$GROUP_ID" "$@"
fi

exec "$@"
