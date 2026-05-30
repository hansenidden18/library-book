"""Extract embedded metadata from PDF/EPUB files at ingest time.

Best-effort: returns a dict of whatever we could find. The title always falls
back to the filename so a document is never untitled.
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_metadata(file_path: Path, file_format: str) -> dict:
    data: dict = {}
    try:
        if file_format == "pdf":
            data = _from_pdf(file_path)
        elif file_format == "epub":
            data = _from_epub(file_path)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("metadata extraction failed for %s: %s", file_path, exc)

    if not data.get("title"):
        data["title"] = file_path.stem.replace("_", " ").strip()
    return data


def _from_pdf(file_path: Path) -> dict:
    try:
        import fitz
    except ImportError:
        return {}
    out: dict = {}
    with fitz.open(file_path) as doc:
        out["page_count"] = doc.page_count
        meta = doc.metadata or {}
        if meta.get("title"):
            out["title"] = meta["title"].strip()
        if meta.get("author"):
            out["authors"] = [a.strip() for a in meta["author"].replace(";", ",").split(",") if a.strip()]
        if meta.get("subject"):
            out["description"] = meta["subject"].strip()
    return out


def _from_epub(file_path: Path) -> dict:
    from ebooklib import epub

    out: dict = {}
    book = epub.read_epub(str(file_path))
    titles = book.get_metadata("DC", "title")
    if titles:
        out["title"] = titles[0][0].strip()
    creators = book.get_metadata("DC", "creator")
    if creators:
        out["authors"] = [c[0].strip() for c in creators if c[0].strip()]
    desc = book.get_metadata("DC", "description")
    if desc:
        out["description"] = desc[0][0].strip()
    lang = book.get_metadata("DC", "language")
    if lang:
        out["language"] = lang[0][0].strip()
    pub = book.get_metadata("DC", "publisher")
    if pub:
        out["publisher"] = pub[0][0].strip()
    dates = book.get_metadata("DC", "date")
    if dates:
        out["published_date"] = dates[0][0].strip()
    # ISBN from dc:identifier
    for ident in book.get_metadata("DC", "identifier"):
        val = (ident[0] or "").replace("-", "").lower()
        digits = "".join(c for c in val if c.isdigit())
        if "isbn" in val or len(digits) in (10, 13):
            if len(digits) == 13:
                out["isbn13"] = digits
            elif len(digits) == 10:
                out["isbn10"] = digits
    return out
