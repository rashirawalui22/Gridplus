import { EventEmitter } from 'node:events';
import { defaultConfiguration } from '../data/mockData.js';
import { evaluateTelemetry } from './faultDetectionService.js';
import { buildSimulationSnapshot, createInitialTelemetry } from './simulationService.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class SimulationEngine extends EventEmitter {
  constructor(configuration = defaultConfiguration) {
    super();
    this.configuration = { ...configuration };
    this.running = false;
    this.timer = null;
    this.sequence = 0;
    this.scenario = null;
    this.faults = [];
    this.alerts = [];
    this.activeFaults = new Map();
    this.history = [];
    this.previousTelemetry = [];
    this.snapshot = this.#makeSnapshot(createInitialTelemetry());
    this.#recordHistory();
  }

  start() {
    if (this.running) return this.getStatus();
    this.running = true;
    this.tick();
    this.#schedule();
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  pause() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  reset() {
    this.scenario = null;
    this.faults = [];
    this.alerts = [];
    this.activeFaults.clear();
    this.history = [];
    this.previousTelemetry = [];
    this.snapshot = this.#makeSnapshot(createInitialTelemetry());
    this.#recordHistory();
    if (this.running) this.tick();
    this.emit('snapshot', this.getSnapshot());
    return this.getStatus();
  }

  setConfiguration(configuration) {
    this.configuration = { ...this.configuration, ...configuration };
    this.snapshot = this.#makeSnapshot(this.snapshot.telemetry);
    this.emit('snapshot', this.getSnapshot());
    return this.configuration;
  }

  setScenario(scenario) {
    this.scenario = scenario;
    this.emit('scenario', scenario);
    return scenario;
  }

  clearScenario() {
    this.scenario = null;
    this.snapshot = this.#makeSnapshot(this.snapshot.telemetry);
    this.emit('scenario', null);
    this.emit('snapshot', this.getSnapshot());
  }

  setIntervalMs(intervalMs) {
    this.configuration.tickIntervalMs = intervalMs;
    if (this.running) {
      clearInterval(this.timer);
      this.#schedule();
    }
  }

  getStatus() {
    return {
      running: this.running,
      scenario: this.scenario,
      tickIntervalMs: this.configuration.tickIntervalMs,
    };
  }

  getSnapshot() {
    return {
      ...this.snapshot,
      dashboard: {
        ...this.snapshot.dashboard,
        criticalAlerts: this.alerts.filter((alert) => alert.severity === 'critical' && alert.status === 'open').length,
      },
    };
  }

  getFaults() {
    return [...this.faults].reverse();
  }

  getAlerts() {
    return [...this.alerts].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  getHistory() {
    return [...this.history];
  }

  hydrateFaults(items) {
    this.faults = items.map(({ _id, __v, ...fault }) => fault);
    this.alerts = this.faults.map((fault) => ({
      ...fault,
      status: fault.status === 'resolved' ? 'resolved' : fault.acknowledged ? 'acknowledged' : 'open',
    }));
    this.activeFaults.clear();
    for (const fault of this.faults) {
      const reading = this.snapshot.telemetry.find((item) => item.feederId === fault.equipment || item.transformerId === fault.equipment);
      if (fault.status !== 'resolved' && reading) {
        this.activeFaults.set(`${fault.category}:${reading.feederId}`, fault);
      }
      const match = fault.id?.match(/^FLT-(\d+)$/);
      if (match) this.sequence = Math.max(this.sequence, Number(match[1]));
    }
  }

  acknowledgeAlert(id) {
    const alert = this.alerts.find((item) => item.id === id);
    if (!alert) return null;
    alert.acknowledged = true;
    alert.status = 'acknowledged';
    const fault = this.faults.find((item) => item.id === alert.id);
    if (fault) {
      fault.acknowledged = true;
      fault.status = 'acknowledged';
    }
    this.emit('alerts', this.getAlerts());
    return alert;
  }

  tick() {
    if (!this.running) return this.getSnapshot();
    const previous = this.snapshot.telemetry;
    const now = new Date().toISOString();
    const telemetry = previous.map((reading) => {
      const base = {
        voltage: reading.voltage + (Math.random() - 0.5) * 0.8,
        current: reading.current * (1 + (Math.random() - 0.5) * 0.025),
        loadPercent: reading.loadPercent + (Math.random() - 0.5) * 1.2,
        frequency: reading.frequency + (Math.random() - 0.5) * 0.025,
      };
      const next = {
        ...reading,
        timestamp: now,
        voltage: Number(clamp(base.voltage, 205, 255).toFixed(1)),
        current: Number(clamp(base.current, 0, 1000).toFixed(1)),
        loadPercent: Number(clamp(base.loadPercent, 0, 125).toFixed(0)),
        frequency: Number(clamp(base.frequency, 59, 61).toFixed(2)),
        activePower: Number(Math.max(0, reading.normalActivePower * base.loadPercent / reading.normalLoadPercent).toFixed(1)),
        reactivePower: Number(Math.max(0, reading.reactivePower * base.loadPercent / reading.normalLoadPercent).toFixed(1)),
      };
      return this.#applyScenario(next);
    });

    this.previousTelemetry = previous;
    this.snapshot = this.#makeSnapshot(telemetry);
    this.#updateFaults(evaluateTelemetry(telemetry, this.configuration, previous));
    this.#recordHistory();
    this.emit('snapshot', this.getSnapshot());
    return this.getSnapshot();
  }

  #applyScenario(reading) {
    if (!this.scenario) return reading;
    const matches = this.scenario.affectedFeederIds.includes(reading.feederId)
      || this.scenario.affectedTransformerIds.includes(reading.transformerId);
    if (!matches) return reading;

    if (this.scenario.mode === 'outage') {
      return { ...reading, voltage: 0, current: 0, activePower: 0, reactivePower: 0, loadPercent: 0, status: 'critical' };
    }

    if (this.scenario.mode === 'load') {
      const loadPercent = clamp(reading.normalLoadPercent + this.scenario.loadDeltaPercent, 0, 125);
      return {
        ...reading,
        loadPercent: Number(loadPercent.toFixed(0)),
        activePower: Number((reading.normalActivePower * loadPercent / reading.normalLoadPercent).toFixed(1)),
        status: loadPercent >= this.configuration.overloadPercent ? 'warning' : reading.status,
      };
    }

    if (this.scenario.mode === 'voltage') {
      const voltage = clamp(reading.normalVoltage + this.scenario.voltageDelta, 0, 300);
      return { ...reading, voltage: Number(voltage.toFixed(1)) };
    }

    return reading;
  }

  #makeSnapshot(telemetry) {
    const statusTelemetry = telemetry.map((reading) => {
      const abnormal = reading.voltage < this.configuration.voltageMin
        || reading.voltage > this.configuration.voltageMax
        || reading.frequency < this.configuration.frequencyMin
        || reading.frequency > this.configuration.frequencyMax;
      const overloaded = reading.loadPercent >= this.configuration.overloadPercent;
      return {
        ...reading,
        status: reading.status === 'critical' ? 'critical' : abnormal || overloaded ? 'warning' : 'normal',
      };
    });
    return buildSimulationSnapshot(this.configuration, statusTelemetry);
  }

  #updateFaults(issues) {
    const present = new Set(issues.map((issue) => issue.key));
    for (const [key, activeFault] of this.activeFaults) {
      if (present.has(key)) continue;
      activeFault.status = 'resolved';
      activeFault.resolvedAt = new Date().toISOString();
      const alert = this.alerts.find((item) => item.id === activeFault.id);
      if (alert) alert.status = 'resolved';
      this.activeFaults.delete(key);
      this.emit('fault:update', activeFault);
    }

    for (const issue of issues) {
      if (this.activeFaults.has(issue.key)) continue;
      this.sequence += 1;
      const fault = {
        ...issue,
        id: `FLT-${String(this.sequence).padStart(5, '0')}`,
        status: 'open',
      };
      const alert = {
        ...fault,
        category: fault.category,
        description: fault.description,
      };
      this.activeFaults.set(issue.key, fault);
      this.faults.push(fault);
      this.alerts.push(alert);
      this.emit('fault', fault);
    }

    this.faults = this.faults.slice(-500);
    this.alerts = this.alerts.slice(-500);
    this.emit('alerts', this.getAlerts());
  }

  #recordHistory() {
    const snapshot = this.snapshot;
    this.history.push({
      timestamp: snapshot.generatedAt,
      totalPower: snapshot.dashboard.totalPowerConsumption,
      averageVoltage: snapshot.dashboard.averageVoltage,
      averageFrequency: snapshot.dashboard.averageFrequency,
      telemetry: snapshot.telemetry.map((reading) => ({
        feederId: reading.feederId,
        activePower: reading.activePower,
        voltage: reading.voltage,
        frequency: reading.frequency,
        loadPercent: reading.loadPercent,
      })),
    });
    this.history = this.history.slice(-2000);
  }

  #schedule() {
    this.timer = setInterval(() => this.tick(), this.configuration.tickIntervalMs);
    this.timer.unref?.();
  }
}
