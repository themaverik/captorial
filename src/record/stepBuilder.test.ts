/**
 * Tests for the pure event-stream -> spec assembly: step boundaries, variable naming and defaults,
 * credentials staying out of the file, and the anchored-frame continuity check.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSpec } from '../spec/validate.js';
import { buildSpec, generalisePath, type RecordedEvent } from './stepBuilder.js';

const EMAIL_BOX = { role: 'textbox', name: 'Email' };
const SIGN_IN = { role: 'button', name: 'Sign in' };

test('a navigation starts a step and a shot closes it', () => {
  const events: RecordedEvent[] = [
    { kind: 'navigate', path: '/login' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
    { kind: 'shot', crop: 'viewport', label: 'Login' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
  ];
  const { spec } = buildSpec('t', events);
  assert.equal(spec.steps.length, 2);
  assert.equal(spec.steps[0].page, '/login');
  assert.equal(spec.steps[0].shot?.id, '01-login');
  // The action after the shot lands in a fresh step, since a step holds at most one shot.
  assert.equal(spec.steps[1].page, undefined);
  assert.equal(spec.steps[1].do?.length, 1);
});

test('a redirect chain collapses to where it settles', () => {
  const events: RecordedEvent[] = [
    { kind: 'navigate', path: '/' },
    { kind: 'navigate', path: '/app' },
    { kind: 'navigate', path: '/app/home' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
  ];
  const { spec } = buildSpec('t', events);
  // Nothing happened on the intermediate hops, so only the settled page earns a step.
  assert.equal(spec.steps.length, 1);
  assert.equal(spec.steps[0].page, '/app/home');
});

test('a navigation the flow caused is asserted, not navigated to', () => {
  const events: RecordedEvent[] = [
    { kind: 'navigate', path: '/login' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
    { kind: 'navigate', path: '/home' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
  ];
  const { spec } = buildSpec('t', events);
  assert.equal(spec.steps.length, 2);
  // The entry point is opened directly; replay reaches /home by repeating the click that led there.
  assert.equal(spec.steps[0].page, '/login');
  assert.equal(spec.steps[1].page, undefined);
  assert.deepEqual(spec.steps[1].expect, { url: '/home' });
});

test('a generated id in a flow-caused path is globbed, so it is not pinned to one run', () => {
  const events: RecordedEvent[] = [
    { kind: 'navigate', path: '/tasks' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
    { kind: 'navigate', path: '/tasks/de165681-24c2-45e1-8531-0065f4757158' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
  ];
  const { spec } = buildSpec('t', events);
  assert.deepEqual(spec.steps[1].expect, { url: '/tasks/*' });
});

test('generalisePath globs generated segments and drops the query', () => {
  assert.equal(generalisePath('/ops/tasks'), '/ops/tasks');
  assert.equal(
    generalisePath('/ops/tasks/de165681-24c2-45e1-8531-0065f4757158'),
    '/ops/tasks/*',
  );
  assert.equal(generalisePath('/orders/1042/lines'), '/orders/*/lines');
  assert.equal(generalisePath('/ops/tasks/create?taskTypeId=5ad6392d-a276-4e98-8951-61f4704'), '/ops/tasks/create');
  // A word segment is part of the route, not an id, however long it is.
  assert.equal(generalisePath('/ops/plantation-activities'), '/ops/plantation-activities');
});

test('a redirect chain the flow started stays an assertion all the way to where it settles', () => {
  const events: RecordedEvent[] = [
    { kind: 'navigate', path: '/login' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
    { kind: 'navigate', path: '/auth/callback' },
    { kind: 'navigate', path: '/home' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
  ];
  const { spec } = buildSpec('t', events);
  assert.equal(spec.steps.length, 2);
  // Never a `page:` for the mid-chain hop — replaying that URL is what breaks a sign-in.
  assert.equal(spec.steps[1].page, undefined);
  assert.deepEqual(spec.steps[1].expect, { url: '/home' });
});

test('consecutive navigations to the same path collapse into one step', () => {
  const events: RecordedEvent[] = [
    { kind: 'navigate', path: '/projects' },
    { kind: 'navigate', path: '/projects' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
  ];
  const { spec } = buildSpec('t', events);
  assert.equal(spec.steps.length, 1);
});

test('a filled field becomes a variable named after its label, defaulting to what was typed', () => {
  const events: RecordedEvent[] = [
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'Company name', value: 'Acme Ltd' },
  ];
  const { spec } = buildSpec('t', events);
  assert.deepEqual(spec.vars.companyName, { type: 'fixed', value: 'Acme Ltd' });
  assert.equal(spec.steps[0].do?.[0].value, '$companyName');
});

test('the same field and value reuse one variable, a different value gets its own', () => {
  const events: RecordedEvent[] = [
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'City', value: 'Oslo' },
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'City', value: 'Oslo' },
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'City', value: 'Bergen' },
  ];
  const { spec } = buildSpec('t', events);
  assert.deepEqual(Object.keys(spec.vars), ['city', 'city2']);
  assert.equal(spec.steps[0].do?.[0].value, '$city');
  assert.equal(spec.steps[0].do?.[1].value, '$city');
  assert.equal(spec.steps[0].do?.[2].value, '$city2');
});

test('credentials become env-sourced vars and never appear as literals', () => {
  const events: RecordedEvent[] = [
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'Email', value: 'me@example.com', secret: 'email' },
    { kind: 'action', action: 'fill', locator: { testid: 'pw' }, label: 'Password', value: 'hunter2', secret: 'password' },
  ];
  const { spec } = buildSpec('t', events);
  assert.deepEqual(spec.vars.email, { type: 'fixed', source: 'env:APP_EMAIL' });
  assert.deepEqual(spec.vars.password, { type: 'fixed', source: 'env:APP_PASSWORD' });
  const serialised = JSON.stringify(spec);
  assert.equal(serialised.includes('me@example.com'), false);
  assert.equal(serialised.includes('hunter2'), false);
});

test('a secret does not collide with a plain field of the same label', () => {
  const events: RecordedEvent[] = [
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'Email', value: 'contact@acme.test' },
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'Email', value: 'me@example.com', secret: 'email' },
  ];
  const { spec } = buildSpec('t', events);
  assert.deepEqual(spec.vars.email, { type: 'fixed', value: 'contact@acme.test' });
  assert.deepEqual(spec.vars.email2, { type: 'fixed', source: 'env:APP_EMAIL' });
});

test('an action needing a value is dropped with a warning when the field was cleared', () => {
  const events: RecordedEvent[] = [
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'Notes', value: '   ' },
  ];
  const { spec, warnings } = buildSpec('t', events);
  assert.equal(spec.steps.length, 0);
  assert.ok(warnings.some((w) => /Notes/.test(w)), warnings.join('\n'));
});

test('a click needs no value and survives without one', () => {
  const { spec } = buildSpec('t', [{ kind: 'action', action: 'click', locator: SIGN_IN }]);
  assert.deepEqual(spec.steps[0].do, [{ action: 'click', locator: SIGN_IN }]);
});

test('anchored frames that overlap raise no continuity warning', () => {
  const events: RecordedEvent[] = [
    { kind: 'shot', crop: 'anchored', anchor: { testid: 'f1' }, label: 'Top', frame: { top: 0, height: 1080, anchorY: 0 } },
    { kind: 'shot', crop: 'anchored', anchor: { testid: 'f4' }, label: 'Mid', frame: { top: 900, height: 1080, anchorY: 900 } },
  ];
  const { spec, warnings } = buildSpec('t', events);
  assert.deepEqual(warnings, []);
  assert.deepEqual(spec.steps.map((s) => s.shot?.id), ['01-top', '02-mid']);
});

test('an anchored frame starting below the previous frame is flagged as a gap', () => {
  const events: RecordedEvent[] = [
    { kind: 'shot', crop: 'anchored', anchor: { testid: 'f1' }, label: 'Top', frame: { top: 0, height: 1080, anchorY: 0 } },
    { kind: 'shot', crop: 'anchored', anchor: { testid: 'f9' }, label: 'Far', frame: { top: 1400, height: 1080, anchorY: 1400 } },
  ];
  const { warnings } = buildSpec('t', events);
  assert.equal(warnings.length, 1);
  assert.ok(/320px below/.test(warnings[0]), warnings[0]);
});

test('navigating resets the continuity chain', () => {
  const events: RecordedEvent[] = [
    { kind: 'shot', crop: 'anchored', anchor: { testid: 'f1' }, frame: { top: 0, height: 1080, anchorY: 0 } },
    { kind: 'navigate', path: '/next' },
    { kind: 'shot', crop: 'anchored', anchor: { testid: 'f2' }, frame: { top: 2000, height: 1080, anchorY: 2000 } },
  ];
  assert.deepEqual(buildSpec('t', events).warnings, []);
});

test('an anchored shot with no resolvable anchor is dropped rather than emitted invalid', () => {
  const { spec, warnings } = buildSpec('t', [{ kind: 'shot', crop: 'anchored' }]);
  assert.equal(spec.steps.length, 0);
  assert.ok(warnings.some((w) => /anchor/i.test(w)), warnings.join('\n'));
});

test('a flow ending on a navigation keeps that landing as a step the validator accepts', () => {
  const events: RecordedEvent[] = [
    { kind: 'navigate', path: '/tasks/new' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
    { kind: 'navigate', path: '/tasks/7f3a1c2b9e0d4a6f8b5c3e1d' },
  ];
  const { spec } = buildSpec('t', events);
  // Saving as the last act leaves a step that only asserts where it landed; it must still survive.
  assert.equal(spec.steps.length, 2);
  assert.deepEqual(spec.steps[1], { expect: { url: '/tasks/*' } });
  const result = validateSpec(JSON.parse(JSON.stringify(spec)));
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
});

test('a recorded flow assembles into a spec its own validator accepts', () => {
  const events: RecordedEvent[] = [
    { kind: 'navigate', path: '/login' },
    { kind: 'action', action: 'fill', locator: EMAIL_BOX, label: 'Email', value: 'me@example.com', secret: 'email' },
    { kind: 'action', action: 'click', locator: SIGN_IN },
    { kind: 'navigate', path: '/orders/new' },
    { kind: 'action', action: 'fill', locator: { testid: 'addr' }, label: 'Address line 1', value: '12 Main St' },
    { kind: 'shot', crop: 'anchored', anchor: { testid: 'addr' }, label: 'Address', frame: { top: 0, height: 1080, anchorY: 0 } },
  ];
  const { spec, warnings } = buildSpec('order-flow', events);
  assert.deepEqual(warnings, []);
  const result = validateSpec(JSON.parse(JSON.stringify(spec)));
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
});
