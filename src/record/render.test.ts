/**
 * Tests for the confirmation render. What matters is that a reader can tell where every value comes
 * from — especially that a credential shows as an environment read and never as its value.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CanonicalSpec } from '../spec/types.js';
import { describeLocator, describeValue, renderSpec, requiredEnvVars } from './render.js';

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
        { action: 'click', locator: { role: 'button', name: 'Sign in' } },
      ],
    },
    {
      do: [{ action: 'fill', locator: { testid: 'city' }, value: '$city' }],
      shot: { id: '01-address', crop: 'anchored', anchor: { role: 'textbox', name: 'Address' } },
    },
  ],
};

test('describeLocator names the tier the runner tries first', () => {
  assert.equal(describeLocator({ role: 'button', name: 'Save' }), '"Save" (button)');
  assert.equal(describeLocator({ testid: 'save-btn' }), '[save-btn]');
  assert.equal(describeLocator({ text: 'Save' }), '"Save"');
  assert.equal(describeLocator({}), '(no locator)');
});

test('describeLocator shows a positional index as a 1-based position', () => {
  assert.equal(describeLocator({ role: 'button', name: 'Delete', nth: 2 }), '"Delete" (button) #3');
});

test('describeValue spells out where each value comes from', () => {
  assert.equal(describeValue('$city', SPEC.vars), ' = $city ("Oslo")');
  assert.equal(describeValue('$email', SPEC.vars), ' = $email (from env:APP_EMAIL)');
  assert.equal(describeValue('$runId', SPEC.vars), ' = $runId (template run-{date})');
  assert.equal(describeValue(undefined, SPEC.vars), '');
});

test('renderSpec lists steps, actions and shots in order', () => {
  const lines = renderSpec(SPEC);
  assert.equal(lines[0], 'Step 1  ->  /login');
  assert.ok(lines[1].includes('fill') && lines[1].includes('"Email" (textbox)'), lines[1]);
  assert.equal(lines[3], 'Step 2');
  assert.ok(lines[5].includes('01-address'), lines[5]);
  assert.ok(lines[5].includes('framed from "Address" (textbox) down'), lines[5]);
});

test('actions are numbered 1-based, so the review can name one to edit', () => {
  const lines = renderSpec(SPEC);
  assert.ok(lines[1].trimStart().startsWith('1) fill'), lines[1]);
  assert.ok(lines[2].trimStart().startsWith('2) click'), lines[2]);
  assert.ok(lines[4].trimStart().startsWith('1) fill'), lines[4]);
});

test('the render never leaks a credential value', () => {
  const rendered = renderSpec(SPEC).join('\n');
  assert.ok(rendered.includes('env:APP_EMAIL'));
  assert.equal(/hunter2|@example/.test(rendered), false);
});

test('requiredEnvVars lists the environment reads replay depends on', () => {
  assert.deepEqual(requiredEnvVars(SPEC), ['APP_EMAIL']);
});
