import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfiguration, initialTelemetry } from '../data/mockData.js';
import { evaluateTelemetry } from '../services/faultDetectionService.js';
import { forecastDemand } from '../services/forecastService.js';
import { IncidentService } from '../services/incidentService.js';
import { createScenario } from '../services/scenarioService.js';
import { SimulationEngine } from '../services/simulationEngine.js';
import { buildSimulationSnapshot, createInitialTelemetry } from '../services/simulationService.js';
import { answerGridQuestion } from '../services/assistantService.js';

test('simulation snapshot derives feeder and transformer readings from one telemetry snapshot', () => {
  const telemetry = createInitialTelemetry();
  const snapshot = buildSimulationSnapshot(defaultConfiguration, telemetry);
  const feeder = snapshot.feeders.find((item) => item.id === 'F-202');
  const transformer = snapshot.transformers.find((item) => item.id === 'TX-202');
  const reading = snapshot.telemetry.find((item) => item.feederId === 'F-202');

  assert.equal(feeder.voltage, reading.voltage);
  assert.equal(transformer.voltage, reading.voltage);
  assert.equal(transformer.loadPercent, reading.loadPercent);
});

test('simulation pause stops state updates and repeated detections do not duplicate open faults', () => {
  const engine = new SimulationEngine({
    ...defaultConfiguration,
    voltageMin: 300,
    voltageMax: 1000,
    frequencyMin: 0,
    frequencyMax: 1000,
    overloadPercent: 150,
    telemetryGapSeconds: 3600,
    powerDeviationPercent: 200,
    loadSpikePercent: 100,
    tickIntervalMs: 60000,
  });

  engine.start();
  const firstFaultCount = engine.getFaults().length;
  engine.tick();
  assert.equal(firstFaultCount, 6);
  assert.equal(engine.getFaults().length, firstFaultCount);

  engine.pause();
  const timestamp = engine.getSnapshot().generatedAt;
  engine.tick();
  assert.equal(engine.getSnapshot().generatedAt, timestamp);
  assert.equal(engine.getStatus().running, false);
});

test('fault detection explains threshold and sudden load anomalies', () => {
  const current = initialTelemetry.map((reading) => ({ ...reading }));
  current[0] = { ...current[0], voltage: 200, normalActivePower: 48.8 };
  const previous = current.map((reading) => ({ ...reading }));
  current[0] = { ...current[0], loadPercent: 90 };
  const issues = evaluateTelemetry(current, defaultConfiguration, previous);

  assert.ok(issues.some((issue) => issue.category === 'under-voltage' && issue.equipment === 'F-101'));
  assert.ok(issues.some((issue) => issue.category === 'sudden-load-spike' && issue.equipment === 'F-101'));
  assert.ok(issues.every((issue) => issue.recommendation && issue.anomalyScore > 0));
});

test('scenario impact resolves downstream equipment and marks estimates as hypothetical', () => {
  const snapshot = buildSimulationSnapshot(defaultConfiguration, createInitialTelemetry());
  const result = createScenario(snapshot, { targetId: 'SS-02', mode: 'outage' });

  assert.deepEqual(result.scenario.affectedFeederIds.sort(), ['F-201', 'F-202']);
  assert.deepEqual(result.scenario.affectedTransformerIds.sort(), ['TX-201', 'TX-202']);
  assert.equal(result.impact.hypothetical, true);
  assert.ok(result.impact.affectedLoadMW > 0);
});

test('forecast returns an explicit baseline with supported interval and no fabricated error metrics', () => {
  const history = Array.from({ length: 10 }, (_, index) => ({ totalPower: 250 + index }));
  const result = forecastDemand(history, 6);

  assert.equal(result.forecast.length, 6);
  assert.equal(result.simulated, true);
  assert.equal(result.errorMetrics, null);
  assert.throws(() => forecastDemand(history, 5), /interval must be/);
});

test('incident lifecycle records immutable status transitions and rejects skipping acknowledgement', () => {
  const service = new IncidentService();
  const incident = service.createFromFault({
    id: 'FLT-1',
    severity: 'warning',
    equipment: 'F-101',
    category: 'under-voltage',
    description: 'Below threshold',
    recommendation: 'Inspect regulator',
  });

  assert.throws(() => service.transition(incident.id, 'INVESTIGATING'), { status: 409 });
  service.transition(incident.id, 'ACKNOWLEDGED', 'operator-1');
  service.transition(incident.id, 'INVESTIGATING', 'operator-1');
  const resolved = service.transition(incident.id, 'RESOLVED', 'operator-1');

  assert.equal(resolved.auditHistory.length, 4);
  assert.equal(service.list({ status: 'RESOLVED' }).total, 1);
});

test('assistant answers from current data and reports evidence', () => {
  const snapshot = buildSimulationSnapshot(defaultConfiguration, createInitialTelemetry());
  const result = answerGridQuestion('Which transformer has the highest load?', {
    snapshot,
    faults: [],
    incidents: [],
    configuration: defaultConfiguration,
  });

  assert.match(result.answer, /TX-202/);
  assert.equal(result.simulated, true);
  assert.equal(result.evidence[0].equipment, 'TX-202');
});
