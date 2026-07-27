/**
 * Tests for the review-pass edits. Two properties matter beyond the obvious per-function behaviour:
 * an edit never mutates the spec it was handed, and whatever the review produces still validates —
 * the recorder must not be able to write a spec the runner then refuses to read.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeSpec } from '../spec/serialize.js';
import type { CanonicalSpec } from '../spec/types.js';
import { parseSpec } from '../spec/validate.js';
import {
  availableCrops,
  dropShot,
  dropStep,
  moveStep,
  pruneUnusedVars,
  referencedVars,
  setActionValue,
  setShotCrop,
  setShotId,
} from './edit.js';

const SPEC: CanonicalSpec = {
  tutorial: 'order-flow',
  vars: {
    email: { type: 'fixed', source: 'env:APP_EMAIL' },
    city: { type: 'fixed', value: 'Oslo' },
  },
  steps: [
    {
      page: '/login',
      do: [
        { action: 'fill', locator: { role: 'textbox', name: 'Email' }, value: '$email' },
        { action: 'click', locator: { role: 'button', name: 'Sign in' } },
      ],
    },
    {
      do: [{ action: 'fill', locator: { testid: 'city' }, value: '$city' }],
      shot: { id: '01-address', crop: 'element', target: { testid: 'city' } },
    },
    // Shot-only: nothing remains if its shot is dropped.
    { shot: { id: '02-summary', crop: 'anchored', anchor: { role: 'heading', name: 'Summary' } } },
  ],
};

test('dropStep removes the step at the index', () => {
  const edited = dropStep(SPEC, 0);
  assert.equal(edited.steps.length, 2);
  assert.equal(edited.steps[0].shot?.id, '01-address');
});

test('dropStep refuses the last step, since an empty spec does not validate', () => {
  const single: CanonicalSpec = { ...SPEC, steps: [SPEC.steps[0]] };
  assert.equal(dropStep(single, 0), single);
});

test('dropStep ignores an out-of-range index', () => {
  assert.equal(dropStep(SPEC, 9), SPEC);
  assert.equal(dropStep(SPEC, -1), SPEC);
});

test('dropShot keeps the actions that drive the flow', () => {
  const edited = dropShot(SPEC, 1);
  assert.equal(edited.steps.length, 3);
  assert.equal(edited.steps[1].shot, undefined);
  assert.equal(edited.steps[1].do?.length, 1);
});

test('dropShot removes a step that held nothing but the shot', () => {
  const edited = dropShot(SPEC, 2);
  assert.equal(edited.steps.length, 2);
});

test('dropShot ignores a step with no shot', () => {
  assert.equal(dropShot(SPEC, 0), SPEC);
});

test('moveStep reorders and shifts the rest around it', () => {
  const edited = moveStep(SPEC, 2, 0);
  assert.deepEqual(
    edited.steps.map((step) => step.shot?.id ?? step.page),
    ['02-summary', '/login', '01-address'],
  );
});

test('moveStep ignores a no-op or an out-of-range index', () => {
  assert.equal(moveStep(SPEC, 1, 1), SPEC);
  assert.equal(moveStep(SPEC, 0, 9), SPEC);
});

test('setShotId renames a shot and trims the input', () => {
  assert.equal(setShotId(SPEC, 1, '  03-city  ').steps[1].shot?.id, '03-city');
  assert.equal(setShotId(SPEC, 1, '   '), SPEC);
});

test('availableCrops offers only modes the shot has a locator for', () => {
  assert.deepEqual(availableCrops(SPEC.steps[1].shot!), ['viewport', 'fullpage', 'element']);
  assert.deepEqual(availableCrops(SPEC.steps[2].shot!), ['viewport', 'fullpage', 'anchored']);
});

test('setShotCrop rejects a mode whose locator was never recorded', () => {
  assert.equal(setShotCrop(SPEC, 1, 'anchored'), SPEC);
  assert.equal(setShotCrop(SPEC, 1, 'viewport').steps[1].shot?.crop, 'viewport');
});

test('setShotCrop keeps the locators, so a mode switch is reversible', () => {
  const viewport = setShotCrop(SPEC, 1, 'viewport');
  assert.deepEqual(viewport.steps[1].shot?.target, { testid: 'city' });
  assert.equal(setShotCrop(viewport, 1, 'element').steps[1].shot?.crop, 'element');
});

test('setActionValue rewrites one action and leaves its siblings alone', () => {
  const edited = setActionValue(SPEC, 0, 0, '$city');
  assert.equal(edited.steps[0].do?.[0].value, '$city');
  assert.equal(edited.steps[0].do?.[1].action, 'click');
});

test('referencedVars finds every $ref still in the spec', () => {
  assert.deepEqual([...referencedVars(SPEC)].sort(), ['city', 'email']);
});

test('pruneUnusedVars drops vars the remaining steps no longer reference', () => {
  const pruned = pruneUnusedVars(dropStep(SPEC, 0));
  assert.deepEqual(Object.keys(pruned.vars), ['city']);
});

test('an edit never mutates the spec it was given', () => {
  const before = JSON.stringify(SPEC);
  dropStep(SPEC, 0);
  dropShot(SPEC, 1);
  moveStep(SPEC, 2, 0);
  setShotId(SPEC, 1, 'renamed');
  setShotCrop(SPEC, 1, 'viewport');
  setActionValue(SPEC, 0, 0, 'literal');
  pruneUnusedVars(SPEC);
  assert.equal(JSON.stringify(SPEC), before);
});

test('a reviewed spec still validates after every kind of edit', () => {
  const edited = pruneUnusedVars(
    setShotId(setShotCrop(dropShot(moveStep(dropStep(SPEC, 0), 1, 0), 1), 1, 'viewport'), 1, 'final'),
  );
  const result = parseSpec(serializeSpec(edited));
  assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
});
