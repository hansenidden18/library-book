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
# External-content-ish setup kept in sync by triggers. We store a flat
# ``authors_text``/``tags_text`` rebuilt by the application on writes, plus
# triggers that mirror the core scalar columns from ``documents``.

_FTS_SETUP = """
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title, subtitle, description, authors_text, tags_text, venue, publisher,
    content=''
);
"""


def init_db() -> None:
    """Create directories, tables, and the FTS index. Idempotent."""
    settings.ensure_dirs()
    # Import models so they register on Base.metadata before create_all.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for stmt in _FTS_SETUP.strip().split(";"):
            if stmt.strip():
                conn.execute(text(stmt))
