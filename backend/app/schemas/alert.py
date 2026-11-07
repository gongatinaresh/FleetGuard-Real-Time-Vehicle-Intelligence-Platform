from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class AlertCreate(BaseModel):
    vehicle_id: int = Field(..., gt=0)
    geofence_id: int = Field(..., gt=0)
    event_type: str = Field(..., pattern="^(ENTER|EXIT)$")
    event_time: datetime


class AlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    vehicle_id: int
    geofence_id: int
    event_type: str
    event_time: datetime
    is_read: str
    created_at: datetime


class AlertListQuery(BaseModel):
    vehicle_id: Optional[int] = None
    geofence_id: Optional[int] = None
    event_type: Optional[str] = None
