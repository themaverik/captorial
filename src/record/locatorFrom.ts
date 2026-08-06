/**
 * Pure derivation of a semantic locator from a raw element descriptor.
 *
 * Mirrors the ARIA implicit-role table and name-computation order closely enough for the elements a
 * tutorial actually touches. It will diverge from a full accessible-name implementation on hard
 * cases (long `aria-labelledby` chains, generated content), which is why the recorder verifies every
 * derived locator against the live DOM before writing it into a spec: a locator that does not
 * resolve at record time would never resolve at replay time either.
 */

import type { SpecLocator } from '../spec/types.js';
import { locatorTiers } from '../replay/locator.js';
import type { ElementDescriptor } from './elementInfo.js';

/** Longest name/text kept in a locator. Past this a string is prose, not an identifier. */
const MAX_NAME_LEN = 80;
/** Longest string accepted for the weak `text` tier. */
const MAX_TEXT_LEN = 60;

const ROLE_BY_TAG: Readonly<Record<string, string>> = {
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  img: 'img',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};

const ROLE_BY_INPUT_TYPE: Readonly<Record<string, string>> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  number: 'spinbutton',
  range: 'slider',
  search: 'searchbox',
  text: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  email: 'textbox',
};

/** Roles whose accessible name comes from their own content rather than a separate label. */
const NAME_FROM_CONTENT = new Set(['button', 'link', 'heading', 'menuitem', 'tab', 'option']);

/**
 * Tags whose text content does not describe them, so it makes no usable `text` locator: a select's
 * text is its whole option list, and an input's is empty or incidental.
 */
const NOT_NAMED_BY_TEXT = new Set(['input', 'select', 'textarea']);

/**
 * Controls a `<label>` can be associated with, and so the only ones `getByLabel` resolves. This is
 * the tier that reaches a control with no implicit role: without it a labelled password or file
 * input offers no candidate at all and the interaction is dropped.
 */
const LABELLABLE = new Set(['input', 'select', 'textarea']);

/** Collapse whitespace and trim; returns undefined for anything empty or over `max`. */
const clean = (value: string | undefined, max = MAX_NAME_LEN): string | undefined => {
  if (!value) return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed || collapsed.length > max) return undefined;
  return collapsed;
};

/**
 * The element's implicit ARIA role, or undefined when it has none. `input[type=password]` and
 * `input[type=file]` are deliberately absent from the table: neither has an implicit role, so a
 * locator for them must lean on a testid or a label instead.
 */
export const inferRole = (d: ElementDescriptor): string | undefined => {
  if (d.explicitRole) return d.explicitRole.toLowerCase();
  if (d.tag === 'a') return d.hasHref ? 'link' : undefined;
  // A bare <input> with no type attribute behaves as type="text".
  if (d.tag === 'input') return ROLE_BY_INPUT_TYPE[(d.inputType || 'text').toLowerCase()];
  return ROLE_BY_TAG[d.tag];
};

/**
 * The element's accessible name, following ARIA precedence: aria-label, then a native label, then
 * the element's own content for content-named roles, then placeholder / title / alt, then the value
 * of a submit-style input.
 */
export const accessibleName = (d: ElementDescriptor): string | undefined => {
  const role = inferRole(d);
  const fromContent = role && NAME_FROM_CONTENT.has(role) ? d.text : undefined;
  const fromValue = role === 'button' && d.tag === 'input' ? d.value : undefined;
  const candidates = [d.ariaLabel, d.labelText, fromContent, d.placeholder, d.title, d.alt, fromValue];
  for (const candidate of candidates) {
    const value = clean(candidate);
    if (value) return value;
  }
  return undefined;
};

/**
 * Every locator candidate this element offers, in the order the runner resolves them. Weak
 * candidates are included on purpose: the runner falls through to them when the DOM drifts and logs
 * that it did, which is how drift becomes visible before it becomes breakage.
 */
export const locatorFor = (d: ElementDescriptor): SpecLocator => {
  const locator: SpecLocator = {};
  const role = inferRole(d);
  const name = accessibleName(d);
  if (role && name) {
    locator.role = role;
    locator.name = name;
  }
  const testid = clean(d.testid);
  if (testid) locator.testid = testid;
  // getByLabel matches an associated <label> or an aria-label, so either serves as the candidate.
  const label = LABELLABLE.has(d.tag) ? clean(d.labelText) ?? clean(d.ariaLabel) : undefined;
  if (label) locator.label = label;
  // Only short text from an element that its text actually describes; a paragraph is prose and a
  // select's text is its option list, neither of which locates anything.
  const text = NOT_NAMED_BY_TEXT.has(d.tag) ? undefined : clean(d.text, MAX_TEXT_LEN);
  if (text) locator.text = text;
  return locator;
};

/** True when the runner would have at least one tier to try. */
export const hasCandidate = (locator: SpecLocator): boolean => locatorTiers(locator).length > 0;

/**
 * The human label a field should be named after when it becomes a spec variable. Prefers what the
 * user sees (its label), falling back to attributes only when the field is visually unlabelled.
 */
export const fieldLabel = (d: ElementDescriptor): string | undefined =>
  clean(d.labelText) ||
  clean(d.ariaLabel) ||
  clean(d.placeholder) ||
  clean(d.title) ||
  clean(d.fieldName) ||
  clean(d.testid);

/** Turn a human label into a camelCase variable name: "Email address *" -> "emailAddress". */
export const varNameFrom = (label: string): string => {
  const words = label.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'field';
  const [first, ...rest] = words;
  const name =
    first.toLowerCase() + rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  // A leading digit is not a usable identifier; prefix it.
  return /^[0-9]/.test(name) ? `field${name[0].toUpperCase()}${name.slice(1)}` : name;
};
