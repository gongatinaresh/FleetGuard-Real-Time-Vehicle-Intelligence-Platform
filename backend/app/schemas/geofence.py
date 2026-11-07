from datetime import datetime
import math
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from shapely.geometry import Polygon
from shapely.validation import explain_validity


def validate_polygon_coordinates(value):
    if value is None:
        return value
    if len(value) < 3:
        raise ValueError("A geofence must have at least 3 coordinate pairs.")
    for pair in value:
        if len(pair) != 2:
            raise ValueError("Each coordinate must contain latitude and longitude.")
        lat, lon = pair
        if not math.isfinite(lat) or not math.isfinite(lon):
            raise ValueError("Coordinates must be finite numbers.")
        if not (-90 <= lat <= 90):
            raise ValueError("Latitude must be between -90 and 90 degrees.")
        if not (-180 <= lon <= 180):
            raise ValueError("Longitude must be between -180 and 180 degrees.")
    if value[0] != value[-1]:
        value = value + [value[0]]
    if len({tuple(pair) for pair in value[:-1]}) < 3:
        raise ValueError("A geofence polygon must contain at least 3 distinct coordinate pairs.")

    polygon = Polygon([(lon, lat) for lat, lon in value])
    if polygon.is_empty or polygon.area == 0:
        raise ValueError("A geofence polygon must enclose a non-zero area.")
    if not polygon.is_valid:
        raise ValueError(f"Invalid geofence polygon: {explain_validity(polygon)}")
    return value


class GeofenceCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=128)
    description: str = Field(default="")
    coordinates: List[List[float]] = Field(..., min_length=3)

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, value):
        return validate_polygon_coordinates(value)


class GeofenceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=128)
    description: Optional[str] = Field(default=None)
    coordinates: Optional[List[List[float]]] = Field(default=None)

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, value):
        return validate_polygon_coordinates(value)


class GeofenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    coordinates: List[List[float]]
    created_at: datetime
    updated_at: datetime
