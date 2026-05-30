"""Citation export (BibTeX / RIS / APA) for documents, papers especially."""

import re

from ..models import Document


def _cite_key(doc: Document) -> str:
    first_author = doc.authors[0].name.split()[-1] if doc.authors else "anon"
    year = str(doc.year or (doc.published_date or "")[:4] or "n.d.")
    word = re.sub(r"[^a-zA-Z]", "", (doc.title or "untitled").split(" ")[0]) or "ref"
    return f"{first_author.lower()}{year}{word.lower()}"


def _authors_bibtex(doc: Document) -> str:
    return " and ".join(a.name for a in doc.authors)


def to_bibtex(doc: Document) -> str:
    entry_type = "article" if doc.doc_type == "paper" else "book"
    fields: list[tuple[str, str]] = []
    if doc.authors:
        fields.append(("author", _authors_bibtex(doc)))
    if doc.title:
        fields.append(("title", doc.title))
    year = doc.year or ((doc.published_date or "")[:4] if doc.published_date else None)
    if year:
        fields.append(("year", str(year)))
    if doc.venue:
        key = "journal" if doc.doc_type == "paper" else "series"
        fields.append((key, doc.venue))
    if doc.publisher:
        fields.append(("publisher", doc.publisher))
    if doc.doi:
        fields.append(("doi", doc.doi))
    if doc.arxiv_id:
        fields.append(("eprint", doc.arxiv_id))
        fields.append(("archivePrefix", "arXiv"))
    if doc.isbn13 or doc.isbn10:
        fields.append(("isbn", doc.isbn13 or doc.isbn10))

    lines = [f"@{entry_type}{{{_cite_key(doc)},"]
    for key, value in fields:
        value = str(value).replace("{", "").replace("}", "")
        lines.append(f"  {key} = {{{value}}},")
    lines.append("}")
    return "\n".join(lines) + "\n"


def to_ris(doc: Document) -> str:
    ty = "JOUR" if doc.doc_type == "paper" else "BOOK"
    lines = [f"TY  - {ty}"]
    for a in doc.authors:
        lines.append(f"AU  - {a.name}")
    if doc.title:
        lines.append(f"TI  - {doc.title}")
    year = doc.year or ((doc.published_date or "")[:4] if doc.published_date else None)
    if year:
        lines.append(f"PY  - {year}")
    if doc.venue:
        lines.append(f"JO  - {doc.venue}")
    if doc.publisher:
        lines.append(f"PB  - {doc.publisher}")
    if doc.doi:
        lines.append(f"DO  - {doc.doi}")
    if doc.isbn13 or doc.isbn10:
        lines.append(f"SN  - {doc.isbn13 or doc.isbn10}")
    lines.append("ER  - ")
    return "\n".join(lines) + "\n"


def to_apa(doc: Document) -> str:
    names = [a.name for a in doc.authors]
    if len(names) == 1:
        authors = names[0]
    elif len(names) > 1:
        authors = ", ".join(names[:-1]) + ", & " + names[-1]
    else:
        authors = ""
    year = doc.year or ((doc.published_date or "")[:4] if doc.published_date else "n.d.")
    parts = [p for p in [f"{authors}" if authors else "", f"({year})."] if p]
    out = " ".join(parts) + f" {doc.title}."
    if doc.venue:
        out += f" {doc.venue}."
    elif doc.publisher:
        out += f" {doc.publisher}."
    if doc.doi:
        out += f" https://doi.org/{doc.doi}"
    return out.strip() + "\n"
