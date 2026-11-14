import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMongoUri, sanitizeMongoError, validateMongoUri } from '../config/mongoUri.js';

test('loads MONGODB_URI and preserves the legacy MONGO_URI alias', () => {
  const uri = 'mongodb+srv://user:pass@cluster.example.mongodb.net/gridpulse';
  assert.equal(resolveMongoUri({ MONGODB_URI: uri }), uri);
  assert.equal(resolveMongoUri({ MONGO_URI: uri }), uri);
  assert.equal(resolveMongoUri({}), '');
  assert.throws(
    () => resolveMongoUri({ MONGODB_URI: uri, MONGO_URI: 'mongodb://localhost/gridpulse' }),
    /Set only one MongoDB URI variable/,
  );
});

test('validates URI schemes and catches malformed or unencoded credentials', () => {
  assert.throws(() => validateMongoUri('https://db.example/gridpulse'), /mongodb:\/\/ or mongodb\+srv:\/\//);
  assert.throws(
    () => validateMongoUri('mongodb+srv://user:bad%2@cluster.example.mongodb.net/gridpulse'),
    /invalid percent encoding/,
  );
  assert.throws(
    () => validateMongoUri('mongodb+srv://user:p@ss@cluster.example.mongodb.net/gridpulse'),
    /credentials must be URL-encoded/,
  );

  const encoded = 'mongodb+srv://user:p%40ss%24word@cluster.example.mongodb.net/gridpulse';
  assert.equal(validateMongoUri(encoded), encoded);
});

test('keeps Atlas TLS and certificate verification enabled', () => {
  assert.throws(
    () => validateMongoUri('mongodb+srv://cluster.example.mongodb.net/gridpulse?tls=false'),
    /TLS must not be disabled/,
  );
  assert.throws(
    () => validateMongoUri('mongodb+srv://cluster.example.mongodb.net/gridpulse?tlsInsecure=true'),
    /certificate and hostname verification/,
  );
  assert.throws(
    () => validateMongoUri('mongodb://cluster.example.mongodb.net:27017/gridpulse'),
    /must specify tls=true/,
  );
  assert.equal(
    validateMongoUri('mongodb://cluster.example.mongodb.net:27017/gridpulse?tls=true'),
    'mongodb://cluster.example.mongodb.net:27017/gridpulse?tls=true',
  );
});

test('redacts MongoDB connection strings from driver error messages', () => {
  const safe = sanitizeMongoError(new Error(
    'TLS failure for mongodb+srv://alice:private%40password@cluster.example.mongodb.net/gridpulse',
  ));
  assert.equal(safe, 'TLS failure for [MongoDB URI redacted]');
  assert.doesNotMatch(safe, /private|alice|cluster\.example/);
});
