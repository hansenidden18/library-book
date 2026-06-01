"""Document CRUD, file upload, file/cover streaming, citation export."""

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..database import get_db
from ..models import (
    Annotation,
    Author,
    Document,
    DocumentAuthor,
    ReadingProgress,
    ShelfDocument,
    Tag,
    document_tags,
)
from ..schemas import DocumentOut, DocumentUpdate
from ..services import citations, export_pdf, fts, ingest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/documents", tags=["documents"])

MEDIA_TYPES = {"pdf": "application/pdf", "epub": "application/epub+zip"}


def _load(db: Session, doc_id: int) -> Document:
    doc = db.execute(
        select(Document)
        .options(
            selectinload(Document.author_links).selectinload(DocumentAuthor.author),
            selectinload(Document.tags),
            selectinload(Document.progress),
        )
        .where(Document.id == doc_id)
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "document not found")
    return doc


@router.get("", response_model=list[DocumentOut])
def list_documents(
    db: Session = Depends(get_db),
    type: str | None = None,
    shelf: int | None = None,
    tag: int | None = None,
    status: str | None = None,
    q: str | None = None,
    sort: str = "added_desc",
):
    stmt = select(Document).options(
        selectinload(Document.author_links).selectinload(DocumentAuthor.author),
        selectinload(Document.tags),
        selectinload(Document.progress),
    )
    if type:
        stmt = stmt.where(Document.doc_type == type)
    if shelf:
        stmt = stmt.join(ShelfDocument).where(ShelfDocument.shelf_id == shelf)
    if tag:
        stmt = stmt.join(document_tags).where(document_tags.c.tag_id == tag)
    if q:
        ids = fts.search_ids(db, q)
        if not ids:
            return []
        stmt = stmt.where(Document.id.in_(ids))

    if sort == "last_read":
        stmt = stmt.join(ReadingProgress).order_by(ReadingProgress.updated_at.desc())
    else:
        sort_map = {
            "added_desc": Document.added_at.desc(),
            "added_asc": Document.added_at.asc(),
            "title_asc": Document.title.asc(),
            "title_desc": Document.title.desc(),
            "year_desc": Document.year.desc(),
        }
        stmt = stmt.order_by(sort_map.get(sort, Document.added_at.desc()))

    docs = db.execute(stmt).scalars().unique().all()
    if status:
        docs = [d for d in docs if (d.progress.status if d.progress else "unread") == status]
    return docs


@router.post("/upload", response_model=DocumentOut)
async def upload_document(
    file: UploadFile = File(...),
    doc_type: str = Form("book"),
    db: Session = Depends(get_db),
):
    suffix = Path(file.filename or "").suffix.lower()
    if not ingest.detect_format(Path(file.filename or "")):
        raise HTTPException(400, f"unsupported file type: {suffix}")

    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        delete=False, dir=settings.tmp_dir, suffix=suffix
    ) as tmp:
        tmp_path = Path(tmp.name)
        while chunk := await file.read(1 << 20):
            tmp.write(chunk)

    try:
        doc = ingest.ingest_file(
            db, tmp_path, doc_type=doc_type, move=False, original_name=file.filename
        )
    except ingest.DuplicateError as e:
        raise HTTPException(409, f"already in library (document {e.existing.id})")
    except ingest.IngestError as e:
        raise HTTPException(400, str(e))
    finally:
        tmp_path.unlink(missing_ok=True)

    return _load(db, doc.id)


@router.get("/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: int, db: Session = Depends(get_db)):
    return _load(db, doc_id)


@router.patch("/{doc_id}", response_model=DocumentOut)
def update_document(doc_id: int, payload: DocumentUpdate, db: Session = Depends(get_db)):
    doc = _load(db, doc_id)
    data = payload.model_dump(exclude_unset=True)

    if "authors" in data:
        _set_authors(db, doc, data.pop("authors") or [])
    if "tags" in data:
        _set_tags(db, doc, data.pop("tags") or [])
    for key, value in data.items():
        setattr(doc, key, value)

    db.flush()
    db.refresh(doc)
    fts.index_document(db, doc)
    db.commit()
    return _load(db, doc_id)


@router.delete("/{doc_id}")
def delete_document(doc_id: int, delete_file: bool = False, db: Session = Depends(get_db)):
    doc = _load(db, doc_id)
    if delete_file and doc.file_path:
        (settings.data_dir / doc.file_path).unlink(missing_ok=True)
    if doc.cover_path:
        (settings.data_dir / doc.cover_path).unlink(missing_ok=True)
        (settings.covers_dir / f"{doc.id}_thumb.jpg").unlink(missing_ok=True)
    fts.remove_document(db, doc.id)
    db.delete(doc)
    db.commit()
    return {"deleted": doc_id}


@router.get("/{doc_id}/file")
def get_file(doc_id: int, db: Session = Depends(get_db)):
    doc = _load(db, doc_id)
    path = settings.data_dir / doc.file_path
    if not path.exists():
        raise HTTPException(404, "file missing on disk")
    # FileResponse handles Range requests, needed by pdf.js / epub.js.
    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(doc.file_format, "application/octet-stream"),
        filename=path.name,
    )


@router.get("/{doc_id}/file/annotated")
def get_annotated_file(doc_id: int, db: Session = Depends(get_db)):
    """Download a PDF with the app's highlights/notes burned in."""
    doc = _load(db, doc_id)
    if doc.file_format != "pdf":
        raise HTTPException(400, "annotated download is only available for PDFs")
    src = settings.data_dir / doc.file_path
    if not src.exists():
        raise HTTPException(404, "file missing on disk")
    anns = db.query(Annotation).filter(Annotation.document_id == doc_id).all()

    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    out = settings.tmp_dir / f"annotated-{doc_id}.pdf"
    if not export_pdf.build_annotated_pdf(src, anns, out):
        raise HTTPException(500, "could not build annotated PDF")

    from pathlib import Path as _P

    fname = f"{_P(doc.file_path).stem}-highlighted.pdf"
    return FileResponse(out, media_type="application/pdf", filename=fname)


@router.get("/{doc_id}/cover")
def get_cover(doc_id: int, thumb: bool = False, db: Session = Depends(get_db)):
    doc = _load(db, doc_id)
    if not doc.cover_path:
        raise HTTPException(404, "no cover")
    name = f"{doc.id}_thumb.jpg" if thumb else f"{doc.id}.jpg"
    path = settings.covers_dir / name
    if not path.exists():
        path = settings.data_dir / doc.cover_path
    if not path.exists():
        raise HTTPException(404, "cover missing on disk")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/{doc_id}/cover", response_model=DocumentOut)
async def upload_cover(doc_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    from PIL import Image
    import io

    doc = _load(db, doc_id)
    raw = await file.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    settings.covers_dir.mkdir(parents=True, exist_ok=True)
    cover = img.copy()
    cover.thumbnail((600, 600))
    cover.save(settings.covers_dir / f"{doc.id}.jpg", "JPEG", quality=85)
    thumb = img.copy()
    thumb.thumbnail((300, 300))
    thumb.save(settings.covers_dir / f"{doc.id}_thumb.jpg", "JPEG", quality=80)
    doc.cover_path = f"covers/{doc.id}.jpg"
    db.commit()
    return _load(db, doc_id)


@router.get("/{doc_id}/citation")
def get_citation(doc_id: int, format: str = Query("bibtex"), db: Session = Depends(get_db)):
    doc = _load(db, doc_id)
    if format == "bibtex":
        body = citations.to_bibtex(doc)
        return Response(body, media_type="text/plain")
    if format == "ris":
        return Response(citations.to_ris(doc), media_type="text/plain")
    if format == "apa":
        return Response(citations.to_apa(doc), media_type="text/plain")
    raise HTTPException(400, "format must be bibtex|ris|apa")


# --- helpers -----------------------------------------------------------


def _set_authors(db: Session, doc: Document, names: list[str]) -> None:
    doc.author_links.clear()
    db.flush()
    for i, name in enumerate(names):
        name = name.strip()
        if not name:
            continue
        author = db.query(Author).filter(Author.name == name).first()
        if not author:
            author = Author(name=name)
            db.add(author)
            db.flush()
        db.add(DocumentAuthor(document_id=doc.id, author_id=author.id, position=i))


def _set_tags(db: Session, doc: Document, names: list[str]) -> None:
    tags = []
    for name in names:
        name = name.strip()
        if not name:
            continue
        tag = db.query(Tag).filter(Tag.name == name).first()
        if not tag:
            tag = Tag(name=name)
            db.add(tag)
            db.flush()
        tags.append(tag)
    doc.tags = tags
