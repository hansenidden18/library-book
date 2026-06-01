"""Notebook: all highlights and notes across the library, plus export."""

import json

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Annotation, Document

router = APIRouter(prefix="/api/notebook", tags=["notebook"])


def _entries(db: Session, kind: str | None = None):
    stmt = (
        select(Annotation, Document)
        .join(Document, Annotation.document_id == Document.id)
        .order_by(Document.title, Annotation.pdf_page, Annotation.created_at)
    )
    if kind:
        stmt = stmt.where(Annotation.kind == kind)
    return db.execute(stmt).all()


@router.get("")
def notebook(db: Session = Depends(get_db), kind: str | None = None):
    rows = _entries(db, kind)
    out = []
    for ann, doc in rows:
        out.append(
            {
                "id": ann.id,
                "document_id": doc.id,
                "document_title": doc.title,
                "doc_type": doc.doc_type,
                "kind": ann.kind,
                "pdf_page": ann.pdf_page,
                "epub_cfi_range": ann.epub_cfi_range,
                "selected_text": ann.selected_text,
                "note": ann.note,
                "color": ann.color,
                "created_at": ann.created_at.isoformat() if ann.created_at else None,
            }
        )
    return out


@router.get("/export")
def export_markdown(db: Session = Depends(get_db)):
    rows = _entries(db)
    by_doc: dict[int, dict] = {}
    for ann, doc in rows:
        d = by_doc.setdefault(doc.id, {"title": doc.title, "authors": [a.name for a in doc.authors], "items": []})
        d["items"].append(ann)

    lines = ["# Notebook", ""]
    for doc_id, d in by_doc.items():
        lines.append(f"## {d['title']}")
        if d["authors"]:
            lines.append(f"*{', '.join(d['authors'])}*")
        lines.append("")
        for ann in d["items"]:
            loc = f"p.{ann.pdf_page}" if ann.pdf_page else ""
            if ann.kind == "bookmark":
                lines.append(f"- 🔖 Bookmark {loc}".rstrip())
            else:
                text = (ann.selected_text or "").strip().replace("\n", " ")
                if text:
                    lines.append(f"> {text} {f'({loc})' if loc else ''}".rstrip())
                if ann.note:
                    lines.append(f"  - {ann.note.strip()}")
            lines.append("")
        lines.append("")

    md = "\n".join(lines)
    return Response(
        md,
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="notebook.md"'},
    )
