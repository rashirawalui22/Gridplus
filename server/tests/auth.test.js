import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/authService.js';

test('JWT authentication blocks missing credentials when configured', async () => {
  const auth = new AuthService({
    enabled: true,
    secret: 'test-secret-that-is-at-least-thirty-two-characters',
    tokenRevoked: async () => false,
    userLookup: async () => ({ id: 'user-id', role: 'OPERATOR' }),
  });
  let receivedError;
  await auth.requireRoles(['OPERATOR'])({ get: () => undefined }, {}, (error) => { receivedError = error; });
  assert.equal(receivedError.status, 401);
});

test('JWT role middleware rejects viewer access to operator controls', async () => {
  const secret = 'test-secret-that-is-at-least-thirty-two-characters';
  const auth = new AuthService({ enabled: true, secret, tokenRevoked: async () => false, userLookup: async () => ({ id: 'user-id', role: 'VIEWER' }) });
  const token = jwt.sign({ role: 'VIEWER' }, secret, { subject: 'user-id', expiresIn: '1m' });
  let receivedError;
  await auth.requireRoles(['OPERATOR'])({ get: () => `Bearer ${token}` }, {}, (error) => { receivedError = error; });
  assert.equal(receivedError.status, 403);
});

test('JWT role middleware exposes verified role to downstream handlers', async () => {
  const secret = 'test-secret-that-is-at-least-thirty-two-characters';
  const auth = new AuthService({ enabled: true, secret, tokenRevoked: async () => false, userLookup: async () => ({ id: 'user-id', role: 'ADMIN' }) });
  const token = jwt.sign({ role: 'ADMIN' }, secret, { subject: 'user-id', expiresIn: '1m' });
  const req = { get: () => `Bearer ${token}` };
  await auth.requireRoles(['ADMIN'])(req, {}, (error) => assert.equal(error, undefined));
  assert.deepEqual(req.user, { id: 'user-id', role: 'ADMIN' });
});
