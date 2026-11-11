# FleetGuard – Real-Time Vehicle Intelligence Platform

**A full-stack vehicle monitoring application featuring vehicle-specific geofence detection, real-time ENTER/EXIT events, WebSocket communication, and a React-based monitoring dashboard.**

FleetGuard demonstrates how multiple registered vehicles can be monitored through a centralized application. The backend processes vehicle location updates, checks geographical boundaries, detects geofence transitions, and communicates event updates to connected dashboard clients.

> **Implementation note:** GPS coordinates are generated using a simulation module for testing. Physical GPS tracking hardware is not currently integrated.

---

## Project Links

| Resource | Link |
|---|---|
| GitHub Repository | [View Source Code](https://github.com/gongatinaresh/FleetGuard-Real-Time-Vehicle-Intelligence-Platform) |
| Live Frontend | [Open FleetGuard Dashboard](https://fleetguard-real-time-vehicle-5ids.onrender.com) |
| Backend API | [Open FastAPI Documentation](https://fleetguard-real-time-vehicle.onrender.com/docs) |
| Backend Health Check | [Check API Health](https://fleetguard-real-time-vehicle.onrender.com/health) |
| Project Demonstration | [Watch on YouTube](https://youtu.be/WotR_V5CSfc) |
| Docker Hub – Backend | [Backend Image](https://hub.docker.com/r/gangadhar12341234/fleetguard-backend) |
| Docker Hub – Frontend | [Frontend Image](https://hub.docker.com/r/gangadhar12341234/fleetguard-frontend) |

### Published Docker Images

**Backend**
```bash
docker pull gangadhar12341234/fleetguard-backend:1.1.0
```

**Frontend**
```bash
docker pull gangadhar12341234/fleetguard-frontend:1.1.0
```

---

## 1. Project Overview

Fleet management systems need more than a map displaying vehicle locations. They also need to identify which vehicle has entered or exited a designated geographical area and communicate that event to monitoring users.

FleetGuard brings together:

- Vehicle registration and management
- Geofence creation using polygon coordinates
- Vehicle location processing
- Geofence ENTER and EXIT detection
- Real-time notifications through WebSockets
- PostgreSQL data persistence
- A React and Leaflet monitoring dashboard

## 2. How FleetGuard Works

```text
       Vehicle Registration
                |
                v
       GPS Location Update
        (GPS Simulation)
                |
                v
         FastAPI Backend
                |
                v
       Identify the Vehicle
                |
                v
       Process Coordinates
                |
                v
       Geofence Boundary Check
                |
          +-----+-----+
          |           |
          v           v
       INSIDE       OUTSIDE
          |           |
          v           v
       ENTER         EXIT
        EVENT        EVENT
          |           |
          +-----+-----+
                |
                v
          PostgreSQL
                |
                v
       WebSocket Communication
                |
                v
       React Monitoring Dashboard
```

**Example scenario:** Multiple registered vehicles submit location updates. The backend associates each update with its vehicle record and checks the coordinates against configured geofences. When a geofence transition is detected, the corresponding event is recorded and communicated to connected dashboard clients.

## 3. Core Features

### Vehicle Management
- Register vehicles using registration numbers and names.
- Manage vehicle status.
- Maintain registered vehicle information.

### Geofence Management
- Create geographical boundaries using polygon coordinates.
- View configured geofences.
- Monitor vehicle movements relative to defined boundaries.

### GPS Location Simulation
- Select a registered vehicle.
- Submit sample latitude and longitude coordinates.
- Test vehicle movements inside and outside configured geofences.
- Run a deterministic outside → inside → outside demonstration.

### Geofence Event Detection
- Detect vehicle ENTER events.
- Detect vehicle EXIT events.
- Associate location processing with registered vehicles.
- Apply polygon boundary checks using Shapely.

### Real-Time Dashboard
- Display vehicle monitoring information.
- Receive updates through WebSocket communication.
- View geofence alerts and event history.
- Visualize geographical information using Leaflet.

### Database Management
- Persist application information using PostgreSQL.
- Manage schema changes using Alembic migrations.
- Preserve local database data through a Docker named volume.

## 4. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React.js, Vite | Interactive dashboard |
| Map Visualization | Leaflet | Vehicle and geofence visualization |
| Backend | Python, FastAPI | Application logic and REST APIs |
| Database | PostgreSQL | Persistent application data |
| Real-Time Communication | WebSockets | Dashboard updates |
| Geospatial Processing | Shapely | Polygon boundary checks |
| Database Migrations | Alembic | Schema version management |
| Containerization | Docker | Application packaging |
| Local Orchestration | Docker Compose | Multi-service application |
| Web Server | Nginx | Frontend hosting and reverse proxy |
| Deployment | Render | Hosting frontend and backend |
| Production Database | Neon PostgreSQL | Managed PostgreSQL |
| Container Registry | Docker Hub | Published container images |

## 5. System Architecture

FleetGuard separates frontend, backend, and database responsibilities.

**Frontend – React + Leaflet**

Provides the monitoring dashboard, vehicle management interface, geofence management, GPS simulation controls, and alert history.

The browser communicates with the backend through REST API requests and WebSocket connections.

**Backend – FastAPI**

Handles application requests, vehicle location processing, geofence detection, event-related operations, database communication, and WebSocket connections.

**Database – PostgreSQL**

Stores persistent application information, including vehicle, geofence, and alert data.

**WebSocket Layer**

Provides real-time communication between the backend and connected dashboard clients.

**Nginx**

Serves the production-built React application and reverse-proxies `/api/*` and `/ws` requests to the backend in the Docker Compose architecture.

## 6. Requirements

- Python 3.10+
- Node.js 20+ and npm
- Docker Desktop
- Docker Compose

## 7. Quick Start – Docker Compose

Docker Compose starts the complete local application stack:

- PostgreSQL database
- FastAPI backend
- React frontend served through Nginx

### Step 1: Configure environment variables

Open PowerShell in the project root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Replace `POSTGRES_PASSWORD` with a local-only password. Never commit actual `.env` files or database credentials to GitHub.

### Step 2: Build and start

```powershell
docker compose up --build -d
```

Check running containers:

```powershell
docker compose ps
```

### Step 3: Access the application

| Component | Local URL |
|---|---|
| React Dashboard | http://localhost:5173 |
| FastAPI Health Check | http://localhost:8000/health |
| FastAPI Swagger Documentation | http://localhost:8000/docs |
| PostgreSQL Host Port | 5433 |

The backend waits for PostgreSQL to become healthy and runs Alembic migrations before starting Uvicorn.

PostgreSQL data is stored in the named `postgres_data` volume.

### Step 4: Stop the application

```powershell
docker compose down
```

This stops containers without deleting the database volume.

> Avoid `docker compose down -v` unless you intentionally want to delete the stored database volume.

## 8. Local Development Setup

### Step 1: Start PostgreSQL

From the project root:

```powershell
docker compose up -d db
```

### Step 2: Configure the backend

```powershell
Copy-Item backend\.env.example backend\.env
```

Configure the database URL with the same password as the project-root `.env`. The local database connection uses `localhost:5433`.

Navigate to the backend:

```powershell
cd backend
```

Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install dependencies:

```powershell
python -m pip install -r requirements.txt
```

Apply database migrations:

```powershell
python -m alembic upgrade head
```

Start the FastAPI server:

```powershell
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API documentation: http://localhost:8000/docs

### Step 3: Configure the frontend

Open another terminal from the project root:

```powershell
Copy-Item frontend\.env.example frontend\.env.local
cd frontend
npm ci
npm run dev
```

Frontend configuration variables:

- `VITE_API_BASE_URL`
- `VITE_WS_URL`

For local Vite development:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
```

These URLs must be reachable by the browser.

## 9. GPS and Geofence Demonstration

### Dashboard-based testing

1. Register a vehicle.
2. Create a geofence using polygon coordinates.
3. Open the GPS simulation controls.
4. Select the vehicle.
5. Send sample coordinates inside the geofence.
6. Send coordinates outside the geofence.
7. Observe the resulting ENTER and EXIT events.

### Automated GPS simulation

The backend also supports a deterministic outside → inside → outside trip.

Run from the backend directory:

```powershell
python simulator/gps_simulator.py --demo --vehicle-id <ID> --geofence-id <ID>
```

Replace the placeholders with the actual registered vehicle ID and geofence ID.

## 10. Running Tests

### Backend tests

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest app\tests -q
```

### Frontend tests

```powershell
cd frontend
npm ci
npm test
```

### Production frontend build

```powershell
npm run build
```

## 11. Deployment Architecture

FleetGuard uses separate frontend and backend Docker web services on Render, with Neon PostgreSQL as the managed database.

```text
             User Browser
                  |
                  v
          Render Frontend
             (Nginx)
                  |
             /api and /ws
                  |
                  v
          Render Backend
             (FastAPI)
                  |
                  v
          Neon PostgreSQL
```

### Frontend configuration

```env
BACKEND_URL=https://your-api.onrender.com
VITE_API_BASE_URL=/api
VITE_WS_URL=/ws
```

### Backend configuration

- `DATABASE_URL`: SQLAlchemy-compatible PostgreSQL connection URL.
- `CORS_ORIGINS`: Exact public frontend origin.
- `PORT`: Supplied by Render.

The frontend Nginx service listens on the configured `PORT` and proxies API and WebSocket traffic to the backend.

Render must support WebSocket upgrades for real-time updates.

**Important:** Docker Compose runs the local stack; it does not deploy the application to Render.

## 12. Important Implementation Details

- Points on a polygon boundary are treated as inside the geofence using Shapely's `covers()` behavior.
- Browser requests use the configured API and WebSocket URLs.
- In Docker Compose, the backend connects to PostgreSQL using the internal service address `db:5432`.
- PostgreSQL data persists in the named `postgres_data` volume.
- The backend can use `DATABASE_URL` or PostgreSQL connection components. If neither is configured, it falls back to a local SQLite database.
- Environment files contain configuration and secrets and must not be committed.

## 13. Future Enhancements

- Integration with physical GPS tracking devices.
- Scalable location ingestion for larger vehicle fleets.
- Advanced fleet analytics and reporting.
- Improved monitoring, observability, and deployment resilience.
- Additional automated integration and load testing.

## 14. Project Outcome

FleetGuard demonstrates an end-to-end full-stack application combining vehicle management, simulated location updates, geospatial boundary detection, real-time communication, database persistence, and containerized deployment.

Developing this application provided practical experience in:

- Building REST APIs with FastAPI.
- Developing interactive interfaces with React.
- Working with PostgreSQL and database migrations.
- Implementing WebSocket communication.
- Processing geographical coordinates.
- Containerizing multi-service applications.
- Configuring and troubleshooting cloud deployment.

---

**Built with React, FastAPI, PostgreSQL, WebSockets, and Docker.**

**Project:** FleetGuard – Real-Time Vehicle Intelligence Platform

**Developer:** G. Naresh
