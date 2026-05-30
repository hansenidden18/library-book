"""OPDS 1.2 (Atom) catalog so external readers (KOReader, Thorium, etc.)
can browse and download the library without any login."""

from datetime import datetime, timezone
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Document, DocumentAuthor, ReadingProgress, Shelf, ShelfDocument
from ..services import fts

router = APIRouter(prefix="/opds", tags=["opds"])

NAV = "application/atom+xml;profile=opds-catalog;kind=navigation"
ACQ = "application/atom+xml;profile=opds-catalog;kind=acquisition"
MEDIA = {"pdf": "application/pdf", "epub": "application/epub+zip"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _feed(title: str, feed_id: str, base: str, entries: str, *, acquisition: bool, self_url: str) -> Response:
    feed_type = ACQ if acquisition else NAV
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>{escape(feed_id)}</id>
  <title>{escape(title)}</title>
  <updated>{_now()}</updated>
  <link rel="self" href="{escape(self_url)}" type="{feed_type}"/>
  <link rel="start" href="{base}/opds" type="{NAV}"/>
  <link rel="search" type="application/opensearchdescription+xml" href="{base}/opds/search.xml"/>
{entries}
</feed>"""
    return Response(xml, media_type=feed_type)


def _nav_entry(title: str, href: str, content: str) -> str:
    return f"""  <entry>
    <title>{escape(title)}</title>
    <id>{escape(href)}</id>
    <updated>{_now()}</updated>
    <content type="text">{escape(content)}</content>
    <link rel="subsection" href="{escape(href)}" type="{NAV}"/>
  </entry>"""


def _doc_entry(doc: Document, base: str) -> str:
    authors = "".join(f"    <author><name>{escape(a.name)}</name></author>\n" for a in doc.authors)
    summary = escape((doc.description or "")[:1000])
    cover = (
        f'    <link rel="http://opds-spec.org/image" href="{base}/api/documents/{doc.id}/cover" type="image/jpeg"/>\n'
        f'    <link rel="http://opds-spec.org/image/thumbnail" href="{base}/api/documents/{doc.id}/cover?thumb=true" type="image/jpeg"/>\n'
        if doc.cover_path
        else ""
    )
    mt = MEDIA.get(doc.file_format, "application/octet-stream")
    return f"""  <entry>
    <title>{escape(doc.title)}</title>
    <id>urn:library-book:{doc.id}</id>
    <updated>{_now()}</updated>
{authors}    <summary type="text">{summary}</summary>
{cover}    <link rel="http://opds-spec.org/acquisition" href="{base}/api/documents/{doc.id}/file" type="{mt}"/>
  </entry>"""


def _base(request: Request) -> str:
    return str(request.base_url).rstrip("/")


@router.get("")
def opds_root(request: Request):
    base = _base(request)
    entries = "\n".join(
        [
            _nav_entry("Recently Added", f"{base}/opds/recent", "Newest documents"),
            _nav_entry("Unread", f"{base}/opds/unread", "Not started yet"),
            _nav_entry("Shelves", f"{base}/opds/shelves", "Browse by shelf"),
        ]
    )
    return _feed("library-book", f"{base}/opds", base, entries, acquisition=False, self_url=f"{base}/opds")


def _doc_query(db: Session):
    return select(Document).options(
        selectinload(Document.author_links).selectinload(DocumentAuthor.author)
    )


@router.get("/recent")
def opds_recent(request: Request, db: Session = Depends(get_db)):
    base = _base(request)
    docs = db.execute(_doc_query(db).order_by(Document.added_at.desc()).limit(100)).scalars().unique().all()
    entries = "\n".join(_doc_entry(d, base) for d in docs)
    return _feed("Recently Added", f"{base}/opds/recent", base, entries, acquisition=True, self_url=f"{base}/opds/recent")


@router.get("/unread")
def opds_unread(request: Request, db: Session = Depends(get_db)):
    base = _base(request)
    docs = db.execute(
        _doc_query(db)
        .outerjoin(ReadingProgress)
        .where((ReadingProgress.status.is_(None)) | (ReadingProgress.status == "unread"))
        .order_by(Document.added_at.desc())
        .limit(100)
    ).scalars().unique().all()
    entries = "\n".join(_doc_entry(d, base) for d in docs)
    return _feed("Unread", f"{base}/opds/unread", base, entries, acquisition=True, self_url=f"{base}/opds/unread")


@router.get("/shelves")
def opds_shelves(request: Request, db: Session = Depends(get_db)):
    base = _base(request)
    shelves = db.execute(select(Shelf).order_by(Shelf.name)).scalars().all()
    entries = "\n".join(
        _nav_entry(s.name, f"{base}/opds/shelves/{s.id}", s.description or "") for s in shelves
    )
    return _feed("Shelves", f"{base}/opds/shelves", base, entries, acquisition=False, self_url=f"{base}/opds/shelves")


@router.get("/shelves/{shelf_id}")
def opds_shelf(shelf_id: int, request: Request, db: Session = Depends(get_db)):
    base = _base(request)
    shelf = db.get(Shelf, shelf_id)
    title = shelf.name if shelf else "Shelf"
    docs = db.execute(
        _doc_query(db)
        .join(ShelfDocument)
        .where(ShelfDocument.shelf_id == shelf_id)
        .order_by(ShelfDocument.position)
    ).scalars().unique().all()
    entries = "\n".join(_doc_entry(d, base) for d in docs)
    return _feed(title, f"{base}/opds/shelves/{shelf_id}", base, entries, acquisition=True, self_url=f"{base}/opds/shelves/{shelf_id}")


@router.get("/search")
def opds_search(request: Request, q: str = "", db: Session = Depends(get_db)):
    base = _base(request)
    ids = fts.search_ids(db, q) if q else []
    docs = []
    if ids:
        docs = db.execute(_doc_query(db).where(Document.id.in_(ids))).scalars().unique().all()
    entries = "\n".join(_doc_entry(d, base) for d in docs)
    return _feed(f"Search: {q}", f"{base}/opds/search", base, entries, acquisition=True, self_url=f"{base}/opds/search?q={escape(q)}")


@router.get("/search.xml")
def opds_opensearch(request: Request):
    base = _base(request)
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>library-book</ShortName>
  <Description>Search the library</Description>
  <Url type="{ACQ}" template="{base}/opds/search?q={{searchTerms}}"/>
</OpenSearchDescription>"""
    return Response(xml, media_type="application/opensearchdescription+xml")
