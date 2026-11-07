import argparse
import os
import time
from datetime import datetime, timedelta, timezone

import httpx
from shapely.geometry import Point, Polygon

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")


def fetch_vehicles():
    response = httpx.get(f"{BASE_URL}/vehicles", timeout=10)
    response.raise_for_status()
    return response.json()


def fetch_geofences():
    response = httpx.get(f"{BASE_URL}/geofences", timeout=10)
    response.raise_for_status()
    return response.json()


def send_location(vehicle_id: int, latitude: float, longitude: float, timestamp: datetime | None = None):
    response = httpx.post(
        f"{BASE_URL}/vehicles/location",
        json={
            "vehicle_id": vehicle_id,
            "latitude": latitude,
            "longitude": longitude,
            "timestamp": (timestamp or datetime.now(timezone.utc)).isoformat(),
        },
        timeout=10,
    )
    response.raise_for_status()
    print(f"Vehicle {vehicle_id} -> {latitude}, {longitude} :: {response.status_code}")
    print(response.text)


def demo_coordinates(geofence):
    polygon = Polygon([(lon, lat) for lat, lon in geofence["coordinates"]])
    if polygon.is_empty or not polygon.is_valid:
        raise ValueError(f"Geofence {geofence['id']} does not contain a valid polygon")

    inside = polygon.representative_point()
    min_lon, min_lat, max_lon, max_lat = polygon.bounds
    step = max(max_lon - min_lon, max_lat - min_lat, 0.01) * 0.1
    outside = None

    for multiplier in (1, 10, 100, 1000):
        candidates = (
            Point(min_lon - step * multiplier, (min_lat + max_lat) / 2),
            Point(max_lon + step * multiplier, (min_lat + max_lat) / 2),
            Point((min_lon + max_lon) / 2, min_lat - step * multiplier),
            Point((min_lon + max_lon) / 2, max_lat + step * multiplier),
        )
        outside = next(
            (
                point
                for point in candidates
                if -180 <= point.x <= 180
                and -90 <= point.y <= 90
                and not polygon.covers(point)
            ),
            None,
        )
        if outside is not None:
            break

    if outside is None:
        raise ValueError(f"Could not find a valid outside point for geofence {geofence['id']}")

    return (outside.y, outside.x), (inside.y, inside.x)


def run_demo(vehicle_id: int, geofence: dict, interval: float):
    outside, inside = demo_coordinates(geofence)
    trip = (("outside", outside), ("inside", inside), ("outside", outside))
    start = datetime.now(timezone.utc)

    for index, (state, (latitude, longitude)) in enumerate(trip):
        print(f"Sending {state} point for geofence {geofence['id']}")
        send_location(
            vehicle_id,
            latitude,
            longitude,
            timestamp=start + timedelta(seconds=index),
        )
        if interval and index < len(trip) - 1:
            time.sleep(interval)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send GPS updates for registered vehicles")
    parser.add_argument("--demo", action="store_true", help="send an outside-inside-outside geofence trip")
    parser.add_argument("--vehicle-id", type=int, help="vehicle to simulate; defaults to the first registered vehicle")
    parser.add_argument("--geofence-id", type=int, help="geofence for the demo; defaults to the first geofence")
    parser.add_argument("--interval", type=float, default=1, help="seconds between demo GPS updates")
    args = parser.parse_args()

    vehicles = fetch_vehicles()
    if not vehicles:
        raise SystemExit("No vehicles registered. Create a vehicle before running the simulator.")

    vehicle = next(
        (item for item in vehicles if item["id"] == args.vehicle_id),
        None,
    ) if args.vehicle_id is not None else vehicles[0]
    if vehicle is None:
        raise SystemExit(f"Vehicle {args.vehicle_id} was not found.")
    vehicle_id = vehicle["id"]

    if args.demo:
        geofences = fetch_geofences()
        if not geofences:
            raise SystemExit("No geofences registered. Create a geofence before running the demo.")
        geofence = next(
            (item for item in geofences if item["id"] == args.geofence_id),
            None,
        ) if args.geofence_id is not None else geofences[0]
        if geofence is None:
            raise SystemExit(f"Geofence {args.geofence_id} was not found.")
        if args.interval < 0:
            raise SystemExit("--interval must be zero or greater.")
        run_demo(vehicle_id, geofence, args.interval)
        raise SystemExit(0)

    while True:
        lat = 0.05 + (0.01 * __import__("random").random())
        lon = 0.05 + (0.01 * __import__("random").random())
        send_location(vehicle_id, lat, lon)
        time.sleep(5)
