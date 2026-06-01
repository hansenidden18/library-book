"""Shared ingest pipeline used by both UI upload and the watch folder.

Steps: hash (dedupe) -> detect format -> extract embedded metadata -> move into
the managed library tree -> generate cover -> insert document row -> index FTS.
"""

import hashlib
import json
import logging
import re
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Annotation, Author, Document, DocumentAuthor
from . import covers, extract, fts

logger = logging.getLogger(__name__)

SUPPORTED = {".pdf": "pdf", ".epub": "epub"}


class IngestError(Exception):
    pass


class DuplicateError(IngestError):
    def __init__(self, existing: Document):
        self.existing = existing
        super().__init__(f"duplicate of document {existing.id}")


def detect_format(path: Path) -> str | None:
    return SUPPORTED.get(path.suffix.lower())


def _slugify(text: str, maxlen: int = 60) -> str:
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:maxlen].strip("-") or "untitled"


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ingest_file(
    db: Session,
    src: Path,
    *,
    doc_type: str = "book",
    move: bool = False,
    original_name: str | None = None,
) -> Document:
    """Ingest a file into the library.

    ``move`` removes the source after copying (used by the watch folder).
    Raises DuplicateError if a file with the same hash already exists.
    """
    fmt = detect_format(Path(original_name or src.name))
    if not fmt:
        raise IngestError(f"unsupported file type: {src.name}")

    file_hash = _hash_file(src)
    existing = db.query(Document).filter(Document.file_hash == file_hash).first()
    if existing:
        raise DuplicateError(existing)

    meta = extract.extract_metadata(src, fmt)

    # "auto": classify as a paper when we detect an arXiv id or DOI, else a book.
    if doc_type == "auto":
        if fmt == "pdf" and (meta.get("doi") or meta.get("arxiv_id")):
            doc_type = "paper"
        else:
            doc_type = "book"

    subdir = "papers" if doc_type == "paper" else "books"
    dest_dir = settings.library_dir / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Create the document row first so we have an id for naming.
    doc = Document(
        doc_type=doc_type,
        file_format=fmt,
        title=meta.get("title") or Path(original_name or src.name).stem,
        description=meta.get("description"),
        language=meta.get("language"),
        publisher=meta.get("publisher"),
        published_date=meta.get("published_date"),
        page_count=meta.get("page_count"),
        isbn10=meta.get("isbn10"),
        isbn13=meta.get("isbn13"),
        doi=meta.get("doi"),
        arxiv_id=meta.get("arxiv_id"),
        file_hash=file_hash,
        file_size=src.stat().st_size,
        file_path="",  # set after we know the id
        metadata_source="embedded",
    )
    db.add(doc)
    db.flush()  # assigns doc.id

    # author links
    for i, name in enumerate(meta.get("authors", []) or []):
        author = db.query(Author).filter(Author.name == name).first()
        if not author:
            author = Author(name=name)
            db.add(author)
            db.flush()
        db.add(DocumentAuthor(document_id=doc.id, author_id=author.id, position=i))

    # move/copy file into place
    dest_name = f"{doc.id}-{_slugify(doc.title)}.{fmt}"
    dest_path = dest_dir / dest_name
    if move:
        shutil.move(str(src), dest_path)
    else:
        shutil.copy2(src, dest_path)
    doc.file_path = str(dest_path.relative_to(settings.data_dir))

    # cover
    cover_rel = covers.generate_cover(dest_path, fmt, settings.covers_dir, doc.id)
    if cover_rel:
        doc.cover_path = cover_rel

    # Import highlights/notes the user made in another PDF viewer.
    if fmt == "pdf":
        imported = import_pdf_annotations(db, doc.id, dest_path)
        if imported:
            logger.info("imported %d annotation(s) for document %s", imported, doc.id)

    # Auto-enrich papers from arXiv/Crossref when we found an id.
    if doc_type == "paper" and (doc.arxiv_id or doc.doi):
        _auto_fetch_metadata(db, doc)

    # Index the full text for content search.
    body = extract.extract_fulltext(dest_path, fmt)
    fts.index_content(db, doc.id, body)

    db.flush()
    db.refresh(doc)
    fts.index_document(db, doc)
    db.commit()
    db.refresh(doc)
    logger.info("ingested document %s: %s", doc.id, doc.title)
    return doc


def _auto_fetch_metadata(db: Session, doc: Document) -> None:
    """Fill in paper metadata from arXiv/Crossref. Best-effort, never fatal."""
    if not settings.metadata_fetch_enabled:
        return
    try:
        from . import metadata_fetch

        candidates = []
        if doc.arxiv_id:
            candidates = metadata_fetch.fetch_arxiv(doc.arxiv_id)
        if not candidates and doc.doi:
            candidates = metadata_fetch.fetch_crossref(doi=doc.doi)
        if not candidates:
            return
        c = candidates[0]
        if c.title:
            doc.title = c.title
        if c.description:
            doc.description = c.description
        if c.venue:
            doc.venue = c.venue
        if c.year:
            doc.year = c.year
        if c.publisher:
            doc.publisher = c.publisher
        doc.metadata_source = c.source
        if c.authors:
            doc.author_links.clear()
            db.flush()
            for i, name in enumerate(c.authors):
                name = name.strip()
                if not name:
                    continue
                author = db.query(Author).filter(Author.name == name).first()
                if not author:
                    author = Author(name=name)
                    db.add(author)
                    db.flush()
                db.add(DocumentAuthor(document_id=doc.id, author_id=author.id, position=i))
        logger.info("auto-fetched metadata for document %s from %s", doc.id, c.source)
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning("auto metadata fetch failed for %s: %s", doc.id, exc)


def backfill_content_index() -> None:
    """Index full text for documents missing from content_fts (one-time per doc)."""
    from ..database import SessionLocal

    db = SessionLocal()
    try:
        docs = db.query(Document).all()
        indexed = 0
        for doc in docs:
            if fts.has_content(db, doc.id):
                continue
            path = settings.data_dir / doc.file_path
            if not path.exists():
                continue
            body = extract.extract_fulltext(path, doc.file_format)
            fts.index_content(db, doc.id, body)
            indexed += 1
        if indexed:
            db.commit()
            logger.info("backfilled content index for %d document(s)", indexed)
    except Exception as exc:  # pragma: no cover
        logger.warning("content backfill failed: %s", exc)
    finally:
        db.close()


def import_pdf_annotations(db: Session, doc_id: int, pdf_path: Path) -> int:
    """Create Annotation rows from a PDF's embedded markup. Returns the count."""
    count = 0
    for a in extract.extract_pdf_annotations(pdf_path):
        db.add(
            Annotation(
                document_id=doc_id,
                kind=a["kind"],
                pdf_page=a.get("pdf_page"),
                pdf_rects=json.dumps(a["pdf_rects"]) if a.get("pdf_rects") else None,
                selected_text=a.get("selected_text"),
                note=a.get("note"),
                color=a.get("color"),
            )
        )
        count += 1
    return count
