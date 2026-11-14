import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { RevokedToken, User } from '../models/index.js';

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

export class AuthService {
  constructor({
    secret,
    enabled = false,
    expiresIn = '8h',
    adminEmail = '',
    tokenRevoked = async (tokenId) => Boolean(await RevokedToken.exists({ tokenId })),
    userLookup = async (id) => {
      const user = await User.findById(id).select('_id role');
      return user ? { id: String(user._id), role: user.role } : null;
    },
  }) {
    this.secret = secret;
    this.enabled = enabled && typeof secret === 'string' && secret.length >= 32;
    this.expiresIn = expiresIn;
    this.adminEmail = adminEmail.trim().toLowerCase();
    this.tokenRevoked = tokenRevoked;
    this.userLookup = userLookup;
  }

  get status() {
    return { enabled: this.enabled, strategy: this.enabled ? 'JWT + bcrypt' : 'local demo; authentication not configured' };
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
    return { id: String(user.id ?? user._id), role: user.role };
  }

  async register({ name, email, password } = {}) {
    this.#assertEnabled();
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
      throw httpError(400, 'Name must contain 2 to 120 characters.');
    }
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw httpError(400, 'Enter a valid email address.');
    }
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
      throw httpError(400, 'Password must contain 10 to 128 characters.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) throw httpError(409, 'An account with that email already exists.');
    const passwordHash = await bcrypt.hash(password, 12);
    let user;
    try {
      user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        role: normalizedEmail === this.adminEmail && this.adminEmail ? 'ADMIN' : 'VIEWER',
      });
    } catch (error) {
      if (error.code === 11000) throw httpError(409, 'An account with that email already exists.');
      throw error;
    }
    return this.#issue(user);
  }

  async login({ email, password } = {}) {
    this.#assertEnabled();
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw httpError(400, 'Email and password are required.');
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
    const matches = user && await bcrypt.compare(password, user.passwordHash);
    if (!matches) throw httpError(401, 'Email or password is incorrect.');
    return this.#issue(user);
  }

  async getProfile(id) {
    this.#assertEnabled();
    const user = await User.findById(id);
    if (!user) throw httpError(401, 'Account is no longer available.');
    return publicUser(user);
  }

  async listUsers() {
    this.#assertEnabled();
    const users = await User.find().sort({ createdAt: 1 });
    return users.map(publicUser);
  }

  async updateRole(id, role) {
    this.#assertEnabled();
    if (!['ADMIN', 'OPERATOR', 'VIEWER'].includes(role)) {
      throw httpError(400, 'Role must be ADMIN, OPERATOR, or VIEWER.');
    }
    const user = await User.findByIdAndUpdate(id, { role }, { new: true, runValidators: true });
    if (!user) throw httpError(404, 'User not found.');
    return publicUser(user);
  }

  async revokeToken(token) {
    this.#assertEnabled();
    const claims = this.verifyToken(token);
    if (!claims.jti || !claims.exp) throw httpError(400, 'The access token cannot be revoked.');
    await RevokedToken.updateOne(
      { tokenId: claims.jti },
      { $setOnInsert: { tokenId: claims.jti, userId: claims.sub, expiresAt: new Date(claims.exp * 1000) } },
      { upsert: true },
    );
  }

  #assertEnabled() {
    if (!this.enabled) throw httpError(503, 'Authentication requires a reachable MongoDB instance and a JWT_SECRET of at least 32 characters.');
  }

  #issue(user) {
    const token = jwt.sign({ role: user.role }, this.secret, {
      subject: String(user._id),
      jwtid: randomUUID(),
      expiresIn: this.expiresIn,
    });
    return { token, user: publicUser(user) };
  }
}
