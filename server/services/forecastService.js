const supportedIntervals = new Set([1, 3, 6, 12, 24]);

export function forecastDemand(history, intervalHours = 24) {
  if (!supportedIntervals.has(intervalHours)) {
    const error = new Error('Forecast interval must be 1, 3, 6, 12, or 24 hours.');
    error.status = 400;
    throw error;
  }

  const samples = history.map((point) => point.totalPower).filter(Number.isFinite).slice(-20);
  const baseline = samples.length
    ? samples.reduce((sum, value) => sum + value, 0) / samples.length
    : 0;
  const previous = samples.slice(0, -1);
  const recentTrend = previous.length
    ? (samples[samples.length - 1] - previous.reduce((sum, value) => sum + value, 0) / previous.length)
      / Math.max(baseline, 1)
    : 0;
  const trendPerHour = Math.max(-0.02, Math.min(0.02, recentTrend / Math.max(samples.length, 1)));
  const start = new Date();
  const forecast = Array.from({ length: intervalHours }, (_, index) => {
    const timestamp = new Date(start.getTime() + (index + 1) * 60 * 60 * 1000);
    const hourOfDay = timestamp.getHours();
    const dailyProfile = 1 + 0.08 * Math.cos(((hourOfDay - 18) / 24) * Math.PI * 2);
    const trend = 1 + trendPerHour * (index + 1);
    return {
      timestamp: timestamp.toISOString(),
      hour: timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actualMW: null,
      predictedMW: Number(Math.max(0, baseline * dailyProfile * trend).toFixed(1)),
      peak: hourOfDay >= 16 && hourOfDay <= 20,
    };
  });

  return {
    intervalHours,
    method: 'Recent mean with capped local trend and an explicitly synthetic daily profile',
    simulated: true,
    sampleCount: samples.length,
    baselineMW: Number(baseline.toFixed(1)),
    errorMetrics: null,
    forecast,
  };
}
