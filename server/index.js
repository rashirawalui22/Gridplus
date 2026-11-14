import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { AuthService } from './services/authService.js';
import { IncidentService } from './services/incidentService.js';
import { PersistenceService } from './services/persistenceService.js';
import { SimulationEngine } from './services/simulationEngine.js';
import { logger } from './utils/logger.js';

const engine = new SimulationEngine();
const incidents = new IncidentService();
const persistence = new PersistenceService(config.mongoUri);
await persistence.connect();
const auth = new AuthService({
  secret: config.jwtSecret,
  enabled: persistence.status === 'connected',
  expiresIn: config.jwtExpiresIn,
  adminEmail: config.adminEmail,
});
if (persistence.status === 'connected' && !auth.status.enabled) {
  logger.warn('Authentication disabled because JWT_SECRET must contain at least 32 characters');
}
if (persistence.status === 'connected') {
  try {
    const savedConfiguration = await persistence.loadConfiguration();
    if (savedConfiguration) engine.setConfiguration(savedConfiguration);
    incidents.hydrate(await persistence.loadIncidents());
    engine.hydrateFaults(await persistence.loadFaults());
  } catch (error) {
    logger.warn('Could not load persisted event history; continuing in memory mode', { reason: error.message });
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

io.use((socket, next) => {
  if (!auth.status.enabled) return next();
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication is required.'));
  return auth.authenticateToken(token)
    .then((user) => {
      socket.data.user = user;
      next();
    })
    .catch(next);
});

engine.on('snapshot', (snapshot) => io.emit('telemetry:snapshot', snapshot));
engine.on('status', (status) => io.emit('simulation:status', status));
engine.on('alerts', (alerts) => io.emit('alerts:update', alerts));
engine.on('snapshot', (snapshot) => {
  persistence.persistSnapshot(snapshot).catch((error) => {
    logger.error('Could not persist telemetry snapshot', { reason: error.message });
  });
});
engine.on('fault', (fault) => {
  const incident = incidents.createFromFault(fault);
  persistence.persistFault(fault).catch((error) => {
    logger.error('Could not persist fault event', { id: fault.id, reason: error.message });
  });
  if (incident) {
    persistence.persistIncident(incident, 'incident.created').catch((error) => {
      logger.error('Could not persist incident', { id: incident.id, reason: error.message });
    });
  }
  io.emit('fault:new', fault);
  if (incident) io.emit('incident:new', incident);
});
engine.on('fault:update', (fault) => {
  persistence.persistFault(fault).catch((error) => {
    logger.error('Could not update persisted fault', { id: fault.id, reason: error.message });
  });
});

io.on('connection', (socket) => {
  socket.emit('telemetry:snapshot', engine.getSnapshot());
  socket.emit('simulation:status', engine.getStatus());
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
  io.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
