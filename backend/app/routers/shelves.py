"""Shelves (collections) CRUD and membership management."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Document, Shelf, ShelfDocument
from ..schemas import ShelfCreate, ShelfOut, ShelfUpdate

router = APIRouter(prefix="/api/shelves", tags=["shelves"])


def _to_out(db: Session, shelf: Shelf) -> ShelfOut:
    count = db.execute(
        select(func.count(ShelfDocument.document_id)).where(ShelfDocument.shelf_id == shelf.id)
    ).scalar_one()
    return ShelfOut(
        id=shelf.id,
        name=shelf.name,
        description=shelf.description,
        sort_order=shelf.sort_order,
        created_at=shelf.created_at,
        document_count=count,
    )


@router.get("", response_model=list[ShelfOut])
def list_shelves(db: Session = Depends(get_db)):
    shelves = db.execute(select(Shelf).order_by(Shelf.sort_order, Shelf.name)).scalars().all()
    return [_to_out(db, s) for s in shelves]


@router.post("", response_model=ShelfOut)
def create_shelf(payload: ShelfCreate, db: Session = Depends(get_db)):
    if db.query(Shelf).filter(Shelf.name == payload.name).first():
        raise HTTPException(409, "shelf name already exists")
    shelf = Shelf(name=payload.name, description=payload.description)
    db.add(shelf)
    db.commit()
    db.refresh(shelf)
    return _to_out(db, shelf)


@router.patch("/{shelf_id}", response_model=ShelfOut)
def update_shelf(shelf_id: int, payload: ShelfUpdate, db: Session = Depends(get_db)):
    shelf = db.get(Shelf, shelf_id)
    if not shelf:
        raise HTTPException(404, "shelf not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(shelf, key, value)
    db.commit()
    db.refresh(shelf)
    return _to_out(db, shelf)


@router.delete("/{shelf_id}")
def delete_shelf(shelf_id: int, db: Session = Depends(get_db)):
    shelf = db.get(Shelf, shelf_id)
    if not shelf:
        raise HTTPException(404, "shelf not found")
    db.delete(shelf)
    db.commit()
    return {"deleted": shelf_id}


@router.post("/{shelf_id}/documents/{doc_id}")
def add_to_shelf(shelf_id: int, doc_id: int, db: Session = Depends(get_db)):
    if not db.get(Shelf, shelf_id):
        raise HTTPException(404, "shelf not found")
    if not db.get(Document, doc_id):
        raise HTTPException(404, "document not found")
    if db.get(ShelfDocument, (shelf_id, doc_id)):
        return {"ok": True}
    pos = db.execute(
        select(func.coalesce(func.max(ShelfDocument.position), -1)).where(
            ShelfDocument.shelf_id == shelf_id
        )
    ).scalar_one()
    db.add(ShelfDocument(shelf_id=shelf_id, document_id=doc_id, position=pos + 1))
    db.commit()
    return {"ok": True}


@router.delete("/{shelf_id}/documents/{doc_id}")
def remove_from_shelf(shelf_id: int, doc_id: int, db: Session = Depends(get_db)):
    link = db.get(ShelfDocument, (shelf_id, doc_id))
    if link:
        db.delete(link)
        db.commit()
    return {"ok": True}
