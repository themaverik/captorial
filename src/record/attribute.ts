/**
 * Which element a click actually meant.
 *
 * The browser reports the deepest element under the pointer, which is rarely the control: clicking
 * the label inside a button reports the span. The observer therefore walks up to the nearest
 * interactive ancestor. That walk cannot, on its own, tell a control *wrapping* what was clicked
 * from a container merely *holding* it — and attributing a click to a container records an action
 * the user never performed, which replays as a click that does nothing.
 *
 * An element that carries an interactive role is the control by definition, whatever its size. Only
 * for the rest is size the discriminator: a wrapper around its own label is about as big as that
 * label; a form section holding a dropdown trigger is many times bigger. Pure and in Node on purpose,
 * so it is unit tested rather than trapped inside the injected script.
 */

import type { ElementDescriptor } from './elementInfo.js';
import { inferRole } from './locatorFrom.js';
import type { ElementRect } from './observer.js';

/** Tags that are a control in their own right, whatever their size relative to what was clicked. */
const CONTROL_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);

/**
 * Roles that make an element a control however it is built. An app is free to compose a listbox out
 * of divs, and `role="option"` on a wide row is the control even though its label is a fraction of
 * its width — size alone would read it as a container and descend into the label, trading a role+name
 * locator for a bare text one scoped by the very role+name it discarded.
 */
const CONTROL_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'combobox',
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'treeitem',
]);

/**
 * Whether an element is a control rather than something merely holding one. Deliberately asks about
 * role, not about whether the element can be named: a wrapper carrying the section's only testid is
 * highly namable and still not what the user pressed.
 */
const isControl = (element: ElementDescriptor): boolean => {
  if (CONTROL_TAGS.has(element.tag)) return true;
  const role = inferRole(element);
  return role !== undefined && CONTROL_ROLES.has(role);
};

/**
 * How much bigger than the clicked element an ancestor may be and still count as the same control.
 * Padding, an icon and a border grow a button well past its label, so the margin is generous; a
 * container holding a control among siblings clears it by an order of magnitude.
 */
const SAME_CONTROL_AREA_RATIO = 4;

const area = (rect: ElementRect): number =>
  Math.max(rect.width, 0) * Math.max(rect.height, 0);

export interface ClickedElement {
  element: ElementDescriptor;
  rect: ElementRect;
}

export interface Attribution extends ClickedElement {
  /** The container the locator should be scoped to, when the click was attributed inward. */
  scope?: ElementDescriptor;
}

/**
 * Choose between the ancestor the observer attributed the click to (`outer`) and the element the
 * pointer was actually over (`inner`). Returning the inner element carries the outer one along as a
 * scope: a trigger with only placeholder text is ambiguous page-wide but unique inside its field.
 */
export const attributeClick = (outer: ClickedElement, inner?: ClickedElement): Attribution => {
  if (!inner) return { element: outer.element, rect: outer.rect };
  // A real control is the control however much padding it carries.
  if (isControl(outer.element)) return { element: outer.element, rect: outer.rect };
  const innerArea = area(inner.rect);
  // A zero-area target measures nothing, so the ancestor is the better guess.
  if (!innerArea || area(outer.rect) <= innerArea * SAME_CONTROL_AREA_RATIO) {
    return { element: outer.element, rect: outer.rect };
  }
  return { element: inner.element, rect: inner.rect, scope: outer.element };
};
