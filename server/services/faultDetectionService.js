import { defaultConfiguration } from '../data/mockData.js';

export function evaluateTelemetry(telemetry, config = defaultConfiguration) {
  const issues = [];
  const seen = new Set();

  for (const reading of telemetry) {
    const keyBase = `${reading.feederId}-${reading.transformerId}`;

    if (reading.voltage < config.voltageMin) {
      const key = `${keyBase}-voltage-low`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          id: `fault-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          category: 'under-voltage',
          severity: reading.voltage < config.voltageMin * 0.96 ? 'critical' : 'warning',
          equipment: reading.feederId,
          timestamp: reading.timestamp,
          description: `Voltage for ${reading.feederName} fell below ${config.voltageMin}V.`,
          recommendation: 'Inspect load balance and verify feeder regulator response.',
          acknowledged: false,
        });
      }
    }

    if (reading.voltage > config.voltageMax) {
      const key = `${keyBase}-voltage-high`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          id: `fault-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          category: 'over-voltage',
          severity: reading.voltage > config.voltageMax * 1.04 ? 'critical' : 'warning',
          equipment: reading.feederId,
          timestamp: reading.timestamp,
          description: `Voltage for ${reading.feederName} exceeded ${config.voltageMax}V.`,
          recommendation: 'Review reactive support and inspect tap changer operation.',
          acknowledged: false,
        });
      }
    }

    if (reading.frequency < config.frequencyMin || reading.frequency > config.frequencyMax) {
      const key = `${keyBase}-frequency`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          id: `fault-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          category: 'frequency-deviation',
          severity: Math.abs(reading.frequency - 60) > 0.35 ? 'critical' : 'warning',
          equipment: reading.feederId,
          timestamp: reading.timestamp,
          description: `Frequency drift for ${reading.feederName} exceeded the configured window.`,
          recommendation: 'Assess generation balance and confirm system interconnection stability.',
          acknowledged: false,
        });
      }
    }

    if (reading.loadPercent >= config.overloadPercent) {
      const key = `${keyBase}-load`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          id: `fault-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          category: 'transformer-overload',
          severity: reading.loadPercent > config.overloadPercent + 8 ? 'critical' : 'warning',
          equipment: reading.transformerId,
          timestamp: reading.timestamp,
          description: `Transformer ${reading.transformerName} is operating at ${reading.loadPercent}% of rated load.`,
          recommendation: 'Shift demand to alternate feeders and inspect cooling systems.',
          acknowledged: false,
        });
      }
    }

    const activePowerDeviation = Math.abs(reading.activePower - 50) / 50;
    if (activePowerDeviation * 100 > config.powerDeviationPercent) {
      const key = `${keyBase}-power`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          id: `fault-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          category: 'abnormal-power',
          severity: activePowerDeviation > 0.5 ? 'critical' : 'warning',
          equipment: reading.feederId,
          timestamp: reading.timestamp,
          description: `Power draw deviates materially from the expected operating envelope on ${reading.feederName}.`,
          recommendation: 'Review feeder loading and verify metering calibration.',
          acknowledged: false,
        });
      }
    }
  }

  return issues;
}
