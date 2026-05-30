"""Watch-folder auto-import (BookLore-style "BookDrop").

A watchdog observer monitors the import directory. New PDF/EPUB files are
ingested after a short debounce (so we don't grab partially-copied files).
Unparseable or duplicate files are moved to ``.failed/``. Document type is
inferred: files dropped under an ``import/papers/`` subdir become papers.
"""

import logging
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from ..config import settings
from ..database import SessionLocal
from . import ingest

logger = logging.getLogger(__name__)

_DEBOUNCE = 3.0  # seconds of quiescence before ingesting


class _Handler(FileSystemEventHandler):
    def __init__(self):
        self._pending: dict[str, float] = {}
        self._lock = threading.Lock()

    def on_created(self, event):
        if not event.is_directory:
            self._mark(event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            self._mark(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._mark(event.dest_path)

    def _mark(self, path: str):
        p = Path(path)
        if p.suffix.lower() not in ingest.SUPPORTED:
            return
        if any(part in (".failed", ".processing") for part in p.parts):
            return
        with self._lock:
            self._pending[str(p)] = time.monotonic()

    def due(self) -> list[Path]:
        now = time.monotonic()
        ready = []
        with self._lock:
            for path, ts in list(self._pending.items()):
                if now - ts >= _DEBOUNCE:
                    ready.append(Path(path))
                    del self._pending[path]
        return ready


class WatchManager:
    def __init__(self):
        self._observer: Observer | None = None
        self._handler = _Handler()
        self._worker: threading.Thread | None = None
        self._stop = threading.Event()
        self.last_results: list[dict] = []

    def start(self):
        if not settings.watch_enabled:
            logger.info("watch folder disabled")
            return
        settings.import_dir.mkdir(parents=True, exist_ok=True)
        self._observer = Observer()
        self._observer.schedule(self._handler, str(settings.import_dir), recursive=True)
        self._observer.start()
        self._worker = threading.Thread(target=self._loop, daemon=True)
        self._worker.start()
        logger.info("watching %s", settings.import_dir)
        # Catch files already present at startup.
        self.scan_now()

    def stop(self):
        self._stop.set()
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)

    def _loop(self):
        while not self._stop.is_set():
            for path in self._handler.due():
                self._ingest_one(path)
            self._stop.wait(1.0)

    def scan_now(self) -> list[dict]:
        """Synchronously ingest every supported file currently in the folder."""
        results = []
        for path in sorted(settings.import_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in ingest.SUPPORTED:
                if any(part in (".failed", ".processing") for part in path.parts):
                    continue
                results.append(self._ingest_one(path))
        return results

    def _infer_type(self, path: Path) -> str:
        return "paper" if "papers" in path.parts else "book"

    def _ingest_one(self, path: Path) -> dict:
        if not path.exists():
            return {"file": str(path), "status": "gone"}
        doc_type = self._infer_type(path)
        db = SessionLocal()
        try:
            doc = ingest.ingest_file(db, path, doc_type=doc_type, move=True, original_name=path.name)
            result = {"file": path.name, "status": "imported", "document_id": doc.id, "title": doc.title}
        except ingest.DuplicateError as e:
            self._quarantine(path, ".failed")
            result = {"file": path.name, "status": "duplicate", "document_id": e.existing.id}
        except Exception as exc:
            logger.warning("watch ingest failed for %s: %s", path, exc)
            self._quarantine(path, ".failed")
            result = {"file": path.name, "status": "error", "error": str(exc)}
        finally:
            db.close()
        self.last_results = ([result] + self.last_results)[:50]
        return result

    def _quarantine(self, path: Path, subdir: str):
        try:
            dest = settings.import_dir / subdir / path.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                path.replace(dest)
        except Exception as exc:  # pragma: no cover
            logger.warning("quarantine failed for %s: %s", path, exc)


manager = WatchManager()
