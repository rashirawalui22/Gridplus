import { defaultConfiguration, initialTelemetry, transformers, feeders, substations } from '../data/mockData.js';

export function buildSimulationSnapshot(configuration = defaultConfiguration) {
  const now = new Date();
  const telemetry = initialTelemetry.map((reading, index) => {
    const swing = (index % 2 === 0 ? 1 : -1) * (Math.random() * 1.4);
    const adjustedVoltage = Number((reading.voltage + swing).toFixed(1));
    const adjustedFrequency = Number((reading.frequency + swing * 0.03).toFixed(2));
    const adjustedCurrent = Number((reading.current + Math.random() * 12).toFixed(1));
    const adjustedLoad = Math.max(35, Math.min(98, reading.loadPercent + (Math.random() * 9 - 4)));

    return {
      ...reading,
      timestamp: now.toISOString(),
      voltage: Math.min(Math.max(adjustedVoltage, 210), 250),
      current: adjustedCurrent,
      frequency: Math.min(Math.max(adjustedFrequency, 59.3), 60.4),
      activePower: Number((reading.activePower + Math.random() * 5 - 2).toFixed(1)),
      reactivePower: Number((reading.reactivePower + Math.random() * 3 - 1.5).toFixed(1)),
      loadPercent: Number(adjustedLoad.toFixed(0)),
      status: adjustedLoad >= configuration.overloadPercent ? 'warning' : 'normal',
    };
  });

  const dashboard = {
    totalFeeders: feeders.length,
    activeTransformers: transformers.filter((item) => item.status !== 'offline').length,
    healthyEquipment: transformers.filter((item) => item.status === 'normal').length,
    criticalAlerts: 2,
    averageVoltage: Number((telemetry.reduce((sum, item) => sum + item.voltage, 0) / telemetry.length).toFixed(1)),
    averageFrequency: Number((telemetry.reduce((sum, item) => sum + item.frequency, 0) / telemetry.length).toFixed(2)),
    totalPowerConsumption: Number(telemetry.reduce((sum, item) => sum + item.activePower, 0).toFixed(1)),
    reliability: Number((substations.reduce((sum, s) => sum + s.reliability, 0) / substations.length).toFixed(1)),
  };

  return {
    dashboard,
    telemetry,
    transformers: transformers.map((item) => {
      const match = telemetry.find((reading) => reading.transformerId === item.id);
      return {
        ...item,
        currentLoadMVA: match ? Number((match.activePower / 3).toFixed(1)) : item.currentLoadMVA,
        loadPercent: match ? match.loadPercent : item.loadPercent,
        voltage: match ? match.voltage : item.voltage,
        status: match && match.loadPercent >= configuration.overloadPercent ? 'overload' : 'normal',
      };
    }),
    feeders: feeders.map((item) => {
      const match = telemetry.find((reading) => reading.feederId === item.id);
      return {
        ...item,
        voltage: match ? match.voltage : item.voltage,
        current: match ? match.current : item.current,
        frequency: match ? match.frequency : item.frequency,
        activePower: match ? match.activePower : item.activePower,
        reactivePower: match ? match.reactivePower : item.reactivePower,
        loadPercent: match ? match.loadPercent : item.loadPercent,
        status: match && match.loadPercent >= configuration.overloadPercent ? 'warning' : 'normal',
      };
    }),
    substations,
  };
}
