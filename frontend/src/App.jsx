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

const markerIcon = L.divIcon({
  className: 'vehicle-marker-icon',
  html: '<span class="vehicle-marker-dot"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});
const staleMarkerIcon = L.divIcon({
  className: 'stale-vehicle-marker-icon',
  html: '<span class="vehicle-marker-dot stale-vehicle-marker-dot"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const defaultMapCenter = [12.9716, 77.5946];
const GPS_STALE_AFTER_MS = 5 * 60 * 1000;

const defaultVehicle = { registration_number: '', name: '', status: 'active' };
const defaultGeofence = { name: '', description: '', coordinates: '0,0;0,0.1;0.1,0.1;0.1,0;0,0' };

export default function App() {
  const [vehicles, setVehicles] = useState([]);
  const [vehicleLocations, setVehicleLocations] = useState({});
  const [geofences, setGeofences] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertFilter, setAlertFilter] = useState('ALL');
  const [summary, setSummary] = useState({ total_vehicles: 0, active_vehicles: 0, total_geofences: 0, total_alerts: 0 });
  const seenAlertIds = useRef(new Set());
  const [vehicleForm, setVehicleForm] = useState(defaultVehicle);
  const [geofenceForm, setGeofenceForm] = useState(defaultGeofence);
  const [simulationVehicleId, setSimulationVehicleId] = useState(null);
  const [simulationCoordinates, setSimulationCoordinates] = useState({ latitude: '', longitude: '' });
  const [simulationResult, setSimulationResult] = useState(null);
  const [simulationPending, setSimulationPending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [deletingVehicleId, setDeletingVehicleId] = useState(null);
  const [deletingGeofenceId, setDeletingGeofenceId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [formError, setFormError] = useState('');

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
        setConnectionStatus('connected');
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
      socket.onerror = () => {
        console.warn('WebSocket connection failed');
        setConnectionStatus('reconnecting');
      };
      socket.onclose = () => {
        setConnectionStatus('reconnecting');
        if (disconnected) return;
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      };
    };

    connect();
    const staleRefreshTimer = window.setInterval(() => {
      setVehicleLocations((current) => ({ ...current }));
    }, 30000);

    return () => {
      disconnected = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(staleRefreshTimer);
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
  const allMapPoints = useMemo(
    () => mapPoints,
    [mapPoints],
  );
  const trackedVehicles = useMemo(
    () => vehicles.map((vehicle) => {
      const location = vehicleLocations[vehicle.id];
      return {
        ...vehicle,
        location,
        locationStatus: getVehicleLocationStatus(location),
      };
    }),
    [vehicles, vehicleLocations],
  );
  const locatedVehicles = useMemo(
    () => trackedVehicles.filter((vehicle) => vehicle.location),
    [trackedVehicles],
  );
  const filteredAlerts = useMemo(() => {
    if (alertFilter === 'ALL') return alerts;
    return alerts.filter((alert) => (alert.event_type || '').toUpperCase() === alertFilter);
  }, [alerts, alertFilter]);
  const filteredVehicles = useMemo(() => {
    const query = vehicleSearch.trim().toLowerCase();
    if (!query) return vehicles;
    return vehicles.filter((vehicle) =>
      (vehicle.registration_number || '').toLowerCase().includes(query),
    );
  }, [vehicleSearch, vehicles]);
  const mapBoundsPoints = useMemo(
    () => [
      ...locatedVehicles.map(({ location }) => [location.latitude, location.longitude]),
      ...allMapPoints.flatMap(({ latlngs }) => latlngs),
    ],
    [locatedVehicles, allMapPoints],
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
      const vehiclesData = Array.isArray(vehicleRes.data) ? vehicleRes.data : [];
      const locationData = Array.isArray(locationRes.data) ? locationRes.data : [];
      const geofenceData = Array.isArray(geofenceRes.data) ? geofenceRes.data : [];
      const alertData = Array.isArray(alertRes.data) ? alertRes.data : [];
      const summaryData = summaryRes?.data && typeof summaryRes.data === 'object' ? summaryRes.data : {};

      setVehicles(vehiclesData);
      const latestLocations = locationData
        .map(normalizeLocation)
        .filter(Boolean);
      setVehicleLocations((current) => mergeVehicleLocations(current, latestLocations));
      setGeofences(geofenceData);
      alertData.forEach((alert) => {
        if (Number.isFinite(Number(alert.id))) {
          seenAlertIds.current.add(Number(alert.id));
        }
      });
      setAlerts((current) => {
        const byId = new Map(current.map((alert) => [alert.id, alert]));
        alertData.forEach((alert) => {
          if (Number.isFinite(Number(alert.id))) {
            byId.set(Number(alert.id), alert);
          }
        });
        return [...byId.values()]
          .sort((left, right) => Date.parse(right.event_time) - Date.parse(left.event_time))
          .slice(0, 10);
      });
      setSummary((current) => ({
        ...current,
        ...summaryData,
        total_alerts: Number.isFinite(Number(summaryData.total_alerts))
          ? Math.max(Number(summaryData.total_alerts), current.total_alerts)
          : current.total_alerts,
      }));
    } catch (error) {
      console.error('Failed to load dashboard data', error);
      const detail = formatApiError(error);
      setNotice({ type: 'error', message: `Dashboard data could not be refreshed: ${detail}` });
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleVehicleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    try {
      await axios.post(`${API_BASE}/vehicles`, vehicleForm);
      setVehicleForm(defaultVehicle);
      setNotice({ type: 'success', message: 'Vehicle added successfully.' });
      await loadData();
    } catch (error) {
      const detail = formatApiError(error);
      setFormError(`Could not add vehicle: ${detail}`);
    }
  };

  const handleVehicleDelete = async (vehicle) => {
    const registration = vehicle.registration_number || vehicle.name || `Vehicle ${vehicle.id}`;
    if (!window.confirm(`Delete ${registration}? This vehicle will be removed from the active fleet.`)) return;

    setDeletingVehicleId(vehicle.id);
    setNotice(null);
    try {
      await axios.delete(`${API_BASE}/vehicles/${vehicle.id}`);
      setVehicles((current) => current.filter((item) => item.id !== vehicle.id));
      setVehicleLocations((current) => {
        const next = { ...current };
        delete next[vehicle.id];
        return next;
      });
      if (simulationVehicleId === vehicle.id) {
        setSimulationVehicleId(null);
        setSimulationCoordinates({ latitude: '', longitude: '' });
        setSimulationResult(null);
      }
      setNotice({ type: 'success', message: `${registration} deleted successfully.` });
      await loadData();
    } catch (error) {
      const detail = formatApiError(error);
      setNotice({ type: 'error', message: `Could not delete ${registration}: ${detail}` });
    } finally {
      setDeletingVehicleId(null);
    }
  };

  const handleGeofenceDelete = async (geofence) => {
    const name = geofence.name || `Geofence ${geofence.id}`;
    const confirmed = window.confirm(
      `Delete "${name}"? This cannot be undone. If this geofence has recorded ENTER/EXIT alerts, the backend will block deletion to preserve that history.`,
    );
    if (!confirmed) return;

    setDeletingGeofenceId(geofence.id);
    setNotice(null);
    try {
      await axios.delete(`${API_BASE}/geofences/${geofence.id}`);
      setGeofences((current) => current.filter((item) => item.id !== geofence.id));
      setNotice({ type: 'success', message: `${name} deleted successfully.` });
      await loadData();
    } catch (error) {
      const detail = formatApiError(error);
      setNotice({ type: 'error', message: `Could not delete ${name}: ${detail}` });
    } finally {
      setDeletingGeofenceId(null);
    }
  };

  const handleGeofenceSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    try {
      const coordinates = geofenceForm.coordinates
        .split(';')
        .map((point) => PointStringToPair(point));
      await axios.post(`${API_BASE}/geofences`, {
        name: geofenceForm.name,
        description: geofenceForm.description,
        coordinates,
      });
      setGeofenceForm(defaultGeofence);
      setNotice({ type: 'success', message: 'Geofence created successfully.' });
      await loadData();
    } catch (error) {
      const detail = formatApiError(error);
      setFormError(`Could not create geofence: ${detail}`);
    }
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
      const detail = formatApiError(error);
      setSimulationResult({ type: 'error', message: `Backend rejected update: ${detail}` });
    } finally {
      setSimulationPending(false);
    }
  };

  const activeVehicleCount = vehicles.filter((vehicle) => vehicle.status?.toLowerCase() === 'active').length;
  const inactiveVehicleCount = vehicles.filter((vehicle) => vehicle.status?.toLowerCase() === 'inactive').length;

  return (
    <div className="app-shell" id="dashboard">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="FleetGuard dashboard">
          <span className="brand-mark"><Icon name="shield" /></span>
          <span><strong>FleetGuard</strong><small>FLEET INTELLIGENCE</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-link active" href="#dashboard"><Icon name="grid" />Dashboard</a>
          <a className="nav-link" href="#live-tracking"><Icon name="map" />Live Tracking<span className="nav-live-dot" /></a>
          <a className="nav-link" href="#vehicles"><Icon name="truck" />Vehicles</a>
          <button className="nav-link unavailable" type="button" disabled title="Driver management is not available in this workspace"><Icon name="users" />Drivers</button>
          <button className="nav-link unavailable" type="button" disabled title="Trip management is not available in this workspace"><Icon name="route" />Trips</button>
          <a className="nav-link" href="#geofences"><Icon name="pin" />Geofences</a>
          <a className="nav-link" href="#alerts"><Icon name="bell" />Alerts{alerts.length > 0 && <span className="nav-count">{alerts.length}</span>}</a>
          <button className="nav-link unavailable" type="button" disabled title="Reports are not available in this workspace"><Icon name="chart" />Reports</button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-link unavailable" type="button" disabled title="Settings are not available in this workspace"><Icon name="settings" />Settings</button>
          <div className="sidebar-footnote"><span className="connection-dot" />Fleet systems operational</div>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div className="page-heading">
            <p className="eyebrow">FLEET OVERVIEW</p>
            <h1>Vehicle Geofencing Dashboard</h1>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Icon name="search" />
              <input
                aria-label="Search vehicles by registration"
                placeholder="Search registration..."
                value={vehicleSearch}
                onChange={(event) => setVehicleSearch(event.target.value)}
              />
              <kbd>/</kbd>
            </label>
            <span className={`connection-status ${connectionStatus}`}>
              <span className="connection-dot" />
              {connectionStatus === 'connected' ? 'Live' : connectionStatus === 'connecting' ? 'Connecting' : 'Reconnecting'}
            </span>
            <button className="icon-button refresh-button" type="button" onClick={loadData} aria-label="Refresh dashboard" title="Refresh dashboard">
              <Icon name="refresh" />
            </button>
            <a className="icon-button notification-button" href="#alerts" aria-label="View alerts" title="View alerts">
              <Icon name="bell" />
              {alerts.length > 0 && <span className="notification-dot" />}
            </a>
            <div className="profile-chip">
              <span className="avatar">FG</span>
              <span className="profile-copy"><strong>Fleet Admin</strong><small>Administrator</small></span>
              <Icon name="chevron" />
            </div>
          </div>
        </header>

        <div className="dashboard-content">
          {notice && <p className={`notice ${notice.type}`} role="status">{notice.message}</p>}
          {formError && <p className="notice error" role="alert">{formError}</p>}

          <section className="stats-grid" aria-label="Fleet statistics">
            <StatCard icon="truck" label="Total vehicles" value={summary.total_vehicles} detail="Registered in fleet" tone="orange" />
            <StatCard icon="activity" label="Active vehicles" value={summary.active_vehicles} detail="Currently active" tone="green" />
            <StatCard icon="pause" label="Inactive vehicles" value={inactiveVehicleCount} detail="Marked inactive" tone="blue" />
            <StatCard icon="pin" label="Total geofences" value={summary.total_geofences ?? geofences.length} detail="Configured zones" tone="purple" />
            <StatCard icon="bell" label="Total alerts" value={summary.total_alerts} detail="Recorded events" tone="red" />
          </section>

          <div className="overview-grid">
            <section className="panel map-panel" id="live-tracking">
              <div className="panel-heading map-heading">
                <div>
                  <p className="eyebrow">REAL-TIME OPERATIONS</p>
                  <h2>Live vehicle map</h2>
                </div>
                <div className="map-legend"><span className="legend-vehicle" />LIVE <span className="legend-stale" />GPS STALE</div>
              </div>
              <MapContainer center={defaultMapCenter} zoom={12} scrollWheelZoom={true} className="map-container">
                <MapViewport points={mapBoundsPoints} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {allMapPoints.map((geofence) => (
                  <Polygon
                    key={geofence.id}
                    positions={geofence.latlngs}
                    pathOptions={{ color: '#f7933a', fillColor: '#f7933a', fillOpacity: 0.13, weight: 2 }}
                  >
                    <Popup>
                      <strong>{geofence.name}</strong>
                    </Popup>
                  </Polygon>
                ))}
                {locatedVehicles.map((vehicle) => (
                  <Marker
                    key={vehicle.id}
                    position={[vehicle.location.latitude, vehicle.location.longitude]}
                    icon={vehicle.locationStatus === 'GPS STALE' ? staleMarkerIcon : markerIcon}
                    title={`${vehicle.registration_number} — ${vehicle.locationStatus}`}
                  >
                    <Popup>
                      <strong>{vehicle.registration_number}</strong>
                      <br />
                      {vehicle.name}
                      <br />
                      Status: {vehicle.locationStatus}
                      <br />
                      Coordinates: {vehicle.location.latitude.toFixed(6)}, {vehicle.location.longitude.toFixed(6)}
                      <br />
                      Timestamp: {formatTimestamp(vehicle.location.timestamp)}
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
              <div className="map-footer">
                <span><span className="connection-dot" />{locatedVehicles.length} {locatedVehicles.length === 1 ? 'vehicle' : 'vehicles'} with backend GPS locations</span>
                <div className="coordinate-strip" aria-label="Latest GPS coordinates">
                  {locatedVehicles.length === 0 ? <span>No GPS coordinates received yet</span> : locatedVehicles.slice(0, 3).map((vehicle) => (
                    <span key={vehicle.id}><strong>{vehicle.registration_number}</strong> {vehicle.location.latitude.toFixed(4)}, {vehicle.location.longitude.toFixed(4)} · {vehicle.locationStatus}</span>
                  ))}
                </div>
              </div>
            </section>

            <section className="panel alerts-panel" id="alerts" aria-label="Geofence alerts">
              <div className="panel-heading">
                <div><p className="eyebrow">ACTIVITY FEED</p><h2>Recent alerts</h2><p className="section-description">Vehicle entry and exit events from saved GPS updates.</p></div>
                <span className="live-tag"><span className="connection-dot" />LIVE</span>
              </div>
              <div className="alert-toolbar" aria-label="Filter alerts">
                <span className="alert-count">{summary.total_alerts} recorded</span>
                <div className="alert-filters">
                  {['ALL', 'ENTER', 'EXIT'].map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={`alert-filter ${alertFilter === filter ? 'active' : ''}`}
                      aria-pressed={alertFilter === filter}
                      onClick={() => setAlertFilter(filter)}
                    >
                      {filter === 'ALL' ? 'All' : filter === 'ENTER' ? 'Entries' : 'Exits'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="alert-list" aria-live="polite">
                {alerts.length === 0 ? (
                  <div className="empty-state"><span className="empty-icon"><Icon name="bell" /></span><strong>No alerts yet</strong><p>Create a vehicle and geofence, then send a GPS update inside or outside the zone.</p></div>
                ) : filteredAlerts.length === 0 ? (
                  <div className="empty-state"><span className="empty-icon"><Icon name="bell" /></span><strong>No matching alerts</strong><p>Try another alert filter.</p></div>
                ) : filteredAlerts.slice(0, 10).map((alert) => {
                  const vehicle = vehicles.find((item) => Number(item.id) === Number(alert.vehicle_id));
                  const geofence = geofences.find((item) => Number(item.id) === Number(alert.geofence_id));
                  const eventType = (alert.event_type || 'EVENT').toUpperCase();
                  const eventVerb = eventType === 'ENTER' ? 'entered' : eventType === 'EXIT' ? 'exited' : 'triggered an event in';
                  return (
                    <article key={alert.id} className="alert-item">
                      <span className={`alert-icon ${eventType.toLowerCase()}`}><Icon name={eventType === 'ENTER' ? 'enter' : 'exit'} /></span>
                      <div className="alert-copy">
                        <div className="alert-title"><strong>{vehicle?.registration_number || `Vehicle ${alert.vehicle_id}`}</strong><span className={`pill ${eventType.toLowerCase()}`}>{eventType}</span></div>
                        <small>{eventVerb} <strong>{geofence?.name || `Geofence ${alert.geofence_id}`}</strong></small>
                        <time dateTime={alert.event_time}>{formatTimestamp(alert.event_time)}</time>
                      </div>
                    </article>
                  );
                })}
              </div>
              <a className="text-link" href="#alerts">Showing latest matching events <Icon name="chevron" /></a>
            </section>
          </div>

          <section className="panel vehicle-management" id="vehicles">
            <div className="panel-heading section-heading">
              <div><p className="eyebrow">FLEET DIRECTORY</p><h2>Vehicle management</h2><p className="section-description">Manage registered vehicles and their GPS tracking.</p></div>
              <span className="vehicle-total">{vehicles.length} {vehicles.length === 1 ? 'vehicle' : 'vehicles'}</span>
            </div>
            <div className="management-grid">
              <div className="vehicle-list-column">
                <div className="list-header"><span>VEHICLE</span><span>STATUS</span><span>GPS</span><span>ACTIONS</span></div>
                <div className="vehicle-list">
                  {filteredVehicles.length === 0 ? (
                    <p className="vehicle-empty">{vehicles.length === 0 ? 'No vehicles registered yet.' : 'No vehicles match that registration.'}</p>
                  ) : filteredVehicles.map((vehicle) => {
                    const location = vehicleLocations[vehicle.id];
                    const gpsStatus = getVehicleLocationStatus(location);
                    return (
                      <article key={vehicle.id} className="vehicle-row">
                        <div className="vehicle-identity">
                          <span className="vehicle-avatar"><Icon name="truck" /></span>
                          <span><strong>{vehicle.name || 'Unnamed vehicle'}</strong><small>{vehicle.registration_number}</small></span>
                        </div>
                        <span className={`status-pill ${(vehicle.status || 'unknown').toLowerCase()}`}><span />{vehicle.status || 'Unknown'}</span>
                        <span className={`gps-state ${gpsStatus === 'LIVE' ? 'available' : gpsStatus === 'GPS STALE' ? 'stale' : 'pending'}`}><span />{gpsStatus}</span>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="small-button simulate-button"
                            aria-label={`Configure GPS simulation for ${vehicle.registration_number}`}
                            onClick={() => {
                              setSimulationVehicleId(vehicle.id);
                              setSimulationCoordinates({ latitude: '', longitude: '' });
                              setSimulationResult(null);
                            }}
                          >
                            <Icon name="activity" /><span>Simulate GPS</span>
                          </button>
                          <button
                            type="button"
                            className="icon-button delete-button"
                            aria-label={`Delete ${vehicle.registration_number}`}
                            title={`Delete ${vehicle.registration_number}`}
                            disabled={deletingVehicleId === vehicle.id}
                            onClick={() => handleVehicleDelete(vehicle)}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <section className="create-vehicle-card">
                <div className="form-card-heading"><span className="form-icon"><Icon name="plus" /></span><div><h3>Add vehicle</h3><p>Register a vehicle to your fleet.</p></div></div>
                <form onSubmit={handleVehicleSubmit} className="stack-form">
                  <label>Registration number<input required value={vehicleForm.registration_number} onChange={(event) => setVehicleForm({ ...vehicleForm, registration_number: event.target.value })} placeholder="e.g. FG-2048" /></label>
                  <label>Vehicle name<input required value={vehicleForm.name} onChange={(event) => setVehicleForm({ ...vehicleForm, name: event.target.value })} placeholder="e.g. Delivery Van 04" /></label>
                  <label>Vehicle status<select value={vehicleForm.status} onChange={(event) => setVehicleForm({ ...vehicleForm, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
                  <button type="submit" className="primary-button"><Icon name="plus" />Add vehicle</button>
                </form>
              </section>
            </div>
          </section>

          {simulationVehicleId !== null && (
            <section className="panel simulation-panel" aria-label="GPS Simulation (Testing)">
              <div className="panel-heading section-heading">
                <div><p className="eyebrow">LOCATION TESTING</p><h2>GPS Simulation (Testing)</h2><p className="section-description">Test GPS data is simulated for integration testing only and is not live hardware telemetry.</p></div>
                <button type="button" className="secondary-button" onClick={() => setSimulationVehicleId(null)}>Close simulation</button>
              </div>
              <p className="selected-vehicle">Selected vehicle: <strong>{vehicles.find((vehicle) => vehicle.id === simulationVehicleId)?.registration_number || `Vehicle ${simulationVehicleId}`}</strong> <span>(ID {simulationVehicleId})</span></p>
              <form onSubmit={simulateGpsUpdate} className="simulation-form">
                <label>Latitude (-90 to 90)<input aria-label="Latitude (-90 to 90)" type="number" step="any" value={simulationCoordinates.latitude} onChange={(event) => { setSimulationCoordinates((current) => ({ ...current, latitude: event.target.value })); setSimulationResult(null); }} /></label>
                <label>Longitude (-180 to 180)<input aria-label="Longitude (-180 to 180)" type="number" step="any" value={simulationCoordinates.longitude} onChange={(event) => { setSimulationCoordinates((current) => ({ ...current, longitude: event.target.value })); setSimulationResult(null); }} /></label>
                <p className="coordinate-preview">Sending vehicle ID {simulationVehicleId} at coordinates {simulationCoordinates.latitude || '—'}, {simulationCoordinates.longitude || '—'}</p>
                <button type="submit" className="primary-button" disabled={simulationPending}>{simulationPending ? 'Sending GPS update…' : 'Send GPS update'}</button>
                {simulationResult && <p className={`simulation-result ${simulationResult.type}`} role="status" aria-live="polite" data-result={simulationResult.type}>{simulationResult.message}</p>}
              </form>
            </section>
          )}

          <section className="panel geofence-panel" id="geofences">
            <div className="panel-heading section-heading">
              <div><p className="eyebrow">LOCATION BOUNDARIES</p><h2>Geofence management</h2><p className="section-description">Create zones to monitor vehicle entry and exit events.</p></div>
              <span className="vehicle-total">{geofences.length} configured</span>
            </div>
            <div className="geofence-content">
              <div className="geofence-list">
                {geofences.length === 0 ? <p className="vehicle-empty">No geofences configured yet.</p> : geofences.map((geofence) => (
                  <div className="geofence-row" key={geofence.id}>
                    <span className="geofence-icon"><Icon name="pin" /></span>
                    <span className="geofence-row-copy">
                      <strong>{geofence.name}</strong>
                      <small>{geofence.description || `${geofence.coordinates?.length || 0} polygon points`}</small>
                    </span>
                    <button
                      type="button"
                      className="icon-button delete-button geofence-delete-button"
                      aria-label={`Delete geofence ${geofence.name}`}
                      title={`Delete ${geofence.name}`}
                      disabled={deletingGeofenceId === geofence.id}
                      onClick={() => handleGeofenceDelete(geofence)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
              </div>
              <form onSubmit={handleGeofenceSubmit} className="stack-form geofence-form">
                <label>Geofence name<input required value={geofenceForm.name} onChange={(event) => setGeofenceForm({ ...geofenceForm, name: event.target.value })} placeholder="e.g. North distribution hub" /></label>
                <label>Description<input value={geofenceForm.description} onChange={(event) => setGeofenceForm({ ...geofenceForm, description: event.target.value })} placeholder="Optional details" /></label>
                <label>Polygon coordinates<textarea required value={geofenceForm.coordinates} onChange={(event) => setGeofenceForm({ ...geofenceForm, coordinates: event.target.value })} rows="3" placeholder="0,0;0,0.1;0.1,0.1;0.1,0;0,0" /></label>
                <small className="form-hint">Enter latitude,longitude pairs separated by semicolons.</small>
                <button type="submit" className="primary-button"><Icon name="plus" />Create geofence</button>
              </form>
            </div>
          </section>
          <footer className="dashboard-footer">FleetGuard <span>·</span> Real-time vehicle intelligence</footer>
        </div>
      </main>
    </div>
  );
}

function MapViewport({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 12);
      return;
    }
    map.fitBounds(points, { padding: [30, 30], maxZoom: 12 });
  }, [map, points]);

  return null;
}

function StatCard({ icon, label, value, detail, tone }) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-card-top">
        <span className="stat-label">{label}<strong>{value ?? 0}</strong></span>
        <span className="stat-icon"><Icon name={icon} /></span>
      </div>
      <small>{detail}</small>
    </article>
  );
}

function Icon({ name }) {
  const paths = {
    shield: 'M12 3 4.5 6v5.5c0 4.6 3.2 7.7 7.5 9.5 4.3-1.8 7.5-4.9 7.5-9.5V6L12 3Z M9 12l2 2 4-4',
    grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
    map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z M9 3v15 M15 6v15',
    truck: 'M3 6h11v12H3z M14 10h4l3 3v5h-7z M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M20 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    route: 'M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M18 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M8 6h5a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3h-2a3 3 0 0 0-3 3v1',
    pin: 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
    chart: 'M4 19V5 M4 19h17 M8 15l4-5 4 3 5-7',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.75.62l-.05.07h-3.4l-.05-.07a1.7 1.7 0 0 0-1.75-.62l-.08.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 9.6 15l-.08-.04v-3.4l.08-.04a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.7-2.94.08.02a1.7 1.7 0 0 0 1.75-.62l.05-.07h3.4l.05.07a1.7 1.7 0 0 0 1.75.62l.08-.02 1.7 2.94-.06.06a1.7 1.7 0 0 0-.34 1.88l.08.04v3.4l-.08.04Z',
    search: 'm20 20-4.5-4.5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
    refresh: 'M20 7v5h-5 M4 17v-5h5 M5.6 9a7 7 0 0 1 11.6-2L20 12 M4 12l2.8 5a7 7 0 0 0 11.6-2',
    chevron: 'm9 18 6-6-6-6',
    activity: 'M3 12h4l3-8 4 16 3-8h4',
    pause: 'M8 5v14 M16 5v14',
    enter: 'M4 12h12 M11 7l5 5-5 5 M20 5v14',
    exit: 'M20 12H8 M13 7l-5 5 5 5 M4 5v14',
    trash: 'M4 7h16 M10 11v6 M14 11v6 M5 7l1 14h12l1-14 M9 7V4h6v3',
    plus: 'M12 5v14 M5 12h14',
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.grid} /></svg>;
}

function formatTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'Time unavailable';
}

function getVehicleLocationStatus(location) {
  if (!location) return 'LOCATION PENDING';
  const timestamp = Number.isFinite(Date.parse(location.timestamp)) ? Date.parse(location.timestamp) : Number.NaN;
  if (!Number.isFinite(timestamp)) return 'GPS STALE';
  const age = Date.now() - timestamp;
  return age >= 0 && age <= GPS_STALE_AFTER_MS ? 'LIVE' : 'GPS STALE';
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
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { ...location, vehicle_id: vehicleId, latitude, longitude };
}

function mergeVehicleLocations(current, incoming) {
  return incoming.reduce((locations, location) => {
    const previous = locations[location.vehicle_id];
    const previousTimestamp = previous && previous.timestamp ? Date.parse(previous.timestamp) : Number.NaN;
    const incomingTimestamp = location.timestamp ? Date.parse(location.timestamp) : Number.NaN;
    const previousHasValidTimestamp = Number.isFinite(previousTimestamp);
    const incomingHasValidTimestamp = Number.isFinite(incomingTimestamp);

    if (!previous) {
      locations[location.vehicle_id] = location;
      return locations;
    }

    if (!incomingHasValidTimestamp) {
      if (!previousHasValidTimestamp) {
        locations[location.vehicle_id] = location;
      }
      return locations;
    }

    if (!previousHasValidTimestamp || incomingTimestamp >= previousTimestamp) {
      locations[location.vehicle_id] = location;
    }
    return locations;
  }, { ...current });
}


function formatApiError(error) {
  const detail = error?.response?.data?.detail;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        const location = Array.isArray(item?.loc)
          ? item.loc.filter((part) => part !== 'body').join('.')
          : '';
        const message = item?.msg || item?.message || 'Invalid value';
        return location ? `${location}: ${message}` : message;
      })
      .join('; ');
  }

  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    return detail.message || JSON.stringify(detail);
  }
  return error?.message || 'Request failed.';
}

function PointStringToPair(point) {
  const [lat, lon] = point.split(',').map(Number);
  return [lat, lon];
}
