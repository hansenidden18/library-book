"""Tag listing/creation/deletion and per-document tag assignment."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Document, Tag
from ..schemas import TagCreate, TagOut
from ..services import fts

router = APIRouter(prefix="/api", tags=["tags"])


@router.get("/tags", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db)):
    return db.execute(select(Tag).order_by(Tag.name)).scalars().all()


@router.post("/tags", response_model=TagOut)
def create_tag(payload: TagCreate, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.name == payload.name).first()
    if not tag:
        tag = Tag(name=payload.name)
        db.add(tag)
        db.commit()
        db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(404, "tag not found")
    db.delete(tag)
    db.commit()
    return {"deleted": tag_id}


@router.put("/documents/{doc_id}/tags", response_model=list[TagOut])
def set_document_tags(doc_id: int, names: list[str], db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
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
    db.flush()
    fts.index_document(db, doc)
    db.commit()
    return doc.tags
