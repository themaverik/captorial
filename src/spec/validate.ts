/**
 * Hand-rolled validator for the canonical spec. No schema-library dependency (the repo has none and
 * the format is small). Collects every problem with a path so an author sees all of them at once,
 * then returns a typed CanonicalSpec on success.
 *
 * `parseSpec` loads YAML text; `validateSpec` takes an already-parsed value.
 */

import yaml from 'js-yaml';
import {
  type ActionType,
  type CanonicalSpec,
  type CropMode,
  type SpecLocator,
  type SpecVar,
  type Step,
  type StepAction,
  VALUE_ACTIONS,
} from './types.js';

export type ValidationResult =
  | { ok: true; spec: CanonicalSpec }
  | { ok: false; errors: string[] };

const ACTIONS: ReadonlyArray<ActionType> = ['fill', 'click', 'select', 'check', 'upload', 'press'];
const CROP_MODES: ReadonlyArray<CropMode> = ['element', 'viewport', 'fullpage', 'anchored'];
const LOCATOR_KEYS = ['role', 'name', 'testid', 'label', 'text'] as const;
/**
 * The keys each level accepts. A spec is rebuilt from known keys on the way out, so anything not
 * listed here would otherwise be dropped in silence — a typo and a half-implemented feature look
 * identical. New fields become legal by being added here.
 */
const TOP_KEYS = ['tutorial', 'vars', 'steps'] as const;
const STEP_KEYS = ['page', 'expect', 'do', 'shot'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const rejectUnknownKeys = (
  raw: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
  at: string,
  errors: string[],
): void => {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) errors.push(`${at}: unknown key "${key}"`);
  }
};

/** Every key a locator accepts: the candidate tiers, plus scoping and disambiguation. */
const LOCATOR_ALL_KEYS = [...LOCATOR_KEYS, 'within', 'nth'] as const;

/**
 * A locator needs at least one candidate the runner can resolve. `within` is validated as a locator
 * in its own right — it has to resolve to the element the tiers are searched inside, so a scope with
 * no candidate of its own would silently widen the search back to the whole page.
 */
const validateLocator = (raw: unknown, at: string, errors: string[]): void => {
  if (!isObject(raw)) {
    errors.push(`${at}: locator must be an object`);
    return;
  }
  rejectUnknownKeys(raw, LOCATOR_ALL_KEYS, at, errors);
  const hasCandidate = LOCATOR_KEYS.some((key) => isNonEmptyString(raw[key]));
  if (!hasCandidate) {
    errors.push(`${at}: locator needs at least one of role/name/testid/label/text`);
  }
  if (raw.nth !== undefined && !Number.isInteger(raw.nth)) {
    errors.push(`${at}: locator.nth must be an integer`);
  }
  if (raw.within !== undefined) validateLocator(raw.within, `${at}.within`, errors);
};

const validateVar = (name: string, raw: unknown, errors: string[]): void => {
  const at = `vars.${name}`;
  if (!isObject(raw)) {
    errors.push(`${at}: must be an object`);
    return;
  }
  if (raw.type === 'fixed') {
    const hasValue = isNonEmptyString(raw.value);
    const hasSource = isNonEmptyString(raw.source);
    if (hasValue === hasSource) {
      errors.push(`${at}: a fixed var needs exactly one of value or source`);
    }
    if (hasSource && !/^env:.+/.test(raw.source as string)) {
      errors.push(`${at}: source must look like "env:VAR_NAME"`);
    }
  } else if (raw.type === 'generated') {
    if (!isNonEmptyString(raw.template)) {
      errors.push(`${at}: a generated var needs a non-empty template`);
    }
  } else {
    errors.push(`${at}: type must be "fixed" or "generated"`);
  }
};

/** Flag a `$name` value that references a var not declared in `vars`. */
const validateValueRef = (value: unknown, varNames: Set<string>, at: string, errors: string[]): void => {
  if (typeof value !== 'string' || !value.startsWith('$')) return;
  const name = value.slice(1);
  if (!varNames.has(name)) errors.push(`${at}: value references undeclared var "${name}"`);
};

const validateAction = (raw: unknown, at: string, varNames: Set<string>, errors: string[]): void => {
  if (!isObject(raw)) {
    errors.push(`${at}: action must be an object`);
    return;
  }
  if (!ACTIONS.includes(raw.action as ActionType)) {
    errors.push(`${at}: unknown action "${String(raw.action)}"`);
  }
  validateLocator(raw.locator, `${at}.locator`, errors);
  if (VALUE_ACTIONS.includes(raw.action as ActionType) && !isNonEmptyString(raw.value)) {
    errors.push(`${at}: action "${String(raw.action)}" requires a value`);
  }
  validateValueRef(raw.value, varNames, at, errors);
};

const validateShot = (raw: unknown, at: string, errors: string[]): void => {
  if (!isObject(raw)) {
    errors.push(`${at}: shot must be an object`);
    return;
  }
  if (!isNonEmptyString(raw.id)) errors.push(`${at}: shot needs an id`);
  if (!CROP_MODES.includes(raw.crop as CropMode)) {
    errors.push(`${at}: crop must be one of ${CROP_MODES.join(', ')}`);
  }
  if (raw.crop === 'element') validateLocator(raw.target, `${at}.target`, errors);
  if (raw.crop === 'anchored') validateLocator(raw.anchor, `${at}.anchor`, errors);
};

const validateStep = (raw: unknown, index: number, varNames: Set<string>, errors: string[]): void => {
  const at = `steps[${index}]`;
  if (!isObject(raw)) {
    errors.push(`${at}: step must be an object`);
    return;
  }
  rejectUnknownKeys(raw, STEP_KEYS, at, errors);
  if (raw.page === undefined && raw.expect === undefined && raw.do === undefined && raw.shot === undefined) {
    errors.push(`${at}: step needs at least one of page/expect/do/shot`);
  }
  if (raw.page !== undefined && !isNonEmptyString(raw.page)) errors.push(`${at}.page: must be a string`);
  if (raw.do !== undefined) {
    if (!Array.isArray(raw.do)) errors.push(`${at}.do: must be an array`);
    else raw.do.forEach((action, i) => validateAction(action, `${at}.do[${i}]`, varNames, errors));
  }
  if (raw.expect !== undefined) {
    if (!isObject(raw.expect)) errors.push(`${at}.expect: must be an object`);
    else if (raw.expect.visible !== undefined) {
      validateLocator(raw.expect.visible, `${at}.expect.visible`, errors);
    }
  }
  if (raw.shot !== undefined) validateShot(raw.shot, `${at}.shot`, errors);
};

export const validateSpec = (raw: unknown): ValidationResult => {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, errors: ['spec must be a YAML object'] };
  }
  rejectUnknownKeys(raw, TOP_KEYS, 'spec', errors);

  if (!isNonEmptyString(raw.tutorial)) errors.push('tutorial: must be a non-empty string');

  const varNames = new Set<string>();
  if (raw.vars !== undefined) {
    if (!isObject(raw.vars)) {
      errors.push('vars: must be an object');
    } else {
      for (const [name, value] of Object.entries(raw.vars)) {
        varNames.add(name);
        validateVar(name, value, errors);
      }
    }
  }

  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    errors.push('steps: must be a non-empty array');
  } else {
    raw.steps.forEach((step, index) => validateStep(step, index, varNames, errors));
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    spec: {
      tutorial: raw.tutorial as string,
      vars: (raw.vars ?? {}) as Record<string, SpecVar>,
      steps: raw.steps as Step[],
    },
  };
};

/** Load YAML text and validate it. YAML parse errors are returned as a single validation error. */
export const parseSpec = (yamlText: string): ValidationResult => {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText);
  } catch (error) {
    return { ok: false, errors: [`YAML parse error: ${String(error)}`] };
  }
  return validateSpec(parsed);
};

/** Narrowing helper for callers that want to throw on invalid specs. */
export const assertValidSpec = (raw: unknown): CanonicalSpec => {
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(`Invalid spec:\n- ${result.errors.join('\n- ')}`);
  return result.spec;
};

// Referenced for the StepAction/SpecLocator types in downstream tooling; re-export for convenience.
export type { StepAction, SpecLocator };
