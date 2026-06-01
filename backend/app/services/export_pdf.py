"""Burn library-book highlights/notes into a copy of a PDF.

The original file is never modified: we open it, add standard PDF highlight and
text annotations from the app's annotation rows, and write a new file. The
result opens with visible highlights in any PDF viewer.
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def _hex_to_rgb(color: str | None) -> tuple[float, float, float]:
    if not color:
        return (1.0, 0.9, 0.2)
    c = color.lstrip("#")
    try:
        r = int(c[0:2], 16) / 255
        g = int(c[2:4], 16) / 255
        b = int(c[4:6], 16) / 255
        return (r, g, b)
    except Exception:
        return (1.0, 0.9, 0.2)


def build_annotated_pdf(src_path: Path, annotations: list, out_path: Path) -> bool:
    """Write ``src_path`` with ``annotations`` burned in to ``out_path``.

    ``annotations`` are ORM Annotation rows. Returns True on success.
    """
    try:
        import fitz
    except ImportError:
        logger.warning("PyMuPDF not available; cannot annotate PDF")
        return False

    by_page: dict[int, list] = {}
    for a in annotations:
        if a.pdf_page:
            by_page.setdefault(a.pdf_page, []).append(a)

    with fitz.open(src_path) as doc:
        for pno, anns in by_page.items():
            if pno < 1 or pno > doc.page_count:
                continue
            page = doc.load_page(pno - 1)
            pw, ph = page.rect.width, page.rect.height
            for a in anns:
                rgb = _hex_to_rgb(a.color)
                rects = json.loads(a.pdf_rects) if a.pdf_rects else []
                quads = [
                    fitz.Rect(r["x"] * pw, r["y"] * ph, (r["x"] + r["w"]) * pw, (r["y"] + r["h"]) * ph)
                    for r in rects
                ]
                if a.kind == "highlight" and quads:
                    annot = page.add_highlight_annot(quads)
                    annot.set_colors(stroke=rgb)
                    if a.note:
                        annot.set_info(content=a.note)
                    annot.update()
                elif a.kind == "note" or (a.note and not quads):
                    point = fitz.Point(quads[0].x0 if quads else 36, quads[0].y0 if quads else 36)
                    annot = page.add_text_annot(point, a.note or a.selected_text or "")
                    annot.update()
        doc.save(out_path)
    return True
