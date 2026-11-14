# GridPulse

GridPulse is a simulated distribution-operations application built with React, Vite, Tailwind CSS, Express, Mongoose, and Socket.IO. It is a portfolio/demo system only: it is not connected to a utility grid, and its readings, forecasts, outage impacts, and consumers are synthetic estimates.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm. MongoDB is optional for local demo mode.

```powershell
npm install
npm run dev
```

The Vite UI runs at `http://localhost:5173`; the REST and Socket.IO server runs at port `4000`. The Vite proxy forwards `/api` and `/socket.io` to the backend.

To serve a production build from Express:

```powershell
npm run build
npm start
```

## Configuration

Copy `.env.example` to `.env` and set values for your environment. `.env` is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `PORT` | Express/Socket.IO port (default `4000`) |
| `VITE_PORT` | Vite development-server port (default `5173`) |
| `API_TARGET` | Backend proxy target for Vite (default `http://127.0.0.1:4000`) |
| `MONGO_URI` | Optional MongoDB connection; when unavailable, the application continues in in-memory demo mode |
| `FRONTEND_ORIGIN` | Exact allowed browser origin for CORS |
| `JWT_SECRET` | At least 32 characters; enables JWT authentication when MongoDB is connected |
| `JWT_EXPIRES_IN` | JWT lifetime (default `8h`) |
| `ADMIN_EMAIL` | Email that receives the initial `ADMIN` role during registration |

If you change the development UI port, set `FRONTEND_ORIGIN` to that UI's exact browser origin as well.

With MongoDB and a valid `JWT_SECRET`, new accounts are stored with bcrypt-hashed passwords and receive the `VIEWER` role by default. Only the configured `ADMIN_EMAIL` receives the initial admin role. Admins can promote accounts to `OPERATOR` or `ADMIN`. Without both database and secret configuration, the app explicitly runs in local demo mode with authentication disabled; the auth endpoints return a configuration error rather than issuing fake credentials.

## Implemented capabilities

- Tick-driven synthetic telemetry; dashboard reads do not generate new readings.
- REST snapshot endpoints and Socket.IO updates with simulation start, pause, and reset controls.
- Configurable thresholds, severity scoring, load-spike detection, fault deduplication while an event remains active, and fault resolution.
- Interactive substation/feeder/transformer topology and live telemetry tables.
- Incident lifecycle (`OPEN` → `ACKNOWLEDGED` → `INVESTIGATING` → `RESOLVED`) with appended status history.
- Hypothetical outage/load/voltage scenarios with estimated affected load, consumers, and alternate capacity.
- Transparent, statistical 1–24 hour load baseline; no unvalidated predictive-AI claims.
- Data-grounded rule-based assistant, CSV export, input validation, CORS allow-list, security headers, API rate limiting, and error responses.
- Mongoose schemas for users, network equipment, telemetry, faults, incidents, scenarios, audit logs, and simulation configuration. Mongo persistence is optional; telemetry retention uses a 90-day TTL index and writes are throttled.
- Optional Mongo-backed JWT authentication with bcrypt password hashes, viewer/operator/admin roles, per-request role lookup, token revocation on logout, and protected REST/Socket.IO access.
- Docker Compose for the app and MongoDB, GitHub Actions validation, and an OpenAPI contract at `docs/openapi.yaml`.

## Tests and build

```powershell
npm test
npm run build
```

The current tests cover simulator snapshot consistency, pause behavior, duplicate fault suppression, detection explanations, scenarios, forecasts, incident transitions, assistant responses, and JWT role checks.

To run the containerized app and MongoDB, set `JWT_SECRET` (32+ random characters) and `ADMIN_EMAIL` in your environment, then run `docker compose up --build`. The configured admin email receives the initial `ADMIN` role; registrations from other addresses receive `VIEWER`.

## API overview

- `GET /api/health`, `/api/dashboard`, `/api/feeders`, `/api/transformers`, `/api/substations`
- `GET /api/snapshot` for a single consistent bootstrap response
- `GET /api/telemetry`, `/api/historical`, `/api/faults`, `/api/alerts`, `/api/incidents`
- `POST /api/simulation/start|pause|reset`
- `POST /api/scenarios`, `DELETE /api/scenarios/current`
- `GET /api/forecast?hours=24`, `POST /api/assistant/query`
- `GET /api/reports/telemetry.csv`
- `GET /api/auth/status`, `POST /api/auth/register|login|logout`, `GET /api/auth/me|users`, `PATCH /api/auth/users/:id/role`

Authentication is enabled only when MongoDB is connected and `JWT_SECRET` is configured. Viewer accounts can read; operators can manage incidents, acknowledge alerts, and run scenarios; admins can also change thresholds and roles. Logout revokes the token until its expiry. In local demo mode, controls are intentionally available without pretending to authenticate a user.

## Current limitations

- Demo data and all scenario consumer/load estimates are synthetic assumptions, not engineering or operational recommendations.
- The statistical forecast is a baseline without validated accuracy/error metrics.
- The application has no external LLM integration, Redis cache, or PDF report export yet.
- Database and auth behavior require a reachable MongoDB instance and are not exercised by the in-memory unit suite.
