from datetime import datetime, timezone

from fastapi import HTTPException

from app.models.alert import Alert
from app.models.geofence import Geofence
from app.models.location import VehicleLocation
from app.models.vehicle import Vehicle
from app.services.geofence_service import resolve_geofence_transition


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def save_vehicle_location(database, vehicle_id: int, latitude: float, longitude: float, timestamp: datetime):
    vehicle = database.query(Vehicle).filter_by(id=vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    if latitude < -90 or latitude > 90:
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90 degrees")
    if longitude < -180 or longitude > 180:
        raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180 degrees")

    timestamp = _as_utc(timestamp)

    latest_location = (
        database.query(VehicleLocation)
        .filter_by(vehicle_id=vehicle_id)
        .order_by(VehicleLocation.timestamp.desc(), VehicleLocation.id.desc())
        .first()
    )
    if latest_location and timestamp < _as_utc(latest_location.timestamp):
        raise HTTPException(status_code=400, detail="GPS timestamp is older than the latest known vehicle position")

    entry = VehicleLocation(vehicle_id=vehicle_id, latitude=latitude, longitude=longitude, timestamp=timestamp)
    database.add(entry)
    database.flush()

    alerts = []
    geofences = database.query(Geofence).all()
    for geofence in geofences:
        event_type = resolve_geofence_transition(database, vehicle_id, geofence, latitude, longitude)
        if event_type:
            alert = Alert(
                vehicle_id=vehicle_id,
                geofence_id=geofence.id,
                event_type=event_type,
                event_time=timestamp,
            )
            database.add(alert)
            alerts.append(alert)

    database.commit()
    return entry, alerts
