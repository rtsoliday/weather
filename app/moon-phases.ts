export type MoonPhase = {
  name: 'New moon' | 'First quarter' | 'Full moon' | 'Last quarter';
  symbol: string;
  time: Date;
};

const PHASES = [
  { name: 'New moon', symbol: '●' },
  { name: 'First quarter', symbol: '◐' },
  { name: 'Full moon', symbol: '○' },
  { name: 'Last quarter', symbol: '◑' },
] as const;

const DAY_MS = 86_400_000;
const UNIX_EPOCH_JD = 2_440_587.5;
const NEW_MOON_EPOCH_JD = 2_451_550.09766;
const SYNODIC_MONTH = 29.530588861;
const sin = (degrees: number) => Math.sin(degrees * Math.PI / 180);
const cos = (degrees: number) => Math.cos(degrees * Math.PI / 180);

// Meeus, Astronomical Algorithms, chapter 49. The result is a phase instant
// in terrestrial time; the small delta-T adjustment below converts it to UTC.
function phaseTime(quarterIndex: number): Date {
  const k = quarterIndex / 4;
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const e = 1 - 0.002516 * t - 0.0000074 * t2;
  const m = 2.5534 + 29.1053567 * k - 0.0000014 * t2 - 0.00000011 * t3;
  const mp = 201.5643 + 385.81693528 * k + 0.0107582 * t2 + 0.00001238 * t3 - 0.000000058 * t4;
  const f = 160.7108 + 390.67050284 * k - 0.0016118 * t2 - 0.00000227 * t3 + 0.000000011 * t4;
  const omega = 124.7746 - 1.56375588 * k + 0.0020672 * t2 + 0.00000215 * t3;
  const quarter = ((quarterIndex % 4) + 4) % 4;
  let correction: number;

  if (quarter === 1 || quarter === 3) {
    correction = -0.62801 * sin(mp) + 0.17172 * e * sin(m)
      - 0.01183 * e * sin(mp + m) + 0.00862 * sin(2 * mp)
      + 0.00804 * sin(2 * f) + 0.00454 * e * sin(mp - m)
      + 0.00204 * e * e * sin(2 * m) - 0.00180 * sin(mp - 2 * f)
      - 0.00070 * sin(mp + 2 * f) - 0.00040 * sin(3 * mp)
      - 0.00034 * e * sin(2 * mp - m) + 0.00032 * e * sin(m + 2 * f)
      + 0.00032 * e * sin(m - 2 * f) - 0.00028 * e * e * sin(mp + 2 * m)
      + 0.00027 * e * sin(2 * mp + m) - 0.00017 * sin(omega)
      - 0.00005 * sin(mp - m - 2 * f) + 0.00004 * sin(2 * mp + 2 * f)
      - 0.00004 * sin(mp + m + 2 * f) + 0.00004 * sin(mp - 2 * m)
      + 0.00003 * sin(mp + m - 2 * f) + 0.00003 * sin(3 * m)
      + 0.00002 * sin(2 * mp - 2 * f) + 0.00002 * sin(mp - m + 2 * f)
      - 0.00002 * sin(3 * mp + m);
    const w = 0.00306 - 0.00038 * e * cos(m) + 0.00026 * cos(mp)
      - 0.00002 * cos(mp - m) + 0.00002 * cos(mp + m)
      + 0.00002 * cos(2 * f);
    correction += quarter === 1 ? w : -w;
  } else {
    const full = quarter === 2;
    correction = (full ? -0.40614 : -0.40720) * sin(mp)
      + (full ? 0.17302 : 0.17241) * e * sin(m)
      + (full ? 0.01614 : 0.01608) * sin(2 * mp)
      + (full ? 0.01043 : 0.01039) * sin(2 * f)
      + (full ? 0.00734 : 0.00739) * e * sin(mp - m)
      - (full ? 0.00515 : 0.00514) * e * sin(mp + m)
      + (full ? 0.00209 : 0.00208) * e * e * sin(2 * m)
      - 0.00111 * sin(mp - 2 * f) - 0.00057 * sin(mp + 2 * f)
      + 0.00056 * e * sin(2 * mp + m) - 0.00042 * sin(3 * mp)
      + 0.00042 * e * sin(m + 2 * f) + 0.00038 * e * sin(m - 2 * f)
      - 0.00024 * e * sin(2 * mp - m) - 0.00017 * sin(omega)
      - 0.00007 * sin(mp + 2 * m) + 0.00004 * sin(2 * mp - 2 * f)
      + 0.00004 * sin(3 * m) + 0.00003 * sin(mp + m - 2 * f)
      + 0.00003 * sin(2 * mp + 2 * f) - 0.00003 * sin(mp + m + 2 * f)
      + 0.00003 * sin(mp - m + 2 * f) - 0.00002 * sin(mp - m - 2 * f)
      - 0.00002 * sin(3 * mp + m) + 0.00002 * sin(4 * mp);
  }

  const planetaryAngles = [
    299.77 + 0.107408 * k - 0.009173 * t2,
    251.88 + 0.016321 * k,
    251.83 + 26.651886 * k,
    349.42 + 36.412478 * k,
    84.66 + 18.206239 * k,
    141.74 + 53.303771 * k,
    207.14 + 2.453732 * k,
    154.84 + 7.306860 * k,
    34.52 + 27.261239 * k,
    207.19 + 0.121824 * k,
    291.34 + 1.844379 * k,
    161.72 + 24.198154 * k,
    239.56 + 25.513099 * k,
    331.55 + 3.592518 * k,
  ];
  const planetaryWeights = [
    0.000325, 0.000165, 0.000164, 0.000126, 0.000110, 0.000062, 0.000060,
    0.000056, 0.000047, 0.000042, 0.000040, 0.000037, 0.000035, 0.000023,
  ];
  correction += planetaryAngles.reduce((sum, angle, index) => sum + planetaryWeights[index] * sin(angle), 0);

  const jd = NEW_MOON_EPOCH_JD + SYNODIC_MONTH * k + 0.00015437 * t2
    - 0.000000150 * t3 + 0.00000000073 * t4 + correction;
  const year = 2000 + k / 12.3685;
  const y = year - 2000;
  // Delta T approximation for 2005–2050; only current forecast dates use it.
  const deltaTSeconds = 62.92 + 0.32217 * y + 0.005589 * y * y;
  return new Date((jd - UNIX_EPOCH_JD) * DAY_MS - deltaTSeconds * 1000);
}

/** Return exact major-phase events on the forecast's local calendar dates. */
export function moonPhasesForDays(days: string[], timezone: string): Map<string, MoonPhase> {
  const result = new Map<string, MoonPhase>();
  if (!days.length) return result;
  const first = Date.parse(`${days[0]}T00:00:00Z`);
  const last = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return result;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const forecastDays = new Set(days);
  const firstJd = first / DAY_MS + UNIX_EPOCH_JD;
  const lastJd = last / DAY_MS + UNIX_EPOCH_JD;
  const start = Math.floor((firstJd - NEW_MOON_EPOCH_JD) / SYNODIC_MONTH * 4) - 4;
  const end = Math.ceil((lastJd - NEW_MOON_EPOCH_JD) / SYNODIC_MONTH * 4) + 4;

  for (let index = start; index <= end; index++) {
    const time = phaseTime(index);
    const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (forecastDays.has(date)) result.set(date, { ...PHASES[((index % 4) + 4) % 4], time });
  }
  return result;
}
