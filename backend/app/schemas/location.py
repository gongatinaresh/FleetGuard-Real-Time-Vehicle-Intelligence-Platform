from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class VehicleLocationCreate(BaseModel):
    vehicle_id: int = Field(..., gt=0)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    timestamp: datetime


class VehicleLocationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    vehicle_id: int
    latitude: float
    longitude: float
    timestamp: datetime
