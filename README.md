# library-book

A self-hosted, **single-user, no-login** reading library for both **e-books and academic papers**. Read PDFs and EPUBs in the browser, track reading progress and statistics, organize with shelves and tags, auto-fetch metadata (arXiv / Crossref / Google Books / Open Library), highlight and bookmark, and browse from external readers over OPDS.

Inspired by [BookLore](https://github.com/booklore-app/booklore), but deliberately lightweight: one Docker image, a single SQLite file, no auth, no external database.

## Features

- **Readers** - In-browser PDF (pdf.js) and EPUB (epub.js) readers. Reading position is saved and restored per document (PDF page + scroll, EPUB CFI).
- **Reading statistics** - Time tracked via reading sessions (heartbeat while the tab is active), with a dashboard: total time, current/longest streak, items finished, a minutes-per-day bar chart, and a GitHub-style calendar heatmap.
- **Library & organization** - Cover grid, books vs papers, shelves/collections, tags, and full-text search (SQLite FTS5) across titles, authors, abstracts, and tags.
- **Metadata** - Auto-fetch for papers (arXiv ID, DOI via Crossref) and books (ISBN / title via Google Books and Open Library), with cover download. Per-document metadata locking. Export **BibTeX / RIS / APA** citations.
- **Annotations** - Highlights and bookmarks in both PDF and EPUB, saved per document.
- **Watch-folder import** - Drop files into `data/import/` (or `data/import/papers/`) and they are imported automatically. UI drag-and-drop upload too.
- **OPDS feed** - Point KOReader, Thorium, Marvin, etc. at `/opds` to browse and download.

## Stack

- **Backend**: Python / FastAPI / SQLAlchemy / SQLite (WAL). PyMuPDF for PDF, ebooklib for EPUB, watchdog for the import folder, APScheduler for the session sweeper.
- **Frontend**: React + TypeScript + Vite, TanStack Query, Tailwind CSS, Recharts, pdfjs-dist, epub.js.
- **Deploy**: one multi-stage Docker image (React built and served as static files by FastAPI), one `/data` volume.

## Quick start (Docker)

```bash
git clone <this-repo> library-book
cd library-book
cp .env.example .env      # set DATA_PATH to the disk you back up
docker compose up --build -d
```

Open <http://localhost:8000>. Upload a PDF or EPUB, or drop files into `$DATA_PATH/import/`.

Everything persists under `DATA_PATH` (host) / `/data` (container), which
defaults to `./data`:

```
data/
  db/library.db        # SQLite database
  library/books/       # managed e-book files
  library/papers/      # managed paper files
  covers/              # generated cover + thumbnail images
  import/              # WATCH FOLDER - drop files here (papers/ subfolder = papers)
    .failed/           # files that couldn't be imported land here
```

### Tailscale (optional): its own hostname, so it installs as a PWA

The app is built to live at the root of an origin - absolute asset paths,
`start_url: "/"`, service worker at root scope. Hanging it off a sub-path of
a host you already use (`https://host/library`) would mean rebuilding the
frontend with a `base`, and the install would still share cookies,
localStorage, IndexedDB, and service-worker registration with whatever else
lives on that origin. A separate hostname avoids all of it.

The `tailscale` profile starts a sidecar that joins your tailnet as its own
node and proxies `:443` to the app:

```bash
docker compose --profile tailscale up -d
docker compose logs tailscale      # prints a login URL on first run
```

Set `TS_HOSTNAME` in `.env` (default `library`) and the library answers on
`https://library.<your-tailnet>.ts.net` - HTTPS via Tailscale's certs, so
the browser offers "install app" with no warnings. Point `TS_STATE_PATH` at
the same disk as `DATA_PATH` and a restore brings the node identity back
too, keeping the URL stable across machines. Tailnet-only by default; the
serve config does not enable Funnel.

### Backup and moving to another machine

One directory is the entire library, so a backup is one tarball and a
restore is one copy:

```bash
scripts/backup.sh                 # -> $DATA_PATH/../backups/library-book-<stamp>.tar.gz
scripts/backup.sh /mnt/usb/bak    # or anywhere else
```

The script snapshots SQLite through its online-backup API, so it is safe to
run while the server is up (a plain `cp` of a WAL database can tear).

The tarball holds `db/`, `library/`, and `covers/` - the whole library.
`import/` and `tmp/` are scratch space and are recreated on boot.

To bring the library up on a new machine:

```bash
git clone <this-repo> library-book && cd library-book
cp .env.example .env               # point DATA_PATH at the new disk
set -a && . ./.env && set +a       # load DATA_PATH into this shell

mkdir -p "$DATA_PATH"
tar -xzf /path/to/library-book-<stamp>.tar.gz -C "$DATA_PATH"

docker compose up --build -d
```

Reading progress, annotations, shelves, tags, and statistics all live in
`db/library.db`, so nothing is lost - the app comes back exactly where it
was. File paths in the database are relative to `DATA_DIR`, so the host
directory can change freely.

**If you use the Tailscale profile**, mind the hostname. It is what an
installed PWA is bound to, and a PWA cannot follow a URL change - a new
origin is a new app, with new storage. Either:

- copy `TS_STATE_PATH` across as well (it is *not* in the tarball - it holds
  the node's private keys, so treat it like a secret), and the machine comes
  back as the same node; or
- delete the dead node in the [admin console](https://login.tailscale.com/admin/machines)
  *before* starting the new one, and re-authenticate. Skip this and the name
  `library` is still taken, so the new node becomes `library-1` and your
  installed app points at nothing.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `/data` | Root data directory (everything lives here) |
| `WATCH_ENABLED` | `true` | Enable the import watch folder |
| `METADATA_FETCH_ENABLED` | `true` | Enable external metadata lookups |
| `CROSSREF_MAILTO` | _(empty)_ | Your email for the Crossref "polite pool" (recommended) |
| `GOOGLE_BOOKS_API_KEY` | _(empty)_ | Optional, raises Google Books rate limits |
| `SESSION_PING_INTERVAL` | `30` | Reader heartbeat interval (seconds) |
| `USER_ID` / `GROUP_ID` | `1000` | UID/GID to own the data volume and run as |
| `TZ` | `UTC` | Timezone |
| `LOG_LEVEL` | `info` | Log level |

No login is required - this is a single-user instance. Put it behind a reverse proxy (and your own auth, e.g. forward-auth) if you expose it publicly.

## Local development

Two processes: FastAPI on `:8000`, Vite dev server on `:5173` (which proxies `/api`, `/opds`, `/covers` to the backend).

```bash
# backend
cd backend
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
DATA_DIR=./devdata .venv/bin/uvicorn app.main:app --reload --port 8000

# frontend (separate terminal)
cd frontend
npm install
npm run dev    # open http://localhost:5173
```

To test the production bundle locally, `npm run build` then copy `frontend/dist` to `backend/static`; FastAPI serves the SPA at `/`.

## API overview

All under `/api` (OPDS under `/opds`, covers under `/covers`):

- `documents` - list/filter/upload/get/update/delete, `/file` (Range), `/cover`, `/citation`
- `documents/{id}/progress` - get/save reading position
- `sessions` - `start` / `{id}/ping` / `{id}/end` (drives stats)
- `stats` - `summary`, `timeseries`, `heatmap`
- `shelves`, `tags`, `search`, `metadata/search`, `metadata/apply/{id}`
- `documents/{id}/annotations`, `annotations/{id}`
- `import/status`, `import/scan`
- `opds`, `opds/recent`, `opds/unread`, `opds/shelves[/{id}]`, `opds/search`
