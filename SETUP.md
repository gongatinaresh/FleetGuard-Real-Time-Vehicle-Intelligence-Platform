# Setup guide

## Prerequisites

- Python 3.10+
- Node.js 20+ and npm
- Docker Desktop and Docker Compose

## Docker Compose (recommended local setup)

From the project root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set `POSTGRES_PASSWORD` to a local-only password and save the file. Do not commit `.env`. Then run:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

The Compose services are:

- `db`: PostgreSQL 16, internal port 5432, host port 5433, persistent `postgres_data` volume and `pg_isready` health check.
- `backend`: FastAPI on port 8000; waits for healthy `db`, constructs a PostgreSQL URL using hostname `db`, and applies Alembic migrations before serving. Its `PORT` defaults to 8000.
- `frontend`: production-built React static files served by Nginx on port 5173; waits for a healthy backend, has an HTTP health check, listens on container `PORT` (80 in Compose), proxies `/api/*` and `/ws` to FastAPI using `BACKEND_URL` (default `http://backend:8000`), and receives `VITE_API_BASE_URL` / `VITE_WS_URL` at container startup.

Check `http://localhost:8000/health`, `http://localhost:5173/healthz`, and `http://localhost:5173`. The browser's default API and WebSocket URLs are same-origin `/api` and `/ws`, reverse-proxied by Nginx. These runtime variables can be changed in the project `.env` without rebuilding the frontend image. Follow startup output with `docker compose logs -f backend frontend`. Stop without removing stored data using `docker compose down`; avoid `docker compose down -v` unless database deletion is intended.

## Host-based development using Compose PostgreSQL

Start PostgreSQL from the project root after creating `.env`:

```powershell
docker compose up -d db
```

Configure the backend:

```powershell
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```

Update the password in `DATABASE_URL` to match the root `.env` value. The backend sample uses `localhost:5433`, which is the database's host-published port. Then:

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

In another terminal, configure and run the frontend:

```powershell
Copy-Item frontend\.env.example frontend\.env.local
Set-Location frontend
npm ci
npm run dev
```

`frontend/.env.local` uses `VITE_API_BASE_URL=http://localhost:8000` and `VITE_WS_URL=ws://localhost:8000/ws` for the local Vite development server. These addresses are consumed by the browser and must not be changed to Compose-only hostnames. The Compose Nginx image instead reads the same variables at container startup, defaulting to `/api` and `/ws`.

The backend loads `backend/.env`; `DATABASE_URL` is preferred. Alternatively configure `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` to construct a PostgreSQL URL. If no database variables are supplied, local application settings use SQLite. Alembic must be run before starting a host-based backend.

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

## Environment variable reference

| Variable | Used by | Purpose |
|---|---|---|
| `POSTGRES_DB` | Compose/PostgreSQL/backend | Database name |
| `POSTGRES_USER` | Compose/PostgreSQL/backend | Database user |
| `POSTGRES_PASSWORD` | Compose/PostgreSQL/backend | Local database password; required by Compose |
| `DATABASE_URL` | Backend | Optional complete SQLAlchemy connection URL; takes precedence over PostgreSQL components |
| `POSTGRES_HOST` | Backend | Database host (`db` in Compose, `localhost` for host-based local development) |
| `POSTGRES_PORT` | Backend | Database port (`5432` in Compose, `5433` on the host) |
| `CORS_ORIGINS` | Backend | Comma-separated browser origins allowed by the API |
| `VITE_API_BASE_URL` | Frontend | Browser-visible HTTP API base URL; runtime-injected by Compose Nginx |
| `VITE_WS_URL` | Frontend | Browser-visible WebSocket URL; runtime-injected by Compose Nginx |
| `BACKEND_URL` | Frontend Nginx | Backend origin used for `/api/` and `/ws` proxying; defaults to `http://backend:8000` in Compose |
| `PORT` | Backend / frontend Nginx | Listening port; backend defaults to `8000`, frontend Nginx defaults to `80`, and each uses the platform's value when provided |

Use the root `.env.example` for Compose and the backend/frontend examples for host-based development. These files contain placeholders, not actual credentials. Do not commit `.env` or `.env.local`.

## Separate Render Docker services

Create separate Render Docker web services using `backend/Dockerfile` and `frontend/Dockerfile` (with the corresponding directory as each service's build context), plus a Render PostgreSQL database. Configure:

- **Backend service:** Render supplies `PORT`; do not override it. Set `DATABASE_URL` to the Render database's SQLAlchemy-compatible connection URL, and set `CORS_ORIGINS` to the exact public frontend origin, such as `https://your-dashboard.onrender.com`. Migrations run before Uvicorn starts. The image exposes port 8000 as its local default; the command binds to the provided `PORT`.
- **Frontend service:** set `BACKEND_URL` to the backend's public origin, such as `https://your-api.onrender.com`, with no trailing slash. Keep `VITE_API_BASE_URL=/api` and `VITE_WS_URL=/ws`; Nginx proxies these same-origin browser requests and WebSocket upgrades to the backend. Nginx listens on the provided `PORT`, defaulting to 80.
- Configure the Render web service to route to the frontend image's listening port. Ensure WebSocket connections are supported for live updates.
- psycopg 3 is the installed PostgreSQL driver. The backend normalizes `postgres://`, `postgresql://`, and other PostgreSQL driver schemes to `postgresql+psycopg://` before connecting; credentials remain in the environment-provided URL and are not logged.
- Store database URLs/passwords and other credentials only in Render's environment settings. Do not put secrets in source files or commit them.

The local Compose defaults do not require `BACKEND_URL` or a platform `PORT`: Compose uses `http://backend:8000` and explicitly sets backend `PORT=8000` and frontend `PORT=80`. Keep the Compose PostgreSQL service and named volume for local use; Render should use its managed PostgreSQL service instead.

## Troubleshooting

- Compose requires `POSTGRES_PASSWORD` in the project-root `.env`; verify the variable is set and non-empty.
- For host-based backend access, use `localhost:5433`; from the backend container, use service name `db` and port `5432`.
- If migrations fail, inspect PostgreSQL health and `docker compose logs db backend`.
- If the page loads but API calls fail, verify the browser-facing `VITE_API_BASE_URL`, `VITE_WS_URL`, and backend `CORS_ORIGINS`.
