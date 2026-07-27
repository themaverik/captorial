/**
 * Serialise a canonical spec back to YAML — the inverse of `validate.ts`, and the recorder's output
 * format.
 *
 * A recorded spec is meant to be read and hand-edited afterwards, so keys are emitted in the order
 * the format documents rather than whatever order the object happens to carry, and anything the
 * format does not define is dropped. Block style throughout: more lines than the inline locators in
 * a hand-authored spec, but it diffs cleanly and survives editing.
 *
 * No Playwright dependency here, in keeping with the rest of `src/spec/`.
 */

import yaml from 'js-yaml';
import type {
  CanonicalSpec,
  ExpectBlock,
  Shot,
  SpecLocator,
  SpecVar,
  Step,
  StepAction,
} from './types.js';

const HEADER = [
  '# Canonical spec. One YAML file per tutorial is the only artifact the replay runner reads.',
  '# Locators resolve in order: role+name -> testid -> text. Values are literals or $var references.',
  '# Credentials are read from the environment at replay time; no secret is stored in this file.',
].join('\n');

/** Drop undefined entries so they never reach the YAML emitter. */
const compact = (obj: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));

const orderLocator = (locator: SpecLocator): Record<string, unknown> =>
  compact({
    role: locator.role,
    name: locator.name,
    testid: locator.testid,
    text: locator.text,
    nth: locator.nth,
  });

const orderVar = (variable: SpecVar): Record<string, unknown> =>
  variable.type === 'generated'
    ? { type: variable.type, template: variable.template }
    : compact({ type: variable.type, value: variable.value, source: variable.source });

const orderAction = (action: StepAction): Record<string, unknown> =>
  compact({ action: action.action, locator: orderLocator(action.locator), value: action.value });

const orderShot = (shot: Shot): Record<string, unknown> =>
  compact({
    id: shot.id,
    crop: shot.crop,
    target: shot.target && orderLocator(shot.target),
    anchor: shot.anchor && orderLocator(shot.anchor),
  });

const orderExpect = (expect: ExpectBlock): Record<string, unknown> =>
  compact({ url: expect.url, visible: expect.visible && orderLocator(expect.visible) });

const orderStep = (step: Step): Record<string, unknown> =>
  compact({
    page: step.page,
    expect: step.expect && orderExpect(step.expect),
    do: step.do?.map(orderAction),
    shot: step.shot && orderShot(step.shot),
  });

/** Render a spec as YAML text, ready to write to `specs/<tutorial>.yaml`. */
export const serializeSpec = (spec: CanonicalSpec): string => {
  const document = compact({
    tutorial: spec.tutorial,
    vars: Object.keys(spec.vars).length
      ? Object.fromEntries(Object.entries(spec.vars).map(([name, v]) => [name, orderVar(v)]))
      : undefined,
    steps: spec.steps.map(orderStep),
  });
  return `${HEADER}\n${yaml.dump(document, { lineWidth: 100, noRefs: true })}`;
};
