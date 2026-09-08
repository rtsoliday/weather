'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type Place = {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type WeatherData = {
  timezone: string;
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
};

type GeocodingResult = {
  id: number;
  name: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type RadarFrame = { time: number; path: string };

type Unit = 'F' | 'C';

const DEFAULT_PLACE: Place = {
  name: 'Chicago',
  label: 'Chicago, IL',
  latitude: 41.8781,
  longitude: -87.6298,
  timezone: 'America/Chicago',
};

function describeWeather(code: number) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Mixed conditions';
}

function weatherIcon(code: number, isDay = true) {
  if (code === 0) return isDay ? '☀' : '☾';
  if (code === 1 || code === 2) return isDay ? '🌤' : '☁';
  if (code === 3) return '☁';
  if (code === 45 || code === 48) return '≋';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '☂';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return '❄';
  if (code >= 95) return 'ϟ';
  return '◌';
}

function conditionCopy(code: number, rainChance?: number) {
  const rain = rainChance ?? 0;
  if (code === 0) return rain > 25 ? 'Clear for now, with a chance of rain later.' : 'Clear skies make for an easy day outside.';
  if (code <= 2) return rain > 30 ? 'Some clouds today, with a chance of a passing shower.' : 'A quiet mix of sunshine and passing clouds.';
  if (code === 3) return 'Clouds hold on today, but conditions stay easy to navigate.';
  if (code === 45 || code === 48) return 'Visibility may be limited. Give yourself a little extra time.';
  if (code >= 51 && code <= 82) return 'Keep an umbrella nearby and check the radar before heading out.';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'Snow is in the picture. Allow extra time on the road.';
  if (code >= 95) return 'Storms are possible. Keep an eye on the latest radar.';
  return 'Conditions may shift through the day. Check back for updates.';
}

function temp(value?: number) {
  return typeof value === 'number' ? Math.round(value) + '°' : '—';
}

function percent(value?: number) {
  return typeof value === 'number' ? Math.round(value) + '%' : '—';
}

function formatHour(iso?: string) {
  if (!iso || !iso.includes('T')) return '—';
  const raw = Number(iso.split('T')[1].slice(0, 2));
  if (raw === 0) return '12 AM';
  if (raw === 12) return '12 PM';
  return (raw > 12 ? raw - 12 : raw) + (raw > 11 ? ' PM' : ' AM');
}

function formatDate(iso?: string, full = false) {
  if (!iso) return 'Today';
  return new Intl.DateTimeFormat('en-US', full
    ? { weekday: 'long', month: 'long', day: 'numeric' }
    : { weekday: 'short' }
  ).format(new Date(iso + 'T12:00:00'));
}

function greeting(iso?: string) {
  if (!iso || !iso.includes('T')) return 'Hello';
  const hour = Number(iso.split('T')[1].slice(0, 2));
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function windCompass(degrees?: number) {
  if (typeof degrees !== 'number') return '—';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(degrees / 45) % 8];
}

function radarTime(timestamp: number | undefined, timezone?: string) {
  if (!timestamp) return 'Latest frame';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: timezone,
    }).format(new Date(timestamp * 1000));
  } catch {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp * 1000));
  }
}

export default function Home() {
  const [place, setPlace] = useState<Place>(DEFAULT_PLACE);
  const [unit, setUnit] = useState<Unit>('F');
  const [ready, setReady] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [weatherError, setWeatherError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const [radarHost, setRadarHost] = useState('');
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [radarIndex, setRadarIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [radarError, setRadarError] = useState('');
  const [radarMapReady, setRadarMapReady] = useState(false);
  const radarMapContainer = useRef<HTMLDivElement | null>(null);
  const leaflet = useRef<typeof import('leaflet') | null>(null);
  const radarMap = useRef<import('leaflet').Map | null>(null);
  const radarMarker = useRef<import('leaflet').CircleMarker | null>(null);
  const radarLayer = useRef<import('leaflet').TileLayer | null>(null);

  useEffect(() => {
    try {
      const storedPlace = window.localStorage.getItem('clear-weather-place');
      const storedUnit = window.localStorage.getItem('clear-weather-unit');
      if (storedPlace) {
        const parsed = JSON.parse(storedPlace) as Place;
        if (Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)) setPlace(parsed);
      }
      if (storedUnit === 'F' || storedUnit === 'C') setUnit(storedUnit);
    } catch {
      // A private or restricted browser may not allow local preferences.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      temperature_unit: unit === 'F' ? 'fahrenheit' : 'celsius',
      wind_speed_unit: unit === 'F' ? 'mph' : 'kmh',
      timezone: 'auto',
      forecast_days: '10',
    });

    setWeatherStatus('loading');
    setWeatherError('');
    fetch('https://api.open-meteo.com/v1/forecast?' + params.toString(), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Forecast service returned an error.');
        return response.json() as Promise<WeatherData>;
      })
      .then((data) => {
        setWeather(data);
        setWeatherStatus('ready');
      })
      .catch((error: Error) => {
        if (error.name === 'AbortError') return;
        setWeather(null);
        setWeatherStatus('error');
        setWeatherError('We could not update the forecast right now.');
      });

    return () => controller.abort();
  }, [place, unit, ready, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Radar service returned an error.');
        return response.json() as Promise<{ host: string; radar?: { past?: RadarFrame[] } }>;
      })
      .then((data) => {
        const frames = data.radar?.past ?? [];
        setRadarHost(data.host);
        setRadarFrames(frames);
        setRadarIndex(Math.max(0, frames.length - 1));
        setRadarError(frames.length ? '' : 'Recent radar frames are unavailable.');
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setRadarError('Recent radar is temporarily unavailable.');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!radarPlaying || radarFrames.length < 2) return;
    const timer = window.setInterval(() => {
      setRadarIndex((current) => current >= radarFrames.length - 1 ? 0 : current + 1);
    }, 700);
    return () => window.clearInterval(timer);
  }, [radarPlaying, radarFrames.length]);

  const hourly = useMemo(() => {
    if (!weather) return [];
    const start = Math.max(0, weather.hourly.time.findIndex((time) => time >= weather.current.time));
    return weather.hourly.time.slice(start, start + 7).map((time, offset) => {
      const index = start + offset;
      return {
        time,
        temperature: weather.hourly.temperature_2m[index],
        rain: weather.hourly.precipitation_probability[index],
        code: weather.hourly.weather_code[index],
      };
    });
  }, [weather]);

  const radarTileUrl = useMemo(() => {
    const frame = radarFrames[radarIndex];
    if (!frame || !radarHost) return '';
    return radarHost + frame.path + '/256/{z}/{x}/{y}/2/1_1.png';
  }, [radarFrames, radarIndex, radarHost]);

  useEffect(() => {
    let cancelled = false;

    import('leaflet')
      .then((leafletModule) => {
        if (cancelled || !radarMapContainer.current) return;
        const L = leafletModule.default ?? leafletModule;
        leaflet.current = L;

        const map = L.map(radarMapContainer.current, {
          center: [place.latitude, place.longitude],
          zoom: 6,
          minZoom: 2,
          maxZoom: 10,
          zoomControl: true,
          attributionControl: true,
          preferCanvas: false,
        });
        radarMap.current = map;

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          minZoom: 2,
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        }).addTo(map);

        radarMarker.current = L.circleMarker([place.latitude, place.longitude], {
          radius: 7,
          color: '#ffffff',
          weight: 4,
          fillColor: '#172b25',
          fillOpacity: 1,
          interactive: false,
        })
          .addTo(map)
          .bindTooltip(place.name, {
            permanent: true,
            direction: 'bottom',
            offset: [0, 9],
            opacity: 1,
            className: 'radar-location-label',
          })
          .openTooltip();

        window.setTimeout(() => {
          if (cancelled) return;
          map.invalidateSize();
          setRadarMapReady(true);
        }, 0);
      })
      .catch(() => setRadarError('The geographic radar map is temporarily unavailable.'));

    return () => {
      cancelled = true;
      setRadarMapReady(false);
      radarLayer.current?.remove();
      radarLayer.current = null;
      radarMarker.current?.remove();
      radarMarker.current = null;
      radarMap.current?.remove();
      radarMap.current = null;
      leaflet.current = null;
    };
  }, []);

  useEffect(() => {
    const map = radarMap.current;
    const marker = radarMarker.current;
    if (!radarMapReady || !map || !marker) return;

    const center: [number, number] = [place.latitude, place.longitude];
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) map.setView(center, 6, { animate: false });
    else map.flyTo(center, 6, { animate: true, duration: 0.65 });

    marker.setLatLng(center).setTooltipContent(place.name);
  }, [place.latitude, place.longitude, place.name, radarMapReady]);

  useEffect(() => {
    const L = leaflet.current;
    const map = radarMap.current;
    if (!radarMapReady || !L || !map || !radarTileUrl) return;

    if (radarLayer.current) {
      radarLayer.current.setUrl(radarTileUrl, false);
      return;
    }

    const layer = L.tileLayer(radarTileUrl, {
      minZoom: 2,
      maxZoom: 10,
      maxNativeZoom: 7,
      tileSize: 256,
      opacity: 0.72,
      zIndex: 450,
      className: 'radar-tile-layer',
      attribution: 'Radar &copy; <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>',
    }).addTo(map);
    layer.once('load', () => setRadarError(''));
    radarLayer.current = layer;
  }, [radarMapReady, radarTileUrl]);

  const choosePlace = (nextPlace: Place) => {
    setPlace(nextPlace);
    setQuery('');
    setSearchResults([]);
    setSearchMessage('');
    try { window.localStorage.setItem('clear-weather-place', JSON.stringify(nextPlace)); } catch {}
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = query.trim();
    if (name.length < 2) {
      setSearchMessage('Enter at least two letters.');
      return;
    }
    setSearching(true);
    setSearchMessage('');
    setSearchResults([]);
    const params = new URLSearchParams({ name, count: '6', language: 'en', format: 'json' });
    try {
      const response = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + params.toString());
      if (!response.ok) throw new Error('Search unavailable');
      const data = await response.json() as { results?: GeocodingResult[] };
      const results = data.results ?? [];
      setSearchResults(results);
      if (!results.length) setSearchMessage('No matching places found.');
    } catch {
      setSearchMessage('Location search is temporarily unavailable.');
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setSearchMessage('Your browser does not support location access.');
      return;
    }
    setLocating(true);
    setSearchMessage('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        choosePlace({
          name: 'Your location',
          label: 'Your location',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setSearchMessage('Location was not shared. Search for a city instead.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };

  const toggleUnit = () => {
    const nextUnit: Unit = unit === 'F' ? 'C' : 'F';
    setUnit(nextUnit);
    try { window.localStorage.setItem('clear-weather-unit', nextUnit); } catch {}
  };

  const current = weather?.current;
  const todayRain = weather?.daily.precipitation_probability_max[0];
  const windUnit = unit === 'F' ? 'mph' : 'km/h';

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Clear Weather home">
          <span className="brand-mark" aria-hidden="true" />
          <span>Clear Weather</span>
        </a>

        <div className="top-controls">
          <form className="location-search" onSubmit={handleSearch} role="search">
            <label className="sr-only" htmlFor="location-query">Search for a city or postal code</label>
            <span className="search-symbol" aria-hidden="true">⌕</span>
            <input
              id="location-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={place.label}
              autoComplete="off"
            />
            <button className="search-submit" type="submit" disabled={searching}>
              {searching ? 'Searching' : 'Go'}
            </button>
            {(searchResults.length > 0 || searchMessage) && (
              <div className="search-panel" aria-live="polite">
                {searchMessage && <p className="search-message">{searchMessage}</p>}
                {searchResults.length > 0 && (
                  <ul>
                    {searchResults.map((result) => {
                      const detail = result.admin1 || result.country || result.country_code || '';
                      return (
                        <li key={result.id}>
                          <button type="button" onClick={() => choosePlace({
                            name: result.name,
                            label: result.name + (detail ? ', ' + detail : ''),
                            latitude: result.latitude,
                            longitude: result.longitude,
                            timezone: result.timezone,
                          })}>
                            <strong>{result.name}</strong>
                            <span>{detail}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </form>
          <button className="geo-button" type="button" onClick={useMyLocation} disabled={locating}>
            <span aria-hidden="true">◎</span><span className="geo-label">{locating ? 'Locating…' : 'Use my location'}</span>
          </button>
          <button className="units-button" type="button" onClick={toggleUnit} aria-label={'Switch to degrees ' + (unit === 'F' ? 'Celsius' : 'Fahrenheit')}>
            °{unit}
          </button>
        </div>
      </header>

      <div className="weather-page" id="top">
        <div className={'data-status data-status-' + weatherStatus} role="status" aria-live="polite">
          {weatherStatus === 'loading' && <span><i /> Updating {place.name}&apos;s forecast…</span>}
          {weatherStatus === 'error' && (
            <span>{weatherError} <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Try again</button></span>
          )}
          {weatherStatus === 'ready' && <span><i /> Live conditions for {place.label}</span>}
        </div>

        <section className="today-card" aria-labelledby="today-title">
          <div className="today-heading">
            <div>
              <p className="eyebrow">{formatDate(weather?.daily.time[0], true)}</p>
              <h1 id="today-title">{greeting(current?.time)}, {place.name}.</h1>
              <p className="condition-copy">
                {current ? conditionCopy(current.weather_code, todayRain) : 'Getting a clear read on the day ahead.'}
              </p>
            </div>
            <p className="updated">{current ? 'Updated ' + formatHour(current.time) : 'Updating now'}</p>
          </div>

          <div className="current-grid">
            <div className="temperature-block">
              <span className="weather-symbol" aria-hidden="true">{current ? weatherIcon(current.weather_code, Boolean(current.is_day)) : '◌'}</span>
              <div>
                <p className="temperature">{temp(current?.temperature_2m)}</p>
                <p className="feels-like">
                  {current ? describeWeather(current.weather_code) + ' · Feels like ' + temp(current.apparent_temperature) : 'Loading current conditions'}
                </p>
              </div>
            </div>
            <dl className="weather-stats">
              <div><dt>High / Low</dt><dd>{temp(weather?.daily.temperature_2m_max[0])} / {temp(weather?.daily.temperature_2m_min[0])}</dd></div>
              <div><dt>Rain</dt><dd>{percent(todayRain)}</dd></div>
              <div><dt>Wind</dt><dd>{current ? windCompass(current.wind_direction_10m) + ' ' + Math.round(current.wind_speed_10m) + ' ' + windUnit : '—'}</dd></div>
              <div><dt>Humidity</dt><dd>{percent(current?.relative_humidity_2m)}</dd></div>
            </dl>
          </div>

          <div className="hourly-strip" aria-label="Next several hours">
            {hourly.length ? hourly.map((hour, index) => (
              <div className="hour-cell" key={hour.time}>
                <p>{index === 0 ? 'Now' : formatHour(hour.time)}</p>
                <span aria-hidden="true">{weatherIcon(hour.code)}</span>
                <strong>{temp(hour.temperature)}</strong>
                <small>{percent(hour.rain)} rain</small>
              </div>
            )) : Array.from({ length: 7 }).map((_, index) => (
              <div className="hour-cell hour-placeholder" key={index} aria-hidden="true"><p>—</p><span>◌</span><strong>—</strong><small>Updating</small></div>
            ))}
          </div>
        </section>

        <section className="radar-card" aria-labelledby="radar-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Observed · Last 2 hours</p>
              <h2 id="radar-title">Recent radar</h2>
              <p className="section-copy">Actual recent precipitation, not a future projection.</p>
            </div>
            <button
              className="play-button"
              type="button"
              disabled={radarFrames.length < 2}
              aria-pressed={radarPlaying}
              onClick={() => {
                if (!radarPlaying && radarIndex >= radarFrames.length - 1) setRadarIndex(0);
                setRadarPlaying((playing) => !playing);
              }}
            >
              <span aria-hidden="true">{radarPlaying ? 'Ⅱ' : '▶'}</span> {radarPlaying ? 'Pause' : 'Play'}
            </button>
          </div>

          <div
            className="radar-map"
            role="region"
            aria-label={'Interactive recent radar map centered on ' + place.label}
          >
            <div className="radar-canvas" ref={radarMapContainer} />
            {radarError && <p className="radar-error" role="status">{radarError}</p>}
            <div className="radar-time">{radarTime(radarFrames[radarIndex]?.time, weather?.timezone || place.timezone)}</div>
            <div className="radar-legend" aria-label="Radar intensity from light to heavy">
              <span>Light</span><i /><i /><i /><strong>Heavy</strong>
            </div>
          </div>

          <div className="radar-controls">
            <span>{radarFrames.length ? '2 hr ago' : 'Waiting for radar'}</span>
            <input
              type="range"
              min="0"
              max={Math.max(0, radarFrames.length - 1)}
              value={Math.min(radarIndex, Math.max(0, radarFrames.length - 1))}
              disabled={!radarFrames.length}
              aria-label="Radar frame time"
              onChange={(event) => {
                setRadarPlaying(false);
                setRadarIndex(Number(event.target.value));
                setRadarError('');
              }}
            />
            <span>Now</span>
          </div>
        </section>

        <section className="forecast-section" aria-labelledby="forecast-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Plan ahead</p>
              <h2 id="forecast-title">10-day forecast</h2>
              <p className="section-copy">The essentials, one day at a time.</p>
            </div>
          </div>
          <div className="forecast-list">
            {weather ? weather.daily.time.map((day, index) => (
              <article className="forecast-row" key={day}>
                <p className="forecast-day">{index === 0 ? 'Today' : formatDate(day)}</p>
                <span className="forecast-icon" aria-hidden="true">{weatherIcon(weather.daily.weather_code[index])}</span>
                <p className="forecast-label">{describeWeather(weather.daily.weather_code[index])}</p>
                <p className="rain-chance"><span aria-hidden="true">●</span> {percent(weather.daily.precipitation_probability_max[index])}</p>
                <p className="forecast-temps"><strong>{temp(weather.daily.temperature_2m_max[index])}</strong><span>{temp(weather.daily.temperature_2m_min[index])}</span></p>
              </article>
            )) : Array.from({ length: 10 }).map((_, index) => (
              <article className="forecast-row forecast-placeholder" key={index} aria-hidden="true">
                <p className="forecast-day">{index === 0 ? 'Today' : '—'}</p><span className="forecast-icon">◌</span><p className="forecast-label">Updating forecast</p><p className="rain-chance">—</p><p className="forecast-temps"><strong>—</strong><span>—</span></p>
              </article>
            ))}
          </div>
        </section>

        <footer className="site-footer">
          <p><strong>Clear Weather</strong> keeps the forecast simple: no ads, no autoplay, no account.</p>
          <p>Forecast by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · Radar by <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a></p>
        </footer>
      </div>
    </main>
  );
}
