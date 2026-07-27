/**
 * The review pass between recording and writing: show the recorded flow, let someone correct it, and
 * hand back the spec to write.
 *
 * A recording is a single live pass, so one mistyped field or one redundant shot used to mean
 * re-recording the whole flow or hand-editing YAML afterwards. Everything offered here is a pure
 * transform from `edit.ts`, which is why locators are absent: they are verified against the live DOM
 * at record time and the page is gone by now.
 *
 * Command parsing is pure and tested; the loop around it is thin IO. Step and action numbers are
 * 1-based on screen — they match what the render shows — and become 0-based indices here.
 */

import type { CanonicalSpec, CropMode } from '../spec/types.js';
import { log } from '../utils.js';
import {
  availableCrops,
  dropShot,
  dropStep,
  moveStep,
  pruneUnusedVars,
  setActionValue,
  setShotCrop,
  setShotId,
} from './edit.js';
import { renderSpec } from './render.js';

/** Just the prompt surface the review needs, so the CLI owns readline and this file does not. */
export interface ReviewPrompt {
  ask(question: string, fallback?: string): Promise<string>;
}

export type ReviewCommand =
  | { kind: 'write' }
  | { kind: 'quit' }
  | { kind: 'render' }
  | { kind: 'help' }
  | { kind: 'dropStep'; step: number }
  | { kind: 'dropShot'; step: number }
  | { kind: 'moveStep'; step: number; to: number }
  | { kind: 'setShotId'; step: number }
  | { kind: 'setShotCrop'; step: number }
  | { kind: 'setActionValue'; step: number; action: number }
  | { kind: 'unknown'; input: string };

export const REVIEW_HELP: string[] = [
  '  d <n>        drop step n',
  '  s <n>        drop step n\'s screenshot, keeping its actions',
  '  m <n> <to>   move step n to position <to>',
  '  i <n>        rename step n\'s screenshot',
  '  c <n>        change how step n\'s screenshot is framed',
  '  v <n> <a>    change the value of action <a> in step n',
  '  r            re-print the flow (or just press Enter)',
  '  w            write the spec',
  '  q            discard and quit',
];

/** A 1-based screen number as a 0-based index; -1 when it is missing or not a positive integer. */
const toIndex = (raw: string | undefined): number => {
  if (raw === undefined) return -1;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value - 1 : -1;
};

export const parseCommand = (input: string): ReviewCommand => {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'render' };
  const [verb, ...args] = trimmed.split(/\s+/);
  const unknown: ReviewCommand = { kind: 'unknown', input: trimmed };
  const step = toIndex(args[0]);

  switch (verb.toLowerCase()) {
    case 'w':
      return { kind: 'write' };
    case 'q':
      return { kind: 'quit' };
    case 'r':
      return { kind: 'render' };
    case 'h':
    case '?':
      return { kind: 'help' };
    case 'd':
      return step >= 0 ? { kind: 'dropStep', step } : unknown;
    case 's':
      return step >= 0 ? { kind: 'dropShot', step } : unknown;
    case 'i':
      return step >= 0 ? { kind: 'setShotId', step } : unknown;
    case 'c':
      return step >= 0 ? { kind: 'setShotCrop', step } : unknown;
    case 'm': {
      const to = toIndex(args[1]);
      return step >= 0 && to >= 0 ? { kind: 'moveStep', step, to } : unknown;
    }
    case 'v': {
      const action = toIndex(args[1]);
      return step >= 0 && action >= 0 ? { kind: 'setActionValue', step, action } : unknown;
    }
    default:
      return unknown;
  }
};

const printSpec = (spec: CanonicalSpec): void => {
  log.plain('');
  for (const line of renderSpec(spec)) log.plain(line);
  log.plain('');
};

/** Ask for a new screenshot id. */
const askShotId = async (spec: CanonicalSpec, step: number, prompt: ReviewPrompt): Promise<CanonicalSpec> => {
  const shot = spec.steps[step]?.shot;
  if (!shot) {
    log.warn(`Step ${step + 1} has no screenshot.`);
    return spec;
  }
  return setShotId(spec, step, await prompt.ask(`New id for "${shot.id}"`, shot.id));
};

/** Offer only the crop modes this shot has the locators for; anything else cannot be replayed. */
const askShotCrop = async (spec: CanonicalSpec, step: number, prompt: ReviewPrompt): Promise<CanonicalSpec> => {
  const shot = spec.steps[step]?.shot;
  if (!shot) {
    log.warn(`Step ${step + 1} has no screenshot.`);
    return spec;
  }
  const modes = availableCrops(shot);
  log.plain(`  Framing for "${shot.id}" (now: ${shot.crop})`);
  modes.forEach((mode, i) => log.plain(`    ${i + 1}) ${mode}`));
  const choice = Number(await prompt.ask('  Pick'));
  const picked: CropMode | undefined = modes[choice - 1];
  if (!picked) {
    log.warn('Not one of the offered modes; left unchanged.');
    return spec;
  }
  return setShotCrop(spec, step, picked);
};

/**
 * Ask for a new value. A `$name` that no var declares would fail validation on write, so it is
 * refused here where the person can still see what the declared names are.
 */
const askActionValue = async (
  spec: CanonicalSpec,
  step: number,
  action: number,
  prompt: ReviewPrompt,
): Promise<CanonicalSpec> => {
  const target = spec.steps[step]?.do?.[action];
  if (!target) {
    log.warn(`Step ${step + 1} has no action ${action + 1}.`);
    return spec;
  }
  const value = await prompt.ask(`New value for ${target.action}`, target.value ?? '');
  if (value.startsWith('$') && !(value.slice(1) in spec.vars)) {
    const declared = Object.keys(spec.vars).join(', ') || 'none';
    log.warn(`No var named "${value.slice(1)}". Declared: ${declared}. Left unchanged.`);
    return spec;
  }
  return setActionValue(spec, step, action, value);
};

/**
 * Run the review until the flow is written or discarded. Returns the spec to write, or null when it
 * was discarded. Unused vars are pruned on the way out, so dropping the sign-in step also stops the
 * CLI asking for credentials it no longer needs.
 */
export const reviewSpec = async (
  initial: CanonicalSpec,
  prompt: ReviewPrompt,
): Promise<CanonicalSpec | null> => {
  let spec = initial;
  for (const line of REVIEW_HELP) log.plain(line);

  for (;;) {
    const command = parseCommand(await prompt.ask('\nReview (w=write, q=discard, ?=help)'));
    switch (command.kind) {
      case 'write':
        return pruneUnusedVars(spec);
      case 'quit':
        return null;
      case 'render':
        printSpec(spec);
        break;
      case 'help':
        for (const line of REVIEW_HELP) log.plain(line);
        break;
      case 'dropStep': {
        const next = dropStep(spec, command.step);
        if (next === spec) log.warn('Nothing dropped — a spec needs at least one step.');
        spec = next;
        printSpec(spec);
        break;
      }
      case 'dropShot':
        spec = dropShot(spec, command.step);
        printSpec(spec);
        break;
      case 'moveStep':
        spec = moveStep(spec, command.step, command.to);
        printSpec(spec);
        break;
      case 'setShotId':
        spec = await askShotId(spec, command.step, prompt);
        printSpec(spec);
        break;
      case 'setShotCrop':
        spec = await askShotCrop(spec, command.step, prompt);
        printSpec(spec);
        break;
      case 'setActionValue':
        spec = await askActionValue(spec, command.step, command.action, prompt);
        printSpec(spec);
        break;
      default:
        log.warn(`Unrecognised: "${command.input}". Press ? for the commands.`);
    }
  }
};
