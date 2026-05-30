"""Watch-folder import status and manual rescan."""

from fastapi import APIRouter

from ..config import settings
from ..services.watcher import manager

router = APIRouter(prefix="/api/import", tags=["import"])


@router.get("/status")
def import_status():
    failed_dir = settings.import_dir / ".failed"
    failed = [p.name for p in failed_dir.glob("*") if p.is_file()] if failed_dir.exists() else []
    return {
        "enabled": settings.watch_enabled,
        "watch_folder": str(settings.import_dir),
        "recent": manager.last_results,
        "failed": failed,
    }


@router.post("/scan")
def trigger_scan():
    results = manager.scan_now()
    return {"scanned": len(results), "results": results}
