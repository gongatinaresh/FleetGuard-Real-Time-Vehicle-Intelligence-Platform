# Vehicle Geofencing & Real-Time Alert System

A vehicle monitoring application with a FastAPI API, PostgreSQL persistence, geofence ENTER/EXIT detection, WebSocket notifications, and a React/Leaflet dashboard.

## Requirements

- Python 3.10+
- Node.js 20+ and npm
- Docker Desktop with Docker Compose (for PostgreSQL or the full local stack)

## Quick start with Docker Compose

Compose runs PostgreSQL, the backend with migrations, and the production-built React frontend served by Nginx.

1. Copy the project-root environment template and set a local password:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   Replace `POSTGRES_PASSWORD` with a local-only value. Do not commit `.env`.
2. Build and start:

   ```powershell
   docker compose up --build -d
   docker compose ps
   ```
3. Check availability:

   - Dashboard: http://localhost:5173
   - API health: http://localhost:8000/health
   - PostgreSQL host port: `5433`

The backend waits for PostgreSQL's health check and runs `alembic upgrade head` before starting Uvicorn. PostgreSQL data is kept in the named `postgres_data` volume. To stop the containers without deleting data, run `docker compose down`. Do not use `docker compose down -v` unless you intend to delete the database volume.

Compose reads its variables from the project-root `.env`. The backend connects to the database service at `db:5432`. By default, Nginx serves the frontend on port 5173 and reverse-proxies `/api/*` and `/ws` to `http://backend:8000`. The browser uses same-origin `/api` and `/ws` URLs; override `VITE_API_BASE_URL` and `VITE_WS_URL` in the project `.env` only when needed. These are injected into `runtime-config.js` when the container starts, so they can be changed without rebuilding the image.

## Local development

You can run the backend and frontend on the host while using the Compose PostgreSQL service:

1. Create the root `.env` as above, then start PostgreSQL:

   ```powershell
   docker compose up -d db
   ```
2. Configure and start the backend:

   ```powershell
   Copy-Item backend\.env.example backend\.env
   notepad backend\.env
   ```

   Set the database URL password to the same value as the project-root `.env`. The sample URL uses `localhost:5433`, the host-mapped Compose port. In `backend`:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   python -m alembic upgrade head
   python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
3. Configure and start the frontend in another terminal:

   ```powershell
   Copy-Item frontend\.env.example frontend\.env.local
   Set-Location frontend
   npm ci
   npm run dev
   ```

The frontend configuration values are `VITE_API_BASE_URL` and `VITE_WS_URL`. They must be reachable by the user's browser. For local Vite development the defaults are `http://localhost:8000` and `ws://localhost:8000/ws`; in Compose, the Nginx image receives `/api` and `/ws` at runtime.

The backend loads `backend/.env` when present. `DATABASE_URL` takes precedence; otherwise, the backend can construct a PostgreSQL connection from `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`. If neither is configured, it falls back to a local SQLite database. Docker Compose sets the PostgreSQL components with host `db` and port `5432`.

## Tests

```powershell
Set-Location backend
.\.venv\Scripts\Activate.ps1
python -m pytest app\tests -q

Set-Location ..\frontend
npm ci
npm test
npm run build
```

## GPS/geofence demo

Register a vehicle and create a geofence in the dashboard, then use **Configure GPS simulation** to select the vehicle and send explicit coordinates to the real backend. The backend simulator also supports a deterministic outside → inside → outside trip:

```powershell
Set-Location backend
python simulator\gps_simulator.py --demo --vehicle-id <ID> --geofence-id <ID>
```

## Configuration and security

- `.env.example`, `backend/.env.example`, and `frontend/.env.example` contain examples only. Copy the relevant template and keep actual `.env` files out of version control.
- Compose requires `POSTGRES_PASSWORD`; the example's placeholder must be replaced for local use.
- Compose keeps PostgreSQL data in its named volume and uses the internal backend origin `http://backend:8000` by default.
- For separate Render Docker web services, build the existing `backend` and `frontend` Dockerfiles as separate services and use a Render PostgreSQL database. Set backend `DATABASE_URL` to the database's SQLAlchemy-compatible connection URL, `CORS_ORIGINS` to the exact public frontend origin, and let Render supply `PORT`. Set frontend `BACKEND_URL` to the public backend origin (for example `https://your-api.onrender.com`, without a trailing slash). Leave frontend `VITE_API_BASE_URL=/api` and `VITE_WS_URL=/ws` so browser requests and WebSockets pass through Nginx. These values contain no secrets; database credentials must be stored as Render environment secrets.
- The frontend Nginx service listens on `PORT` (defaults to 80; Compose sets it to 80). Render must allow WebSocket upgrades for live updates.
- `docker compose up` runs the local stack; it does not deploy to Render.

## Boundary behavior

Points on a polygon boundary are treated as inside the geofence, using Shapely `covers()` behavior.
