# FleetGuard review fixes

## Changes applied
1. Vehicle registration reuse is now safe after soft deletion. The API restores the existing row instead of inserting a duplicate that violates the unique database index.
2. Vehicle creation now rolls back on a database integrity conflict and returns a controlled HTTP conflict response rather than leaking an unhandled database exception.
3. Frontend API error formatting now renders FastAPI/Pydantic validation arrays as readable field-level messages instead of `[object Object]`.
4. Added regression coverage for restoring a soft-deleted vehicle and formatting geofence validation errors.

## Validation performed on this source snapshot
- Backend: `python -m pytest app/tests -q` — 15 passed.
- Alembic migration: fresh SQLite migration smoke check — passed.
- Frontend JSX parsing — passed.

## Validation still required on the developer machine / Render
The uploaded `node_modules` tree was built for Windows and could not run its Rollup native binary in this Linux review environment. On Windows, from `frontend` run:
```powershell
npm ci
npm test
npm run build
```
Then deploy the updated backend and frontend and test the live create-vehicle, create-geofence, GPS ENTER/EXIT, and WebSocket flows. The live Render 500 cannot be conclusively attributed without its backend traceback; the source-level duplicate-registration failure described above is confirmed and fixed.

## Security
This review package intentionally excludes `.env`, local databases, `.git`, dependency folders, and generated build output. Use the provided `.env.example` templates and keep real secrets only in local environment files / hosting secret settings.

## Alert display improvements

- The dashboard alert feed now clearly shows persisted ENTER and EXIT events with vehicle registration, geofence name, and event timestamp.
- Added All, Entries, and Exits filters to make recent alert history easier to inspect.
- Added a recorded-alert count and a helpful empty state explaining how to generate the first geofence event.
- Added frontend regression coverage for loading persisted alert history and filtering by event type.
