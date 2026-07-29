#!/bin/bash
# Snapshot the whole library into a single tarball.
#
# The database is copied with SQLite's online-backup API rather than `cp`,
# so the snapshot is consistent even while the server is running and WAL
# writes are in flight. A plain copy of library.db can miss the -wal tail.
#
# usage: scripts/backup.sh [destination-dir]   (default: $DATA_PATH/../backups)

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
[[ -f "$root/.env" ]] && source "$root/.env"

DATA_PATH="${DATA_PATH:-$root/data}"
CONTAINER="${CONTAINER:-library-book}"
dest="${1:-$(dirname "$DATA_PATH")/backups}"

[[ -d "$DATA_PATH" ]] || {
    echo "data directory not found: $DATA_PATH" >&2
    exit 1
}

stamp="$(date +%Y%m%d-%H%M%S)"
stage="$DATA_PATH/tmp/backup-$stamp"
archive="$dest/library-book-$stamp.tar.gz"

cleanup() {
    rm -rf "$stage"
}
trap cleanup EXIT INT TERM

mkdir -p "$dest" "$stage/db"

# Consistent db snapshot. Prefer the running container (it owns the write
# lock); fall back to a host-side sqlite3 if the stack is down.
snapshot='
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
with sqlite3.connect(f"file:{src}?mode=ro", uri=True) as s, sqlite3.connect(dst) as d:
    s.backup(d)
'
if docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    docker exec "$CONTAINER" python -c "$snapshot" \
        /data/db/library.db "/data/tmp/backup-$stamp/db/library.db"
else
    python3 -c "$snapshot" "$DATA_PATH/db/library.db" "$stage/db/library.db"
fi

[[ -s "$stage/db/library.db" ]] || {
    echo "database snapshot is empty - aborting" >&2
    exit 1
}

# db comes from the snapshot; everything else is immutable-once-written.
tar -czf "$archive" \
    -C "$stage" db \
    -C "$DATA_PATH" library covers

echo "$archive"
du -h "$archive" | cut -f1
