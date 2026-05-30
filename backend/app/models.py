"""SQLAlchemy data model.

A single ``documents`` table with a ``doc_type`` discriminator (book|paper)
holds both e-books and academic papers. Reading position is stored in a
format-specific way (PDF page+offset vs EPUB CFI) plus a unified ``percent``
so the library grid, stats, and OPDS stay format-agnostic.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --- association tables ------------------------------------------------

document_tags = Table(
    "document_tags",
    Base.metadata,
    Column("document_id", ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class DocumentAuthor(Base):
    __tablename__ = "document_authors"
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("authors.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)

    author: Mapped["Author"] = relationship(back_populates="document_links")
    document: Mapped["Document"] = relationship(back_populates="author_links")


class ShelfDocument(Base):
    __tablename__ = "shelf_documents"
    shelf_id: Mapped[int] = mapped_column(
        ForeignKey("shelves.id", ondelete="CASCADE"), primary_key=True
    )
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)

    shelf: Mapped["Shelf"] = relationship(back_populates="document_links")
    document: Mapped["Document"] = relationship(back_populates="shelf_links")


# --- core entities -----------------------------------------------------


class Author(Base):
    __tablename__ = "authors"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)

    document_links: Mapped[list[DocumentAuthor]] = relationship(
        back_populates="author", cascade="all, delete-orphan"
    )


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)

    documents: Mapped[list["Document"]] = relationship(
        secondary=document_tags, back_populates="tags"
    )


class Shelf(Base):
    __tablename__ = "shelves"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    document_links: Mapped[list[ShelfDocument]] = relationship(
        back_populates="shelf", cascade="all, delete-orphan", order_by="ShelfDocument.position"
    )


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_type: Mapped[str] = mapped_column(String, default="book", index=True)  # book|paper
    file_format: Mapped[str] = mapped_column(String)  # pdf|epub

    # shared metadata
    title: Mapped[str] = mapped_column(String, index=True)
    subtitle: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # desc / abstract
    language: Mapped[str | None] = mapped_column(String, nullable=True)
    publisher: Mapped[str | None] = mapped_column(String, nullable=True)
    published_date: Mapped[str | None] = mapped_column(String, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # book-specific
    isbn10: Mapped[str | None] = mapped_column(String, nullable=True)
    isbn13: Mapped[str | None] = mapped_column(String, nullable=True)
    google_books_id: Mapped[str | None] = mapped_column(String, nullable=True)
    openlibrary_id: Mapped[str | None] = mapped_column(String, nullable=True)
    series: Mapped[str | None] = mapped_column(String, nullable=True)
    series_index: Mapped[float | None] = mapped_column(Float, nullable=True)

    # paper-specific
    doi: Mapped[str | None] = mapped_column(String, nullable=True)
    arxiv_id: Mapped[str | None] = mapped_column(String, nullable=True)
    venue: Mapped[str | None] = mapped_column(String, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # file storage (paths relative to data_dir)
    file_path: Mapped[str] = mapped_column(String, unique=True)
    file_hash: Mapped[str | None] = mapped_column(String, unique=True, index=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cover_path: Mapped[str | None] = mapped_column(String, nullable=True)

    # bookkeeping
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    metadata_source: Mapped[str | None] = mapped_column(String, nullable=True)
    metadata_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    # relationships
    author_links: Mapped[list[DocumentAuthor]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DocumentAuthor.position",
    )
    tags: Mapped[list[Tag]] = relationship(secondary=document_tags, back_populates="documents")
    shelf_links: Mapped[list[ShelfDocument]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    progress: Mapped["ReadingProgress | None"] = relationship(
        back_populates="document", cascade="all, delete-orphan", uselist=False
    )
    sessions: Mapped[list["ReadingSession"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    annotations: Mapped[list["Annotation"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )

    @property
    def authors(self) -> list[Author]:
        return [link.author for link in self.author_links]


class ReadingProgress(Base):
    __tablename__ = "reading_progress"
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    pdf_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    epub_cfi: Mapped[str | None] = mapped_column(String, nullable=True)
    scroll_offset: Mapped[float | None] = mapped_column(Float, nullable=True)
    percent: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String, default="unread")  # unread|reading|finished
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    document: Mapped[Document] = relationship(back_populates="progress")


class ReadingSession(Base):
    __tablename__ = "reading_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    last_ping_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    start_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    pages_read: Mapped[int] = mapped_column(Integer, default=0)

    document: Mapped[Document] = relationship(back_populates="sessions")


class Annotation(Base):
    __tablename__ = "annotations"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String)  # highlight|bookmark|note
    pdf_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pdf_rects: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    epub_cfi_range: Mapped[str | None] = mapped_column(String, nullable=True)
    selected_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    document: Mapped[Document] = relationship(back_populates="annotations")


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)


__all__ = [
    "Author",
    "Tag",
    "Shelf",
    "Document",
    "DocumentAuthor",
    "ShelfDocument",
    "ReadingProgress",
    "ReadingSession",
    "Annotation",
    "Setting",
    "document_tags",
]
