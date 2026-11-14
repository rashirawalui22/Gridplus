import { defaultConfiguration } from '../data/mockData.js';

const guidance = {
  'under-voltage': 'Inspect load balance and verify feeder regulator response.',
  'over-voltage': 'Review reactive support and inspect tap changer operation.',
  'frequency-deviation': 'Assess generation balance and confirm interconnection stability.',
  'transformer-overload': 'Shift demand to alternate feeders and inspect cooling systems.',
  'abnormal-power': 'Review feeder loading and verify metering calibration.',
  'sudden-load-spike': 'Check for switched loads and validate metering before rebalancing.',
  'telemetry-gap': 'Check communications, device power and the last successful measurement.',
};

function makeIssue(reading, category, score, detail) {
  return {
    key: `${category}:${reading.feederId || reading.transformerId}`,
    category,
    severity: score >= 2 ? 'critical' : 'warning',
    anomalyScore: Number(score.toFixed(2)),
    equipment: category === 'transformer-overload' ? reading.transformerId : reading.feederId,
    timestamp: reading.timestamp,
    description: detail,
    recommendation: guidance[category],
    acknowledged: false,
  };
}

export function evaluateTelemetry(telemetry, configuration = defaultConfiguration, previousTelemetry = []) {
  const issues = [];
  const previousByFeeder = new Map(previousTelemetry.map((reading) => [reading.feederId, reading]));

  for (const reading of telemetry) {
    const voltageRange = Math.max(configuration.voltageMax - configuration.voltageMin, 1);
    if (reading.voltage < configuration.voltageMin) {
      const ratio = (configuration.voltageMin - reading.voltage) / voltageRange;
      issues.push(makeIssue(reading, 'under-voltage', 1 + ratio, `Voltage measured ${reading.voltage}V, below the configured ${configuration.voltageMin}V limit.`));
    }

    if (reading.voltage > configuration.voltageMax) {
      const ratio = (reading.voltage - configuration.voltageMax) / voltageRange;
      issues.push(makeIssue(reading, 'over-voltage', 1 + ratio, `Voltage measured ${reading.voltage}V, above the configured ${configuration.voltageMax}V limit.`));
    }

    if (reading.frequency < configuration.frequencyMin || reading.frequency > configuration.frequencyMax) {
      const deviation = reading.frequency < configuration.frequencyMin
        ? configuration.frequencyMin - reading.frequency
        : reading.frequency - configuration.frequencyMax;
      issues.push(makeIssue(reading, 'frequency-deviation', 1 + deviation / 0.1, `Frequency measured ${reading.frequency}Hz, outside the configured ${configuration.frequencyMin}–${configuration.frequencyMax}Hz range.`));
    }

    if (reading.loadPercent >= configuration.overloadPercent) {
      const excess = reading.loadPercent - configuration.overloadPercent;
      issues.push(makeIssue(reading, 'transformer-overload', 1 + excess / 8, `${reading.transformerName} is loaded to ${reading.loadPercent}%, at or above the configured ${configuration.overloadPercent}% limit.`));
    }

    const expectedPower = reading.normalActivePower;
    if (Number.isFinite(expectedPower) && expectedPower > 0) {
      const deviation = Math.abs(reading.activePower - expectedPower) / expectedPower;
      if (deviation * 100 >= configuration.powerDeviationPercent) {
        issues.push(makeIssue(reading, 'abnormal-power', 1 + deviation, `Active power is ${Number((deviation * 100).toFixed(1))}% from the simulated feeder baseline.`));
      }
    }

    const previous = previousByFeeder.get(reading.feederId);
    if (previous?.loadPercent > 0 && reading.loadPercent - previous.loadPercent >= configuration.loadSpikePercent) {
      const delta = reading.loadPercent - previous.loadPercent;
      issues.push(makeIssue(reading, 'sudden-load-spike', 1 + delta / configuration.loadSpikePercent, `Feeder load rose ${delta.toFixed(0)} percentage points in one simulation update.`));
    }

    const ageSeconds = (Date.now() - new Date(reading.timestamp).getTime()) / 1000;
    if (Number.isFinite(ageSeconds) && ageSeconds > configuration.telemetryGapSeconds) {
      issues.push(makeIssue(reading, 'telemetry-gap', 1 + ageSeconds / configuration.telemetryGapSeconds, `No telemetry update has been received for ${Math.floor(ageSeconds)} seconds.`));
    }
  }

  return issues;
}
