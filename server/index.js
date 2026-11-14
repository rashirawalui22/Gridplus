import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { sanitizeMongoError } from './config/mongoUri.js';
import { AuthService } from './services/authService.js';
import { IncidentService } from './services/incidentService.js';
import { PersistenceService } from './services/persistenceService.js';
import { SimulationEngine } from './services/simulationEngine.js';
import { attachSocketHandlers } from './socketServer.js';
import { logger } from './utils/logger.js';

if (config.nodeEnv === 'production' && !config.mongoUri) {
  logger.error('MONGODB_URI is required in production; unauthenticated demo mode is only available in development');
  process.exit(1);
}
if (config.mongoUri && config.jwtSecret.length < 32) {
  logger.error('JWT_SECRET must contain at least 32 characters when MongoDB is configured');
  process.exit(1);
}

const engine = new SimulationEngine();
const incidents = new IncidentService();
const persistence = new PersistenceService(config.mongoUri, {
  serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs,
});
await persistence.connect();
persistence.startRecovery();
const auth = new AuthService({
  secret: config.jwtSecret,
  enabled: Boolean(config.mongoUri),
  expiresIn: config.jwtExpiresIn,
  bootstrapSecret: config.adminBootstrapSecret,
});
if (persistence.status === 'connected') {
  try {
    const savedConfiguration = await persistence.loadConfiguration();
    if (savedConfiguration) engine.setConfiguration(savedConfiguration);
    incidents.hydrate(await persistence.loadIncidents());
    engine.hydrateFaults(await persistence.loadFaults());
  } catch (error) {
    logger.error('Could not hydrate persisted application state; refusing to start with incomplete history', {
      reason: sanitizeMongoError(error),
    });
    await persistence.disconnect();
    process.exit(1);
  }
}
const { app } = createApp({
  engine,
  incidents,
  persistence,
  auth,
  allowedOrigin: config.frontendOrigin,
});
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: {
    origin: config.frontendOrigin,
    methods: ['GET', 'POST'],
  },
});
const detachSocketHandlers = attachSocketHandlers(io, auth, engine);
engine.on('snapshot', (snapshot) => {
  persistence.persistSnapshot(snapshot).catch((error) => {
    logger.error('Could not persist telemetry snapshot', { reason: sanitizeMongoError(error) });
  });
});
engine.on('fault', (fault) => {
  const incident = incidents.createFromFault(fault);
  persistence.persistFault(fault).catch((error) => {
    logger.error('Could not persist fault event', { id: fault.id, reason: sanitizeMongoError(error) });
  });
  if (incident) {
    persistence.persistIncident(incident, 'incident.created').catch((error) => {
      logger.error('Could not persist incident', { id: incident.id, reason: sanitizeMongoError(error) });
    });
  }
  io.emit('fault:new', fault);
  if (incident) io.emit('incident:new', incident);
});
engine.on('fault:update', (fault) => {
  persistence.persistFault(fault).catch((error) => {
    logger.error('Could not update persisted fault', { id: fault.id, reason: sanitizeMongoError(error) });
  });
});

server.on('error', (error) => {
  logger.error('GridPulse API server failed to bind', { code: error.code, port: config.port, reason: error.message });
  process.exit(1);
});

server.listen(config.port, '0.0.0.0', () => {
  engine.start();
  logger.info('GridPulse API listening', { port: config.port, database: persistence.status });
});

function shutdown() {
  engine.pause();
  detachSocketHandlers();
  io.close(() => {
    persistence.disconnect()
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error('Failed to disconnect cleanly', { reason: sanitizeMongoError(error) });
        process.exit(1);
      });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
