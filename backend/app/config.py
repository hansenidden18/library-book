"""Application configuration, sourced from environment variables.

Single-user, no-auth deployment: everything is driven by a single DATA_DIR
volume so the whole library can be relocated by moving one directory.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Root data directory. Everything lives under here.
    data_dir: Path = Path("./data")

    # Optional overrides (default to subdirs of data_dir if unset).
    database_url: str | None = None
    watch_folder: Path | None = None

    # Feature toggles
    watch_enabled: bool = True
    metadata_fetch_enabled: bool = True

    # Metadata provider config
    crossref_mailto: str = ""
    google_books_api_key: str = ""

    # Reading-session tuning (seconds)
    session_ping_interval: int = 30
    session_ping_cap: int = 60  # max seconds credited per ping (ignore long gaps)
    session_idle_timeout: int = 120  # auto-close sessions stale longer than this

    log_level: str = "info"

    # --- derived paths -------------------------------------------------
    @property
    def db_dir(self) -> Path:
        return self.data_dir / "db"

    @property
    def library_dir(self) -> Path:
        return self.data_dir / "library"

    @property
    def covers_dir(self) -> Path:
        return self.data_dir / "covers"

    @property
    def import_dir(self) -> Path:
        return self.watch_folder or (self.data_dir / "import")

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.db_dir / 'library.db').resolve()}"

    def ensure_dirs(self) -> None:
        for d in (
            self.db_dir,
            self.library_dir,
            self.library_dir / "books",
            self.library_dir / "papers",
            self.covers_dir,
            self.import_dir,
            self.import_dir / ".failed",
            self.import_dir / ".processing",
            self.tmp_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
