"""Extract embedded metadata from PDF/EPUB files at ingest time.

Best-effort: returns a dict of whatever we could find. The title always falls
back to the filename so a document is never untitled.
"""

import logging
import re
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

    # Note: title fallback is handled by the caller (ingest) using the original
    # filename, since file_path here may be a temp upload path.
    return data


_ARXIV_RE = re.compile(r"ar[Xx]iv:\s*(\d{4}\.\d{4,5})(v\d+)?", re.I)
_DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+\b")

# PyMuPDF annotation type ids for text-markup we treat as highlights.
_MARKUP_TYPES = {8, 9, 10, 11}  # Highlight, Underline, Squiggly, StrikeOut
_NOTE_TYPES = {0, 2}  # Text (sticky note), FreeText


def _rgb_to_hex(rgb) -> str:
    try:
        r, g, b = (max(0, min(255, round(c * 255))) for c in rgb[:3])
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        return "#fde047"


def extract_pdf_annotations(file_path: Path) -> list[dict]:
    """Read highlight/markup and note annotations from a PDF so they can be
    imported into the app. Reads annotation geometry directly (QuadPoints),
    so it works even for highlights without a rendered appearance stream.

    Returns dicts shaped like the annotations API: kind, pdf_page (1-based),
    pdf_rects (normalized 0..1, top-left origin), selected_text, note, color.
    """
    try:
        import fitz
    except ImportError:
        return []

    out: list[dict] = []
    try:
        with fitz.open(file_path) as doc:
            for pno in range(doc.page_count):
                page = doc.load_page(pno)
                pw, ph = page.rect.width, page.rect.height
                if pw <= 0 or ph <= 0:
                    continue
                for annot in page.annots() or []:
                    try:
                        atype = annot.type[0]
                        info = annot.info or {}
                        if atype in _MARKUP_TYPES:
                            quads = _quad_rects(annot)
                            if not quads:
                                r = annot.rect
                                quads = [(r.x0, r.y0, r.x1, r.y1)]
                            norm = [
                                {"x": x0 / pw, "y": y0 / ph, "w": (x1 - x0) / pw, "h": (y1 - y0) / ph}
                                for (x0, y0, x1, y1) in quads
                            ]
                            text = " ".join(
                                page.get_textbox(fitz.Rect(*q)).strip() for q in quads
                            ).strip()
                            colors = annot.colors or {}
                            color = colors.get("stroke") or colors.get("fill")
                            out.append(
                                {
                                    "kind": "highlight",
                                    "pdf_page": pno + 1,
                                    "pdf_rects": norm,
                                    "selected_text": text or None,
                                    "note": info.get("content") or None,
                                    "color": _rgb_to_hex(color) if color else "#fde047",
                                }
                            )
                        elif atype in _NOTE_TYPES and info.get("content"):
                            r = annot.rect
                            out.append(
                                {
                                    "kind": "note",
                                    "pdf_page": pno + 1,
                                    "pdf_rects": [
                                        {
                                            "x": r.x0 / pw,
                                            "y": r.y0 / ph,
                                            "w": max(r.width, 14) / pw,
                                            "h": max(r.height, 14) / ph,
                                        }
                                    ],
                                    "selected_text": None,
                                    "note": info.get("content"),
                                    "color": "#93c5fd",
                                }
                            )
                    except Exception:  # pragma: no cover - per-annot best effort
                        continue
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("annotation extraction failed for %s: %s", file_path, exc)
    return out


def extract_fulltext(file_path: Path, file_format: str, max_chars: int = 2_000_000) -> str:
    """Extract the readable text of a document for full-text search."""
    try:
        if file_format == "pdf":
            return _pdf_fulltext(file_path, max_chars)
        if file_format == "epub":
            return _epub_fulltext(file_path, max_chars)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("fulltext extraction failed for %s: %s", file_path, exc)
    return ""


def _pdf_fulltext(file_path: Path, max_chars: int) -> str:
    try:
        import fitz
    except ImportError:
        return ""
    parts: list[str] = []
    total = 0
    with fitz.open(file_path) as doc:
        for page in doc:
            t = page.get_text()
            parts.append(t)
            total += len(t)
            if total >= max_chars:
                break
    return " ".join(parts)[:max_chars]


def _epub_fulltext(file_path: Path, max_chars: int) -> str:
    from bs4 import BeautifulSoup
    from ebooklib import ITEM_DOCUMENT, epub

    book = epub.read_epub(str(file_path))
    parts: list[str] = []
    total = 0
    for item in book.get_items_of_type(ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        t = soup.get_text(" ", strip=True)
        parts.append(t)
        total += len(t)
        if total >= max_chars:
            break
    return " ".join(parts)[:max_chars]


def _quad_rects(annot) -> list[tuple[float, float, float, float]]:
    """Convert a markup annotation's QuadPoints into per-line bounding rects."""
    verts = annot.vertices
    if not verts or len(verts) % 4 != 0:
        return []
    rects = []
    for i in range(0, len(verts), 4):
        quad = verts[i : i + 4]
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        rects.append((min(xs), min(ys), max(xs), max(ys)))
    return rects


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

        # Scan the first couple of pages for an arXiv id / DOI. Their presence
        # is a strong signal the document is an academic paper.
        sample = ""
        for n in range(min(2, doc.page_count)):
            sample += doc.load_page(n).get_text()
        blob = f"{meta.get('subject','')} {meta.get('keywords','')} {sample}"
        m = _ARXIV_RE.search(blob)
        if m:
            out["arxiv_id"] = m.group(1)
        d = _DOI_RE.search(blob)
        if d:
            out["doi"] = d.group(0).rstrip(".")
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
