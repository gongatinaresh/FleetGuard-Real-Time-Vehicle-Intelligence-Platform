from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.geofence import Geofence
from app.schemas.geofence import GeofenceCreate, GeofenceRead, GeofenceUpdate

router = APIRouter(prefix="/geofences", tags=["geofences"])


@router.get("", response_model=list[GeofenceRead])
def list_geofences(db: Session = Depends(get_db)):
    return db.query(Geofence).order_by(Geofence.id.asc()).all()


@router.post("", response_model=GeofenceRead, status_code=status.HTTP_201_CREATED)
def create_geofence(payload: GeofenceCreate, db: Session = Depends(get_db)):
    geofence = Geofence(**payload.model_dump())
    db.add(geofence)
    db.commit()
    db.refresh(geofence)
    return geofence


@router.get("/{geofence_id}", response_model=GeofenceRead)
def get_geofence(geofence_id: int, db: Session = Depends(get_db)):
    geofence = db.query(Geofence).filter_by(id=geofence_id).first()
    if not geofence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    return geofence


@router.put("/{geofence_id}", response_model=GeofenceRead)
def update_geofence(geofence_id: int, payload: GeofenceUpdate, db: Session = Depends(get_db)):
    geofence = db.query(Geofence).filter_by(id=geofence_id).first()
    if not geofence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is not None:
            setattr(geofence, key, value)
    db.commit()
    db.refresh(geofence)
    return geofence


@router.delete("/{geofence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_geofence(geofence_id: int, db: Session = Depends(get_db)):
    geofence = db.query(Geofence).filter_by(id=geofence_id).first()
    if not geofence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    db.delete(geofence)
    db.commit()
