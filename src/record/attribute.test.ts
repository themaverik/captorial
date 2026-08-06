/**
 * Tests for click attribution: telling a control that wraps what was clicked from a container that
 * merely holds it. Getting this wrong records an action the user never performed, so both directions
 * are covered.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributeClick } from './attribute.js';
import type { ElementDescriptor } from './elementInfo.js';

const el = (over: Partial<ElementDescriptor> = {}): ElementDescriptor => ({
  tag: 'div',
  isPassword: false,
  ...over,
});

const at = (width: number, height: number) => ({ x: 0, y: 0, width, height });

test('with nothing under the pointer the attributed element stands', () => {
  const outer = { element: el({ tag: 'button' }), rect: at(100, 40) };
  assert.deepEqual(attributeClick(outer), { element: outer.element, rect: outer.rect });
});

test('a real control keeps the click however much bigger than its label it is', () => {
  // A wide toolbar button with a small icon inside: the button is still what was pressed.
  const outer = { element: el({ tag: 'button', text: 'Save' }), rect: at(400, 48) };
  const inner = { element: el({ tag: 'svg' }), rect: at(16, 16) };
  assert.equal(attributeClick(outer, inner).element.tag, 'button');
  assert.equal(attributeClick(outer, inner).scope, undefined);
});

test('a wrapper about the size of what was clicked is treated as the same control', () => {
  // No role on either: size is the only thing left to judge by.
  const outer = { element: el({ text: 'Continue' }), rect: at(120, 44) };
  const inner = { element: el({ tag: 'span', text: 'Continue' }), rect: at(100, 20) };
  const result = attributeClick(outer, inner);
  assert.deepEqual(result.rect, outer.rect);
  assert.equal(result.scope, undefined);
});

test('an element with an interactive role is the control however much it dwarfs its label', () => {
  // A listbox built from divs: the option row is wide, its label is not. Descending here would trade
  // a role+name locator for a text one scoped by the role+name it just threw away.
  const outer = { element: el({ explicitRole: 'option', text: 'Land Preparation' }), rect: at(600, 44) };
  const inner = { element: el({ tag: 'span', text: 'Land Preparation' }), rect: at(120, 18) };
  const result = attributeClick(outer, inner);
  assert.equal(result.element.explicitRole, 'option');
  assert.equal(result.scope, undefined);
});

test('a namable container is still a container, since naming is not interactivity', () => {
  // The distinction the role check must not blur: a testid on a wrapper makes it easy to locate and
  // no more clickable for it.
  const outer = { element: el({ testid: 'report-field-speciesId' }), rect: at(900, 120) };
  const inner = { element: el({ text: 'Species name' }), rect: at(140, 20) };
  assert.equal(attributeClick(outer, inner).scope?.testid, 'report-field-speciesId');
});

test('a container dwarfing what was clicked yields the inner element, scoped to it', () => {
  // The shape that broke replay: a form section carrying the only data-testid, with an unnamable
  // dropdown trigger inside it. Clicking the section does nothing, so it must not be recorded.
  const outer = { element: el({ testid: 'report-list-species-item-0-form' }), rect: at(900, 600) };
  const inner = { element: el({ text: 'Select species' }), rect: at(200, 40) };
  const result = attributeClick(outer, inner);
  assert.equal(result.element.text, 'Select species');
  assert.equal(result.scope?.testid, 'report-list-species-item-0-form');
  assert.deepEqual(result.rect, inner.rect);
});

test('a zero-area target cannot be measured, so the ancestor is kept', () => {
  const outer = { element: el({ testid: 'panel' }), rect: at(900, 600) };
  const inner = { element: el({ tag: 'span' }), rect: at(0, 0) };
  const result = attributeClick(outer, inner);
  assert.equal(result.element.testid, 'panel');
  assert.equal(result.scope, undefined);
});

test('the size margin is generous enough for padding but not for a container', () => {
  const inner = { element: el({ tag: 'span', text: 'Go' }), rect: at(50, 20) };
  // 4x area: still the control.
  const padded = { element: el({}), rect: at(100, 40) };
  assert.equal(attributeClick(padded, inner).scope, undefined);
  // 12x area: a container.
  const section = { element: el({ testid: 'section' }), rect: at(300, 120) };
  assert.equal(attributeClick(section, inner).scope?.testid, 'section');
});
