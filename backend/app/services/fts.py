"""Keep the FTS5 index in sync with documents.

We rebuild a document's FTS row on every metadata write. The row id mirrors
``documents.id`` so search results map straight back to documents.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..models import Document


def index_document(db: Session, doc: Document) -> None:
    """Insert or replace the FTS row for a document."""
    authors_text = " ".join(a.name for a in doc.authors)
    tags_text = " ".join(t.name for t in doc.tags)
    db.execute(text("DELETE FROM documents_fts WHERE rowid = :id"), {"id": doc.id})
    db.execute(
        text(
            "INSERT INTO documents_fts(rowid, title, subtitle, description, "
            "authors_text, tags_text, venue, publisher) VALUES "
            "(:id, :title, :subtitle, :description, :authors, :tags, :venue, :publisher)"
        ),
        {
            "id": doc.id,
            "title": doc.title or "",
            "subtitle": doc.subtitle or "",
            "description": doc.description or "",
            "authors": authors_text,
            "tags": tags_text,
            "venue": doc.venue or "",
            "publisher": doc.publisher or "",
        },
    )


def remove_document(db: Session, doc_id: int) -> None:
    db.execute(text("DELETE FROM documents_fts WHERE rowid = :id"), {"id": doc_id})
    db.execute(text("DELETE FROM content_fts WHERE rowid = :id"), {"id": doc_id})


def index_content(db: Session, doc_id: int, body: str) -> None:
    """Index a document's full text for content search."""
    db.execute(text("DELETE FROM content_fts WHERE rowid = :id"), {"id": doc_id})
    if body:
        db.execute(
            text("INSERT INTO content_fts(rowid, body) VALUES (:id, :body)"),
            {"id": doc_id, "body": body},
        )


def has_content(db: Session, doc_id: int) -> bool:
    row = db.execute(
        text("SELECT 1 FROM content_fts WHERE rowid = :id LIMIT 1"), {"id": doc_id}
    ).fetchone()
    return row is not None


def search_ids(db: Session, query: str, limit: int = 200) -> list[int]:
    """Return document ids matching the query, metadata matches ranked first,
    then full-text content matches. De-duplicated, best matches first."""
    cleaned = _sanitize(query)
    if not cleaned:
        return []
    meta = db.execute(
        text(
            "SELECT rowid FROM documents_fts WHERE documents_fts MATCH :q "
            "ORDER BY rank LIMIT :limit"
        ),
        {"q": cleaned, "limit": limit},
    ).fetchall()
    ids = [r[0] for r in meta]
    seen = set(ids)
    try:
        content = db.execute(
            text(
                "SELECT rowid FROM content_fts WHERE content_fts MATCH :q "
                "ORDER BY rank LIMIT :limit"
            ),
            {"q": cleaned, "limit": limit},
        ).fetchall()
        for (rid,) in content:
            if rid not in seen:
                seen.add(rid)
                ids.append(rid)
    except Exception:
        # content_fts may not exist on very old databases
        pass
    return ids


def _sanitize(query: str) -> str:
    """Turn free text into a safe FTS5 prefix query."""
    tokens = [t for t in "".join(c if c.isalnum() else " " for c in query).split() if t]
    if not tokens:
        return ""
    return " ".join(f"{t}*" for t in tokens)
