import time

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.alert import Alert
from app.schemas.alert import AlertRead
from app.services.alert_service import list_alerts

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertRead])
def get_alerts(
    vehicle_id: int | None = Query(default=None),
    geofence_id: int | None = Query(default=None),
    event_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return list_alerts(db, vehicle_id=vehicle_id, geofence_id=geofence_id, event_type=event_type)


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    from app.services.alert_service import dashboard_summary

    summary = dashboard_summary(db)
    summary["recent_alerts"] = [
        {
            "id": alert.id,
            "vehicle_id": alert.vehicle_id,
            "geofence_id": alert.geofence_id,
            "event_type": alert.event_type,
            "event_time": alert.event_time.isoformat(),
            "created_at": alert.created_at.isoformat(),
        }
        for alert in summary["recent_alerts"]
    ]
    summary["time_ns"] = time.time_ns()
    return summary
