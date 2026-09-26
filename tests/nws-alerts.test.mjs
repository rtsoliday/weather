import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app/api/nws/alerts/route.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { GET } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const request = new Request('https://example.test/api/nws/alerts?latitude=41.8781&longitude=-87.6298');

function feature(event, overrides = {}) {
  return {
    id: 'https://api.weather.gov/alerts/' + event.replaceAll(' ', '-'),
    properties: {
      event, status: 'Actual', headline: event + ' for Chicago',
      description: 'NWS alert detail', instruction: 'Follow local guidance',
      expires: new Date(Date.now() + 3_600_000).toISOString(),
      severity: 'Severe', ...overrides,
    },
  };
}

test('returns active warnings and watches for the selected point', async t => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push({ url, options });
    return Response.json({ features: [
      feature('Flood Watch'),
      feature('Tornado Warning'),
      feature('Heat Advisory'),
      feature('Test Warning', { status: 'Test' }),
      feature('Expired Warning', { expires: new Date(Date.now() - 3_600_000).toISOString() }),
    ] });
  });
  const response = await GET(request);
  assert.equal(response.status, 200);
  const { alerts } = await response.json();
  assert.deepEqual(alerts.map(alert => alert.event), ['Tornado Warning', 'Flood Watch']);
  assert.equal(alerts[0].description, 'NWS alert detail');
  assert.equal(seen[0].url, 'https://api.weather.gov/alerts/active?point=41.8781,-87.6298');
  assert.match(seen[0].options.headers['User-Agent'], /ClearWeather/);
  assert.match(response.headers.get('Cache-Control'), /max-age=60/);
});

test('rejects bad coordinates and handles places outside NWS coverage', async t => {
  assert.equal((await GET(new Request('https://example.test/api/nws/alerts?latitude=91'))).status, 400);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 400 }));
  assert.deepEqual(await (await GET(request)).json(), { alerts: [] });
});

test('does not treat an NWS outage or malformed response as no active alerts', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  assert.equal((await GET(request)).status, 502);
  mock.mock.mockImplementation(async () => Response.json({ unexpected: true }));
  assert.equal((await GET(request)).status, 502);
});
