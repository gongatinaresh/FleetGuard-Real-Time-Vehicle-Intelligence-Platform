from shapely.geometry import Point, Polygon

from app.models.alert import Alert


def normalize_polygon(coordinates):
    points = [(float(lon), float(lat)) for lat, lon in coordinates]
    if points and points[0] != points[-1]:
        points.append(points[0])
    return Polygon(points)


def is_point_inside_geofence(latitude, longitude, coordinates):
    polygon = normalize_polygon(coordinates)
    point = Point(float(longitude), float(latitude))
    return polygon.covers(point)


def resolve_geofence_transition(database, vehicle_id, geofence, latitude, longitude):
    current_state = "inside" if is_point_inside_geofence(latitude, longitude, geofence.coordinates) else "outside"

    latest_alert = (
        database.query(Alert)
        .filter(Alert.vehicle_id == vehicle_id, Alert.geofence_id == geofence.id)
        .order_by(Alert.event_time.desc(), Alert.id.desc())
        .first()
    )

    previous_state = None
    if latest_alert:
        previous_state = "inside" if latest_alert.event_type == "ENTER" else "outside"

    if previous_state is None:
        return "ENTER" if current_state == "inside" else None

    if previous_state == current_state:
        return None

    return "ENTER" if current_state == "inside" else "EXIT"
