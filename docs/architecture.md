# Architecture notes

The backend exposes business APIs for vehicle, geofence, and alert workflows. Requests are validated through FastAPI and Pydantic models, then persisted in SQLAlchemy models and stored in a relational database.

The geofence detection service uses Shapely to compute whether a point falls within a polygon. A point on the polygon edge is treated as inside the geofence to avoid edge-case false negatives.

The frontend dashboard consumes the backend REST API and shows summary cards, geofence polygons, and live event notifications via WebSockets.
