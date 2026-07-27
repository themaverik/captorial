/**
 * Pure edits over a recorded spec, applied during the review pass between recording and writing.
 *
 * Only transforms that stay meaningful once the browser has closed live here. Re-picking a locator
 * is not one of them: `verify.ts` confirms every locator against the live DOM at record time, and by
 * review the page is gone, so an edited locator would ship unverified — the exact drift semantic
 * locators exist to surface. Values, shot ids, crop modes, ordering and deletions need no DOM, so
 * they are safe to change from a spec alone.
 *
 * Every function returns a new spec and leaves its input untouched. Two validator rules shape the
 * deletions: `steps` must stay non-empty, and a step needs at least one of page/expect/do/shot — so
 * dropping a step's only content drops the step with it. An out-of-range index is a no-op rather
 * than a throw, so a mistyped menu choice cannot lose a recording.
 */

import type { CanonicalSpec, CropMode, Shot, Step } from '../spec/types.js';

const inRange = (length: number, index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < length;

/** Mirrors the validator's "a step needs at least one of page/expect/do/shot". */
export const isEmptyStep = (step: Step): boolean =>
  step.page === undefined &&
  step.expect === undefined &&
  step.do === undefined &&
  step.shot === undefined;

const replaceStep = (spec: CanonicalSpec, index: number, step: Step): CanonicalSpec => ({
  ...spec,
  steps: spec.steps.map((existing, i) => (i === index ? step : existing)),
});

const replaceShot = (spec: CanonicalSpec, index: number, shot: Shot): CanonicalSpec => {
  if (!inRange(spec.steps.length, index) || !spec.steps[index].shot) return spec;
  return replaceStep(spec, index, { ...spec.steps[index], shot });
};

/** Remove a step. Refuses on the last one, since a spec with no steps does not validate. */
export const dropStep = (spec: CanonicalSpec, index: number): CanonicalSpec => {
  if (!inRange(spec.steps.length, index) || spec.steps.length <= 1) return spec;
  return { ...spec, steps: spec.steps.filter((_, i) => i !== index) };
};

/**
 * Drop a step's screenshot but keep the actions that drive the flow — the common case, where a click
 * is needed to reach the next page but is not worth capturing. A step that held nothing but the shot
 * goes with it.
 */
export const dropShot = (spec: CanonicalSpec, index: number): CanonicalSpec => {
  if (!inRange(spec.steps.length, index) || !spec.steps[index].shot) return spec;
  const step = spec.steps[index];
  const withoutShot: Step = { page: step.page, expect: step.expect, do: step.do };
  if (isEmptyStep(withoutShot)) return dropStep(spec, index);
  return replaceStep(spec, index, withoutShot);
};

/** Move a step to a new position, shifting the rest around it. */
export const moveStep = (spec: CanonicalSpec, from: number, to: number): CanonicalSpec => {
  const { length } = spec.steps;
  if (!inRange(length, from) || !inRange(length, to) || from === to) return spec;
  const steps = [...spec.steps];
  const [moved] = steps.splice(from, 1);
  steps.splice(to, 0, moved);
  return { ...spec, steps };
};

/** Rename a shot. The id becomes a filename, which the runner sanitises when it writes. */
export const setShotId = (spec: CanonicalSpec, index: number, id: string): CanonicalSpec => {
  if (!inRange(spec.steps.length, index)) return spec;
  const shot = spec.steps[index].shot;
  if (!shot || !id.trim()) return spec;
  return replaceShot(spec, index, { ...shot, id: id.trim() });
};

/**
 * Crop modes this shot can actually be switched to. `element` and `anchored` each need a locator the
 * recorder only captured if that was the original mode, so the set is per-shot rather than fixed.
 */
export const availableCrops = (shot: Shot): CropMode[] => {
  const modes: CropMode[] = ['viewport', 'fullpage'];
  if (shot.target) modes.push('element');
  if (shot.anchor) modes.push('anchored');
  return modes;
};

/**
 * Change how a shot is framed. `target` and `anchor` are kept either way, so switching modes is
 * reversible; the serialiser emits only what the chosen mode uses.
 */
export const setShotCrop = (spec: CanonicalSpec, index: number, crop: CropMode): CanonicalSpec => {
  if (!inRange(spec.steps.length, index)) return spec;
  const shot = spec.steps[index].shot;
  if (!shot || !availableCrops(shot).includes(crop)) return spec;
  return replaceShot(spec, index, { ...shot, crop });
};

/** Change an action's value — a literal, or a `$name` reference into `vars`. */
export const setActionValue = (
  spec: CanonicalSpec,
  stepIndex: number,
  actionIndex: number,
  value: string,
): CanonicalSpec => {
  if (!inRange(spec.steps.length, stepIndex)) return spec;
  const step = spec.steps[stepIndex];
  const actions = step.do;
  if (!actions || !inRange(actions.length, actionIndex) || !value.trim()) return spec;
  return replaceStep(spec, stepIndex, {
    ...step,
    do: actions.map((action, i) => (i === actionIndex ? { ...action, value: value.trim() } : action)),
  });
};

/** Every var name a `$ref` in the spec still points at. Only action values can reference vars. */
export const referencedVars = (spec: CanonicalSpec): Set<string> => {
  const names = new Set<string>();
  for (const step of spec.steps) {
    for (const action of step.do ?? []) {
      if (action.value?.startsWith('$')) names.add(action.value.slice(1));
    }
  }
  return names;
};

/**
 * Drop vars nothing references any more. Dropping the sign-in step should stop the CLI telling
 * someone to set the credentials it needed, so this runs once after review rather than per edit.
 */
export const pruneUnusedVars = (spec: CanonicalSpec): CanonicalSpec => {
  const used = referencedVars(spec);
  return {
    ...spec,
    vars: Object.fromEntries(Object.entries(spec.vars).filter(([name]) => used.has(name))),
  };
};
