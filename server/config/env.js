import dotenv from 'dotenv';
import { resolveMongoUri } from './mongoUri.js';

dotenv.config();

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: resolveMongoUri(),
  mongoServerSelectionTimeoutMs: positiveInteger(
    process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    30000,
    'MONGO_SERVER_SELECTION_TIMEOUT_MS',
  ),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  adminBootstrapSecret: process.env.ADMIN_BOOTSTRAP_SECRET || '',
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
};
