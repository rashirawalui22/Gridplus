import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/authService.js';

const secret = 'test-secret-that-is-at-least-thirty-two-characters';

function createAuth(role, options = {}) {
  return new AuthService({
    enabled: true,
    secret,
    tokenRevoked: options.tokenRevoked ?? (async () => false),
    userLookup: options.userLookup ?? (async () => ({ id: 'user-id', role })),
    userModel: options.userModel,
  });
}

function tokenFor(role = 'VIEWER', subject = 'user-id', extra = {}) {
  return jwt.sign({}, secret, { subject, jwtid: 'token-id', expiresIn: '1m', ...extra });
}

async function authorize(auth, token, roles) {
  const req = { get: () => token ? `Bearer ${token}` : undefined };
  let receivedError;
  await auth.requireRoles(roles)(req, {}, (error) => { receivedError = error; });
  return { error: receivedError, user: req.user };
}

test('JWT authentication blocks missing credentials when configured', async () => {
  const { error } = await authorize(createAuth('OPERATOR'), null, ['OPERATOR']);
  assert.equal(error.status, 401);
});

test('role matrix grants only the permissions assigned to each role', async () => {
  const permissions = {
    VIEWER: { read: true, operate: false, administer: false },
    OPERATOR: { read: true, operate: true, administer: false },
    ADMIN: { read: true, operate: true, administer: true },
  };
  const routes = {
    read: ['ADMIN', 'OPERATOR', 'VIEWER'],
    operate: ['ADMIN', 'OPERATOR'],
    administer: ['ADMIN'],
  };

  for (const [role, grants] of Object.entries(permissions)) {
    const auth = createAuth(role);
    const token = tokenFor(role);
    for (const [permission, allowed] of Object.entries(grants)) {
      const { error } = await authorize(auth, token, routes[permission]);
      if (allowed) assert.equal(error, undefined, `${role} ${permission}`);
      else assert.equal(error.status, 403, `${role} cannot ${permission}`);
    }
  }
});

test('authorization uses the current database role and exposes the token identity', async () => {
  const auth = createAuth('ADMIN');
  const { error, user } = await authorize(auth, tokenFor(), ['ADMIN']);

  assert.equal(error, undefined);
  assert.equal(user.id, 'user-id');
  assert.equal(user.role, 'ADMIN');
  assert.equal(user.tokenId, 'token-id');
  assert.ok(user.tokenExpiresAt > Math.floor(Date.now() / 1000));
});

test('revoked JWTs are rejected before reaching protected handlers', async () => {
  const auth = createAuth('ADMIN', { tokenRevoked: async (id) => id === 'token-id' });
  const { error } = await authorize(auth, tokenFor(), ['ADMIN']);
  assert.equal(error.status, 401);
  assert.match(error.message, /revoked/);
});

test('administrators cannot change their own role but can change another user', async () => {
  const userModel = {
    findByIdAndUpdate: async (id, update) => ({
      _id: id,
      name: 'Target User',
      email: 'target@example.com',
      role: update.role,
    }),
  };
  const auth = createAuth('ADMIN', { userModel });
  await assert.rejects(auth.updateRole('user-id', 'VIEWER', 'user-id'), { status: 403 });

  let invalidated;
  auth.onSessionInvalidated((identity) => { invalidated = identity; });
  const updated = await auth.updateRole('target-id', 'OPERATOR', 'user-id');
  assert.equal(updated.role, 'OPERATOR');
  assert.deepEqual(invalidated, { userId: 'target-id' });
});

test('bootstrap refuses to create another administrator when one already exists', async () => {
  const auth = new AuthService({
    enabled: true,
    secret,
    bootstrapSecret: 'bootstrap-secret-that-is-at-least-thirty-two-characters',
    userModel: {
      exists: async (filter) => filter.role === 'ADMIN',
    },
  });
  await assert.rejects(auth.bootstrapAdmin({
    name: 'New Admin',
    email: 'new-admin@example.com',
    password: 'a-valid-long-password',
    bootstrapSecret: 'bootstrap-secret-that-is-at-least-thirty-two-characters',
  }), { status: 409 });
});
