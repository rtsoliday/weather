export type TemperatureSource = 'nws' | 'mixed' | 'open-meteo';
export type NwsPeriod = { start: number; end: number; temperatureC: number };
export type NwsGuidance = { covered: boolean; periods: NwsPeriod[] };

export type WeatherData = {
  timezone: string;
  timestamps: { current: number; hourly: number[] };
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    is_day: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    weather_code: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    sunrise: string[];
    sunset: string[];
  };
  temperatureSources: {
    current: TemperatureSource;
    hourly: TemperatureSource[];
    daily: TemperatureSource[];
    nwsUnavailable: boolean;
  };
};

// Absolute times avoid interpreting the destination's local time in the browser's
// timezone, including when a forecast crosses a daylight-saving transition.
export type OpenMeteoData = {
  timezone: string;
  current: Omit<WeatherData['current'], 'time'> & { time: number };
  hourly: Omit<WeatherData['hourly'], 'time'> & { time: number[] };
  daily: Omit<WeatherData['daily'], 'time' | 'sunrise' | 'sunset'> & {
    time: number[]; sunrise: number[]; sunset: number[];
  };
};

export function applyTemperatureGuidance(
  data: OpenMeteoData, guidance: NwsGuidance | null, unit: 'F' | 'C',
): WeatherData {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: data.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const localTime = (seconds: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(seconds * 1000).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const periods = (guidance?.covered ? guidance.periods : []).filter(p =>
    Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start
    && typeof p.temperatureC === 'number' && Number.isFinite(p.temperatureC)
    && p.temperatureC >= -90 && p.temperatureC <= 70);
  const temperatureAt = (seconds: number) => {
    const p = periods.find(p => p.start <= seconds * 1000 && seconds * 1000 < p.end);
    return p ? (unit === 'F' ? p.temperatureC * 9 / 5 + 32 : p.temperatureC) : undefined;
  };
  const hourlyTime = data.hourly.time.map(localTime);
  const hourlySources: TemperatureSource[] = [];
  const temperatures = data.hourly.temperature_2m.map((value, i) => {
    const nws = temperatureAt(data.hourly.time[i]);
    hourlySources.push(nws === undefined ? 'open-meteo' : 'nws');
    return nws ?? value;
  });
  const dailySources: TemperatureSource[] = [];
  const highs = [...data.daily.temperature_2m_max];
  const lows = [...data.daily.temperature_2m_min];
  const days = data.daily.time.map(t => localTime(t).slice(0, 10));
  days.forEach((day, index) => {
    const hours = hourlyTime.flatMap((time, i) => time.startsWith(day) ? [i] : []);
    const replaced = hours.filter(i => hourlySources[i] === 'nws').length;
    dailySources.push(!replaced ? 'open-meteo' : replaced === hours.length ? 'nws' : 'mixed');
    // Keep the full calendar day: past hours and any gaps remain Open-Meteo.
    if (replaced) {
      const values = hours.map(i => temperatures[i]).filter(v => typeof v === 'number' && Number.isFinite(v));
      highs[index] = Math.max(...values);
      lows[index] = Math.min(...values);
    }
  });
  const currentNws = temperatureAt(data.current.time);
  return {
    timezone: data.timezone,
    timestamps: { current: data.current.time, hourly: data.hourly.time },
    current: { ...data.current, time: localTime(data.current.time), temperature_2m: currentNws ?? data.current.temperature_2m },
    hourly: { ...data.hourly, time: hourlyTime, temperature_2m: temperatures },
    daily: { ...data.daily, time: days, temperature_2m_max: highs, temperature_2m_min: lows,
      sunrise: data.daily.sunrise.map(localTime), sunset: data.daily.sunset.map(localTime) },
    temperatureSources: { current: currentNws === undefined ? 'open-meteo' : 'nws',
      hourly: hourlySources, daily: dailySources, nwsUnavailable: guidance === null },
  };
}

export async function fetchTemperatureGuidance(latitude: number, longitude: number, signal: AbortSignal): Promise<NwsGuidance | null> {
  try {
    const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
    const response = await fetch(`/api/nws/hourly?${query}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(18_000)]),
    });
    if (!response.ok) throw new Error('NWS unavailable');
    const data = await response.json() as NwsGuidance;
    if (typeof data.covered !== 'boolean' || !Array.isArray(data.periods)
      || (data.covered && !data.periods.length)) throw new Error('Invalid NWS response');
    return data;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

export function temperatureSourceLabel(source: TemperatureSource) {
  return source === 'nws' ? 'NWS' : source === 'mixed' ? 'NWS + Open-Meteo' : 'Open-Meteo';
}
