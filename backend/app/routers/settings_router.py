"""Key/value app settings + health check."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings as app_settings
from ..database import get_db
from ..models import Setting

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    rows = db.execute(select(Setting)).scalars().all()
    stored = {r.key: r.value for r in rows}
    return {
        "watch_enabled": app_settings.watch_enabled,
        "metadata_fetch_enabled": app_settings.metadata_fetch_enabled,
        "watch_folder": str(app_settings.import_dir),
        **stored,
    }


@router.put("/settings")
def put_settings(values: dict[str, str], db: Session = Depends(get_db)):
    for key, value in values.items():
        row = db.get(Setting, key)
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))
    db.commit()
    return {"ok": True}
