export function formatLocalClock(localTime?: string): string {
  const match = localTime?.match(/T(\d{2}):(\d{2})/);
  if (!match) return '—';
  const hour = Number(match[1]);
  if (hour > 23) return '—';
  return (hour % 12 || 12) + ':' + match[2] + (hour < 12 ? ' AM' : ' PM');
}

export function peakRainChance(
  day: string,
  localHours: string[],
  probabilities: number[],
  timestamps: number[],
  currentTimestamp: number,
): { time: string; probability: number } | null {
  let peak: { time: string; probability: number } | null = null;
  for (let index = 0; index < localHours.length; index++) {
    const probability = probabilities[index];
    if (!localHours[index]?.startsWith(day + 'T')
      || !Number.isFinite(timestamps[index]) || timestamps[index] <= currentTimestamp
      || !Number.isFinite(probability) || probability < 0 || probability > 100) continue;
    if (!peak || probability > peak.probability) {
      peak = { time: localHours[index], probability };
    }
  }
  return peak;
}
