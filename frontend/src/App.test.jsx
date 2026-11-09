/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const sockets = [];
let App;

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom }) => (
    <div data-testid="map" data-center={center.join(',')} data-zoom={zoom}>{children}</div>
  ),
  Marker: ({ children }) => <div>{children}</div>,
  Polygon: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  TileLayer: ({ url, attribution }) => (
    <div data-testid="map-tile-layer" data-url={url} data-attribution={attribution} />
  ),
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), getZoom: () => 13 }),
}));

class MockWebSocket {
  constructor(url) {
    this.url = url;
    sockets.push(this);
  }

  receive(payload) {
    act(() => this.onmessage?.({ data: JSON.stringify(payload) }));
  }

  disconnectFromServer() {
    act(() => this.onclose?.());
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }
}

function summary(totalAlerts = 0) {
  return {
    total_vehicles: 0,
    active_vehicles: 0,
    total_geofences: 0,
    total_alerts: totalAlerts,
    recent_alerts: [],
  };
}

function mockApi({ totalAlerts = 0, summaryRequest, vehicles = [], locations = [], alerts = [], geofences = [] } = {}) {
  const responses = {
    '/api/vehicles': vehicles,
    '/api/vehicles/locations/latest': locations,
    '/api/geofences': geofences,
    '/api/alerts': alerts,
  };
  axios.get.mockImplementation((url) => {
    if (url === '/api/alerts/summary') {
      return summaryRequest ?? Promise.resolve({ data: summary(totalAlerts) });
    }
    return Promise.resolve({ data: responses[url] });
  });
}

function alertMessage(id) {
  return {
    type: 'alert',
    data: {
      id,
      vehicle_id: 17,
      geofence_id: 4,
      event_type: 'ENTER',
      event_time: '2026-11-07T10:00:00Z',
    },
  };
}

function totalAlertCount() {
  return screen.getByText('Total alerts').parentElement.querySelector('strong');
}

beforeAll(async () => {
  window.__APP_CONFIG__ = { VITE_API_BASE_URL: '/api', VITE_WS_URL: '/ws' };
  App = (await import('./App')).default;
});

afterAll(() => {
  delete window.__APP_CONFIG__;
});

async function renderDashboard() {
  render(<App />);
  await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(5));
  return waitFor(() => expect(screen.getByTestId('map')).toBeInTheDocument());
}

beforeEach(() => {
  sockets.length = 0;
  window.WebSocket = MockWebSocket;
  mockApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('dashboard', () => {
  it('renders the dashboard after loading its API data', async () => {
    await renderDashboard();

    expect(screen.getByRole('heading', { name: 'Vehicle Geofencing Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live vehicle map' })).toBeInTheDocument();
    expect(totalAlertCount()).toHaveTextContent('0');
    expect(screen.getByTestId('map')).toHaveAttribute('data-center', '12.9716,77.5946');
    expect(screen.getByTestId('map')).toHaveAttribute('data-zoom', '12');
    expect(screen.getByTestId('map-tile-layer')).toHaveAttribute(
      'data-url',
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
    expect(screen.getByTestId('map-tile-layer').getAttribute('data-attribution')).toContain('OpenStreetMap');
    expect(sockets[0].url).toBe(
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
    );
  });

  it('identifies fixed Bengaluru demonstration locations separately from backend GPS', async () => {
    mockApi({
      vehicles: [{ id: 44, registration_number: 'FLEET-044', name: 'Actual van', status: 'active' }],
      locations: [{
        vehicle_id: 44,
        latitude: 12.9,
        longitude: 77.6,
        timestamp: '2026-11-07T10:00:00Z',
      }],
    });
    await renderDashboard();

    expect(screen.getByText(/Latest GPS location: 12\.900000, 77\.600000/)).toBeInTheDocument();
    expect(screen.getAllByText(/SIMULATED DEMO GPS/)).toHaveLength(6);
    expect(screen.getAllByText('SIMULATED DEMO ZONE')).toHaveLength(3);
    expect(screen.getByText(/Whitefield delivery van · Whitefield/)).toBeInTheDocument();
    expect(screen.getByText(/Electronic City service vehicle · Electronic City/)).toBeInTheDocument();
    expect(screen.getByText(/Marathahalli cargo vehicle · Marathahalli/)).toBeInTheDocument();
    expect(screen.getByText(/Hebbal operations vehicle · Hebbal/)).toBeInTheDocument();
    expect(screen.getByText(/Koramangala fleet vehicle · Koramangala/)).toBeInTheDocument();
    expect(screen.getByText(/Yelahanka dispatch vehicle · Yelahanka/)).toBeInTheDocument();
    expect(screen.getByText('1 vehicle with backend GPS locations')).toBeInTheDocument();
    expect(screen.getByText('6 fixed simulated demo vehicles · map only')).toBeInTheDocument();
    expect(screen.getByText('1 vehicle')).toBeInTheDocument();
  });


  it('renders persisted alert history and filters entries and exits', async () => {
    const vehicles = [{ id: 17, registration_number: 'FLEET-017', name: 'Delivery van', status: 'active' }];
    const geofences = [{ id: 4, name: 'Central Warehouse', coordinates: [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]] }];
    const alerts = [
      { id: 201, vehicle_id: 17, geofence_id: 4, event_type: 'ENTER', event_time: '2026-11-08T10:00:00Z', is_read: 'unread', created_at: '2026-11-08T10:00:00Z' },
      { id: 202, vehicle_id: 17, geofence_id: 4, event_type: 'EXIT', event_time: '2026-11-08T11:00:00Z', is_read: 'unread', created_at: '2026-11-08T11:00:00Z' },
    ];
    mockApi({ totalAlerts: 2, vehicles, geofences, alerts });
    await renderDashboard();

    const alertSection = screen.getByLabelText('Geofence alerts');

    expect(screen.getByText('2 recorded')).toBeInTheDocument();
    expect(within(alertSection).getAllByText('FLEET-017')).toHaveLength(2);
    expect(within(alertSection).getByText('entered')).toBeInTheDocument();
    expect(within(alertSection).getByText('exited')).toBeInTheDocument();
    expect(within(alertSection).getAllByText('Central Warehouse')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Entries' }));
    expect(screen.getByText('ENTER')).toBeInTheDocument();
    expect(screen.queryByText('EXIT')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Exits' }));
    expect(screen.getByText('EXIT')).toBeInTheDocument();
    expect(screen.queryByText('ENTER')).not.toBeInTheDocument();
  });

  it('shows a WebSocket alert and increments the total immediately', async () => {
    await renderDashboard();

    act(() => sockets[0].receive(alertMessage(101)));

    expect(await screen.findByText('Vehicle 17')).toBeInTheDocument();
    expect(totalAlertCount()).toHaveTextContent('1');
  });

  it('does not count the same alert ID twice', async () => {
    await renderDashboard();
    act(() => {
      sockets[0].receive(alertMessage(102));
      sockets[0].receive(alertMessage(102));
    });

    expect(await screen.findByText('Vehicle 17')).toBeInTheDocument();
    expect(totalAlertCount()).toHaveTextContent('1');
    expect(screen.getAllByText('Vehicle 17')).toHaveLength(1);
  });

  it('does not duplicate a previously received alert after reconnecting', async () => {
    await renderDashboard();
    act(() => sockets[0].receive(alertMessage(103)));
    expect(totalAlertCount()).toHaveTextContent('1');

    vi.useFakeTimers();
    sockets[0].disconnectFromServer();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(sockets).toHaveLength(2);
    act(() => sockets[1].receive(alertMessage(103)));

    expect(totalAlertCount()).toHaveTextContent('1');
    expect(screen.getAllByText('Vehicle 17')).toHaveLength(1);
  });

  it('keeps the newer live count when an older summary response resolves later', async () => {
    let resolveSummary;
    const summaryRequest = new Promise((resolve) => {
      resolveSummary = resolve;
    }).then((data) => ({ data }));
    mockApi({ summaryRequest });
    render(<App />);
    await waitFor(() => expect(sockets).toHaveLength(1));

    act(() => sockets[0].receive(alertMessage(104)));
    expect(totalAlertCount()).toHaveTextContent('1');

    await act(async () => resolveSummary(summary(0)));

    expect(totalAlertCount()).toHaveTextContent('1');
  });

  it('sends configured GPS coordinates to the real location API and reports its response', async () => {
    mockApi({
      vehicles: [{ id: 27, registration_number: 'GPS-027', name: 'Test vehicle', status: 'active' }],
    });
    axios.post.mockResolvedValue({
      status: 200,
      data: { status: 'ok', alerts_generated: 1 },
    });
    await renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: 'Configure GPS simulation for GPS-027' }));
    expect(screen.getByRole('region', { name: 'GPS simulation mode' })).toHaveTextContent('Selected vehicle: GPS-027 (ID 27)');
    expect(screen.getByText(/coordinates —, —/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Latitude (-90 to 90)'), { target: { value: '12.345' } });
    fireEvent.change(screen.getByLabelText('Longitude (-180 to 180)'), { target: { value: '-45.678' } });
    expect(screen.getByText(/coordinates 12.345, -45.678/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send GPS update' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Backend accepted update (HTTP 200); 1 alert generated.');
    expect(axios.post).toHaveBeenCalledWith(
      '/api/vehicles/location',
      expect.objectContaining({
        vehicle_id: 27,
        latitude: 12.345,
        longitude: -45.678,
      }),
    );
  });

  it('reports the actual backend error when a simulated GPS update fails', async () => {
    mockApi({
      vehicles: [{ id: 28, registration_number: 'GPS-028', name: 'Test vehicle', status: 'active' }],
    });
    axios.post.mockRejectedValue({
      response: { data: { detail: 'Vehicle not found' } },
      message: 'Request failed',
    });
    await renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: 'Configure GPS simulation for GPS-028' }));
    fireEvent.change(screen.getByLabelText('Latitude (-90 to 90)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Longitude (-180 to 180)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send GPS update' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Backend rejected update: Vehicle not found');
  });

  it('rejects invalid coordinates before sending a GPS update', async () => {
    mockApi({
      vehicles: [{ id: 29, registration_number: 'GPS-029', name: 'Test vehicle', status: 'active' }],
    });
    await renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Configure GPS simulation for GPS-029' }));
    fireEvent.change(screen.getByLabelText('Latitude (-90 to 90)'), { target: { value: '91' } });
    fireEvent.change(screen.getByLabelText('Longitude (-180 to 180)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send GPS update' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Enter valid latitude (-90 to 90)');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('formats geofence validation errors instead of showing [object Object]', async () => {
    axios.post.mockRejectedValue({
      response: {
        data: {
          detail: [
            {
              loc: ['body', 'coordinates', 0],
              msg: 'Each coordinate must contain latitude and longitude.',
            },
          ],
        },
      },
      message: 'Request failed',
    });
    await renderDashboard();

    fireEvent.change(screen.getByLabelText('Geofence name'), {
      target: { value: 'Test Zone' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create geofence' }));

    expect(await screen.findByText(
      'Could not create geofence: coordinates.0: Each coordinate must contain latitude and longitude.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it('filters vehicles by registration and deletes a vehicle after confirmation', async () => {
    const vehicles = [
      { id: 31, registration_number: 'FLEET-031', name: 'North van', status: 'active' },
      { id: 32, registration_number: 'FLEET-032', name: 'South van', status: 'inactive' },
    ];
    mockApi({ vehicles });
    axios.delete.mockImplementation(async (url) => {
      expect(url).toBe('/api/vehicles/31');
      mockApi({ vehicles: [vehicles[1]] });
      return { status: 204 };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderDashboard();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search vehicles by registration' }), {
      target: { value: '032' },
    });
    expect(screen.getByText('FLEET-032')).toBeInTheDocument();
    expect(screen.queryByText('FLEET-031')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search vehicles by registration' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete FLEET-031' }));
    expect(window.confirm).toHaveBeenCalledWith(
      'Delete FLEET-031? This vehicle will be removed from the active fleet.',
    );
    expect(await screen.findByRole('status')).toHaveTextContent('FLEET-031 deleted successfully.');
    await waitFor(() => expect(screen.queryByText('FLEET-031')).not.toBeInTheDocument());
    expect(axios.delete).toHaveBeenCalledWith('/api/vehicles/31');
  });
});
