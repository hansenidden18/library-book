"""Fetch metadata from external providers.

Papers: arXiv (Atom API) and Crossref (DOI). Books: Google Books and Open
Library. All network calls go through httpx with short timeouts and degrade to
an empty result on error so the UI never hangs.
"""

import logging
import re

import httpx

from ..config import settings
from ..schemas import MetadataCandidate

logger = logging.getLogger(__name__)

TIMEOUT = 12.0
ARXIV_RE = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")


def _client() -> httpx.Client:
    headers = {"User-Agent": "library-book/0.1 (self-hosted)"}
    return httpx.Client(timeout=TIMEOUT, headers=headers, follow_redirects=True)


# --- papers ------------------------------------------------------------


def fetch_arxiv(arxiv_id: str) -> list[MetadataCandidate]:
    m = ARXIV_RE.search(arxiv_id)
    if not m:
        return []
    aid = m.group(1)
    try:
        with _client() as c:
            r = c.get("http://export.arxiv.org/api/query", params={"id_list": aid})
            r.raise_for_status()
    except Exception as exc:
        logger.warning("arxiv fetch failed: %s", exc)
        return []

    import feedparser

    feed = feedparser.parse(r.text)
    out = []
    for entry in feed.entries:
        year = None
        if getattr(entry, "published", None):
            year = int(entry.published[:4]) if entry.published[:4].isdigit() else None
        out.append(
            MetadataCandidate(
                source="arxiv",
                doc_type="paper",
                title=getattr(entry, "title", "").replace("\n", " ").strip(),
                authors=[a.name for a in getattr(entry, "authors", [])],
                description=getattr(entry, "summary", "").replace("\n", " ").strip(),
                arxiv_id=aid,
                year=year,
                published_date=getattr(entry, "published", "")[:10] or None,
                venue="arXiv",
                doi=getattr(entry, "arxiv_doi", None),
                external_id=aid,
            )
        )
    return out


def fetch_crossref(doi: str = "", query: str = "") -> list[MetadataCandidate]:
    params: dict = {"rows": 5}
    if settings.crossref_mailto:
        params["mailto"] = settings.crossref_mailto
    try:
        with _client() as c:
            if doi:
                r = c.get(f"https://api.crossref.org/works/{doi.strip()}")
                r.raise_for_status()
                items = [r.json()["message"]]
            else:
                params["query.bibliographic"] = query
                r = c.get("https://api.crossref.org/works", params=params)
                r.raise_for_status()
                items = r.json()["message"]["items"]
    except Exception as exc:
        logger.warning("crossref fetch failed: %s", exc)
        return []

    out = []
    for it in items:
        authors = [
            " ".join(p for p in [a.get("given"), a.get("family")] if p)
            for a in it.get("author", [])
        ]
        date_parts = (it.get("issued", {}).get("date-parts") or [[None]])[0]
        year = date_parts[0] if date_parts else None
        out.append(
            MetadataCandidate(
                source="crossref",
                doc_type="paper",
                title=(it.get("title") or [""])[0],
                authors=authors,
                description=it.get("abstract", "").replace("<jats:p>", "").replace("</jats:p>", "").strip()
                or None,
                doi=it.get("DOI"),
                year=year,
                venue=(it.get("container-title") or [None])[0],
                publisher=it.get("publisher"),
                external_id=it.get("DOI"),
            )
        )
    return out


# --- books -------------------------------------------------------------


def fetch_google_books(isbn: str = "", query: str = "") -> list[MetadataCandidate]:
    q = f"isbn:{isbn}" if isbn else query
    params = {"q": q, "maxResults": 5}
    if settings.google_books_api_key:
        params["key"] = settings.google_books_api_key
    try:
        with _client() as c:
            r = c.get("https://www.googleapis.com/books/v1/volumes", params=params)
            r.raise_for_status()
            items = r.json().get("items", [])
    except Exception as exc:
        logger.warning("google books fetch failed: %s", exc)
        return []

    out = []
    for it in items:
        v = it.get("volumeInfo", {})
        isbn10 = isbn13 = None
        for ident in v.get("industryIdentifiers", []):
            if ident.get("type") == "ISBN_10":
                isbn10 = ident.get("identifier")
            elif ident.get("type") == "ISBN_13":
                isbn13 = ident.get("identifier")
        img = (v.get("imageLinks") or {}).get("thumbnail")
        if img:
            img = img.replace("http://", "https://")
        out.append(
            MetadataCandidate(
                source="googlebooks",
                doc_type="book",
                title=v.get("title"),
                subtitle=v.get("subtitle"),
                authors=v.get("authors", []),
                description=v.get("description"),
                publisher=v.get("publisher"),
                published_date=v.get("publishedDate"),
                language=v.get("language"),
                isbn10=isbn10,
                isbn13=isbn13,
                cover_url=img,
                external_id=it.get("id"),
            )
        )
    return out


def fetch_openlibrary(isbn: str = "", query: str = "") -> list[MetadataCandidate]:
    try:
        with _client() as c:
            if isbn:
                r = c.get(
                    "https://openlibrary.org/api/books",
                    params={"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"},
                )
                r.raise_for_status()
                data = r.json()
                items = list(data.values())
            else:
                r = c.get("https://openlibrary.org/search.json", params={"q": query, "limit": 5})
                r.raise_for_status()
                items = r.json().get("docs", [])
    except Exception as exc:
        logger.warning("openlibrary fetch failed: %s", exc)
        return []

    out = []
    for it in items:
        if isbn:
            authors = [a.get("name") for a in it.get("authors", [])]
            cover = (it.get("cover") or {}).get("large")
            out.append(
                MetadataCandidate(
                    source="openlibrary",
                    doc_type="book",
                    title=it.get("title"),
                    authors=authors,
                    publisher=", ".join(p.get("name", "") for p in it.get("publishers", [])) or None,
                    published_date=it.get("publish_date"),
                    isbn13=isbn if len(isbn) == 13 else None,
                    isbn10=isbn if len(isbn) == 10 else None,
                    cover_url=cover,
                    external_id=it.get("key"),
                )
            )
        else:
            cover_id = it.get("cover_i")
            cover = f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else None
            out.append(
                MetadataCandidate(
                    source="openlibrary",
                    doc_type="book",
                    title=it.get("title"),
                    authors=it.get("author_name", []),
                    published_date=str(it.get("first_publish_year") or ""),
                    isbn13=(it.get("isbn") or [None])[0],
                    cover_url=cover,
                    external_id=it.get("key"),
                )
            )
    return out


def search(doc_type: str, doi: str = "", arxiv: str = "", isbn: str = "", query: str = "") -> list[MetadataCandidate]:
    if not settings.metadata_fetch_enabled:
        return []
    results: list[MetadataCandidate] = []
    if doc_type == "paper":
        if arxiv:
            results += fetch_arxiv(arxiv)
        if doi:
            results += fetch_crossref(doi=doi)
        if query and not (arxiv or doi):
            results += fetch_crossref(query=query)
    else:
        if isbn:
            results += fetch_google_books(isbn=isbn)
            results += fetch_openlibrary(isbn=isbn)
        elif query:
            results += fetch_google_books(query=query)
            results += fetch_openlibrary(query=query)
    return results


def download_cover(url: str) -> bytes | None:
    try:
        with _client() as c:
            r = c.get(url)
            r.raise_for_status()
            return r.content
    except Exception as exc:
        logger.warning("cover download failed: %s", exc)
        return None
