/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const sockets = [];
let App;

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  Marker: ({ children }) => <div>{children}</div>,
  Polygon: () => null,
  Popup: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
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

function mockApi({ totalAlerts = 0, summaryRequest, vehicles = [] } = {}) {
  const responses = {
    '/api/vehicles': vehicles,
    '/api/vehicles/locations/latest': [],
    '/api/geofences': [],
    '/api/alerts': [],
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
    expect(sockets[0].url).toBe(
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
    );
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
    expect(screen.getByRole('region', { name: 'GPS simulation mode' })).toHaveTextContent('Vehicle ID: 27 (GPS-027)');
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
});
