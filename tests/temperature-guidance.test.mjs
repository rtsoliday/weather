import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { applyTemperatureGuidance, fetchTemperatureGuidance } = await loadModule('../app/temperature-guidance.ts');
const { GET } = await loadModule('../app/api/nws/hourly/route.ts');
const start = Date.parse('2026-09-09T00:00:00-05:00') / 1000;
const hour = 3600;
function fixture() {
  return {
    timezone: 'America/Chicago',
    current: { time: start + 12.25 * hour, temperature_2m: 5, apparent_temperature: 4 },
    hourly: { time: Array.from({ length: 72 }, (_, i) => start + i * hour),
      temperature_2m: Array(72).fill(5), precipitation_probability: Array(72).fill(10), weather_code: Array(72).fill(0) },
    daily: { time: [start, start + 24 * hour, start + 48 * hour],
      temperature_2m_max: [6, 6, 6], temperature_2m_min: [4, 4, 4], sunrise: [start + 6 * hour], sunset: [start + 19 * hour] },
  };
}
const guidance = { covered: true, periods: [
  { start: (start + 12 * hour) * 1000, end: (start + 24 * hour) * 1000, temperatureC: 20 },
  { start: (start + 24 * hour) * 1000, end: (start + 48 * hour) * 1000, temperatureC: 25 },
] };

test('NWS replaces covered current/hourly temperatures, preserving gaps and later days', () => {
  const data = fixture();
  const result = applyTemperatureGuidance(data, guidance, 'C');
  assert.equal(result.current.temperature_2m, 20);
  assert.equal(result.current.apparent_temperature, 4);
  assert.equal(result.current.time, '2026-09-09T12:15');
  assert.deepEqual(result.daily.temperature_2m_max, [20, 25, 6]);
  assert.deepEqual(result.daily.temperature_2m_min, [5, 25, 4]);
  assert.deepEqual(result.temperatureSources.daily, ['mixed', 'nws', 'open-meteo']);
  assert.equal(result.hourly.temperature_2m[11], 5);
  assert.equal(result.hourly.temperature_2m[12], 20);
  assert.equal(result.hourly.temperature_2m[48], 5);
  assert.equal(data.current.temperature_2m, 5);
});

test('converts NWS Celsius to Fahrenheit', () => {
  assert.equal(applyTemperatureGuidance(fixture(), guidance, 'F').current.temperature_2m, 68);
});

test('outside coverage and outage retain forecasts with distinct fallback status', () => {
  for (const g of [null, { covered: false, periods: [] }]) {
    const result = applyTemperatureGuidance(fixture(), g, 'C');
    assert.equal(result.current.temperature_2m, 5);
    assert.deepEqual(result.daily.temperature_2m_max, [6, 6, 6]);
    assert.equal(result.temperatureSources.nwsUnavailable, g === null);
  }
});

test('absolute instants distinguish repeated hours at daylight-saving fall-back', () => {
  const data = fixture();
  const first = Date.parse('2026-11-01T01:00:00-05:00');
  const second = Date.parse('2026-11-01T01:00:00-06:00');
  data.hourly.time = [first / 1000, second / 1000];
  data.hourly.temperature_2m = [0, 0];
  const result = applyTemperatureGuidance(data, { covered: true, periods: [
    { start: first, end: second, temperatureC: 10 },
    { start: second, end: second + hour * 1000, temperatureC: 11 },
  ] }, 'C');
  assert.deepEqual(result.hourly.temperature_2m, [10, 11]);
  assert.deepEqual(result.hourly.time, ['2026-11-01T01:00', '2026-11-01T01:00']);
});

test('invalid NWS temperatures do not replace valid fallback values', () => {
  const periods = [null, NaN, Infinity, -100].map(temperatureC => ({
    start: start * 1000, end: (start + 72 * hour) * 1000, temperatureC,
  }));
  assert.equal(applyTemperatureGuidance(fixture(), { covered: true, periods }, 'C').current.temperature_2m, 5);
});

test('NWS proxy discovers the hourly endpoint and converts Fahrenheit like the pool app', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(url);
    assert.match(options.headers['User-Agent'], /ClearWeather/);
    return Response.json(urls.length === 1
      ? { properties: { forecastHourly: 'https://api.weather.gov/gridpoints/LOT/60,68/forecast/hourly' } }
      : { properties: { periods: [{ startTime: '2026-09-09T12:00:00-05:00', endTime: '2026-09-09T13:00:00-05:00', temperature: 68, temperatureUnit: 'F' }] } });
  });
  const response = await GET(new Request('https://example.test/api/nws/hourly?latitude=41.8781&longitude=-87.6298'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).periods[0].temperatureC, 20);
  assert.equal(urls[0], 'https://api.weather.gov/points/41.8781,-87.6298');
  assert.equal(urls.length, 2);
});

test('NWS proxy rejects bad coordinates and treats outside coverage separately from outages', async t => {
  assert.equal((await GET(new Request('https://example.test/api/nws/hourly'))).status, 400);
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  const request = new Request('https://example.test/api/nws/hourly?latitude=51.5&longitude=-0.12');
  assert.deepEqual(await (await GET(request)).json(), { covered: false, periods: [] });
  mock.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  assert.equal((await GET(request)).status, 502);
});

test('NWS proxy rejects unexpected upstream forecast URLs', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ properties: { forecastHourly: 'https://example.test/forecast' } }));
  const response = await GET(new Request('https://example.test/api/nws/hourly?latitude=41&longitude=-87'));
  assert.equal(response.status, 502);
});

test('client falls back on NWS failure and propagates cancellation', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unavailable'); });
  assert.equal(await fetchTemperatureGuidance(41, -87, new AbortController().signal), null);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchTemperatureGuidance(41, -87, controller.signal));
});
