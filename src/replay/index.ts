/** The replay layer: drives a target app from a canonical spec with semantic locators. */

export { replaySpec } from './runner.js';
export type { ReplayConfig, ReplayResult, ShotResult } from './runner.js';
export { resolveLocator, buildLocator, locatorTiers } from './locator.js';
export type { LocatorTier, ResolvedLocator } from './locator.js';
export { resolveVars, resolveValue, renderTemplate } from './vars.js';
export type { VarContext } from './vars.js';
export { urlMatches } from './urlMatch.js';
