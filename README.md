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
| `MONGODB_URI` | MongoDB connection string. Atlas `mongodb+srv://` URIs enable TLS by default; `MONGO_URI` remains a supported legacy alias. |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | MongoDB server discovery/connect timeout in milliseconds (default `30000`) |
| `FRONTEND_ORIGIN` | Exact allowed browser origin for CORS |
| `JWT_SECRET` | At least 32 characters; required when a MongoDB URI is configured |
| `JWT_EXPIRES_IN` | JWT lifetime (default `8h`) |
| `ADMIN_BOOTSTRAP_SECRET` | One-time secret (32+ characters) required to create the first administrator |

If you change the development UI port, set `FRONTEND_ORIGIN` to that UI's exact browser origin as well.

For Atlas, set `MONGODB_URI` to the connection string copied from Atlas, preferably its `mongodb+srv://` form. URL-encode reserved characters in the database username and password individually; do not add quotes or whitespace around the URI. SRV connections use TLS with normal certificate and hostname verification. The application rejects explicit TLS-disable and certificate-verification-bypass options. For a non-SRV Atlas `mongodb://` string, include `tls=true`. Also ensure the machine's outbound network can reach Atlas and its current public egress IP is allowed in the Atlas Network Access list; credentials or TLS settings cannot bypass that network restriction.

With MongoDB and a valid `JWT_SECRET`, public registration always creates a `VIEWER`. Create the first administrator once using the configured bootstrap secret through `POST /api/auth/bootstrap-admin` or the sign-in screen. A unique database record permanently marks bootstrap as used; the secret cannot grant another admin after that. Admins can grant roles to other users but cannot change their own role. Local demo mode is enabled only when both `MONGODB_URI` and the legacy `MONGO_URI` are unset and `NODE_ENV` is not `production`. If MongoDB is configured but unavailable, protected requests fail rather than falling back to unauthenticated controls.

## Implemented capabilities

- Tick-driven synthetic telemetry; dashboard reads do not generate new readings.
- REST snapshot endpoints and Socket.IO updates with simulation start, pause, and reset controls.
- Configurable thresholds, severity scoring, load-spike detection, fault deduplication while an event remains active, and fault resolution.
- Interactive substation/feeder/transformer topology and live telemetry tables.
- Incident lifecycle (`OPEN` → `ACKNOWLEDGED` → `INVESTIGATING` → `RESOLVED`) with appended status history.
- Hypothetical outage/load/voltage scenarios with estimated affected load, consumers, and alternate capacity.
- Transparent, statistical 1–24 hour load baseline; no unvalidated predictive-AI claims.
- Data-grounded rule-based assistant, telemetry CSV export, and a print-ready system report that can be saved as PDF from the browser.
- Input validation, CORS allow-list, security headers, API rate limiting, and safe error responses.
- Mongoose schemas for users, network equipment, telemetry, faults, incidents, scenarios, audit logs, and simulation configuration. Mongo persistence is optional; telemetry retention uses a 90-day TTL index and writes are throttled.
- Optional Mongo-backed JWT authentication with bcrypt password hashes, viewer/operator/admin roles, per-request role lookup, token revocation on logout, and protected REST/Socket.IO access.
- Docker Compose for the app and MongoDB, GitHub Actions validation, and an OpenAPI contract at `docs/openapi.yaml`.

## Tests and build

```powershell
npm test
npm run test:integration
npm run build
```

The unit tests cover simulator behavior, fault detection, scenarios, forecasting, incidents, assistant responses, and role permissions. The integration suite requires MongoDB and runs against a unique disposable database; it covers authentication, persistence, restart hydration, TTL indexes, connection recovery, and Socket.IO authorization/revocation.

For local MongoDB integration tests, start the isolated test service, run the suite, then stop it:

```powershell
docker compose --profile integration-test up -d mongo-test
$env:MONGO_TEST_URI = "mongodb://127.0.0.1:27018/gridpulse_test"
npm run test:integration
docker compose --profile integration-test down
```

CI runs the unit suite, MongoDB integration suite, production build, dependency audit, and a Docker Compose smoke test with MongoDB. There is no separate linter configured.

To run the containerized app and MongoDB, set `JWT_SECRET` and `ADMIN_BOOTSTRAP_SECRET` (each at least 32 random characters) in your environment, then run `docker compose up --build`. Use the one-time bootstrap flow to provision the initial administrator; all public registrations receive `VIEWER`.

## API overview

- `GET /api/health`, `/api/dashboard`, `/api/feeders`, `/api/transformers`, `/api/substations`
- `GET /api/snapshot` for a single consistent bootstrap response
- `GET /api/telemetry`, `/api/historical`, `/api/faults`, `/api/alerts`, `/api/incidents`
- `POST /api/simulation/start|pause|reset`
- `POST /api/scenarios`, `DELETE /api/scenarios/current`
- `GET /api/forecast?hours=24`, `POST /api/assistant/query`
- `GET /api/reports/telemetry.csv`
- `GET /api/auth/status`, `POST /api/auth/register|bootstrap-admin|login|logout`, `GET /api/auth/me|users`, `PATCH /api/auth/users/:id/role`

Authentication is enabled whenever a MongoDB URI and valid `JWT_SECRET` are configured, and remains enforced if MongoDB later becomes unavailable. Viewer accounts can read; operators can manage incidents, acknowledge alerts, and run scenarios; admins can also change thresholds and roles. Logout revokes the token until its expiry. In local demo mode, controls are intentionally available without pretending to authenticate a user.

## Current limitations

- Demo data and all scenario consumer/load estimates are synthetic assumptions, not engineering or operational recommendations.
- The statistical forecast is a baseline without validated accuracy/error metrics.
- The application has no external LLM integration or Redis cache; PDF output uses the browser's print-to-PDF flow rather than a server-generated PDF.
- Database and auth behavior require a reachable MongoDB instance and are not exercised by the in-memory unit suite.
