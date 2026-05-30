"""Reading sessions: start / heartbeat ping / end. Feeds the stats dashboard."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Document, ReadingSession, utcnow
from ..schemas import SessionOut, SessionPing, SessionStart

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("/start", response_model=SessionOut)
def start_session(payload: SessionStart, db: Session = Depends(get_db)):
    if not db.get(Document, payload.document_id):
        raise HTTPException(404, "document not found")
    now = utcnow()
    sess = ReadingSession(
        document_id=payload.document_id,
        started_at=now,
        last_ping_at=now,
        start_percent=payload.percent,
        end_percent=payload.percent,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


@router.post("/{session_id}/ping", response_model=SessionOut)
def ping_session(session_id: int, payload: SessionPing, db: Session = Depends(get_db)):
    sess = db.get(ReadingSession, session_id)
    if not sess:
        raise HTTPException(404, "session not found")
    if sess.ended_at is not None:
        raise HTTPException(409, "session already ended")

    now = utcnow()
    last = sess.last_ping_at
    if last.tzinfo is None:
        from datetime import timezone

        last = last.replace(tzinfo=timezone.utc)
    elapsed = int((now - last).total_seconds())
    # Cap credited time so backgrounded tabs / gaps don't inflate totals.
    sess.duration_sec += max(0, min(elapsed, settings.session_ping_cap))
    sess.last_ping_at = now
    if payload.percent is not None:
        sess.end_percent = payload.percent
    if payload.pages_read is not None:
        sess.pages_read = payload.pages_read
    db.commit()
    db.refresh(sess)
    return sess


@router.post("/{session_id}/end", response_model=SessionOut)
def end_session(session_id: int, payload: SessionPing | None = None, db: Session = Depends(get_db)):
    sess = db.get(ReadingSession, session_id)
    if not sess:
        raise HTTPException(404, "session not found")
    if sess.ended_at is None:
        sess.ended_at = utcnow()
        if payload and payload.percent is not None:
            sess.end_percent = payload.percent
        db.commit()
        db.refresh(sess)
    return sess


def sweep_stale_sessions() -> None:
    """Auto-close sessions whose tab vanished (no ping recently)."""
    from ..database import SessionLocal

    cutoff = utcnow() - timedelta(seconds=settings.session_idle_timeout)
    db = SessionLocal()
    try:
        from datetime import timezone

        stale = (
            db.query(ReadingSession)
            .filter(ReadingSession.ended_at.is_(None))
            .all()
        )
        for sess in stale:
            last = sess.last_ping_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if last < cutoff:
                sess.ended_at = last
        db.commit()
    finally:
        db.close()
