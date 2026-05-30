"""Reading statistics aggregated on the fly from reading_sessions/progress."""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Document, ReadingProgress, ReadingSession
from ..schemas import HeatmapPoint, StatsSummary, TimeseriesPoint

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _active_days(db: Session) -> set[date]:
    rows = db.execute(
        select(ReadingSession.started_at, ReadingSession.duration_sec).where(
            ReadingSession.duration_sec > 0
        )
    ).all()
    days: dict[date, int] = {}
    for started_at, dur in rows:
        d = started_at.date()
        days[d] = days.get(d, 0) + dur
    # at least 60s in a day counts toward a streak
    return {d for d, secs in days.items() if secs >= 60}


def _streaks(days: set[date]) -> tuple[int, int]:
    if not days:
        return 0, 0
    ordered = sorted(days)
    longest = cur = 1
    for prev, nxt in zip(ordered, ordered[1:]):
        if (nxt - prev).days == 1:
            cur += 1
        else:
            cur = 1
        longest = max(longest, cur)
    # current streak ending today or yesterday
    today = datetime.now(timezone.utc).date()
    current = 0
    probe = today
    if today not in days and (today - timedelta(days=1)) in days:
        probe = today - timedelta(days=1)
    while probe in days:
        current += 1
        probe -= timedelta(days=1)
    return current, longest


@router.get("/summary", response_model=StatsSummary)
def summary(db: Session = Depends(get_db)):
    total_sec = db.execute(select(func.coalesce(func.sum(ReadingSession.duration_sec), 0))).scalar_one()
    total_sessions = db.execute(select(func.count(ReadingSession.id))).scalar_one()
    started = db.execute(
        select(func.count(ReadingProgress.document_id)).where(ReadingProgress.status != "unread")
    ).scalar_one()
    finished = db.execute(
        select(func.count(ReadingProgress.document_id)).where(ReadingProgress.status == "finished")
    ).scalar_one()

    days = _active_days(db)
    current_streak, longest_streak = _streaks(days)

    now = datetime.now(timezone.utc)
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    week_start = today_start - timedelta(days=today_start.weekday())

    def minutes_since(dt: datetime) -> int:
        secs = db.execute(
            select(func.coalesce(func.sum(ReadingSession.duration_sec), 0)).where(
                ReadingSession.started_at >= dt.replace(tzinfo=None)
            )
        ).scalar_one()
        return int(secs // 60)

    return StatsSummary(
        total_minutes=int(total_sec // 60),
        total_sessions=total_sessions,
        documents_started=started,
        documents_finished=finished,
        current_streak=current_streak,
        longest_streak=longest_streak,
        minutes_today=minutes_since(today_start),
        minutes_this_week=minutes_since(week_start),
    )


@router.get("/timeseries", response_model=list[TimeseriesPoint])
def timeseries(
    db: Session = Depends(get_db),
    metric: str = Query("minutes", pattern="^(minutes|sessions)$"),
    granularity: str = Query("day", pattern="^(day|week|month)$"),
    days: int = 90,
):
    fmt = {"day": "%Y-%m-%d", "week": "%Y-%W", "month": "%Y-%m"}[granularity]
    since = datetime.now(timezone.utc) - timedelta(days=days)
    value = (
        func.sum(ReadingSession.duration_sec) / 60.0
        if metric == "minutes"
        else func.count(ReadingSession.id)
    )
    rows = db.execute(
        select(func.strftime(fmt, ReadingSession.started_at).label("bucket"), value)
        .where(ReadingSession.started_at >= since.replace(tzinfo=None))
        .group_by("bucket")
        .order_by("bucket")
    ).all()
    return [TimeseriesPoint(bucket=b, value=round(float(v or 0), 1)) for b, v in rows]


@router.get("/heatmap", response_model=list[HeatmapPoint])
def heatmap(db: Session = Depends(get_db), year: int | None = None):
    y = year or datetime.now(timezone.utc).year
    rows = db.execute(
        select(
            func.strftime("%Y-%m-%d", ReadingSession.started_at).label("d"),
            func.sum(ReadingSession.duration_sec),
        )
        .where(func.strftime("%Y", ReadingSession.started_at) == str(y))
        .group_by("d")
        .order_by("d")
    ).all()
    return [HeatmapPoint(date=d, minutes=int((s or 0) // 60)) for d, s in rows]
