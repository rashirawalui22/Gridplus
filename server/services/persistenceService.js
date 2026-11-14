import mongoose from 'mongoose';
import { sanitizeMongoError } from '../config/mongoUri.js';
import {
  AuditLog,
  BootstrapState,
  Feeder,
  FaultEvent,
  Incident,
  RevokedToken,
  SimulationConfiguration,
  SimulationScenario,
  Substation,
  TelemetryReading,
  Transformer,
  User,
} from '../models/index.js';
import { feeders, substations, transformers } from '../data/mockData.js';
import { logger } from '../utils/logger.js';

export class PersistenceService {
  constructor(uri, { telemetryIntervalMs = 15000, serverSelectionTimeoutMS = 30000 } = {}) {
    this.uri = uri;
    this.telemetryIntervalMs = telemetryIntervalMs;
    this.serverSelectionTimeoutMS = serverSelectionTimeoutMS;
    this.connected = false;
    this.ready = false;
    this.lastTelemetryWrite = 0;
    this.connecting = null;
    this.retryTimer = null;
    this.connectionHandlers = {
      connected: () => {
        if (this.ready) this.connected = true;
      },
      disconnected: () => {
        this.connected = false;
      },
    };
    mongoose.connection.on('connected', this.connectionHandlers.connected);
    mongoose.connection.on('disconnected', this.connectionHandlers.disconnected);
  }

  async connect() {
    if (!this.uri) return false;
    if (this.connected) return true;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      try {
        await mongoose.connect(this.uri, { serverSelectionTimeoutMS: this.serverSelectionTimeoutMS });
        await Promise.all([
          User.init(),
          RevokedToken.init(),
          BootstrapState.init(),
          Substation.init(),
          Transformer.init(),
          Feeder.init(),
          TelemetryReading.init(),
          FaultEvent.init(),
          Incident.init(),
          SimulationScenario.init(),
          AuditLog.init(),
          SimulationConfiguration.init(),
        ]);
        await this.seedEquipment();
        this.ready = true;
        this.connected = true;
        logger.info('MongoDB connected', { database: mongoose.connection.name });
        return true;
      } catch (error) {
        this.connected = false;
        logger.warn('MongoDB unavailable; persistence is not active', { reason: sanitizeMongoError(error) });
        return false;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  startRecovery(intervalMs = 10000) {
    if (!this.uri || this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      if (this.connected || this.connecting) return;
      this.connect().catch((error) => {
        logger.error('MongoDB recovery attempt failed', { reason: sanitizeMongoError(error) });
      });
    }, intervalMs);
    this.retryTimer.unref?.();
  }

  get status() {
    return this.connected ? 'connected' : this.uri ? 'unavailable' : 'disabled';
  }

  async seedEquipment() {
    if (!this.uri) return;
    if (mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB is unavailable; equipment seed was not written.');
    }
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
    if (!this.#canPersist()) return;
    const now = Date.now();
    if (now - this.lastTelemetryWrite < this.telemetryIntervalMs) return;
    this.lastTelemetryWrite = now;
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
    if (!this.#canPersist()) return;
    await FaultEvent.updateOne({ id: fault.id }, { $set: fault }, { upsert: true });
  }

  async persistIncident(incident, action = 'incident.updated') {
    if (!this.#canPersist()) return;
    const latestAudit = incident.auditHistory.at(-1);
    if (action === 'incident.created') {
      const incidentForInsert = { ...incident };
      delete incidentForInsert.updatedAt;
      await Incident.updateOne(
        { id: incident.id },
        { $setOnInsert: incidentForInsert },
        { upsert: true },
      );
    } else {
      const result = await Incident.updateOne(
        { id: incident.id },
        {
          $set: {
            status: incident.status,
            assignedTo: incident.assignedTo,
          },
          ...(latestAudit ? { $addToSet: { auditHistory: latestAudit } } : {}),
        },
      );
      if (!result.matchedCount) throw new Error(`Incident ${incident.id} was not found in persistent storage.`);
    }
    if (latestAudit) {
      const eventId = `${incident.id}:${latestAudit.status}:${latestAudit.timestamp}`;
      try {
        await AuditLog.updateOne(
          { eventId },
          {
            $setOnInsert: {
              eventId,
              actor: latestAudit.actor,
              action,
              entityId: incident.id,
              details: { status: latestAudit.status, equipment: incident.equipment },
            },
          },
          { upsert: true },
        );
      } catch (error) {
        logger.error('Incident audit log mirror failed; embedded incident history remains authoritative', {
          entityId: incident.id,
          eventId,
          reason: sanitizeMongoError(error),
        });
      }
    }
  }

  async persistScenario(result) {
    if (!this.#canPersist()) return;
    await SimulationScenario.updateOne(
      { id: result.scenario.id },
      { $setOnInsert: { ...result.scenario, impact: result.impact } },
      { upsert: true },
    );
  }

  async persistConfiguration(values) {
    if (!this.#canPersist()) return;
    await SimulationConfiguration.updateOne(
      { key: 'default' },
      { $set: { values } },
      { upsert: true },
    );
  }

  async loadConfiguration() {
    if (!this.#canPersist()) return null;
    const config = await SimulationConfiguration.findOne({ key: 'default' }).lean();
    return config?.values ?? null;
  }

  async loadIncidents() {
    if (!this.#canPersist()) return [];
    return Incident.find().sort({ createdAt: -1 }).limit(500).lean();
  }

  async loadFaults() {
    if (!this.#canPersist()) return [];
    return FaultEvent.find().sort({ timestamp: -1 }).limit(500).lean();
  }

  async getHistorical({ feederId, limit = 100, offset = 0 } = {}) {
    if (!this.#canPersist()) return null;
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
    clearInterval(this.retryTimer);
    this.retryTimer = null;
    if (mongoose.connection.readyState) await mongoose.disconnect();
    this.connected = false;
    this.ready = false;
    mongoose.connection.off('connected', this.connectionHandlers.connected);
    mongoose.connection.off('disconnected', this.connectionHandlers.disconnected);
  }

  #canPersist() {
    if (!this.uri) return false;
    if (!this.connected || mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB is unavailable; the persistence operation was not completed.');
    }
    return true;
  }
}
