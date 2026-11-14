import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['ADMIN', 'OPERATOR', 'VIEWER'], default: 'VIEWER', required: true },
}, { timestamps: true });

const substationSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  region: { type: String, required: true },
  reliability: { type: Number, min: 0, max: 100, default: 100 },
}, { timestamps: true });

const transformerSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  substationId: { type: String, required: true, ref: 'Substation', index: true },
  ratingMVA: { type: Number, required: true, min: 0 },
}, { timestamps: true });

const feederSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  substationId: { type: String, required: true, ref: 'Substation', index: true },
  transformerId: { type: String, required: true, ref: 'Transformer', index: true },
}, { timestamps: true });

const telemetrySchema = new Schema({
  feederId: { type: String, required: true, index: true },
  transformerId: { type: String, required: true, index: true },
  substationId: { type: String, required: true, index: true },
  voltage: { type: Number, required: true, min: 0 },
  current: { type: Number, required: true, min: 0 },
  frequency: { type: Number, required: true, min: 0 },
  activePower: { type: Number, required: true, min: 0 },
  reactivePower: { type: Number, required: true, min: 0 },
  loadPercent: { type: Number, required: true, min: 0, max: 200 },
  status: { type: String, enum: ['normal', 'warning', 'critical'], required: true },
  timestamp: { type: Date, required: true },
}, { timestamps: true });
telemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });
telemetrySchema.index({ feederId: 1, timestamp: -1 });

const faultSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  category: { type: String, required: true, index: true },
  severity: { type: String, enum: ['informational', 'warning', 'critical'], required: true, index: true },
  equipment: { type: String, required: true, index: true },
  description: { type: String, required: true },
  recommendation: { type: String, required: true },
  anomalyScore: { type: Number, min: 0 },
  status: { type: String, enum: ['open', 'acknowledged', 'resolved'], default: 'open', index: true },
  acknowledged: { type: Boolean, default: false },
  timestamp: { type: Date, required: true, index: true },
  resolvedAt: Date,
}, { timestamps: true });
faultSchema.index({ severity: 1, timestamp: -1 });

const auditEntrySchema = new Schema({
  status: { type: String, required: true, immutable: true },
  actor: { type: String, required: true, immutable: true },
  timestamp: { type: Date, required: true, immutable: true },
}, { _id: false });

const incidentSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  sourceFaultId: { type: String, required: true, unique: true, index: true },
  severity: { type: String, enum: ['informational', 'warning', 'critical'], required: true, index: true },
  equipment: { type: String, required: true, index: true },
  category: { type: String, required: true },
  description: { type: String, required: true },
  recommendation: { type: String, required: true },
  status: { type: String, enum: ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'], default: 'OPEN', index: true },
  assignedTo: { type: String, default: 'Unassigned' },
  auditHistory: { type: [auditEntrySchema], default: [] },
}, { timestamps: true });
incidentSchema.index({ status: 1, severity: 1, createdAt: -1 });

const scenarioSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  targetId: { type: String, required: true, index: true },
  mode: { type: String, enum: ['outage', 'load', 'voltage'], required: true },
  impact: { type: Schema.Types.Mixed, required: true },
  hypothetical: { type: Boolean, default: true, immutable: true },
}, { timestamps: true });

const auditLogSchema = new Schema({
  eventId: { type: String, required: true, unique: true, sparse: true, immutable: true },
  actor: { type: String, required: true, immutable: true },
  action: { type: String, required: true, immutable: true, index: true },
  entityId: { type: String, required: true, immutable: true, index: true },
  details: { type: Schema.Types.Mixed, default: {}, immutable: true },
}, { timestamps: true });

const simulationConfigSchema = new Schema({
  key: { type: String, default: 'default', unique: true, immutable: true },
  values: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

const revokedTokenSchema = new Schema({
  tokenId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const bootstrapStateSchema = new Schema({
  key: { type: String, required: true, unique: true, immutable: true },
  claimId: { type: String, required: true, unique: true, immutable: true },
  userEmail: { type: String, required: true, immutable: true },
  usedAt: { type: Date, required: true, immutable: true },
}, { timestamps: true });

function getModel(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

export const User = getModel('User', userSchema);
export const Substation = getModel('Substation', substationSchema);
export const Transformer = getModel('Transformer', transformerSchema);
export const Feeder = getModel('Feeder', feederSchema);
export const TelemetryReading = getModel('TelemetryReading', telemetrySchema);
export const FaultEvent = getModel('FaultEvent', faultSchema);
export const Incident = getModel('Incident', incidentSchema);
export const SimulationScenario = getModel('SimulationScenario', scenarioSchema);
export const AuditLog = getModel('AuditLog', auditLogSchema);
export const SimulationConfiguration = getModel('SimulationConfiguration', simulationConfigSchema);
export const RevokedToken = getModel('RevokedToken', revokedTokenSchema);
export const BootstrapState = getModel('BootstrapState', bootstrapStateSchema);
