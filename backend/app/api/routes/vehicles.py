import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.location import VehicleLocation
from app.models.vehicle import Vehicle
from app.schemas.location import VehicleLocationCreate, VehicleLocationRead
from app.schemas.vehicle import VehicleCreate, VehicleRead, VehicleUpdate
from app.services.location_service import save_vehicle_location
from app.websocket.manager import websocket_manager

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("", response_model=list[VehicleRead])
def list_vehicles(db: Session = Depends(get_db)):
    return db.query(Vehicle).filter_by(is_deleted=False).order_by(Vehicle.id.asc()).all()


@router.post("", response_model=VehicleRead, status_code=status.HTTP_201_CREATED)
def create_vehicle(payload: VehicleCreate, db: Session = Depends(get_db)):
    existing = db.query(Vehicle).filter_by(registration_number=payload.registration_number).first()
    if existing and not existing.is_deleted:
        raise HTTPException(status_code=400, detail="Vehicle registration must be unique")
    vehicle = Vehicle(**payload.model_dump())
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.get("/{vehicle_id}", response_model=VehicleRead)
def get_vehicle(vehicle_id: int, db: Session = Depends(get_db)):
    vehicle = db.query(Vehicle).filter_by(id=vehicle_id, is_deleted=False).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


@router.put("/{vehicle_id}", response_model=VehicleRead)
def update_vehicle(vehicle_id: int, payload: VehicleUpdate, db: Session = Depends(get_db)):
    vehicle = db.query(Vehicle).filter_by(id=vehicle_id, is_deleted=False).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    data = payload.model_dump(exclude_unset=True)
    if "registration_number" in data and data["registration_number"]:
        existing = db.query(Vehicle).filter_by(registration_number=data["registration_number"]).first()
        if existing and existing.id != vehicle.id:
            raise HTTPException(status_code=400, detail="Vehicle registration must be unique")
    for key, value in data.items():
        if value is not None:
            setattr(vehicle, key, value)
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_db)):
    vehicle = db.query(Vehicle).filter_by(id=vehicle_id, is_deleted=False).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicle.is_deleted = True
    db.commit()


@router.get("/locations/latest", response_model=list[VehicleLocationRead])
def get_latest_vehicle_locations(db: Session = Depends(get_db)):
    latest_location_ids = (
        db.query(
            VehicleLocation.id.label("location_id"),
            func.row_number()
            .over(
                partition_by=VehicleLocation.vehicle_id,
                order_by=(VehicleLocation.timestamp.desc(), VehicleLocation.id.desc()),
            )
            .label("location_rank"),
        )
        .join(Vehicle, Vehicle.id == VehicleLocation.vehicle_id)
        .filter(Vehicle.is_deleted.is_(False))
        .subquery()
    )
    return (
        db.query(VehicleLocation)
        .join(latest_location_ids, VehicleLocation.id == latest_location_ids.c.location_id)
        .filter(latest_location_ids.c.location_rank == 1)
        .order_by(VehicleLocation.vehicle_id.asc())
        .all()
    )


@router.post("/location")
async def create_vehicle_location(payload: VehicleLocationCreate, db: Session = Depends(get_db)):
    location, alerts = save_vehicle_location(db, payload.vehicle_id, payload.latitude, payload.longitude, payload.timestamp)
    await websocket_manager.broadcast({
        "type": "location",
        "data": {
            "vehicle_id": location.vehicle_id,
            "latitude": location.latitude,
            "longitude": location.longitude,
            "timestamp": location.timestamp.isoformat(),
        },
    })
    for alert in alerts:
        await websocket_manager.broadcast({
            "type": "alert",
            "data": {
                "id": alert.id,
                "vehicle_id": alert.vehicle_id,
                "geofence_id": alert.geofence_id,
                "event_type": alert.event_type,
                "event_time": alert.event_time.isoformat(),
            },
        })
    return {"status": "ok", "vehicle_id": payload.vehicle_id, "alerts_generated": len(alerts), "time_ns": time.time_ns()}
