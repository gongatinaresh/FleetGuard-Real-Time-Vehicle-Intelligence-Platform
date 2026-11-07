from datetime import datetime, timedelta, timezone


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert "time_ns" in payload


def test_create_vehicle_and_duplicate(client):
    payload = {"registration_number": "ABC123", "name": "Vehicle One", "status": "active"}
    first = client.post("/vehicles", json=payload)
    assert first.status_code == 201

    duplicate = client.post("/vehicles", json=payload)
    assert duplicate.status_code == 400


def test_geofence_validation_and_creation(client):
    valid = {
        "name": "Zone A",
        "description": "Office complex",
        "coordinates": [[12.0, 12.0], [12.0, 13.0], [13.0, 13.0], [13.0, 12.0], [12.0, 12.0]],
    }
    response = client.post("/geofences", json=valid)
    assert response.status_code == 201

    invalid = {"name": "Bad Zone", "coordinates": [[0, 0], [0, 1]]}
    bad_response = client.post("/geofences", json=invalid)
    assert bad_response.status_code == 422


def test_geofence_update_validates_polygon_and_preserves_existing_record(client):
    original_coordinates = [
        [12.0, 12.0],
        [12.0, 13.0],
        [13.0, 13.0],
        [13.0, 12.0],
        [12.0, 12.0],
    ]
    created = client.post("/geofences", json={"name": "Update Zone", "coordinates": original_coordinates})
    assert created.status_code == 201
    geofence_id = created.json()["id"]

    valid_update = client.put(f"/geofences/{geofence_id}", json={
        "coordinates": [[20.0, 20.0], [20.0, 21.0], [21.0, 21.0], [21.0, 20.0]],
    })
    assert valid_update.status_code == 200
    updated_coordinates = [[20.0, 20.0], [20.0, 21.0], [21.0, 21.0], [21.0, 20.0], [20.0, 20.0]]
    assert valid_update.json()["coordinates"] == updated_coordinates

    invalid_polygons = [
        [[91.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
        [[0.0, 0.0], [0.0, 1.0, 2.0], [1.0, 1.0]],
        [[0.0, 0.0], [0.0, 1.0]],
        [[0.0, 0.0], [1.0, 1.0], [0.0, 1.0], [1.0, 0.0]],
        [[0.0, 0.0], [0.0, 1.0], [0.0, 2.0]],
    ]
    for coordinates in invalid_polygons:
        response = client.put(f"/geofences/{geofence_id}", json={"coordinates": coordinates})
        assert response.status_code == 422
        assert response.json()["detail"]
        persisted = client.get(f"/geofences/{geofence_id}")
        assert persisted.status_code == 200
        assert persisted.json()["coordinates"] == updated_coordinates


def test_invalid_gps_coordinates(client):
    vehicle = client.post("/vehicles", json={"registration_number": "GPS123", "name": "GPS Test", "status": "active"})
    vehicle_id = vehicle.json()["id"]
    bad = client.post("/vehicles/location", json={"vehicle_id": vehicle_id, "latitude": 99, "longitude": 10, "timestamp": datetime.now(timezone.utc).isoformat()})
    assert bad.status_code == 422


def test_latest_vehicle_locations_returns_newest_location_per_vehicle(client):
    vehicles = [
        client.post("/vehicles", json={"registration_number": f"MAP{i}", "name": f"Map Vehicle {i}", "status": "active"}).json()
        for i in range(2)
    ]
    vehicle_without_location = client.post(
        "/vehicles",
        json={"registration_number": "MAPNONE", "name": "Map Vehicle Without Location", "status": "active"},
    ).json()
    base_time = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)
    for vehicle, latitude in zip(vehicles, (10.0, 20.0)):
        first = client.post("/vehicles/location", json={
            "vehicle_id": vehicle["id"],
            "latitude": latitude,
            "longitude": 30.0,
            "timestamp": base_time.isoformat(),
        })
        assert first.status_code == 200
        updated = client.post("/vehicles/location", json={
            "vehicle_id": vehicle["id"],
            "latitude": latitude + 0.5,
            "longitude": 30.5,
            "timestamp": (base_time + timedelta(seconds=1)).isoformat(),
        })
        assert updated.status_code == 200

    locations = client.get("/vehicles/locations/latest")
    assert locations.status_code == 200
    by_vehicle = {location["vehicle_id"]: location for location in locations.json()}
    assert len(by_vehicle) == 2
    assert vehicle_without_location["id"] not in by_vehicle
    assert by_vehicle[vehicles[0]["id"]]["latitude"] == 10.5
    assert by_vehicle[vehicles[1]["id"]]["latitude"] == 20.5


def test_enter_event_detection(client):
    vehicle = client.post("/vehicles", json={"registration_number": "ENT123", "name": "Enter Vehicle", "status": "active"})
    vehicle_id = vehicle.json()["id"]
    geofence = client.post("/geofences", json={
        "name": "Warehouse",
        "description": "Warehouse area",
        "coordinates": [[0.0, 0.0], [0.0, 0.1], [0.1, 0.1], [0.1, 0.0], [0.0, 0.0]],
    })
    geofence_id = geofence.json()["id"]
    response = client.post("/vehicles/location", json={
        "vehicle_id": vehicle_id,
        "latitude": 0.05,
        "longitude": 0.05,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    assert response.status_code == 200
    alerts = client.get("/alerts", params={"vehicle_id": vehicle_id, "geofence_id": geofence_id})
    assert alerts.status_code == 200
    assert len(alerts.json()) == 1
    assert alerts.json()[0]["event_type"] == "ENTER"


def test_exit_event_detection(client):
    vehicle = client.post("/vehicles", json={"registration_number": "EXT123", "name": "Exit Vehicle", "status": "active"})
    vehicle_id = vehicle.json()["id"]
    geofence = client.post("/geofences", json={
        "name": "Zone B",
        "description": "Boundary area",
        "coordinates": [[0.0, 0.0], [0.0, 0.1], [0.1, 0.1], [0.1, 0.0], [0.0, 0.0]],
    })
    geofence_id = geofence.json()["id"]
    client.post("/vehicles/location", json={"vehicle_id": vehicle_id, "latitude": 0.05, "longitude": 0.05, "timestamp": datetime.now(timezone.utc).isoformat()})
    response = client.post("/vehicles/location", json={"vehicle_id": vehicle_id, "latitude": 1.0, "longitude": 1.0, "timestamp": (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()})
    assert response.status_code == 200
    alerts = client.get("/alerts", params={"vehicle_id": vehicle_id, "geofence_id": geofence_id})
    assert alerts.status_code == 200
    assert any(item["event_type"] == "EXIT" for item in alerts.json())


def test_no_duplicate_events_when_state_does_not_change(client):
    vehicle = client.post("/vehicles", json={"registration_number": "NO_DUP", "name": "No Duplicate", "status": "active"})
    vehicle_id = vehicle.json()["id"]
    geofence = client.post("/geofences", json={"name": "No Duplicate Zone", "coordinates": [[0.0, 0.0], [0.0, 0.1], [0.1, 0.1], [0.1, 0.0], [0.0, 0.0]]})
    geofence_id = geofence.json()["id"]
    now = datetime.now(timezone.utc)
    client.post("/vehicles/location", json={"vehicle_id": vehicle_id, "latitude": 0.05, "longitude": 0.05, "timestamp": now.isoformat()})
    client.post("/vehicles/location", json={"vehicle_id": vehicle_id, "latitude": 0.05, "longitude": 0.05, "timestamp": (now + timedelta(minutes=1)).isoformat()})
    alerts = client.get("/alerts", params={"vehicle_id": vehicle_id, "geofence_id": geofence_id})
    assert len(alerts.json()) == 1


def test_boundary_point_is_inside(client):
    vehicle = client.post("/vehicles", json={"registration_number": "BOUND", "name": "Boundary", "status": "active"})
    vehicle_id = vehicle.json()["id"]
    geofence = client.post("/geofences", json={"name": "Boundary Zone", "coordinates": [[0.0, 0.0], [0.0, 0.1], [0.1, 0.1], [0.1, 0.0], [0.0, 0.0]]})
    geofence_id = geofence.json()["id"]
    response = client.post("/vehicles/location", json={"vehicle_id": vehicle_id, "latitude": 0.1, "longitude": 0.0, "timestamp": datetime.now(timezone.utc).isoformat()})
    assert response.status_code == 200
    alerts = client.get("/alerts", params={"vehicle_id": vehicle_id, "geofence_id": geofence_id})
    assert len(alerts.json()) == 1
    assert alerts.json()[0]["event_type"] == "ENTER"


def test_alert_history_filters(client):
    vehicle = client.post("/vehicles", json={"registration_number": "FILTER", "name": "Filtered", "status": "active"})
    vehicle_id = vehicle.json()["id"]
    geofence = client.post("/geofences", json={"name": "Filter Zone", "coordinates": [[0.0, 0.0], [0.0, 0.1], [0.1, 0.1], [0.1, 0.0], [0.0, 0.0]]})
    geofence_id = geofence.json()["id"]
    client.post("/vehicles/location", json={"vehicle_id": vehicle_id, "latitude": 0.05, "longitude": 0.05, "timestamp": datetime.now(timezone.utc).isoformat()})
    response = client.get("/alerts", params={"vehicle_id": vehicle_id, "event_type": "ENTER"})
    assert response.status_code == 200
    assert response.json()[0]["geofence_id"] == geofence_id


def test_dashboard_summary(client):
    summary = client.get("/alerts/summary")
    assert summary.status_code == 200
    payload = summary.json()
    assert "total_vehicles" in payload
    assert "total_geofences" in payload
    assert "total_alerts" in payload


def test_websocket_alert_broadcast(client):
    vehicle = client.post("/vehicles", json={"registration_number": "WS123", "name": "WebSocket Vehicle", "status": "active"})
    vehicle_id = vehicle.json()["id"]
    geofence = client.post("/geofences", json={
        "name": "Live Zone",
        "coordinates": [[0.0, 0.0], [0.0, 0.1], [0.1, 0.1], [0.1, 0.0], [0.0, 0.0]],
    })
    geofence_id = geofence.json()["id"]
    with client.websocket_connect("/ws") as websocket:
        client.post("/vehicles/location", json={
            "vehicle_id": vehicle_id,
            "latitude": 0.05,
            "longitude": 0.05,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        location_payload = websocket.receive_json()
        assert location_payload["type"] == "location"
        payload = websocket.receive_json()
        assert payload["type"] == "alert"
        assert payload["data"]["vehicle_id"] == vehicle_id
        assert payload["data"]["geofence_id"] == geofence_id
        assert payload["data"]["event_type"] == "ENTER"
        assert isinstance(payload["data"]["id"], int)


def test_websocket_broadcasts_location_updates(client):
    vehicle = client.post("/vehicles", json={"registration_number": "WSLOC", "name": "Location Vehicle", "status": "active"})
    vehicle_id = vehicle.json()["id"]
    timestamp = datetime.now(timezone.utc).isoformat()

    with client.websocket_connect("/ws") as websocket:
        response = client.post("/vehicles/location", json={
            "vehicle_id": vehicle_id,
            "latitude": 51.5,
            "longitude": -0.12,
            "timestamp": timestamp,
        })
        assert response.status_code == 200
        payload = websocket.receive_json()
        assert payload["type"] == "location"
        assert payload["data"]["vehicle_id"] == vehicle_id
        assert payload["data"]["latitude"] == 51.5
        assert payload["data"]["longitude"] == -0.12
