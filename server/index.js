import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { buildSimulationSnapshot } from './services/simulationService.js';
import { defaultConfiguration, alertHistory, faults } from './data/mockData.js';
import { evaluateTelemetry } from './services/faultDetectionService.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

let simulationConfig = { ...defaultConfiguration };
let state = buildSimulationSnapshot(simulationConfig);
let alerts = [...alertHistory];
let faultLog = [...faults];
let simulationRunning = true;

if (config.mongoUri) {
  mongoose.connect(config.mongoUri)
    .then(() => console.log('MongoDB connected'))
    .catch((error) => console.warn('MongoDB unavailable, using synthetic simulator mode:', error.message));
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', label: 'GridPulse simulation engine online', simulated: true });
});

app.get('/api/dashboard', (_req, res) => {
  const snapshot = buildSimulationSnapshot(simulationConfig);
  const computedFaults = evaluateTelemetry(snapshot.telemetry, simulationConfig);
  state = snapshot;
  faultLog = [...faultLog, ...computedFaults].slice(-24);
  res.json({
    ...snapshot.dashboard,
    alerts: alerts.length,
    faultCount: faultLog.length,
    telemetry: snapshot.telemetry,
  });
});

app.get('/api/feeders', (_req, res) => {
  res.json(state.feeders);
});

app.get('/api/transformers', (_req, res) => {
  res.json(state.transformers);
});

app.get('/api/substations', (_req, res) => {
  res.json(state.substations);
});

app.get('/api/faults', (_req, res) => {
  res.json(faultLog);
});

app.get('/api/alerts', (_req, res) => {
  res.json(alerts);
});

app.get('/api/settings', (_req, res) => {
  res.json({ thresholds: simulationConfig, simulationRunning });
});

app.post('/api/settings', (req, res) => {
  const { voltageMin, voltageMax, frequencyMin, frequencyMax, overloadPercent, telemetryGapSeconds, powerDeviationPercent } = req.body;
  const next = {
    ...simulationConfig,
    ...(voltageMin !== undefined ? { voltageMin: Number(voltageMin) } : {}),
    ...(voltageMax !== undefined ? { voltageMax: Number(voltageMax) } : {}),
    ...(frequencyMin !== undefined ? { frequencyMin: Number(frequencyMin) } : {}),
    ...(frequencyMax !== undefined ? { frequencyMax: Number(frequencyMax) } : {}),
    ...(overloadPercent !== undefined ? { overloadPercent: Number(overloadPercent) } : {}),
    ...(telemetryGapSeconds !== undefined ? { telemetryGapSeconds: Number(telemetryGapSeconds) } : {}),
    ...(powerDeviationPercent !== undefined ? { powerDeviationPercent: Number(powerDeviationPercent) } : {}),
  };

  simulationConfig = next;
  state = buildSimulationSnapshot(simulationConfig);
  res.json({ thresholds: simulationConfig, simulationRunning });
});

app.post('/api/alerts/:id/ack', (req, res) => {
  const { id } = req.params;
  alerts = alerts.map((alert) => (
    alert.id === id ? { ...alert, acknowledged: true, status: 'acknowledged' } : alert
  ));
  res.json(alerts);
});

app.post('/api/simulation/toggle', (req, res) => {
  simulationRunning = Boolean(req.body.running);
  res.json({ simulationRunning });
});

app.get('/api/telemetry', (_req, res) => {
  res.json(state.telemetry);
});

app.get('/api/historical', (_req, res) => {
  res.json(state.telemetry);
});

app.post('/api/auth/login', (_req, res) => {
  res.json({
    user: {
      id: 'user-ops-01',
      name: 'Control Room Operator',
      role: 'Distribution Supervisory Desk',
      simulated: true,
    },
    token: 'simulated-token',
  });
});

app.get('/api/users/me', (_req, res) => {
  res.json({
    id: 'user-ops-01',
    name: 'Control Room Operator',
    role: 'Distribution Supervisory Desk',
    simulated: true,
  });
});

const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const port = config.port;
app.listen(port, () => {
  console.log(`GridPulse API listening on http://localhost:${port}`);
});
