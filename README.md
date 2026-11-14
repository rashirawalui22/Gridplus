# GridPulse

GridPulse is a synthetic power distribution monitoring and analytics platform built to simulate a modern utility operations dashboard. It is designed for demonstration and engineering review rather than live grid integration.

## Implementation plan

1. Establish a working Node.js + Express API foundation and environment configuration.
2. Build a realistic simulation data model for substations, feeders, transformers, telemetry, alerts, and faults.
3. Implement threshold-based fault detection and alert lifecycle logic.
4. Create a premium SCADA-inspired React + Tailwind dashboard covering overview, grid monitoring, fault detection, analytics, alerts, and settings.
5. Wire the frontend to the backend and validate the application against the expected behavior.

## Features

- Overview dashboard with voltage, frequency, power, reliability, and alert KPIs
- Grid monitoring views for feeders and transformers
- Fault detection centre with configurable thresholds and investigation guidance
- Analytics panel for telemetry trends
- Alert management workspace with acknowledgement state
- Settings panel for threshold tuning and system metadata
- Synthetic telemetry engine that clearly marks all data as simulated and non-live

## Getting started

```bash
npm install
npm run dev
```

The frontend runs on port 5173, while the API is served on port 4000.

## Environment

Create a local `.env` file based on `.env.example` if you want to configure the backend port or MongoDB connection.

## Important note

All telemetry and operational values in this project are simulated for demonstration purposes only and should never be interpreted as actual utility or grid measurements.
