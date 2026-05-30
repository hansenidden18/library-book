"""Annotations: highlights, bookmarks, notes (PDF + EPUB)."""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Annotation, Document
from ..schemas import AnnotationCreate, AnnotationOut, AnnotationUpdate
from ..services.ingest import import_pdf_annotations

router = APIRouter(prefix="/api", tags=["annotations"])


def _to_out(a: Annotation) -> AnnotationOut:
    return AnnotationOut(
        id=a.id,
        document_id=a.document_id,
        kind=a.kind,
        pdf_page=a.pdf_page,
        pdf_rects=json.loads(a.pdf_rects) if a.pdf_rects else None,
        epub_cfi_range=a.epub_cfi_range,
        selected_text=a.selected_text,
        note=a.note,
        color=a.color,
        created_at=a.created_at,
        updated_at=a.updated_at,
    )


@router.get("/documents/{doc_id}/annotations", response_model=list[AnnotationOut])
def list_annotations(doc_id: int, kind: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Annotation).where(Annotation.document_id == doc_id)
    if kind:
        stmt = stmt.where(Annotation.kind == kind)
    stmt = stmt.order_by(Annotation.pdf_page, Annotation.created_at)
    return [_to_out(a) for a in db.execute(stmt).scalars().all()]


@router.post("/documents/{doc_id}/annotations/import")
def import_embedded_annotations(doc_id: int, db: Session = Depends(get_db)):
    """Import highlights/notes embedded in the PDF (made in another viewer)."""
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    if doc.file_format != "pdf":
        return {"imported": 0, "reason": "not a pdf"}
    existing = db.execute(
        select(func.count(Annotation.id)).where(Annotation.document_id == doc_id)
    ).scalar_one()
    if existing:
        return {"imported": 0, "skipped": True, "reason": "document already has annotations"}
    path = settings.data_dir / doc.file_path
    if not path.exists():
        raise HTTPException(404, "file missing on disk")
    n = import_pdf_annotations(db, doc_id, path)
    db.commit()
    return {"imported": n}


@router.post("/documents/{doc_id}/annotations", response_model=AnnotationOut)
def create_annotation(doc_id: int, payload: AnnotationCreate, db: Session = Depends(get_db)):
    if not db.get(Document, doc_id):
        raise HTTPException(404, "document not found")
    a = Annotation(
        document_id=doc_id,
        kind=payload.kind,
        pdf_page=payload.pdf_page,
        pdf_rects=json.dumps(payload.pdf_rects) if payload.pdf_rects else None,
        epub_cfi_range=payload.epub_cfi_range,
        selected_text=payload.selected_text,
        note=payload.note,
        color=payload.color,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _to_out(a)


@router.patch("/annotations/{ann_id}", response_model=AnnotationOut)
def update_annotation(ann_id: int, payload: AnnotationUpdate, db: Session = Depends(get_db)):
    a = db.get(Annotation, ann_id)
    if not a:
        raise HTTPException(404, "annotation not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(a, key, value)
    db.commit()
    db.refresh(a)
    return _to_out(a)


@router.delete("/annotations/{ann_id}")
def delete_annotation(ann_id: int, db: Session = Depends(get_db)):
    a = db.get(Annotation, ann_id)
    if not a:
        raise HTTPException(404, "annotation not found")
    db.delete(a)
    db.commit()
    return {"deleted": ann_id}
