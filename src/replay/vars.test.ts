/**
 * Tests for spec variable resolution: fixed literals, env-sourced values, generated templates, and
 * $var references. Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderTemplate, resolveValue, resolveVars } from './vars.js';
import type { SpecVar } from '../spec/types.js';

const clock = new Date('2026-07-27T09:05:00');

test('renderTemplate substitutes {date}, {time} and {timestamp}', () => {
  assert.equal(renderTemplate('run-{date}', clock), 'run-2026-07-27');
  assert.equal(renderTemplate('{date}-{time}', clock), '2026-07-27-0905');
  assert.equal(renderTemplate('id-{timestamp}', clock), `id-${clock.getTime()}`);
});

test('resolveVars resolves fixed literals, env sources and generated templates', () => {
  const vars: Record<string, SpecVar> = {
    who: { type: 'fixed', value: 'Demo Project' },
    email: { type: 'fixed', source: 'env:DEMO_EMAIL' },
    runId: { type: 'generated', template: 'run-{date}' },
  };
  const resolved = resolveVars(vars, { env: { DEMO_EMAIL: 'a@b.co' }, now: clock });
  assert.deepEqual(resolved, { who: 'Demo Project', email: 'a@b.co', runId: 'run-2026-07-27' });
});

test('resolveVars fails fast when an env source is missing', () => {
  const vars: Record<string, SpecVar> = { email: { type: 'fixed', source: 'env:MISSING' } };
  assert.throws(() => resolveVars(vars, { env: {}, now: clock }), /MISSING/);
});

test('resolveValue dereferences a $var and passes literals through', () => {
  const resolved = { email: 'a@b.co' };
  assert.equal(resolveValue('$email', resolved), 'a@b.co');
  assert.equal(resolveValue('plain text', resolved), 'plain text');
  assert.equal(resolveValue(undefined, resolved), undefined);
});

test('resolveValue throws on an unknown $var', () => {
  assert.throws(() => resolveValue('$nope', {}), /nope/);
});
