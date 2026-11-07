from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class VehicleCreate(BaseModel):
    registration_number: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=2, max_length=128)
    status: str = Field(default="active", min_length=2, max_length=32)

    @field_validator("registration_number")
    @classmethod
    def normalize_registration(cls, value: str) -> str:
        return value.strip().upper()


class VehicleUpdate(BaseModel):
    registration_number: Optional[str] = Field(default=None, min_length=2, max_length=64)
    name: Optional[str] = Field(default=None, min_length=2, max_length=128)
    status: Optional[str] = Field(default=None, min_length=2, max_length=32)


class VehicleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    registration_number: str
    name: str
    status: str
    created_at: datetime
    updated_at: datetime
