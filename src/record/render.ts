/**
 * Human-readable render of a spec, for the confirmation step.
 *
 * The point of confirmation is that someone can read back what will replay without reading YAML, so
 * every line names the element the way a person would and spells out where each value comes from.
 * Pure, so the wording is testable.
 */

import type {
  CanonicalSpec,
  FixedVar,
  Shot,
  SpecLocator,
  SpecVar,
  StepAction,
} from '../spec/types.js';

/** Short description of a locator, showing the candidate the runner tries first. */
export const describeLocator = (locator: SpecLocator): string => {
  const index = locator.nth !== undefined ? ` #${locator.nth + 1}` : '';
  if (locator.role && locator.name) return `"${locator.name}" (${locator.role})${index}`;
  if (locator.testid) return `[${locator.testid}]${index}`;
  if (locator.text) return `"${locator.text}"${index}`;
  return '(no locator)';
};

/** How a value resolves at replay time — a literal default, an env read, or a generated template. */
export const describeValue = (
  value: string | undefined,
  vars: Record<string, SpecVar>,
): string => {
  if (value === undefined) return '';
  if (!value.startsWith('$')) return ` = ${value}`;
  const variable = vars[value.slice(1)];
  if (!variable) return ` = ${value} (undeclared)`;
  if (variable.type === 'generated') return ` = ${value} (template ${variable.template})`;
  if (variable.source) return ` = ${value} (from ${variable.source})`;
  return ` = ${value} ("${variable.value}")`;
};

const describeShot = (shot: Shot): string => {
  if (shot.crop === 'anchored' && shot.anchor) {
    return `${shot.crop}, framed from ${describeLocator(shot.anchor)} down`;
  }
  if (shot.crop === 'element' && shot.target) return `${shot.crop} ${describeLocator(shot.target)}`;
  if (shot.crop === 'fullpage') return `${shot.crop}, auto-tiled into overlapping frames`;
  return shot.crop;
};

const actionLine = (action: StepAction, vars: Record<string, SpecVar>): string =>
  `    ${action.action.padEnd(7)} ${describeLocator(action.locator)}${describeValue(action.value, vars)}`;

/** The replayable flow, one block per step. */
export const renderSpec = (spec: CanonicalSpec): string[] => {
  const lines: string[] = [];
  spec.steps.forEach((step, index) => {
    lines.push(`Step ${index + 1}${step.page ? `  ->  ${step.page}` : ''}`);
    for (const action of step.do ?? []) lines.push(actionLine(action, spec.vars));
    if (step.expect?.url) lines.push(`    expect  url matches ${step.expect.url}`);
    if (step.shot) lines.push(`    shot    ${step.shot.id} — ${describeShot(step.shot)}`);
  });
  return lines;
};

/** Environment variables replay will need, deduplicated and sorted. */
export const requiredEnvVars = (spec: CanonicalSpec): string[] => {
  const names = Object.values(spec.vars)
    .filter((v): v is FixedVar => v.type === 'fixed' && Boolean(v.source))
    .map((v) => (v.source as string).replace(/^env:/, ''));
  return [...new Set(names)].sort();
};
