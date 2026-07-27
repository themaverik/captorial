/**
 * Tests for the pure descriptor -> locator derivation. These pin the implicit-role table and the
 * accessible-name precedence the recorder relies on, so a change to either is a deliberate one.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ElementDescriptor } from './elementInfo.js';
import {
  accessibleName,
  fieldLabel,
  hasCandidate,
  inferRole,
  locatorFor,
  varNameFrom,
} from './locatorFrom.js';

const describe = (partial: Partial<ElementDescriptor> & { tag: string }): ElementDescriptor => ({
  isPassword: false,
  ...partial,
});

test('inferRole maps inputs by type and falls back to textbox for a bare input', () => {
  assert.equal(inferRole(describe({ tag: 'input', inputType: 'email' })), 'textbox');
  assert.equal(inferRole(describe({ tag: 'input' })), 'textbox');
  assert.equal(inferRole(describe({ tag: 'input', inputType: 'checkbox' })), 'checkbox');
  assert.equal(inferRole(describe({ tag: 'input', inputType: 'number' })), 'spinbutton');
  assert.equal(inferRole(describe({ tag: 'input', inputType: 'search' })), 'searchbox');
  assert.equal(inferRole(describe({ tag: 'input', inputType: 'submit' })), 'button');
});

test('inferRole gives password and file inputs no role', () => {
  // Neither has an implicit ARIA role, so their locators must lean on a label or testid.
  assert.equal(inferRole(describe({ tag: 'input', inputType: 'password', isPassword: true })), undefined);
  assert.equal(inferRole(describe({ tag: 'input', inputType: 'file' })), undefined);
});

test('inferRole only treats an anchor with an href as a link', () => {
  assert.equal(inferRole(describe({ tag: 'a', hasHref: true })), 'link');
  assert.equal(inferRole(describe({ tag: 'a' })), undefined);
});

test('inferRole prefers an explicit role attribute over the implicit one', () => {
  assert.equal(inferRole(describe({ tag: 'div', explicitRole: 'Button' })), 'button');
});

test('accessibleName follows ARIA precedence', () => {
  // aria-label beats a native label, which beats a placeholder.
  const all = describe({ tag: 'input', ariaLabel: 'Aria', labelText: 'Label', placeholder: 'Place' });
  assert.equal(accessibleName(all), 'Aria');
  assert.equal(accessibleName(describe({ tag: 'input', labelText: 'Label', placeholder: 'Place' })), 'Label');
  assert.equal(accessibleName(describe({ tag: 'input', placeholder: 'Place' })), 'Place');
});

test('accessibleName uses element content only for content-named roles', () => {
  assert.equal(accessibleName(describe({ tag: 'button', text: 'Sign in' })), 'Sign in');
  // A textbox is not named by its own content, so the stray text is ignored.
  assert.equal(accessibleName(describe({ tag: 'input', text: 'stray' })), undefined);
});

test('accessibleName collapses whitespace and rejects prose', () => {
  assert.equal(accessibleName(describe({ tag: 'button', text: '  Sign\n  in  ' })), 'Sign in');
  assert.equal(accessibleName(describe({ tag: 'button', text: 'x'.repeat(200) })), undefined);
});

test('locatorFor stores every candidate tier it can', () => {
  const locator = locatorFor(
    describe({ tag: 'button', text: 'Sign in', testid: 'signin-btn' }),
  );
  assert.deepEqual(locator, { role: 'button', name: 'Sign in', testid: 'signin-btn', text: 'Sign in' });
});

test('locatorFor omits role+name when either half is missing', () => {
  // A password field has no role, so only the testid tier survives.
  const locator = locatorFor(
    describe({ tag: 'input', inputType: 'password', isPassword: true, testid: 'pw', labelText: 'Password' }),
  );
  assert.deepEqual(locator, { testid: 'pw' });
  assert.equal(hasCandidate(locator), true);
});

test('locatorFor never uses a form control\'s text as a locator', () => {
  // A select's text content is its whole option list, which locates nothing.
  const locator = locatorFor(
    describe({ tag: 'select', labelText: 'Country', text: 'Choose Norway United Kingdom' }),
  );
  assert.deepEqual(locator, { role: 'combobox', name: 'Country' });
});

test('locatorFor drops long text rather than storing prose as a locator', () => {
  const locator = locatorFor(describe({ tag: 'div', text: 'x'.repeat(70) }));
  assert.deepEqual(locator, {});
  assert.equal(hasCandidate(locator), false);
});

test('fieldLabel prefers what the user sees over attributes', () => {
  assert.equal(
    fieldLabel(describe({ tag: 'input', labelText: 'Email address', fieldName: 'usr_eml' })),
    'Email address',
  );
  assert.equal(fieldLabel(describe({ tag: 'input', fieldName: 'usr_eml' })), 'usr_eml');
  assert.equal(fieldLabel(describe({ tag: 'input' })), undefined);
});

test('varNameFrom camelCases a human label', () => {
  assert.equal(varNameFrom('Email address'), 'emailAddress');
  assert.equal(varNameFrom('First name *'), 'firstName');
  assert.equal(varNameFrom('usr_eml'), 'usrEml');
  assert.equal(varNameFrom('  '), 'field');
  assert.equal(varNameFrom('2nd line'), 'field2ndLine');
});
