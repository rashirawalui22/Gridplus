const modes = new Set(['outage', 'load', 'voltage']);

export function createScenario(snapshot, input) {
  const { targetId, mode } = input;
  if (!modes.has(mode)) {
    const error = new Error('Scenario mode must be outage, load, or voltage.');
    error.status = 400;
    throw error;
  }

  const substation = snapshot.substations.find((item) => item.id === targetId);
  const feeder = snapshot.feeders.find((item) => item.id === targetId);
  const transformer = snapshot.transformers.find((item) => item.id === targetId);
  const asset = substation || feeder || transformer;
  if (!asset) {
    const error = new Error('Select a known substation, feeder, or transformer.');
    error.status = 404;
    throw error;
  }

  const affectedFeeders = snapshot.feeders.filter((item) => {
    if (substation) return item.substationId === substation.id;
    if (feeder) return item.id === feeder.id;
    return item.transformerId === transformer.id;
  });
  const feederIds = new Set(affectedFeeders.map((item) => item.id));
  const affectedTransformerIds = substation
    ? snapshot.transformers.filter((item) => item.substationId === substation.id).map((item) => item.id)
    : transformer ? [transformer.id] : affectedFeeders.map((item) => item.transformerId);
  const affectedLoadMW = Number(affectedFeeders.reduce((sum, item) => sum + item.activePower, 0).toFixed(1));
  const totalLoadMW = snapshot.dashboard.totalPowerConsumption || 1;
  const share = affectedLoadMW / totalLoadMW;
  const availableCapacityMVA = snapshot.transformers
    .filter((item) => !affectedTransformerIds.includes(item.id))
    .reduce((sum, item) => sum + Math.max(0, item.ratingMVA - item.currentLoadMVA), 0);

  const loadDeltaPercent = Number(input.loadDeltaPercent ?? 20);
  const voltageDelta = Number(input.voltageDelta ?? -12);
  if (!Number.isFinite(loadDeltaPercent) || loadDeltaPercent < -100 || loadDeltaPercent > 125) {
    const error = new Error('Load change must be between -100 and 125 percentage points.');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(voltageDelta) || voltageDelta < -120 || voltageDelta > 120) {
    const error = new Error('Voltage change must be between -120V and 120V.');
    error.status = 400;
    throw error;
  }

  const scenario = {
    id: `SCN-${Date.now()}`,
    targetId,
    targetName: asset.name,
    mode,
    loadDeltaPercent,
    voltageDelta,
    affectedFeederIds: [...feederIds],
    affectedTransformerIds,
    hypothetical: true,
    createdAt: new Date().toISOString(),
  };
  const estimatedConsumersAffected = mode === 'outage'
    ? Math.round(affectedLoadMW * 18)
    : mode === 'load' ? Math.round(affectedLoadMW * Math.abs(loadDeltaPercent) / 100 * 18) : 0;

  return {
    scenario,
    impact: {
      affectedEquipment: [...scenario.affectedFeederIds, ...scenario.affectedTransformerIds],
      affectedLoadMW,
      estimatedConsumersAffected,
      severity: mode === 'outage' && share >= 0.35 ? 'critical' : mode === 'outage' || share >= 0.25 ? 'warning' : 'informational',
      availableAlternativeCapacityMVA: Number(availableCapacityMVA.toFixed(1)),
      alternativeCapacitySufficient: availableCapacityMVA >= affectedLoadMW,
      hypothetical: true,
    },
  };
}
