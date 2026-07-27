/**
 * Tests for spec serialisation. The important property is a round trip: anything the recorder writes
 * must parse back through the validator to the same spec, or a recorded flow could fail to replay.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { serializeSpec } from './serialize.js';
import { parseSpec } from './validate.js';
import type { CanonicalSpec } from './types.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleSpecPath = path.resolve(dirname, '..', '..', 'specs', 'example-login.yaml');

const SPEC: CanonicalSpec = {
  tutorial: 'order-flow',
  vars: {
    email: { type: 'fixed', source: 'env:APP_EMAIL' },
    city: { type: 'fixed', value: 'Oslo' },
    runId: { type: 'generated', template: 'run-{date}' },
  },
  steps: [
    {
      page: '/login',
      do: [
        { action: 'fill', locator: { role: 'textbox', name: 'Email' }, value: '$email' },
        { action: 'click', locator: { role: 'button', name: 'Sign in', testid: 'signin' } },
      ],
    },
    {
      expect: { url: '/orders/*', visible: { text: 'Orders' } },
      shot: { id: '01-address', crop: 'anchored', anchor: { testid: 'addr' } },
    },
  ],
};

test('a serialised spec parses back to exactly the same spec', () => {
  const result = parseSpec(serializeSpec(SPEC));
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  if (!result.ok) return;
  assert.deepEqual(result.spec, SPEC);
});

test('the bundled example round-trips through serialisation unchanged', () => {
  const original = parseSpec(fs.readFileSync(exampleSpecPath, 'utf8'));
  assert.equal(original.ok, true);
  if (!original.ok) return;
  const reparsed = parseSpec(serializeSpec(original.spec));
  assert.equal(reparsed.ok, true, reparsed.ok ? '' : reparsed.errors.join('\n'));
  if (!reparsed.ok) return;
  assert.deepEqual(reparsed.spec, original.spec);
});

test('the output carries a header and omits an empty vars block', () => {
  const yamlText = serializeSpec({ tutorial: 't', vars: {}, steps: [{ page: '/x' }] });
  assert.ok(yamlText.startsWith('# Canonical spec.'), yamlText.slice(0, 40));
  assert.equal(/^vars:/m.test(yamlText), false);
});

test('undefined locator candidates are dropped rather than emitted as nulls', () => {
  const yamlText = serializeSpec({
    tutorial: 't',
    vars: {},
    steps: [{ do: [{ action: 'click', locator: { testid: 'only' } }] }],
  });
  assert.equal(/role:/.test(yamlText), false);
  assert.equal(/null/.test(yamlText), false);
});
