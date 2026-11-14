import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { attachSocketHandlers } from '../socketServer.js';

test('revocation during a pending socket handshake prevents connection', async () => {
  const io = new EventEmitter();
  io.sockets = { sockets: new Map() };
  io.use = (middleware) => { io.middleware = middleware; };
  let invalidateSessions;
  let signalAuthentication;
  let completeAuthentication;
  const authenticationStarted = new Promise((resolve) => { signalAuthentication = resolve; });
  const authenticationGate = new Promise((resolve) => { completeAuthentication = resolve; });
  const auth = {
    status: { enabled: true },
    verifyToken: () => ({ sub: 'user-id', jti: 'token-id' }),
    authenticateToken: async () => {
      signalAuthentication();
      await authenticationGate;
      return { id: 'user-id', role: 'OPERATOR', tokenId: 'token-id' };
    },
    onSessionInvalidated: (listener) => {
      invalidateSessions = listener;
      return () => { invalidateSessions = null; };
    },
  };
  const engine = new EventEmitter();
  engine.getSnapshot = () => ({});
  engine.getStatus = () => ({});
  const detach = attachSocketHandlers(io, auth, engine);
  const socket = {
    handshake: { auth: { token: 'valid-token' } },
    data: {},
    disconnected: false,
    disconnect() { this.disconnected = true; },
  };

  const result = new Promise((resolve) => io.middleware(socket, resolve));
  await authenticationStarted;
  invalidateSessions({ tokenId: 'token-id' });
  completeAuthentication();

  const error = await result;
  assert.match(error.message, /revoked/);
  assert.equal(socket.disconnected, true);
  detach();
});
