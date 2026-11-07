from typing import Optional

from sqlalchemy import or_

from app.models.alert import Alert


def list_alerts(database, vehicle_id: Optional[int] = None, geofence_id: Optional[int] = None, event_type: Optional[str] = None):
    query = database.query(Alert)
    if vehicle_id is not None:
        query = query.filter(Alert.vehicle_id == vehicle_id)
    if geofence_id is not None:
        query = query.filter(Alert.geofence_id == geofence_id)
    if event_type is not None:
        query = query.filter(Alert.event_type == event_type)
    return query.order_by(Alert.event_time.desc(), Alert.id.desc()).all()


def dashboard_summary(database):
    from app.models.geofence import Geofence
    from app.models.vehicle import Vehicle

    total_vehicles = database.query(Vehicle).filter_by(is_deleted=False).count()
    active_vehicles = database.query(Vehicle).filter_by(is_deleted=False, status="active").count()
    total_geofences = database.query(Geofence).count()
    total_alerts = database.query(Alert).count()
    recent_alerts = database.query(Alert).order_by(Alert.event_time.desc(), Alert.id.desc()).limit(10).all()
    return {
        "total_vehicles": total_vehicles,
        "active_vehicles": active_vehicles,
        "total_geofences": total_geofences,
        "total_alerts": total_alerts,
        "recent_alerts": recent_alerts,
    }
