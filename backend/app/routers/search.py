"""Full-text search across document metadata via SQLite FTS5."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Document, DocumentAuthor
from ..schemas import DocumentOut
from ..services import fts

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search", response_model=list[DocumentOut])
def search(q: str, type: str | None = None, db: Session = Depends(get_db)):
    ids = fts.search_ids(db, q)
    if not ids:
        return []
    order = {doc_id: i for i, doc_id in enumerate(ids)}
    stmt = (
        select(Document)
        .options(
            selectinload(Document.author_links).selectinload(DocumentAuthor.author),
            selectinload(Document.tags),
            selectinload(Document.progress),
        )
        .where(Document.id.in_(ids))
    )
    if type:
        stmt = stmt.where(Document.doc_type == type)
    docs = db.execute(stmt).scalars().unique().all()
    docs.sort(key=lambda d: order.get(d.id, 1_000_000))
    return docs
