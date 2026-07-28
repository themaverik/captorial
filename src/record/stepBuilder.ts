/**
 * Pure assembly of a canonical spec from an ordered stream of recorded events.
 *
 * No browser and no I/O: the session hands over what the user did, and this turns it into steps,
 * variables, and shot ids. Keeping it pure is what makes the interesting rules — how a field becomes
 * a named variable, how credentials stay out of the file, when consecutive frames leave a gap —
 * testable without driving a real app.
 */

import { framesAreContinuous } from '../transform/index.js';
import {
  VALUE_ACTIONS,
  type ActionType,
  type CanonicalSpec,
  type CropMode,
  type Shot,
  type SpecLocator,
  type SpecVar,
  type Step,
  type StepAction,
} from '../spec/types.js';
import { pad2, sanitizeName } from '../utils.js';
import { varNameFrom } from './locatorFrom.js';

/** A credential collected at startup. Its value is never written into the spec. */
export type SecretKind = 'email' | 'password';

/** Environment variable each credential is read from at replay time. */
export const SECRET_ENV: Readonly<Record<SecretKind, string>> = {
  email: 'APP_EMAIL',
  password: 'APP_PASSWORD',
};

export interface NavigateEvent {
  kind: 'navigate';
  /** Path portion of the new URL, relative to the base URL. */
  path: string;
}

export interface ActionEvent {
  kind: 'action';
  action: ActionType;
  locator: SpecLocator;
  /** Human label of the field; names the variable this value becomes. */
  label?: string;
  value?: string;
  /** Marks the value as a credential, so it becomes an env-sourced var rather than a literal. */
  secret?: SecretKind;
}

export interface ShotEvent {
  kind: 'shot';
  crop: CropMode;
  anchor?: SpecLocator;
  target?: SpecLocator;
  /** Short label used to name the shot file. */
  label?: string;
  /** Where an anchored frame actually landed. Drives the continuity check. */
  frame?: { top: number; height: number; anchorY: number };
}

export type RecordedEvent = NavigateEvent | ActionEvent | ShotEvent;

export interface BuildResult {
  spec: CanonicalSpec;
  warnings: string[];
}

/** Turn a label into a filename-safe slug for a shot id. */
const slugify = (value: string): string =>
  sanitizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Assemble the spec. Steps break on navigation and after each shot, since a step carries at most one
 * shot. Every value an action supplies becomes a variable so the flow can be re-run with different
 * data, defaulting to what was actually typed.
 */
export const buildSpec = (tutorial: string, events: RecordedEvent[]): BuildResult => {
  const warnings: string[] = [];
  const steps: Step[] = [];
  const vars: Record<string, SpecVar> = {};
  const takenNames = new Set<string>();
  const varByValue = new Map<string, string>();
  const secretVars = new Map<SecretKind, string>();

  let current: Step | null = null;
  let lastPath: string | null = null;
  let shotCount = 0;
  /** The previous anchored frame on this page, for the continuity check. */
  let lastFrame: { top: number; height: number } | null = null;

  const closeStep = (): void => {
    if (current && (current.page || current.do?.length || current.shot)) steps.push(current);
    current = null;
  };

  const openStep = (): Step => {
    if (!current) current = {};
    return current;
  };

  /**
   * The step being assembled when it is only a page nothing was recorded on — a hop in a redirect
   * chain, which a following navigation should replace rather than close.
   */
  const redirectHop = (): Step | null =>
    current && current.page && !current.do?.length && !current.shot ? current : null;

  const uniqueName = (base: string): string => {
    let name = base;
    let suffix = 2;
    while (takenNames.has(name)) {
      name = `${base}${suffix}`;
      suffix += 1;
    }
    takenNames.add(name);
    return name;
  };

  /** Credentials are declared once and always read from the environment — never written literally. */
  const declareSecret = (secret: SecretKind): string => {
    const existing = secretVars.get(secret);
    if (existing) return existing;
    const name = uniqueName(secret);
    vars[name] = { type: 'fixed', source: `env:${SECRET_ENV[secret]}` };
    secretVars.set(secret, name);
    return name;
  };

  /** Declare (or reuse) a variable holding what the user typed, named after the field's label. */
  const declareValue = (label: string | undefined, value: string): string => {
    const key = `${label ?? ''}::${value}`;
    const existing = varByValue.get(key);
    if (existing) return existing;
    const name = uniqueName(varNameFrom(label ?? 'value'));
    vars[name] = { type: 'fixed', value };
    varByValue.set(key, name);
    return name;
  };

  const buildAction = (event: ActionEvent): StepAction | null => {
    const { action, locator } = event;
    if (!VALUE_ACTIONS.includes(action as ActionType)) return { action, locator };
    if (event.secret) return { action, locator, value: `$${declareSecret(event.secret)}` };
    const raw = event.value ?? '';
    if (!raw.trim()) {
      // A cleared field cannot round-trip: the validator requires a value for these actions.
      warnings.push(
        `${action} on "${event.label ?? 'an unlabelled field'}" recorded an empty value — dropped, ` +
          `since ${action} requires one`,
      );
      return null;
    }
    return { action, locator, value: `$${declareValue(event.label, raw)}` };
  };

  const checkContinuity = (shotId: string, frame: ShotEvent['frame']): void => {
    if (!frame) return;
    if (lastFrame && !framesAreContinuous(lastFrame.top, lastFrame.height, frame.anchorY)) {
      const gap = Math.round(frame.anchorY - (lastFrame.top + lastFrame.height));
      warnings.push(
        `shot ${shotId}: its anchor sits ${gap}px below the previous frame's bottom edge — ` +
          `that strip of the page is in no shot`,
      );
    }
    lastFrame = { top: frame.top, height: frame.height };
  };

  const buildShot = (event: ShotEvent): Shot | null => {
    if (event.crop === 'anchored' && !event.anchor) {
      warnings.push('an anchored shot had no resolvable anchor element — dropped');
      return null;
    }
    if (event.crop === 'element' && !event.target) {
      warnings.push('an element shot had no resolvable target element — dropped');
      return null;
    }
    shotCount += 1;
    const slug = slugify(event.label ?? event.crop) || event.crop;
    const shot: Shot = { id: `${pad2(shotCount)}-${slug}`, crop: event.crop };
    if (event.target) shot.target = event.target;
    if (event.anchor) shot.anchor = event.anchor;
    if (event.crop === 'anchored') checkContinuity(shot.id, event.frame);
    else lastFrame = null; // a differently framed shot breaks the anchored chain
    return shot;
  };

  for (const event of events) {
    if (event.kind === 'navigate') {
      // SPA routers commonly fire repeatedly for one route; only a real change starts a step.
      if (event.path === lastPath) continue;
      // Nothing was recorded on the page we are leaving, so it was a hop in a redirect chain the app
      // performed itself, not somewhere the flow did anything. Only where the chain settles earns a
      // step; replay re-follows the redirects on its own.
      const leaving = redirectHop();
      if (leaving) {
        current = { ...leaving, page: event.path };
      } else {
        closeStep();
        current = { page: event.path };
      }
      lastPath = event.path;
      lastFrame = null;
      continue;
    }
    if (event.kind === 'action') {
      const action = buildAction(event);
      if (!action) continue;
      const step = openStep();
      step.do = [...(step.do ?? []), action];
      continue;
    }
    const shot = buildShot(event);
    if (!shot) continue;
    openStep().shot = shot;
    closeStep();
  }
  closeStep();

  if (!steps.length) warnings.push('nothing was recorded — the spec has no steps');
  return { spec: { tutorial, vars, steps }, warnings };
};
