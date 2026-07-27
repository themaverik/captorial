# Progress

Tracking the move from a use-case-specific capture pipeline to a resilient, app-agnostic
record → review → replay pipeline built on semantic locators and one canonical spec per tutorial.
The stable boundary is documented in `docs/transform-contract.md`.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Extract the transform (scale / frame / store) layer into a standalone module | [x] Done, verified |
| A | Canonical spec types + validator + sample spec | [x] Done, verified |
| B | Replay runner (spec → semantic locators → transform), basic version | [~] Basic runner + CLI landed; not yet run against a live app |
| C | Live recorder (headed capture → draft spec) | [ ] Pending |
| D | Review CLI (draft spec → final spec) | [ ] Pending |
| E | Migration + CI (retire the legacy generators behind `--legacy`, replay in CI) | [ ] Pending |

## What is app-agnostic now

- `src/transform/` — viewport-grow, 16:9 tiling, screenshot storage. Pure geometry
  (`tileGeometry.ts`) plus a Playwright capturer (`pageCapture.ts`) parameterised by
  `contentSelector`, `topAnchorSelectors`, and an `onSettle` hook. No product terms.
- `src/spec/` — `types.ts` (canonical spec) and `validate.ts` (hand-rolled validator, no schema
  dependency). Sample: `specs/example-login.yaml`.
- `src/replay/` — `vars.ts` (fixed / env / generated variable resolution and `$var` references),
  `locator.ts` (role+name → testid → text with fallthrough logging), `urlMatch.ts` (glob URL
  assertions), `runner.ts` (drives the app, captures shots + an element-bounds sidecar), and a CLI
  entry `src/cli/replay.ts` (`npm run replay -- <spec.yaml>`).

## Canonical spec format

One YAML file per tutorial is the only artifact the runner reads: `tutorial`, `vars`, `steps`.
Each step may assert a `page`/`expect`, run `do` actions against semantic locators, and take a
`shot`. Values are literals or `$var` references; vars are `fixed` (literal or `env:VAR`) or
`generated` (template). See `specs/example-login.yaml`.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 26/26 pass (transform geometry, spec validator, variable resolution, locator tiers,
  URL matching). Pure logic only; the Playwright-coupled runner is exercised against a live app.
- Byte-comparable output against the previous pipeline needs a live run and is not yet done.

## Next

Phase B needs a live run against a target app to confirm the runner drives real DOM and to compare
output with the prior pipeline. Phases C (recorder) and D (review CLI) then close the loop so a flow
can be recorded, reviewed, and replayed with one command each.
