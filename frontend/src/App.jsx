import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { MapContainer, Marker, Polygon, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';

const runtimeConfig = window.__APP_CONFIG__ || {};
const API_BASE = runtimeConfig.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const configuredWsUrl = runtimeConfig.VITE_WS_URL || import.meta.env.VITE_WS_URL || `${API_BASE.replace(/^http/, 'ws')}/ws`;
const WS_BASE = configuredWsUrl.startsWith('/')
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${configuredWsUrl}`
  : configuredWsUrl;

const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const defaultVehicle = { registration_number: '', name: '', status: 'active' };
const defaultGeofence = { name: '', description: '', coordinates: '0,0;0,0.1;0.1,0.1;0.1,0;0,0' };

export default function App() {
  const [vehicles, setVehicles] = useState([]);
  const [vehicleLocations, setVehicleLocations] = useState({});
  const [geofences, setGeofences] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [summary, setSummary] = useState({ total_vehicles: 0, active_vehicles: 0, total_geofences: 0, total_alerts: 0 });
  const seenAlertIds = useRef(new Set());
  const [vehicleForm, setVehicleForm] = useState(defaultVehicle);
  const [geofenceForm, setGeofenceForm] = useState(defaultGeofence);
  const [simulationVehicleId, setSimulationVehicleId] = useState(null);
  const [simulationCoordinates, setSimulationCoordinates] = useState({ latitude: '', longitude: '' });
  const [simulationResult, setSimulationResult] = useState(null);
  const [simulationPending, setSimulationPending] = useState(false);

  useEffect(() => {
    let socket;
    let reconnectTimer;
    let reconnectDelay = 1000;
    let disconnected = false;

    const connect = () => {
      if (disconnected) return;
      socket = new WebSocket(WS_BASE);
      socket.onopen = () => {
        reconnectDelay = 1000;
      };
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === 'location') {
          const location = normalizeLocation(payload.data);
          if (location) {
            setVehicleLocations((current) => mergeVehicleLocations(current, [location]));
          }
        }
        if (payload.type === 'alert') {
          const alertId = Number(payload.data.id);
          if (!Number.isInteger(alertId) || seenAlertIds.current.has(alertId)) return;
          seenAlertIds.current.add(alertId);
          const newAlert = { ...payload.data, id: alertId };
          setAlerts((current) => [newAlert, ...current].slice(0, 10));
          setSummary((current) => ({
            ...current,
            total_alerts: current.total_alerts + 1,
          }));
        }
      };
      socket.onerror = () => console.warn('WebSocket connection failed');
      socket.onclose = () => {
        if (disconnected) return;
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      };
    };

    connect();
    return () => {
      disconnected = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  const mapPoints = useMemo(
    () =>
      geofences.map((geofence) => ({
        id: geofence.id,
        latlngs: geofence.coordinates.map(([lat, lon]) => [lat, lon]),
        name: geofence.name,
      })),
    [geofences],
  );
  const locatedVehicles = useMemo(
    () => vehicles
      .map((vehicle) => ({ ...vehicle, location: vehicleLocations[vehicle.id] }))
      .filter((vehicle) => vehicle.location),
    [vehicles, vehicleLocations],
  );
  const mapBoundsPoints = useMemo(
    () => [
      ...locatedVehicles.map(({ location }) => [location.latitude, location.longitude]),
      ...mapPoints.flatMap(({ latlngs }) => latlngs),
    ],
    [locatedVehicles, mapPoints],
  );

  const loadData = async () => {
    try {
      const [vehicleRes, locationRes, geofenceRes, alertRes, summaryRes] = await Promise.all([
        axios.get(`${API_BASE}/vehicles`),
        axios.get(`${API_BASE}/vehicles/locations/latest`),
        axios.get(`${API_BASE}/geofences`),
        axios.get(`${API_BASE}/alerts`),
        axios.get(`${API_BASE}/alerts/summary`),
      ]);
      setVehicles(vehicleRes.data);
      const latestLocations = locationRes.data
        .map(normalizeLocation)
        .filter(Boolean);
      setVehicleLocations((current) => mergeVehicleLocations(current, latestLocations));
      setGeofences(geofenceRes.data);
      alertRes.data.forEach((alert) => seenAlertIds.current.add(alert.id));
      setAlerts((current) => {
        const byId = new Map(current.map((alert) => [alert.id, alert]));
        alertRes.data.forEach((alert) => byId.set(alert.id, alert));
        return [...byId.values()]
          .sort((left, right) => Date.parse(right.event_time) - Date.parse(left.event_time))
          .slice(0, 10);
      });
      setSummary((current) => ({
        ...summaryRes.data,
        total_alerts: Math.max(summaryRes.data.total_alerts, current.total_alerts),
      }));
    } catch (error) {
      console.error('Failed to load dashboard data', error);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleVehicleSubmit = async (event) => {
    event.preventDefault();
    await axios.post(`${API_BASE}/vehicles`, vehicleForm);
    setVehicleForm(defaultVehicle);
    loadData();
  };

  const handleGeofenceSubmit = async (event) => {
    event.preventDefault();
    const coordinates = geofenceForm.coordinates
      .split(';')
      .map((point) => PointStringToPair(point));
    await axios.post(`${API_BASE}/geofences`, {
      name: geofenceForm.name,
      description: geofenceForm.description,
      coordinates,
    });
    setGeofenceForm(defaultGeofence);
    loadData();
  };

  const simulateGpsUpdate = async (event) => {
    event.preventDefault();
    const latitude = Number(simulationCoordinates.latitude);
    const longitude = Number(simulationCoordinates.longitude);
    if (
      simulationCoordinates.latitude.trim() === '' ||
      simulationCoordinates.longitude.trim() === '' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      setSimulationResult({ type: 'error', message: 'Enter valid latitude (-90 to 90) and longitude (-180 to 180).' });
      return;
    }

    const vehicleId = Number(simulationVehicleId);
    const payload = {
      vehicle_id: vehicleId,
      latitude,
      longitude,
      timestamp: new Date().toISOString(),
    };
    setSimulationPending(true);
    setSimulationResult(null);
    try {
      const response = await axios.post(`${API_BASE}/vehicles/location`, payload);
      const alertCount = response.data.alerts_generated ?? 0;
      setSimulationResult({
        type: 'success',
        message: `Backend accepted update (HTTP ${response.status}); ${alertCount} alert${alertCount === 1 ? '' : 's'} generated.`,
      });
      loadData();
    } catch (error) {
      const detail = error.response?.data?.detail || error.message || 'Request failed.';
      setSimulationResult({ type: 'error', message: `Backend rejected update: ${detail}` });
    } finally {
      setSimulationPending(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Fleet safety</p>
          <h1>Vehicle Geofencing Dashboard</h1>
        </div>
        <button className="secondary-button" onClick={loadData}>Refresh</button>
      </header>

      <section className="stats-grid">
        <div className="stat-card"><span>Total vehicles</span><strong>{summary.total_vehicles}</strong></div>
        <div className="stat-card"><span>Active vehicles</span><strong>{summary.active_vehicles}</strong></div>
        <div className="stat-card"><span>Total geofences</span><strong>{summary.total_geofences}</strong></div>
        <div className="stat-card"><span>Total alerts</span><strong>{summary.total_alerts}</strong></div>
      </section>

      <div className="content-grid">
        <div className="panel map-panel">
          <h2>Live vehicle map</h2>
          <MapContainer center={[0.06, 0.06]} zoom={13} scrollWheelZoom={true} className="map-container">
            <MapViewport points={mapBoundsPoints} />
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {mapPoints.map((geofence) => (
              <Polygon key={geofence.id} positions={geofence.latlngs} pathOptions={{ color: 'green', fillOpacity: 0.2 }}>
                <Popup>{geofence.name}</Popup>
              </Polygon>
            ))}
            {locatedVehicles.map((vehicle) => (
              <Marker
                key={vehicle.id}
                position={[vehicle.location.latitude, vehicle.location.longitude]}
                icon={markerIcon}
                title={vehicle.registration_number}
              >
                <Popup>
                  <strong>{vehicle.registration_number}</strong>
                  <br />
                  {vehicle.name}
                  <br />
                  Latest location: {vehicle.location.latitude.toFixed(6)}, {vehicle.location.longitude.toFixed(6)}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <aside className="panel">
          <h2>Vehicle management</h2>
          <form onSubmit={handleVehicleSubmit} className="stack-form">
            <input value={vehicleForm.registration_number} onChange={(event) => setVehicleForm({ ...vehicleForm, registration_number: event.target.value })} placeholder="Registration number" />
            <input value={vehicleForm.name} onChange={(event) => setVehicleForm({ ...vehicleForm, name: event.target.value })} placeholder="Vehicle name" />
            <select value={vehicleForm.status} onChange={(event) => setVehicleForm({ ...vehicleForm, status: event.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button type="submit">Add vehicle</button>
          </form>

          <div className="vehicle-list">
            {vehicles.map((vehicle) => (
              <div key={vehicle.id} className="list-row">
                <div>
                  <strong>{vehicle.name}</strong>
                  <small>{vehicle.registration_number}</small>
                </div>
                <button
                  type="button"
                  className="small-button"
                  aria-label={`Configure GPS simulation for ${vehicle.registration_number}`}
                  onClick={() => {
                    setSimulationVehicleId(vehicle.id);
                    setSimulationCoordinates({ latitude: '', longitude: '' });
                    setSimulationResult(null);
                  }}
                >
                  Configure GPS simulation
                </button>
              </div>
            ))}
          </div>

          {simulationVehicleId !== null && (
            <section className="simulation-panel" aria-label="GPS simulation mode">
              <h3>GPS simulation mode</h3>
              <p>Vehicle ID: {simulationVehicleId} ({vehicles.find((vehicle) => vehicle.id === simulationVehicleId)?.registration_number})</p>
              <form onSubmit={simulateGpsUpdate} className="stack-form">
                <label>
                  Latitude (-90 to 90)
                  <input
                    type="number"
                    step="any"
                    value={simulationCoordinates.latitude}
                    onChange={(event) => {
                      setSimulationCoordinates((current) => ({ ...current, latitude: event.target.value }));
                      setSimulationResult(null);
                    }}
                  />
                </label>
                <label>
                  Longitude (-180 to 180)
                  <input
                    type="number"
                    step="any"
                    value={simulationCoordinates.longitude}
                    onChange={(event) => {
                      setSimulationCoordinates((current) => ({ ...current, longitude: event.target.value }));
                      setSimulationResult(null);
                    }}
                  />
                </label>
                <p>
                  Sending vehicle ID {simulationVehicleId} at coordinates{' '}
                  {simulationCoordinates.latitude || '—'}, {simulationCoordinates.longitude || '—'}
                </p>
                <button type="submit" disabled={simulationPending}>
                  {simulationPending ? 'Sending GPS update…' : 'Send GPS update'}
                </button>
                <button type="button" className="secondary-button" onClick={() => setSimulationVehicleId(null)}>
                  Close simulation
                </button>
                {simulationResult && (
                  <p role="status" aria-live="polite" data-result={simulationResult.type}>
                    {simulationResult.message}
                  </p>
                )}
              </form>
            </section>
          )}
        </aside>
      </div>

      <div className="bottom-grid">
        <section className="panel">
          <h2>Geofence management</h2>
          <form onSubmit={handleGeofenceSubmit} className="stack-form">
            <input value={geofenceForm.name} onChange={(event) => setGeofenceForm({ ...geofenceForm, name: event.target.value })} placeholder="Geofence name" />
            <input value={geofenceForm.description} onChange={(event) => setGeofenceForm({ ...geofenceForm, description: event.target.value })} placeholder="Description" />
            <textarea value={geofenceForm.coordinates} onChange={(event) => setGeofenceForm({ ...geofenceForm, coordinates: event.target.value })} rows="4" placeholder="0,0;0,0.1;0.1,0.1;0.1,0;0,0" />
            <button type="submit">Create geofence</button>
          </form>
        </section>

        <section className="panel">
          <h2>Recent alerts</h2>
          <div className="alert-list">
            {alerts.length === 0 ? <p>No alerts yet.</p> : alerts.slice(0, 8).map((alert) => (
              <div key={alert.id} className="alert-item">
                <span className={`pill ${alert.event_type.toLowerCase()}`}>{alert.event_type}</span>
                <div>
                  <strong>Vehicle {alert.vehicle_id}</strong>
                  <small>Geofence {alert.geofence_id}</small>
                </div>
                <time>{new Date(alert.event_time).toLocaleString()}</time>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function MapViewport({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 13));
      return;
    }
    map.fitBounds(points, { padding: [30, 30], maxZoom: 13 });
  }, [map, points]);

  return null;
}

function normalizeLocation(location) {
  if (!location) return null;
  const vehicleId = Number(location.vehicle_id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) return null;
  if (
    location.latitude === null ||
    location.latitude === undefined ||
    location.longitude === null ||
    location.longitude === undefined ||
    (typeof location.latitude === 'string' && !location.latitude.trim()) ||
    (typeof location.longitude === 'string' && !location.longitude.trim())
  ) {
    return null;
  }
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const timestamp = Date.parse(location.timestamp);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  return { ...location, vehicle_id: vehicleId, latitude, longitude };
}

function mergeVehicleLocations(current, incoming) {
  return incoming.reduce((locations, location) => {
    const previous = locations[location.vehicle_id];
    if (!previous || Date.parse(location.timestamp) >= Date.parse(previous.timestamp)) {
      locations[location.vehicle_id] = location;
    }
    return locations;
  }, { ...current });
}

function PointStringToPair(point) {
  const [lat, lon] = point.split(',').map(Number);
  return [lat, lon];
}
