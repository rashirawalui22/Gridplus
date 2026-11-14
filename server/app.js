import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerGridQuestion } from './services/assistantService.js';
import { AuthService } from './services/authService.js';
import { sanitizeMongoError } from './config/mongoUri.js';
import { forecastDemand } from './services/forecastService.js';
import { IncidentService } from './services/incidentService.js';
import { createScenario } from './services/scenarioService.js';
import { logger } from './utils/logger.js';

const thresholdRanges = {
  voltageMin: [0, 1000],
  voltageMax: [0, 1000],
  frequencyMin: [0, 1000],
  frequencyMax: [0, 1000],
  overloadPercent: [50, 150],
  telemetryGapSeconds: [10, 86400],
  powerDeviationPercent: [5, 200],
  loadSpikePercent: [1, 100],
  tickIntervalMs: [500, 60000],
};
const appDirectory = path.dirname(fileURLToPath(import.meta.url));

function validateThresholds(body, current) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('Settings body must be a JSON object.');
    error.status = 400;
    throw error;
  }

  const updated = { ...current };
  for (const [key, value] of Object.entries(body)) {
    const range = thresholdRanges[key];
    if (!range) {
      const error = new Error(`Unknown setting: ${key}.`);
      error.status = 400;
      throw error;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < range[0] || number > range[1]) {
      const error = new Error(`${key} must be a number between ${range[0]} and ${range[1]}.`);
      error.status = 400;
      throw error;
    }
    updated[key] = number;
  }

  if (updated.voltageMin >= updated.voltageMax || updated.frequencyMin >= updated.frequencyMax) {
    const error = new Error('Minimum thresholds must be lower than maximum thresholds.');
    error.status = 400;
    throw error;
  }
  return updated;
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export function createApp({
  engine,
  incidents = new IncidentService(),
  persistence = null,
  auth = new AuthService({ secret: '', enabled: false }),
  allowedOrigin = 'http://localhost:5173',
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: allowedOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
  }));
  const readerOnly = auth.requireRoles(['ADMIN', 'OPERATOR', 'VIEWER']);
  const operatorOnly = auth.requireRoles(['ADMIN', 'OPERATOR']);
  const adminOnly = auth.requireRoles(['ADMIN']);
  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' },
  });

  app.get('/api/auth/status', (_req, res) => res.json(auth.status));
  app.post('/api/auth/register', authRateLimit, async (req, res, next) => {
    try {
      return res.status(201).json(await auth.register(req.body));
    } catch (error) {
      return next(error);
    }
  });
  app.post('/api/auth/bootstrap-admin', authRateLimit, async (req, res, next) => {
    try {
      return res.status(201).json(await auth.bootstrapAdmin(req.body));
    } catch (error) {
      return next(error);
    }
  });
  app.post('/api/auth/login', authRateLimit, async (req, res, next) => {
    try {
      return res.json(await auth.login(req.body));
    } catch (error) {
      return next(error);
    }
  });
  app.get('/api/auth/me', auth.requireRoles(), async (req, res, next) => {
    try {
      return res.json(await auth.getProfile(req.user?.id));
    } catch (error) {
      return next(error);
    }
  });
  app.get('/api/auth/users', adminOnly, async (_req, res, next) => {
    try {
      return res.json(await auth.listUsers());
    } catch (error) {
      return next(error);
    }
  });
  app.patch('/api/auth/users/:id/role', adminOnly, async (req, res, next) => {
    try {
      return res.json(await auth.updateRole(req.params.id, req.body?.role, req.user?.id));
    } catch (error) {
      return next(error);
    }
  });
  app.post('/api/auth/logout', auth.requireRoles(), async (req, res, next) => {
    try {
      const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
      await auth.revokeToken(token);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      simulated: true,
      simulation: engine.getStatus(),
      database: persistence?.status ?? 'disabled',
      generatedAt: engine.getSnapshot().generatedAt,
    });
  });

  app.get('/api/dashboard', readerOnly, (_req, res) => {
    const snapshot = engine.getSnapshot();
    res.json({
      ...snapshot.dashboard,
      alerts: engine.getAlerts().length,
      faultCount: engine.getFaults().length,
      telemetry: snapshot.telemetry,
      generatedAt: snapshot.generatedAt,
      simulated: true,
    });
  });

  app.get('/api/snapshot', readerOnly, (_req, res) => {
    res.json({
      ...engine.getSnapshot(),
      faults: engine.getFaults(),
      alerts: engine.getAlerts(),
      incidents: incidents.list({ limit: 100 }).items,
      settings: { thresholds: engine.configuration, simulation: engine.getStatus() },
      simulated: true,
    });
  });

  app.get('/api/feeders', readerOnly, (_req, res) => res.json(engine.getSnapshot().feeders));
  app.get('/api/transformers', readerOnly, (_req, res) => res.json(engine.getSnapshot().transformers));
  app.get('/api/substations', readerOnly, (_req, res) => res.json(engine.getSnapshot().substations));
  app.get('/api/telemetry', readerOnly, (_req, res) => res.json(engine.getSnapshot().telemetry));
  app.get('/api/historical', readerOnly, async (req, res, next) => {
    try {
      const persisted = await persistence?.getHistorical(req.query);
      if (persisted) return res.json(persisted);
      const filter = req.query.feederId ? String(req.query.feederId) : '';
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const items = engine.getHistory().flatMap((point) => point.telemetry
        .filter((reading) => !filter || reading.feederId === filter)
        .map((reading) => ({ ...reading, timestamp: point.timestamp })))
        .reverse();
      return res.json({ items: items.slice(offset, offset + limit), total: items.length, limit, offset });
    } catch (error) {
      return next(error);
    }
  });
  app.get('/api/faults', readerOnly, (_req, res) => res.json(engine.getFaults()));
  app.get('/api/alerts', readerOnly, (_req, res) => res.json(engine.getAlerts()));

  app.get('/api/settings', readerOnly, (_req, res) => {
    res.json({ thresholds: engine.configuration, simulation: engine.getStatus() });
  });

  app.put('/api/settings', adminOnly, async (req, res, next) => {
    try {
      const updated = validateThresholds(req.body, engine.configuration);
      await persistence?.persistConfiguration(updated);
      engine.setConfiguration(updated);
      if (req.body.tickIntervalMs !== undefined) engine.setIntervalMs(updated.tickIntervalMs);
      return res.json({ thresholds: engine.configuration, simulation: engine.getStatus() });
    } catch (error) {
      return next(error);
    }
  });
  app.post('/api/settings', adminOnly, async (req, res, next) => {
    try {
      const updated = validateThresholds(req.body, engine.configuration);
      await persistence?.persistConfiguration(updated);
      engine.setConfiguration(updated);
      if (req.body.tickIntervalMs !== undefined) engine.setIntervalMs(updated.tickIntervalMs);
      return res.json({ thresholds: engine.configuration, simulation: engine.getStatus() });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/alerts/:id/ack', operatorOnly, async (req, res, next) => {
    try {
      const previous = engine.getAlerts().find((item) => item.id === req.params.id);
      if (!previous) return res.status(404).json({ error: 'Alert not found.' });
      await persistence?.persistFault({ ...previous, acknowledged: true, status: 'acknowledged' });
      const alert = engine.acknowledgeAlert(req.params.id);
      if (!alert) return res.status(404).json({ error: 'Alert not found.' });
      return res.json(alert);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/simulation/status', (_req, res) => res.json(engine.getStatus()));
  app.post('/api/simulation/start', operatorOnly, (_req, res) => res.json(engine.start()));
  app.post('/api/simulation/pause', operatorOnly, (_req, res) => res.json(engine.pause()));
  app.post('/api/simulation/reset', operatorOnly, (_req, res) => res.json(engine.reset()));
  app.post('/api/simulation/toggle', operatorOnly, (req, res) => {
    if (typeof req.body?.running !== 'boolean') {
      return res.status(400).json({ error: 'running must be a boolean.' });
    }
    return res.json(req.body.running ? engine.start() : engine.pause());
  });

  app.get('/api/incidents', readerOnly, (req, res) => res.json(incidents.list(req.query)));
  app.patch('/api/incidents/:id/status', operatorOnly, async (req, res, next) => {
    try {
      const { status } = req.body ?? {};
      if (typeof status !== 'string') return res.status(400).json({ error: 'status is required.' });
      const incident = incidents.prepareTransition(req.params.id, status, req.user?.id || 'local-operator');
      if (!incident) return res.status(404).json({ error: 'Incident not found.' });
      await persistence?.persistIncident(incident, 'incident.status_changed');
      incidents.commit(incident);
      return res.json(incident);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/scenarios', operatorOnly, async (req, res, next) => {
    try {
      const result = createScenario(engine.getSnapshot(), req.body ?? {});
      await persistence?.persistScenario(result);
      engine.setScenario(result.scenario);
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });
  app.delete('/api/scenarios/current', operatorOnly, (_req, res) => {
    engine.clearScenario();
    res.json({ scenario: null, simulated: true });
  });

  app.get('/api/forecast', readerOnly, (req, res, next) => {
    try {
      const intervalHours = req.query.hours === undefined ? 24 : Number(req.query.hours);
      return res.json(forecastDemand(engine.getHistory(), intervalHours));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/assistant/query', readerOnly, (req, res, next) => {
    try {
      return res.json(answerGridQuestion(req.body?.query, {
        snapshot: engine.getSnapshot(),
        faults: engine.getFaults(),
        incidents: incidents.list({ limit: 500 }).items,
        configuration: engine.configuration,
      }));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/reports/telemetry.csv', readerOnly, (_req, res) => {
    const history = engine.getHistory();
    const header = ['timestamp', 'total_simulated_power_mw', 'average_voltage_v', 'average_frequency_hz'];
    const rows = history.map((point) => [
      point.timestamp,
      point.totalPower,
      point.averageVoltage,
      point.averageFrequency,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    res
      .type('text/csv')
      .attachment('gridpulse-simulated-telemetry.csv')
      .send(csv);
  });

  const distDirectory = path.resolve(appDirectory, '..', 'dist');
  app.use(express.static(distDirectory));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(distDirectory, 'index.html'), (error) => {
      if (error) next();
    });
  });

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}.` });
  });

  app.use((error, _req, res, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) logger.error('API request failed', { reason: sanitizeMongoError(error), path: _req.path });
    res.status(status).json({
      error: status >= 500 ? 'An internal server error occurred.' : error.message,
    });
  });

  return { app, incidents };
}
