import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app/moon-phases.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { moonPhasesForDays } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

function daysFrom(start, count) {
  const first = Date.parse(start + 'T00:00:00Z');
  return Array.from({ length: count }, (_, index) =>
    new Date(first + index * 86_400_000).toISOString().slice(0, 10));
}

test('major phase instants agree with USNO 2026 primary phases', () => {
  // https://aa.usno.navy.mil/calculated/moon/phases?date=2026-09-01&nump=8
  const phases = moonPhasesForDays(daysFrom('2026-09-25', 25), 'UTC');
  for (const [day, name, expected] of [
    ['2026-09-26', 'Full moon', '2026-09-26T16:49:00Z'],
    ['2026-10-03', 'Last quarter', '2026-10-03T13:25:00Z'],
    ['2026-10-10', 'New moon', '2026-10-10T15:50:00Z'],
    ['2026-10-18', 'First quarter', '2026-10-18T16:12:00Z'],
  ]) {
    assert.equal(phases.get(day)?.name, name);
    assert.ok(Math.abs(phases.get(day).time.getTime() - Date.parse(expected)) < 10 * 60_000);
  }
  assert.equal(phases.size, 4);
});

test('phase markers follow the forecast location calendar day', () => {
  const days = daysFrom('2026-10-24', 4);
  assert.equal(moonPhasesForDays(days, 'America/Chicago').get('2026-10-25')?.name, 'Full moon');
  assert.equal(moonPhasesForDays(days, 'Asia/Tokyo').get('2026-10-26')?.name, 'Full moon');
  assert.equal(moonPhasesForDays(daysFrom('2026-09-09', 4), 'America/Chicago').get('2026-09-10')?.name, 'New moon');
});

test('forecast days without a major phase have no marker', () => {
  assert.equal(moonPhasesForDays(daysFrom('2026-09-20', 4), 'UTC').size, 0);
  assert.equal(moonPhasesForDays([], 'UTC').size, 0);
});
