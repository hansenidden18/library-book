"""Database engine, session factory, and schema/FTS bootstrap.

Uses SQLAlchemy 2.x with SQLite in WAL mode. Schema is created with
``Base.metadata.create_all`` plus an idempotent FTS5 + trigger setup. For a
single-user app with a controlled schema this is simpler and just as robust as
running migrations on every boot.
"""

from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


engine: Engine = create_engine(
    settings.sqlalchemy_url,
    connect_args={"check_same_thread": False},
    future=True,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --- FTS5 full-text index over document metadata -----------------------
# A standard (non-contentless) FTS5 table: it keeps its own copy of the
# indexed text, which lets the app INSERT/DELETE rows by rowid as documents
# change. We rebuild it from the documents table on startup so the index is
# always consistent (and to migrate older contentless tables, which could not
# be DELETEd from).

_FTS_CREATE = """
CREATE VIRTUAL TABLE documents_fts USING fts5(
    title, subtitle, description, authors_text, tags_text, venue, publisher
);
"""

_FTS_REPOPULATE = """
INSERT INTO documents_fts(rowid, title, subtitle, description, authors_text, tags_text, venue, publisher)
SELECT d.id,
       COALESCE(d.title, ''),
       COALESCE(d.subtitle, ''),
       COALESCE(d.description, ''),
       COALESCE((SELECT group_concat(a.name, ' ')
                 FROM document_authors da JOIN authors a ON a.id = da.author_id
                 WHERE da.document_id = d.id), ''),
       COALESCE((SELECT group_concat(t.name, ' ')
                 FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
                 WHERE dt.document_id = d.id), ''),
       COALESCE(d.venue, ''),
       COALESCE(d.publisher, '')
FROM documents d;
"""


# Full-text index over document *contents* (the extracted body text). Unlike
# the metadata index it isn't rebuilt from a column, so we keep it across
# restarts and backfill any documents that aren't indexed yet.
_CONTENT_FTS_CREATE = "CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(body);"


def init_db() -> None:
    """Create directories, tables, and rebuild the FTS index. Idempotent."""
    settings.ensure_dirs()
    # Import models so they register on Base.metadata before create_all.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS documents_fts"))
        conn.execute(text(_FTS_CREATE.strip()))
        conn.execute(text(_FTS_REPOPULATE.strip()))
        conn.execute(text(_CONTENT_FTS_CREATE))
