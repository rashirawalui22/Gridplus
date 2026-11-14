import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import mongoose from 'mongoose';
import { Server as SocketServer } from 'socket.io';
import { io as socketClient } from 'socket.io-client';
import test from 'node:test';
import { createApp } from '../app.js';
import { defaultConfiguration } from '../data/mockData.js';
import { AuditLog, Incident, RevokedToken, TelemetryReading } from '../models/index.js';
import { IncidentService } from '../services/incidentService.js';
import { PersistenceService } from '../services/persistenceService.js';
import { SimulationEngine } from '../services/simulationEngine.js';
import { AuthService } from '../services/authService.js';
import { attachSocketHandlers } from '../socketServer.js';

function createTestUri(value) {
  if (!value) throw new Error('MONGO_TEST_URI must point to a dedicated MongoDB test database.');
  const uri = new URL(value);
  const requestedDatabase = uri.pathname.replace(/^\/+/, '').split('/')[0];
  if (!requestedDatabase.toLowerCase().includes('test')) {
    throw new Error('MONGO_TEST_URI database name must include "test".');
  }
  uri.pathname = `/gridpulse_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  return uri.toString();
}

function waitForEvent(emitter, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeoutMs);
    const onEvent = (...args) => {
      clearTimeout(timer);
      resolve(args);
    };
    emitter.once(event, onEvent);
  });
}

async function connectSocket(socket) {
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Socket.IO connection.'));
    }, 5000);
    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    socket.connect();
  });
}

function credentials(prefix) {
  return {
    name: `${prefix} Operator`,
    email: `${prefix}-${randomUUID()}@example.test`,
    password: `${randomUUID()}-Long!Password`,
  };
}

test('MongoDB auth, persistence recovery, and secured real-time workflow', { timeout: 120000 }, async (t) => {
  const mongoUri = createTestUri(process.env.MONGO_TEST_URI);
  const testSecret = randomBytes(48).toString('base64url');
  const bootstrapSecret = randomBytes(48).toString('base64url');
  let recovery;
  let persistence;
  let httpServer;
  let io;
  let detachSocketHandlers;
  const clients = [];

  t.after(async () => {
    for (const client of clients) client.close();
    detachSocketHandlers?.();
    if (io) await new Promise((resolve) => io.close(resolve));
    if (recovery) await recovery.disconnect();
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    if (persistence) await persistence.disconnect();
    else if (mongoose.connection.readyState) await mongoose.disconnect();
    if (httpServer?.listening) await new Promise((resolve) => httpServer.close(resolve));
  });

  recovery = new PersistenceService('mongodb://127.0.0.1:1/gridpulse_test', {
    serverSelectionTimeoutMS: 3000,
  });
  assert.equal(await recovery.connect(), false);
  assert.equal(recovery.status, 'unavailable');
  recovery.uri = mongoUri;
  recovery.startRecovery(50);
  const recoveryDeadline = Date.now() + 15000;
  while (recovery.status !== 'connected' && Date.now() < recoveryDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(recovery.status, 'connected', 'the same persistence service should recover after MongoDB becomes reachable');
  await recovery.disconnect();
  await assert.rejects(
    () => recovery.persistConfiguration(defaultConfiguration),
    /MongoDB is unavailable/,
  );
  recovery = null;

  persistence = new PersistenceService(mongoUri);
  assert.equal(await persistence.connect(), true);
  const engine = new SimulationEngine(defaultConfiguration);
  const savedConfiguration = { ...defaultConfiguration, voltageMin: 220 };
  await persistence.persistConfiguration(savedConfiguration);
  await persistence.persistSnapshot(engine.getSnapshot());

  const fault = {
    id: 'FLT-INT-00001',
    key: 'under-voltage:F-101',
    category: 'under-voltage',
    severity: 'warning',
    anomalyScore: 1.2,
    equipment: 'F-101',
    description: 'Integration test voltage deviation.',
    recommendation: 'Inspect the simulated feeder.',
    status: 'open',
    acknowledged: false,
    timestamp: new Date().toISOString(),
  };
  await persistence.persistFault(fault);
  const incidentService = new IncidentService();
  const incident = incidentService.createFromFault(fault);
  await persistence.persistIncident(incident, 'incident.created');
  const createdIncident = await Incident.findOne({ id: incident.id }).lean();
  assert.ok(createdIncident.createdAt instanceof Date);
  assert.ok(createdIncident.updatedAt instanceof Date);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await persistence.persistIncident(incident, 'incident.created');
  assert.equal(await Incident.countDocuments({ id: incident.id }), 1);
  const repeatedUpsert = await Incident.findOne({ id: incident.id }).lean();
  assert.equal(repeatedUpsert.createdAt.getTime(), createdIncident.createdAt.getTime());
  assert.ok(repeatedUpsert.updatedAt > createdIncident.updatedAt);

  const acknowledged = incidentService.prepareTransition(incident.id, 'ACKNOWLEDGED', 'test-admin');
  await new Promise((resolve) => setTimeout(resolve, 5));
  await persistence.persistIncident(acknowledged, 'incident.status_changed');
  incidentService.commit(acknowledged);
  const acknowledgedIncident = await Incident.findOne({ id: incident.id }).lean();
  assert.equal(acknowledgedIncident.createdAt.getTime(), createdIncident.createdAt.getTime());
  assert.ok(acknowledgedIncident.updatedAt > repeatedUpsert.updatedAt);

  const investigating = incidentService.prepareTransition(incident.id, 'INVESTIGATING', 'test-admin');
  await new Promise((resolve) => setTimeout(resolve, 5));
  await persistence.persistIncident(investigating, 'incident.status_changed');
  incidentService.commit(investigating);
  const investigatingIncident = await Incident.findOne({ id: incident.id }).lean();
  assert.equal(investigatingIncident.status, 'INVESTIGATING');
  assert.equal(investigatingIncident.createdAt.getTime(), createdIncident.createdAt.getTime());
  assert.ok(investigatingIncident.updatedAt > acknowledgedIncident.updatedAt);

  const history = await persistence.getHistorical({ feederId: 'F-101', limit: 10 });
  assert.equal(history.total, 1);
  assert.equal(history.items[0].feederId, 'F-101');
  const ttlIndexes = await TelemetryReading.collection.indexes();
  assert.ok(ttlIndexes.some((index) => index.key.timestamp === 1 && index.expireAfterSeconds === 7776000));
  const revokedTokenIndexes = await RevokedToken.collection.indexes();
  assert.ok(revokedTokenIndexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
  assert.equal(await AuditLog.countDocuments({ entityId: incident.id }), 3);

  await persistence.disconnect();
  persistence = new PersistenceService(mongoUri);
  assert.equal(await persistence.connect(), true);
  assert.deepEqual(await persistence.loadConfiguration(), savedConfiguration);
  const loadedIncidents = await persistence.loadIncidents();
  const loadedFaults = await persistence.loadFaults();
  assert.equal(loadedIncidents[0].status, 'INVESTIGATING');
  assert.equal(loadedIncidents[0].auditHistory.length, 3);
  assert.equal(
    new Date(loadedIncidents[0].updatedAt).getTime(),
    investigatingIncident.updatedAt.getTime(),
  );
  assert.equal(loadedFaults[0].id, fault.id);
  const restoredHistory = await persistence.getHistorical({ feederId: 'F-101', limit: 10 });
  assert.equal(restoredHistory.total, 1);
  const resumedEngine = new SimulationEngine(await persistence.loadConfiguration());
  resumedEngine.hydrateFaults(loadedFaults);
  assert.equal(resumedEngine.getFaults()[0].id, fault.id);

  const auth = new AuthService({
    secret: testSecret,
    enabled: true,
    bootstrapSecret,
  });
  const incidents = new IncidentService();
  incidents.hydrate(loadedIncidents);
  const apiEngine = new SimulationEngine(savedConfiguration);
  apiEngine.hydrateFaults(loadedFaults);
  const { app } = createApp({
    engine: apiEngine,
    incidents,
    persistence,
    auth,
    allowedOrigin: 'http://localhost:5173',
  });
  httpServer = http.createServer(app);
  io = new SocketServer(httpServer, { cors: { origin: 'http://localhost:5173' } });
  detachSocketHandlers = attachSocketHandlers(io, auth, apiEngine);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = response.status === 204 ? null : await response.json();
    return { response, payload };
  }

  const bootstrapCredentials = credentials('admin');
  const wrongBootstrap = await request('/api/auth/bootstrap-admin', {
    method: 'POST',
    body: { ...bootstrapCredentials, bootstrapSecret: randomUUID() },
  });
  assert.equal(wrongBootstrap.response.status, 403);
  const bootstrapped = await request('/api/auth/bootstrap-admin', {
    method: 'POST',
    body: { ...bootstrapCredentials, bootstrapSecret },
  });
  assert.equal(bootstrapped.response.status, 201);
  assert.equal(bootstrapped.payload.user.role, 'ADMIN');
  const reusedBootstrap = await request('/api/auth/bootstrap-admin', {
    method: 'POST',
    body: { ...credentials('second-admin'), bootstrapSecret },
  });
  assert.equal(reusedBootstrap.response.status, 409);

  const viewerCredentials = credentials('viewer');
  const registeredViewer = await request('/api/auth/register', {
    method: 'POST',
    body: { ...viewerCredentials, role: 'ADMIN' },
  });
  assert.equal(registeredViewer.response.status, 201);
  assert.equal(registeredViewer.payload.user.role, 'VIEWER');
  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: bootstrapCredentials.email, password: bootstrapCredentials.password },
  });
  assert.equal(adminLogin.payload.user.role, 'ADMIN');
  const viewerLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: viewerCredentials.email, password: viewerCredentials.password },
  });
  assert.equal(viewerLogin.payload.user.role, 'VIEWER');

  const selfRoleChange = await request(`/api/auth/users/${adminLogin.payload.user.id}/role`, {
    method: 'PATCH',
    token: adminLogin.payload.token,
    body: { role: 'VIEWER' },
  });
  assert.equal(selfRoleChange.response.status, 403);
  const viewerCannotManageRoles = await request(`/api/auth/users/${registeredViewer.payload.user.id}/role`, {
    method: 'PATCH',
    token: viewerLogin.payload.token,
    body: { role: 'ADMIN' },
  });
  assert.equal(viewerCannotManageRoles.response.status, 403);
  const viewerCannotOperate = await request('/api/simulation/start', {
    method: 'POST',
    token: viewerLogin.payload.token,
  });
  assert.equal(viewerCannotOperate.response.status, 403);
  const viewerCanRead = await request('/api/snapshot', { token: viewerLogin.payload.token });
  assert.equal(viewerCanRead.response.status, 200);

  const guestSocket = socketClient(baseUrl, { autoConnect: false, reconnection: false });
  clients.push(guestSocket);
  const guestRejected = waitForEvent(guestSocket, 'connect_error');
  guestSocket.connect();
  const [guestError] = await guestRejected;
  assert.match(guestError.message, /Authentication is required/);

  const invalidSocket = socketClient(baseUrl, {
    autoConnect: false,
    reconnection: false,
    auth: { token: 'not-a-valid-token' },
  });
  clients.push(invalidSocket);
  const invalidRejected = waitForEvent(invalidSocket, 'connect_error');
  invalidSocket.connect();
  const [invalidError] = await invalidRejected;
  assert.match(invalidError.message, /invalid or expired/);

  const viewerSocket = socketClient(baseUrl, {
    autoConnect: false,
    reconnection: false,
    auth: { token: viewerLogin.payload.token },
  });
  clients.push(viewerSocket);
  const viewerSnapshot = waitForEvent(viewerSocket, 'telemetry:snapshot');
  const viewerStatus = waitForEvent(viewerSocket, 'simulation:status');
  await connectSocket(viewerSocket);
  assert.equal((await viewerSnapshot)[0].generatedAt, apiEngine.getSnapshot().generatedAt);
  assert.equal((await viewerStatus)[0].running, false);
  viewerSocket.emit('simulation:start');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(apiEngine.getStatus().running, false, 'read-only sockets have no simulation control event');

  viewerSocket.disconnect();
  const reconnectedSnapshot = waitForEvent(viewerSocket, 'telemetry:snapshot');
  await connectSocket(viewerSocket);
  assert.equal((await reconnectedSnapshot)[0].generatedAt, apiEngine.getSnapshot().generatedAt);

  const operatorDisconnect = waitForEvent(viewerSocket, 'disconnect');
  const promoted = await request(`/api/auth/users/${registeredViewer.payload.user.id}/role`, {
    method: 'PATCH',
    token: adminLogin.payload.token,
    body: { role: 'OPERATOR' },
  });
  assert.equal(promoted.response.status, 200);
  assert.equal(promoted.payload.role, 'OPERATOR');
  await operatorDisconnect;
  const operatorStart = await request('/api/simulation/start', {
    method: 'POST',
    token: viewerLogin.payload.token,
  });
  assert.equal(operatorStart.response.status, 200);
  const operatorPatch = await request(`/api/auth/users/${registeredViewer.payload.user.id}/role`, {
    method: 'PATCH',
    token: viewerLogin.payload.token,
    body: { role: 'ADMIN' },
  });
  assert.equal(operatorPatch.response.status, 403);
  await request('/api/simulation/pause', { method: 'POST', token: viewerLogin.payload.token });

  const operatorSocket = socketClient(baseUrl, {
    autoConnect: false,
    reconnection: false,
    auth: { token: viewerLogin.payload.token },
  });
  clients.push(operatorSocket);
  await connectSocket(operatorSocket);
  const revokedDisconnect = waitForEvent(operatorSocket, 'disconnect');
  const logout = await request('/api/auth/logout', {
    method: 'POST',
    token: viewerLogin.payload.token,
  });
  assert.equal(logout.response.status, 204);
  await revokedDisconnect;
  const revokedProfile = await request('/api/auth/me', { token: viewerLogin.payload.token });
  assert.equal(revokedProfile.response.status, 401);
  const revokedSocket = socketClient(baseUrl, {
    autoConnect: false,
    reconnection: false,
    auth: { token: viewerLogin.payload.token },
  });
  clients.push(revokedSocket);
  await assert.rejects(() => connectSocket(revokedSocket), /revoked/);

  const adminSocket = socketClient(baseUrl, {
    autoConnect: false,
    reconnection: false,
    auth: { token: adminLogin.payload.token },
  });
  clients.push(adminSocket);
  await connectSocket(adminSocket);
  const adminDisconnect = waitForEvent(adminSocket, 'disconnect');
  const adminLogout = await request('/api/auth/logout', {
    method: 'POST',
    token: adminLogin.payload.token,
  });
  assert.equal(adminLogout.response.status, 204);
  await adminDisconnect;

  assert.equal(apiEngine.listenerCount('snapshot'), 1);
  detachSocketHandlers();
  detachSocketHandlers = null;
  assert.equal(apiEngine.listenerCount('snapshot'), 0);
});
