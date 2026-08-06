/**
 * Tests for the canonical spec validator: the bundled example validates, and representative
 * malformed specs are rejected with a useful error each.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseSpec, validateSpec } from './validate.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleSpecPath = path.resolve(dirname, '..', '..', 'specs', 'example-login.yaml');

const specWithLocator = (locator: unknown): unknown => ({
  tutorial: 't',
  vars: {},
  steps: [{ do: [{ action: 'click', locator }] }],
});

test('a within scope is accepted when it can be located itself', () => {
  const result = validateSpec(
    specWithLocator({ text: 'Select species', within: { testid: 'species-0' } }),
  );
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
});

test('a within scope with no candidate of its own is rejected', () => {
  // A scope that resolves to nothing silently widens the search back to the whole page.
  const result = validateSpec(specWithLocator({ text: 'Select', within: { nth: 0 } }));
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.errors.some((e) => /\.within: locator needs/.test(e)),
    result.ok ? '' : result.errors.join('\n'),
  );
});

test('an unknown locator key is rejected rather than dropped on serialisation', () => {
  const result = validateSpec(specWithLocator({ text: 'Select', selector: '.btn' }));
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.errors.some((e) => /unknown key "selector"/.test(e)),
    result.ok ? '' : result.errors.join('\n'),
  );
});

test('the bundled example spec validates', () => {
  const result = parseSpec(fs.readFileSync(exampleSpecPath, 'utf8'));
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  if (!result.ok) return;
  assert.equal(result.spec.tutorial, 'example-login');
  assert.equal(result.spec.steps.length, 2);
  assert.equal(result.spec.vars.email.type, 'fixed');
  assert.equal(result.spec.steps[0].do?.[0].value, '$email');
});

test('a non-object root is rejected', () => {
  const result = validateSpec('not a spec');
  assert.equal(result.ok, false);
});

test('a missing tutorial name is rejected', () => {
  const result = validateSpec({ vars: {}, steps: [{ page: '/x' }] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => /tutorial/i.test(e)), result.errors.join('\n'));
});

test('an unknown action is rejected', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ do: [{ action: 'teleport', locator: { testid: 'x' } }] }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => /action/i.test(e)), result.errors.join('\n'));
});

test('a $var reference to an undeclared variable is rejected', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ do: [{ action: 'fill', locator: { testid: 'x' }, value: '$missing' }] }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => /missing/.test(e)), result.errors.join('\n'));
});

test('a fill action without a value is rejected', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ do: [{ action: 'fill', locator: { testid: 'x' } }] }],
  });
  assert.equal(result.ok, false);
});

test('a locator with no candidates is rejected', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ do: [{ action: 'click', locator: {} }] }],
  });
  assert.equal(result.ok, false);
});

test('an element shot without a target is rejected', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ shot: { id: 's', crop: 'element' } }],
  });
  assert.equal(result.ok, false);
});

test('an anchored shot without an anchor is rejected', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ shot: { id: 's', crop: 'anchored' } }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => /anchor/i.test(e)), result.errors.join('\n'));
});

test('an anchored shot with a resolvable anchor is accepted', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ shot: { id: 's', crop: 'anchored', anchor: { role: 'textbox', name: 'City' } } }],
  });
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
});

test('an unknown crop mode is rejected', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ shot: { id: 's', crop: 'panorama' } }],
  });
  assert.equal(result.ok, false);
});

test('an unknown top-level key is rejected rather than dropped', () => {
  const result = validateSpec({ tutorial: 't', vars: {}, steps: [{ page: '/x' }], roles: ['a'] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.includes('spec: unknown key "roles"'), result.errors.join('\n'));
});

test('an unknown step-level key is rejected rather than passed through', () => {
  const result = validateSpec({
    tutorial: 't',
    vars: {},
    steps: [{ page: '/x', onlyFor: ['a'] }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.includes('steps[0]: unknown key "onlyFor"'), result.errors.join('\n'));
});

test('a misspelled key is named in the error', () => {
  const result = validateSpec({ tutorial: 't', vars: {}, stpes: [{ page: '/x' }] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => /stpes/.test(e)), result.errors.join('\n'));
});
