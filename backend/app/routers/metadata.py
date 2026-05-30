"""Metadata search (external providers) and apply-to-document."""

import io

from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Author, Document, DocumentAuthor
from ..schemas import DocumentOut, MetadataApply, MetadataCandidate
from ..services import fts, metadata_fetch

router = APIRouter(prefix="/api/metadata", tags=["metadata"])


@router.get("/search", response_model=list[MetadataCandidate])
def search_metadata(
    type: str = "book",
    doi: str = "",
    arxiv: str = "",
    isbn: str = "",
    query: str = "",
    db: Session = Depends(get_db),
):
    if not settings.metadata_fetch_enabled:
        raise HTTPException(503, "metadata fetch is disabled")
    return metadata_fetch.search(type, doi=doi, arxiv=arxiv, isbn=isbn, query=query)


@router.post("/apply/{doc_id}", response_model=DocumentOut)
def apply_metadata(doc_id: int, payload: MetadataApply, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    if doc.metadata_locked:
        raise HTTPException(409, "metadata is locked; unlock to overwrite")

    fields = [
        "title", "subtitle", "description", "publisher", "published_date",
        "language", "isbn10", "isbn13", "doi", "arxiv_id", "venue", "year",
    ]
    for f in fields:
        val = getattr(payload, f, None)
        if val:
            setattr(doc, f, val)
    if payload.doc_type:
        doc.doc_type = payload.doc_type
    doc.metadata_source = payload.source

    if payload.authors:
        doc.author_links.clear()
        db.flush()
        for i, name in enumerate(payload.authors):
            name = name.strip()
            if not name:
                continue
            author = db.query(Author).filter(Author.name == name).first()
            if not author:
                author = Author(name=name)
                db.add(author)
                db.flush()
            db.add(DocumentAuthor(document_id=doc.id, author_id=author.id, position=i))

    if payload.cover_url:
        raw = metadata_fetch.download_cover(payload.cover_url)
        if raw:
            try:
                img = Image.open(io.BytesIO(raw)).convert("RGB")
                settings.covers_dir.mkdir(parents=True, exist_ok=True)
                c = img.copy(); c.thumbnail((600, 600)); c.save(settings.covers_dir / f"{doc.id}.jpg", "JPEG", quality=85)
                t = img.copy(); t.thumbnail((300, 300)); t.save(settings.covers_dir / f"{doc.id}_thumb.jpg", "JPEG", quality=80)
                doc.cover_path = f"covers/{doc.id}.jpg"
            except Exception:
                pass

    db.flush()
    db.refresh(doc)
    fts.index_document(db, doc)
    db.commit()

    from .documents import _load

    return _load(db, doc_id)
