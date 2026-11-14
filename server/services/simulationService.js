import {
  defaultConfiguration,
  feeders as feederSeed,
  initialTelemetry,
  substations,
  transformers as transformerSeed,
} from '../data/mockData.js';

export function buildSimulationSnapshot(configuration = defaultConfiguration, telemetry = initialTelemetry) {
  const readings = telemetry.map((reading) => ({ ...reading }));
  const feederById = new Map(readings.map((reading) => [reading.feederId, reading]));
  const transformerById = new Map(readings.map((reading) => [reading.transformerId, reading]));
  const average = (selector) => readings.length
    ? readings.reduce((sum, item) => sum + selector(item), 0) / readings.length
    : 0;
  const healthyCount = readings.filter((item) => item.status === 'normal').length;
  const reliability = readings.length ? (healthyCount / readings.length) * 100 : 100;

  const currentFeeders = feederSeed.map((feeder) => {
    const reading = feederById.get(feeder.id);
    if (!reading) return { ...feeder };
    return {
      ...feeder,
      voltage: reading.voltage,
      current: reading.current,
      frequency: reading.frequency,
      activePower: reading.activePower,
      reactivePower: reading.reactivePower,
      loadPercent: reading.loadPercent,
      status: reading.status,
    };
  });

  const currentTransformers = transformerSeed.map((transformer) => {
    const reading = transformerById.get(transformer.id);
    if (!reading) return { ...transformer };
    return {
      ...transformer,
      currentLoadMVA: Number((transformer.ratingMVA * reading.loadPercent / 100).toFixed(1)),
      loadPercent: reading.loadPercent,
      voltage: reading.voltage,
      status: reading.status === 'critical' ? 'critical' : reading.loadPercent >= configuration.overloadPercent ? 'overload' : 'normal',
    };
  });

  return {
    generatedAt: readings[0]?.timestamp ?? new Date().toISOString(),
    dashboard: {
      totalFeeders: currentFeeders.length,
      totalSubstations: substations.length,
      activeFeeders: currentFeeders.filter((item) => item.status !== 'critical').length,
      activeTransformers: currentTransformers.filter((item) => item.status !== 'offline').length,
      healthyEquipment: healthyCount,
      criticalAlerts: readings.filter((item) => item.status === 'critical').length,
      averageVoltage: Number(average((item) => item.voltage).toFixed(1)),
      averageFrequency: Number(average((item) => item.frequency).toFixed(2)),
      totalPowerConsumption: Number(readings.reduce((sum, item) => sum + item.activePower, 0).toFixed(1)),
      reliability: Number(reliability.toFixed(1)),
    },
    telemetry: readings,
    transformers: currentTransformers,
    feeders: currentFeeders,
    substations: substations.map((item) => ({ ...item })),
  };
}

export function createInitialTelemetry() {
  const timestamp = new Date().toISOString();
  return initialTelemetry.map((reading) => ({
    ...reading,
    timestamp,
    normalActivePower: reading.activePower,
    normalLoadPercent: reading.loadPercent,
    normalVoltage: reading.voltage,
    status: 'normal',
  }));
}
