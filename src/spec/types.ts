/**
 * Canonical spec types. One YAML file per tutorial is the only artifact the replay runner reads:
 * steps + per-step semantic locators + variables. App-agnostic by design; no product terms appear
 * here. See docs (transform-contract.md) and the handoff for the format.
 */

/**
 * A semantic locator. Resolution order at replay time: role+name -> testid -> text. Recorders store
 * every candidate they can so the runner falls through on failure and logs which one it used, making
 * drift visible before it becomes breakage.
 */
export interface SpecLocator {
  role?: string;
  name?: string;
  testid?: string;
  text?: string;
  /** Disambiguation index when several elements match. Recorded metadata; prefer a testid instead. */
  nth?: number;
}

/** A literal value, or one read from the environment at replay time (`source: env:VAR`). */
export interface FixedVar {
  type: 'fixed';
  value?: string;
  source?: string;
}

/** A value regenerated each run from a template, e.g. `run-{date}`. */
export interface GeneratedVar {
  type: 'generated';
  template: string;
}

export type SpecVar = FixedVar | GeneratedVar;

/** Actions a step can perform. Kept small; extend as the recorder learns new interactions. */
export type ActionType = 'fill' | 'click' | 'select' | 'check' | 'upload' | 'press';

/** Actions whose meaning requires a `value` (a literal or a $var reference). */
export const VALUE_ACTIONS: ReadonlyArray<ActionType> = ['fill', 'select', 'press', 'upload'];

export interface StepAction {
  action: ActionType;
  locator: SpecLocator;
  /** Literal, or a `$name` reference into `vars`. Required for VALUE_ACTIONS. */
  value?: string;
}

/** How a shot is framed: to a single element, the current viewport, or the whole page. */
export type CropMode = 'element' | 'viewport' | 'fullpage';

export interface Shot {
  id: string;
  crop: CropMode;
  /** The element to crop to; required when `crop` is `element`. */
  target?: SpecLocator;
}

/** Assertions the runner satisfies before proceeding past a step. */
export interface ExpectBlock {
  /** Glob the current URL must match (e.g. `/projects/*`). */
  url?: string;
  /** An element that must be visible, described the same way as a locator. */
  visible?: SpecLocator;
}

export interface Step {
  /** Page boundary; the runner asserts the URL matches this path. */
  page?: string;
  expect?: ExpectBlock;
  do?: StepAction[];
  shot?: Shot;
}

export interface CanonicalSpec {
  tutorial: string;
  vars: Record<string, SpecVar>;
  steps: Step[];
}
