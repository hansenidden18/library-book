"""Cover/thumbnail generation for PDF and EPUB files.

Degrades gracefully if optional native libs are unavailable: a missing cover
just means the UI shows a placeholder.
"""

import io
import logging
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)

COVER_MAX = 600
THUMB_MAX = 300


def generate_cover(file_path: Path, file_format: str, dest_dir: Path, doc_id: int) -> str | None:
    """Render a cover for the document. Returns the cover path relative to data_dir's
    parent of ``dest_dir`` (i.e. ``covers/<id>.jpg``) or None on failure."""
    try:
        raw = _extract_cover_bytes(file_path, file_format)
        if not raw:
            return None
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("cover extraction failed for %s: %s", file_path, exc)
        return None

    dest_dir.mkdir(parents=True, exist_ok=True)
    cover = img.copy()
    cover.thumbnail((COVER_MAX, COVER_MAX))
    cover_file = dest_dir / f"{doc_id}.jpg"
    cover.save(cover_file, "JPEG", quality=85)

    thumb = img.copy()
    thumb.thumbnail((THUMB_MAX, THUMB_MAX))
    thumb.save(dest_dir / f"{doc_id}_thumb.jpg", "JPEG", quality=80)

    return f"covers/{doc_id}.jpg"


def _extract_cover_bytes(file_path: Path, file_format: str) -> bytes | None:
    if file_format == "pdf":
        return _pdf_first_page(file_path)
    if file_format == "epub":
        return _epub_cover(file_path)
    return None


def _pdf_first_page(file_path: Path) -> bytes | None:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF not installed; skipping PDF cover")
        return None
    with fitz.open(file_path) as doc:
        if doc.page_count == 0:
            return None
        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        return pix.tobytes("png")


def _epub_cover(file_path: Path) -> bytes | None:
    try:
        from ebooklib import epub
    except ImportError:
        return None
    book = epub.read_epub(str(file_path))
    # Preferred: an item flagged as the cover.
    for item in book.get_items():
        if getattr(item, "get_type", None) and item.get_name():
            pass
    # ebooklib exposes cover via metadata or an item id "cover"
    for item in book.get_items():
        name = (item.get_name() or "").lower()
        if "cover" in name and name.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
            return item.get_content()
    # Fallback: first image in the book
    from ebooklib import ITEM_IMAGE

    for item in book.get_items_of_type(ITEM_IMAGE):
        return item.get_content()
    return None
