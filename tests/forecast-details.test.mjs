import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app/forecast-details.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { formatLocalClock, peakRainChance } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
);

test('formats forecast-local sunrise and sunset without the browser timezone', () => {
  assert.equal(formatLocalClock('2026-09-25T06:43'), '6:43 AM');
  assert.equal(formatLocalClock('2026-09-25T19:05'), '7:05 PM');
  assert.equal(formatLocalClock('2026-09-25T00:00'), '12:00 AM');
  assert.equal(formatLocalClock(undefined), '—');
});

test('rain peak uses future hours on the selected local day', () => {
  const times = ['2026-09-25T10:00', '2026-09-25T15:00', '2026-09-25T18:00', '2026-09-26T01:00'];
  const timestamps = [100, 200, 300, 400];
  assert.deepEqual(
    peakRainChance('2026-09-25', times, [95, 30, 70, 100], timestamps, 150),
    { time: '2026-09-25T18:00', probability: 70 },
  );
  assert.deepEqual(
    peakRainChance('2026-09-26', times, [95, 30, 70, 100], timestamps, 150),
    { time: '2026-09-26T01:00', probability: 100 },
  );
});

test('rain peak skips invalid data and missing hours', () => {
  assert.equal(peakRainChance('2026-09-25', ['2026-09-25T11:00'], [NaN], [200], 100), null);
  assert.equal(peakRainChance('2026-09-25', ['2026-09-25T11:00'], [20], [200], 200), null);
  assert.equal(peakRainChance('2026-09-25', [], [], [], 0), null);
});
