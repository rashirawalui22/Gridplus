import bcrypt from 'bcryptjs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { BootstrapState, RevokedToken, User } from '../models/index.js';

const bootstrapKey = 'initial-administrator';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function credentials({ name, email, password } = {}) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
    throw httpError(400, 'Name must contain 2 to 120 characters.');
  }
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(400, 'Enter a valid email address.');
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    throw httpError(400, 'Password must contain 10 to 128 characters.');
  }
  return { name: name.trim(), email: email.trim().toLowerCase(), password };
}

function secretsMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export class AuthService {
  constructor({
    secret,
    enabled = false,
    expiresIn = '8h',
    bootstrapSecret = '',
    tokenRevoked,
    userLookup,
    userModel = User,
    revokedTokenModel = RevokedToken,
    bootstrapStateModel = BootstrapState,
  } = {}) {
    this.secret = secret;
    this.enabled = enabled && typeof secret === 'string' && secret.length >= 32;
    this.expiresIn = expiresIn;
    this.bootstrapSecret = bootstrapSecret;
    this.userModel = userModel;
    this.revokedTokenModel = revokedTokenModel;
    this.bootstrapStateModel = bootstrapStateModel;
    this.tokenRevoked = tokenRevoked ?? (async (tokenId) => Boolean(await revokedTokenModel.exists({ tokenId })));
    this.userLookup = userLookup ?? (async (id) => {
      const user = await userModel.findById(id).select('_id role');
      return user ? { id: String(user._id), role: user.role } : null;
    });
    this.sessionInvalidationListeners = new Set();
  }

  get status() {
    return { enabled: this.enabled, strategy: this.enabled ? 'JWT + bcrypt' : 'local demo; authentication not configured' };
  }

  onSessionInvalidated(listener) {
    this.sessionInvalidationListeners.add(listener);
    return () => this.sessionInvalidationListeners.delete(listener);
  }

  requireRoles(roles = []) {
    return async (req, _res, next) => {
      if (!this.enabled) return next();
      const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return next(httpError(401, 'Authentication is required.'));
      try {
        req.user = await this.authenticateToken(token);
      } catch (error) {
        return next(error);
      }
      if (roles.length && !roles.includes(req.user.role)) {
        return next(httpError(403, 'Your account does not have permission for this action.'));
      }
      return next();
    };
  }

  verifyToken(token) {
    if (!this.enabled) throw httpError(503, 'Authentication is not configured.');
    try {
      return jwt.verify(token, this.secret);
    } catch {
      throw httpError(401, 'The access token is invalid or expired.');
    }
  }

  async authenticateToken(token) {
    const claims = this.verifyToken(token);
    if (claims.jti && await this.tokenRevoked(claims.jti)) {
      throw httpError(401, 'The access token has been revoked.');
    }
    const user = await this.userLookup(claims.sub);
    if (!user) throw httpError(401, 'Account is no longer available.');
    return {
      id: String(user.id ?? user._id),
      role: user.role,
      tokenId: claims.jti,
      tokenExpiresAt: claims.exp,
    };
  }

  async register(input = {}) {
    this.#assertEnabled();
    const { name, email, password } = credentials(input);
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const user = await this.userModel.create({ name, email, passwordHash, role: 'VIEWER' });
      return this.#issue(user);
    } catch (error) {
      if (error.code === 11000) throw httpError(409, 'An account with that email already exists.');
      throw error;
    }
  }

  async bootstrapAdmin(input = {}) {
    this.#assertEnabled();
    if (typeof this.bootstrapSecret !== 'string' || this.bootstrapSecret.length < 32) {
      throw httpError(503, 'One-time administrator bootstrap is not configured.');
    }
    if (!secretsMatch(input.bootstrapSecret, this.bootstrapSecret)) {
      throw httpError(403, 'The administrator bootstrap secret is invalid.');
    }

    const { name, email, password } = credentials(input);
    if (await this.userModel.exists({ email })) throw httpError(409, 'An account with that email already exists.');
    if (await this.userModel.exists({ role: 'ADMIN' })) throw httpError(409, 'An administrator account already exists.');

    const claimId = randomUUID();
    try {
      await this.bootstrapStateModel.create({
        key: bootstrapKey,
        claimId,
        userEmail: email,
        usedAt: new Date(),
      });
    } catch (error) {
      if (error.code === 11000) throw httpError(409, 'Administrator bootstrap has already been used.');
      throw error;
    }

    let user;
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      user = await this.userModel.create({ name, email, passwordHash, role: 'ADMIN' });
      return this.#issue(user);
    } catch (error) {
      const cleanup = await Promise.allSettled([
        this.bootstrapStateModel.deleteOne({ key: bootstrapKey, claimId }),
        ...(user ? [this.userModel.deleteOne({ _id: user._id })] : []),
      ]);
      const cleanupErrors = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason);
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], 'Administrator bootstrap failed and cleanup was incomplete.');
      }
      if (error.code === 11000) throw httpError(409, 'An account with that email already exists.');
      throw error;
    }
  }

  async login({ email, password } = {}) {
    this.#assertEnabled();
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw httpError(400, 'Email and password are required.');
    }
    const user = await this.userModel.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
    const matches = user && await bcrypt.compare(password, user.passwordHash);
    if (!matches) throw httpError(401, 'Email or password is incorrect.');
    return this.#issue(user);
  }

  async getProfile(id) {
    this.#assertEnabled();
    const user = await this.userModel.findById(id);
    if (!user) throw httpError(401, 'Account is no longer available.');
    return publicUser(user);
  }

  async listUsers() {
    this.#assertEnabled();
    const users = await this.userModel.find().sort({ createdAt: 1 });
    return users.map(publicUser);
  }

  async updateRole(id, role, actorId) {
    this.#assertEnabled();
    if (!['ADMIN', 'OPERATOR', 'VIEWER'].includes(role)) {
      throw httpError(400, 'Role must be ADMIN, OPERATOR, or VIEWER.');
    }
    if (String(id) === String(actorId)) throw httpError(403, 'Administrators cannot change their own role.');
    const user = await this.userModel.findByIdAndUpdate(id, { role }, { new: true, runValidators: true });
    if (!user) throw httpError(404, 'User not found.');
    this.#invalidateSessions({ userId: String(user._id) });
    return publicUser(user);
  }

  async revokeToken(token) {
    this.#assertEnabled();
    const claims = this.verifyToken(token);
    if (!claims.jti || !claims.exp) throw httpError(400, 'The access token cannot be revoked.');
    await this.revokedTokenModel.updateOne(
      { tokenId: claims.jti },
      { $setOnInsert: { tokenId: claims.jti, userId: claims.sub, expiresAt: new Date(claims.exp * 1000) } },
      { upsert: true },
    );
    this.#invalidateSessions({ tokenId: claims.jti });
  }

  #assertEnabled() {
    if (!this.enabled) throw httpError(503, 'Authentication requires a reachable MongoDB instance and a JWT_SECRET of at least 32 characters.');
  }

  #invalidateSessions(identity) {
    for (const listener of this.sessionInvalidationListeners) listener(identity);
  }

  #issue(user) {
    const token = jwt.sign({}, this.secret, {
      subject: String(user._id),
      jwtid: randomUUID(),
      expiresIn: this.expiresIn,
    });
    return { token, user: publicUser(user) };
  }
}
