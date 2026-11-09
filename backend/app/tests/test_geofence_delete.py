from datetime import datetime, timezone


def test_delete_geofence_without_alert_history(client):
    created = client.post(
        "/geofences",
        json={
            "name": "Empty History Zone",
            "coordinates": [
                [0.0, 0.0],
                [0.0, 0.1],
                [0.1, 0.1],
                [0.1, 0.0],
                [0.0, 0.0],
            ],
        },
    )
    assert created.status_code == 201
    geofence_id = created.json()["id"]

    deleted = client.delete(f"/geofences/{geofence_id}")
    assert deleted.status_code == 204

    missing = client.get(f"/geofences/{geofence_id}")
    assert missing.status_code == 404


def test_delete_geofence_with_alert_history_is_blocked(client):
    vehicle = client.post(
        "/vehicles",
        json={
            "registration_number": "DELTEST123",
            "name": "Deletion Test Vehicle",
            "status": "active",
        },
    )
    assert vehicle.status_code == 201
    vehicle_id = vehicle.json()["id"]

    geofence = client.post(
        "/geofences",
        json={
            "name": "Protected History Zone",
            "coordinates": [
                [0.0, 0.0],
                [0.0, 0.1],
                [0.1, 0.1],
                [0.1, 0.0],
                [0.0, 0.0],
            ],
        },
    )
    assert geofence.status_code == 201
    geofence_id = geofence.json()["id"]

    location = client.post(
        "/vehicles/location",
        json={
            "vehicle_id": vehicle_id,
            "latitude": 0.05,
            "longitude": 0.05,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
    assert location.status_code == 200

    alerts_before = client.get(
        "/alerts",
        params={
            "vehicle_id": vehicle_id,
            "geofence_id": geofence_id,
        },
    )
    assert alerts_before.status_code == 200
    assert len(alerts_before.json()) == 1
    assert alerts_before.json()[0]["event_type"] == "ENTER"

    deleted = client.delete(f"/geofences/{geofence_id}")
    assert deleted.status_code == 409

    still_exists = client.get(f"/geofences/{geofence_id}")
    assert still_exists.status_code == 200

    alerts_after = client.get(
        "/alerts",
        params={
            "vehicle_id": vehicle_id,
            "geofence_id": geofence_id,
        },
    )
    assert alerts_after.status_code == 200
    assert len(alerts_after.json()) == 1
    assert alerts_after.json()[0]["event_type"] == "ENTER"
