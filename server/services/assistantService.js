import { createScenario } from './scenarioService.js';

export function answerGridQuestion(query, context) {
  const prompt = String(query ?? '').trim();
  if (!prompt || prompt.length > 500) {
    const error = new Error('Question must contain 1 to 500 characters.');
    error.status = 400;
    throw error;
  }

  const text = prompt.toLowerCase();
  const { snapshot, faults = [], incidents = [], configuration } = context;
  const transformers = [...snapshot.transformers].sort((a, b) => b.loadPercent - a.loadPercent);

  if (text.includes('highest') && (text.includes('load') || text.includes('transformer'))) {
    const top = transformers[0];
    return {
      answer: `${top.name} (${top.id}) currently has the highest transformer load at ${top.loadPercent}% of its ${top.ratingMVA} MVA rating.`,
      evidence: [{ equipment: top.id, loadPercent: top.loadPercent, ratingMVA: top.ratingMVA }],
      simulated: true,
    };
  }

  if (text.includes('voltage')) {
    const abnormal = snapshot.feeders.filter((item) => item.voltage < configuration.voltageMin || item.voltage > configuration.voltageMax);
    return {
      answer: abnormal.length
        ? `${abnormal.length} feeder${abnormal.length === 1 ? '' : 's'} currently exceed the configured voltage band: ${abnormal.map((item) => `${item.id} (${item.voltage}V)`).join(', ')}.`
        : 'No feeder is outside the configured voltage band in the current simulated snapshot.',
      evidence: abnormal.map((item) => ({ equipment: item.id, voltage: item.voltage })),
      simulated: true,
    };
  }

  if (text.includes('reliability')) {
    return {
      answer: `Current simulated system reliability is ${snapshot.dashboard.reliability}%, calculated as the share of telemetry readings marked healthy.`,
      evidence: [{ reliability: snapshot.dashboard.reliability, readings: snapshot.telemetry.length }],
      simulated: true,
    };
  }

  if (text.includes('critical') && (text.includes('incident') || text.includes('alert'))) {
    const critical = incidents.filter((item) => item.severity === 'critical' && item.status !== 'RESOLVED');
    return {
      answer: critical.length
        ? `There are ${critical.length} open critical incident${critical.length === 1 ? '' : 's'}: ${critical.map((item) => `${item.id} (${item.equipment})`).join(', ')}.`
        : 'There are no open critical incidents in the current simulated incident list.',
      evidence: critical.map((item) => ({ id: item.id, equipment: item.equipment, status: item.status })),
      simulated: true,
    };
  }

  if (text.includes('why') || text.includes('explain')) {
    const equipmentId = prompt.match(/\b(?:TX|F|SS)-\d+\b/i)?.[0]?.toUpperCase();
    const fault = faults.find((item) => item.equipment.toUpperCase() === equipmentId);
    if (fault) {
      return {
        answer: `${fault.equipment} was flagged for ${fault.category}: ${fault.description} Recommended investigation: ${fault.recommendation}`,
        evidence: [{ id: fault.id, anomalyScore: fault.anomalyScore, timestamp: fault.timestamp }],
        simulated: true,
      };
    }
  }

  if (text.includes('what if') || text.includes('fails') || text.includes('failure')) {
    const targetId = prompt.match(/\b(?:TX|F|SS)-\d+\b/i)?.[0]?.toUpperCase();
    if (targetId) {
      const { impact } = createScenario(snapshot, { targetId, mode: 'outage' });
      return {
        answer: `A hypothetical outage of ${targetId} would affect ${impact.affectedEquipment.length} equipment assets and approximately ${impact.affectedConsumersAffected} simulated consumers. Estimated affected load is ${impact.affectedLoadMW} MW; available alternate transformer capacity is ${impact.availableAlternativeCapacityMVA} MVA.`,
        evidence: [{ ...impact, equipment: targetId }],
        simulated: true,
      };
    }
  }

  return {
    answer: 'I can answer questions about current transformer loading, voltage abnormalities, system reliability, critical incidents, fault explanations, and hypothetical equipment outages using GridPulse simulated data.',
    evidence: [],
    simulated: true,
  };
}
