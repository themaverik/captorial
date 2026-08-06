/**
 * Spec variable resolution. Turns the spec's `vars` block into a flat name -> string map at replay
 * time, and dereferences `$name` value references. Fixed vars are a literal or an env lookup;
 * generated vars render a template. Fails fast with a clear message on a missing env source.
 */

import type { SpecVar } from '../spec/types.js';

export interface VarContext {
  /** Environment map (typically `process.env`). */
  env: Record<string, string | undefined>;
  /** Clock used for generated templates, injected so runs are reproducible in tests. */
  now: Date;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Render a template's placeholders: `{date}` -> YYYY-MM-DD, `{time}` -> HHMM, `{timestamp}` -> ms. */
export const renderTemplate = (template: string, now: Date): string => {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return template
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{timestamp\}/g, String(now.getTime()));
};

/** Resolve one var to its string value. Throws if a required env source is unset. */
export const resolveVar = (name: string, spec: SpecVar, ctx: VarContext): string => {
  if (spec.type === 'generated') return renderTemplate(spec.template, ctx.now);
  if (spec.source) {
    const key = spec.source.replace(/^env:/, '');
    const value = ctx.env[key];
    // Blank counts as unset. `.env.example` is copied with every key present and empty, so an
    // unfilled one arrives as "" rather than undefined — and silently filling a credential field
    // with nothing surfaces much later as whatever the app does to a failed sign-in.
    if (value === undefined || value.trim() === '') {
      throw new Error(`var "${name}": environment variable ${key} is empty or not set`);
    }
    return value;
  }
  return spec.value ?? '';
};

/** Resolve every var in the spec's `vars` block to a flat name -> value map. */
export const resolveVars = (
  vars: Record<string, SpecVar>,
  ctx: VarContext,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(vars)) out[name] = resolveVar(name, spec, ctx);
  return out;
};

/**
 * Dereference a step value: a leading `$name` maps to a resolved var, anything else is a literal.
 * `undefined` passes through (actions without a value). Throws on an unknown reference.
 */
export const resolveValue = (
  value: string | undefined,
  resolved: Record<string, string>,
): string | undefined => {
  if (value === undefined) return undefined;
  if (!value.startsWith('$')) return value;
  const name = value.slice(1);
  if (!(name in resolved)) throw new Error(`value references unknown var "${name}"`);
  return resolved[name];
};
