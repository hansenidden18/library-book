"""Pydantic request/response schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class ProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    document_id: int
    pdf_page: int | None = None
    epub_cfi: str | None = None
    scroll_offset: float | None = None
    percent: float = 0.0
    status: str = "unread"
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime | None = None


class ProgressUpdate(BaseModel):
    pdf_page: int | None = None
    epub_cfi: str | None = None
    scroll_offset: float | None = None
    percent: float | None = None
    status: str | None = None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    doc_type: str
    file_format: str
    title: str
    subtitle: str | None = None
    description: str | None = None
    language: str | None = None
    publisher: str | None = None
    published_date: str | None = None
    page_count: int | None = None
    isbn10: str | None = None
    isbn13: str | None = None
    series: str | None = None
    series_index: float | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    venue: str | None = None
    year: int | None = None
    file_size: int | None = None
    cover_path: str | None = None
    added_at: datetime
    updated_at: datetime
    metadata_source: str | None = None
    metadata_locked: bool = False
    authors: list[AuthorOut] = []
    tags: list[TagOut] = []
    progress: ProgressOut | None = None


class DocumentUpdate(BaseModel):
    doc_type: str | None = None
    title: str | None = None
    subtitle: str | None = None
    description: str | None = None
    language: str | None = None
    publisher: str | None = None
    published_date: str | None = None
    isbn10: str | None = None
    isbn13: str | None = None
    series: str | None = None
    series_index: float | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    venue: str | None = None
    year: int | None = None
    metadata_locked: bool | None = None
    authors: list[str] | None = None  # author names, ordered
    tags: list[str] | None = None


# --- shelves / tags ----------------------------------------------------


class ShelfCreate(BaseModel):
    name: str
    description: str | None = None


class ShelfUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    sort_order: int | None = None


class ShelfOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str | None = None
    sort_order: int = 0
    created_at: datetime
    document_count: int = 0


class TagCreate(BaseModel):
    name: str


# --- sessions / stats --------------------------------------------------


class SessionStart(BaseModel):
    document_id: int
    percent: float | None = None


class SessionPing(BaseModel):
    percent: float | None = None
    pages_read: int | None = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    document_id: int
    started_at: datetime
    duration_sec: int


class StatsSummary(BaseModel):
    total_minutes: int
    total_sessions: int
    documents_started: int
    documents_finished: int
    current_streak: int
    longest_streak: int
    minutes_today: int
    minutes_this_week: int


class TimeseriesPoint(BaseModel):
    bucket: str
    value: float


class HeatmapPoint(BaseModel):
    date: str
    minutes: int


# --- annotations -------------------------------------------------------


class AnnotationCreate(BaseModel):
    kind: str  # highlight|bookmark|note
    pdf_page: int | None = None
    pdf_rects: list[dict] | None = None
    epub_cfi_range: str | None = None
    selected_text: str | None = None
    note: str | None = None
    color: str | None = None


class AnnotationUpdate(BaseModel):
    note: str | None = None
    color: str | None = None


class AnnotationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    document_id: int
    kind: str
    pdf_page: int | None = None
    pdf_rects: list[dict] | None = None
    epub_cfi_range: str | None = None
    selected_text: str | None = None
    note: str | None = None
    color: str | None = None
    created_at: datetime
    updated_at: datetime


# --- metadata ----------------------------------------------------------


class MetadataCandidate(BaseModel):
    source: str
    doc_type: str
    title: str | None = None
    subtitle: str | None = None
    authors: list[str] = []
    description: str | None = None
    publisher: str | None = None
    published_date: str | None = None
    language: str | None = None
    isbn10: str | None = None
    isbn13: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    venue: str | None = None
    year: int | None = None
    cover_url: str | None = None
    external_id: str | None = None


class MetadataApply(MetadataCandidate):
    pass
