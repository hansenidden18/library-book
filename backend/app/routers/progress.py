"""Per-document reading progress (position + status)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Document, ReadingProgress, utcnow
from ..schemas import ProgressOut, ProgressUpdate

router = APIRouter(prefix="/api/documents", tags=["progress"])


def _get_or_create(db: Session, doc_id: int) -> ReadingProgress:
    if not db.get(Document, doc_id):
        raise HTTPException(404, "document not found")
    prog = db.get(ReadingProgress, doc_id)
    if not prog:
        prog = ReadingProgress(document_id=doc_id, status="unread", percent=0.0)
        db.add(prog)
        db.flush()
    return prog


@router.get("/{doc_id}/progress", response_model=ProgressOut)
def get_progress(doc_id: int, db: Session = Depends(get_db)):
    prog = _get_or_create(db, doc_id)
    db.commit()
    return prog


@router.put("/{doc_id}/progress", response_model=ProgressOut)
def update_progress(doc_id: int, payload: ProgressUpdate, db: Session = Depends(get_db)):
    prog = _get_or_create(db, doc_id)
    data = payload.model_dump(exclude_unset=True)

    if prog.started_at is None:
        prog.started_at = utcnow()

    for key, value in data.items():
        setattr(prog, key, value)

    # Auto-manage status from percent unless explicitly set.
    if "status" not in data:
        if prog.percent >= 99.5:
            prog.status = "finished"
        elif prog.percent > 0:
            prog.status = "reading"

    if prog.status == "finished" and prog.finished_at is None:
        prog.finished_at = utcnow()
    if prog.status != "finished":
        prog.finished_at = None

    db.commit()
    db.refresh(prog)
    return prog
