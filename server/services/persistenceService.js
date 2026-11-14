import mongoose from 'mongoose';
import {
  AuditLog,
  Feeder,
  FaultEvent,
  Incident,
  SimulationConfiguration,
  SimulationScenario,
  Substation,
  TelemetryReading,
  Transformer,
} from '../models/index.js';
import { feeders, substations, transformers } from '../data/mockData.js';
import { logger } from '../utils/logger.js';

export class PersistenceService {
  constructor(uri, { telemetryIntervalMs = 15000 } = {}) {
    this.uri = uri;
    this.telemetryIntervalMs = telemetryIntervalMs;
    this.connected = false;
    this.lastTelemetryWrite = 0;
  }

  async connect() {
    if (!this.uri) return false;
    try {
      await mongoose.connect(this.uri, { serverSelectionTimeoutMS: 3000 });
      this.connected = true;
      await this.seedEquipment();
      logger.info('MongoDB connected', { database: mongoose.connection.name });
      return true;
    } catch (error) {
      this.connected = false;
      logger.warn('MongoDB unavailable; using in-memory simulation mode', { reason: error.message });
      return false;
    }
  }

  get status() {
    return this.connected ? 'connected' : this.uri ? 'unavailable' : 'disabled';
  }

  async seedEquipment() {
    if (!this.connected) return;
    await Promise.all([
      ...substations.map(({ id, name, region, reliability }) => Substation.updateOne(
        { id }, { $set: { name, region, reliability } }, { upsert: true },
      )),
      ...transformers.map(({ id, name, substationId, ratingMVA }) => Transformer.updateOne(
        { id }, { $set: { name, substationId, ratingMVA } }, { upsert: true },
      )),
      ...feeders.map(({ id, name, substationId, transformerId }) => Feeder.updateOne(
        { id }, { $set: { name, substationId, transformerId } }, { upsert: true },
      )),
    ]);
  }

  async persistSnapshot(snapshot) {
    if (!this.connected || Date.now() - this.lastTelemetryWrite < this.telemetryIntervalMs) return;
    this.lastTelemetryWrite = Date.now();
    const readings = snapshot.telemetry.map((item) => ({
      feederId: item.feederId,
      transformerId: item.transformerId,
      substationId: item.substationId,
      voltage: item.voltage,
      current: item.current,
      frequency: item.frequency,
      activePower: item.activePower,
      reactivePower: item.reactivePower,
      loadPercent: item.loadPercent,
      status: item.status,
      timestamp: new Date(item.timestamp),
    }));
    await TelemetryReading.insertMany(readings, { ordered: true });
  }

  async persistFault(fault) {
    if (!this.connected) return;
    await FaultEvent.updateOne({ id: fault.id }, { $set: fault }, { upsert: true });
  }

  async persistIncident(incident, action = 'incident.updated') {
    if (!this.connected) return;
    const latestAudit = incident.auditHistory.at(-1);
    if (action === 'incident.created') {
      await Incident.updateOne(
        { id: incident.id },
        { $setOnInsert: incident },
        { upsert: true },
      );
    } else {
      await Incident.updateOne(
        { id: incident.id },
        {
          $set: {
            status: incident.status,
            assignedTo: incident.assignedTo,
            updatedAt: incident.updatedAt,
          },
          ...(latestAudit ? { $push: { auditHistory: latestAudit } } : {}),
        },
      );
    }
    if (latestAudit) {
      await AuditLog.create({
        actor: latestAudit.actor,
        action,
        entityId: incident.id,
        details: { status: latestAudit.status, equipment: incident.equipment },
      });
    }
  }

  async persistScenario(result) {
    if (!this.connected) return;
    await SimulationScenario.updateOne(
      { id: result.scenario.id },
      { $setOnInsert: { ...result.scenario, impact: result.impact } },
      { upsert: true },
    );
  }

  async persistConfiguration(values) {
    if (!this.connected) return;
    await SimulationConfiguration.updateOne(
      { key: 'default' },
      { $set: { values } },
      { upsert: true },
    );
  }

  async loadConfiguration() {
    if (!this.connected) return null;
    const config = await SimulationConfiguration.findOne({ key: 'default' }).lean();
    return config?.values ?? null;
  }

  async loadIncidents() {
    if (!this.connected) return [];
    return Incident.find().sort({ createdAt: -1 }).limit(500).lean();
  }

  async loadFaults() {
    if (!this.connected) return [];
    return FaultEvent.find().sort({ timestamp: -1 }).limit(500).lean();
  }

  async getHistorical({ feederId, limit = 100, offset = 0 } = {}) {
    if (!this.connected) return null;
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const filter = feederId ? { feederId: String(feederId) } : {};
    const [items, total] = await Promise.all([
      TelemetryReading.find(filter).sort({ timestamp: -1 }).skip(safeOffset).limit(safeLimit).lean(),
      TelemetryReading.countDocuments(filter),
    ]);
    return { items, total, limit: safeLimit, offset: safeOffset };
  }

  async disconnect() {
    if (mongoose.connection.readyState) await mongoose.disconnect();
    this.connected = false;
  }
}
