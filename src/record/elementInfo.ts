/**
 * The raw element facts the browser-side observer reports for each interaction.
 *
 * Deliberately dumb — attributes and text, no derivation. Turning a descriptor into a semantic
 * locator happens in Node (`locatorFrom.ts`), so that logic is pure and unit-tested instead of
 * trapped inside an injected script where it cannot be tested at all.
 */

export interface ElementDescriptor {
  /** Lowercased tag name. */
  tag: string;
  /** The `type` attribute for inputs; absent for everything else. */
  inputType?: string;
  /** An explicit `role` attribute, when the app sets one. */
  explicitRole?: string;
  ariaLabel?: string;
  /** Text of the associated label, via `for`, a wrapping `<label>`, or `aria-labelledby`. */
  labelText?: string;
  placeholder?: string;
  title?: string;
  alt?: string;
  /** The `name` attribute — a naming fallback when the field has no visible label. */
  fieldName?: string;
  testid?: string;
  /** Trimmed visible text, truncated by the observer. */
  text?: string;
  /** Current value of a form control. Never reported for password fields. */
  value?: string;
  /** True for `<a href>`; a bare anchor has no link role. */
  hasHref?: boolean;
  /** True for `input[type=password]`. The observer withholds the value of these. */
  isPassword: boolean;
}

/** Which browser interaction produced a descriptor. */
export type ObservedKind = 'click' | 'change' | 'press' | 'shot-anchored' | 'shot-fullpage';
