"""FastAPI application entry point.

Mounts the API/OPDS routers, serves the built React SPA with a client-side
routing fallback, runs the reading-session sweeper, and starts the watch
folder. No authentication: single-user, fully open.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import settings
from .database import init_db
from .routers import (
    annotations,
    documents,
    import_,
    metadata,
    notebook,
    opds,
    progress,
    search,
    sessions,
    settings_router,
    shelves,
    stats,
    tags,
)
from .routers.sessions import sweep_stale_sessions
from .services.watcher import manager as watch_manager

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    scheduler.add_job(sweep_stale_sessions, "interval", seconds=60, id="session_sweeper")
    scheduler.start()
    watch_manager.start()
    # Backfill the full-text content index for any not-yet-indexed documents.
    import threading

    from .services.ingest import backfill_content_index

    threading.Thread(target=backfill_content_index, daemon=True).start()
    logger.info("library-book %s started", __version__)
    yield
    watch_manager.stop()
    scheduler.shutdown(wait=False)


app = FastAPI(title="library-book", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (
    documents,
    progress,
    sessions,
    stats,
    annotations,
    shelves,
    tags,
    search,
    metadata,
    notebook,
    import_,
    settings_router,
    opds,
):
    app.include_router(module.router)


# Serve generated covers directly from the data volume.
settings.covers_dir.mkdir(parents=True, exist_ok=True)
app.mount("/covers", StaticFiles(directory=settings.covers_dir), name="covers")


# --- SPA: serve built frontend with client-side routing fallback -------
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    _RESERVED = ("api/", "opds", "covers/")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        # Never let unmatched API/OPDS/cover paths fall through to index.html,
        # otherwise clients (e.g. epub.js probing for files) get HTML 200s.
        if full_path.startswith(_RESERVED):
            from fastapi import HTTPException

            raise HTTPException(404, "not found")
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
        return {"detail": "frontend not built"}
else:

    @app.get("/")
    def root():
        return {"app": "library-book", "version": __version__, "frontend": "not built"}
