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
docker compose up --build -d
```

Open <http://localhost:8000>. Upload a PDF or EPUB, or drop files into `./data/import/`.

Everything persists under `./data`:

```
data/
  db/library.db        # SQLite database
  library/books/       # managed e-book files
  library/papers/      # managed paper files
  covers/              # generated cover + thumbnail images
  import/              # WATCH FOLDER - drop files here (papers/ subfolder = papers)
    .failed/           # files that couldn't be imported land here
```

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
