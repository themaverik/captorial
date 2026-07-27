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
| C | Live recorder (headed capture → spec) | [~] Recorder + CLI landed, verified against a fixture page; not yet run against a real app |
| D | Review CLI (draft spec → final spec) | [~] Confirmation render + y/n gate landed inside `record`; no per-step editing |
| E | Migration + CI (retire the legacy generators behind `--legacy`, replay in CI) | [ ] Pending |

## What is app-agnostic now

- `src/transform/` — viewport-grow, 16:9 tiling, anchored frames, screenshot storage. Pure geometry
  (`tileGeometry.ts`) plus a Playwright capturer (`pageCapture.ts`) parameterised by
  `contentSelector`, `topAnchorSelectors`, and an `onSettle` hook. No product terms.
- `src/spec/` — `types.ts` (canonical spec), `validate.ts` (hand-rolled validator, no schema
  dependency), `serialize.ts` (spec → YAML). Sample: `specs/example-login.yaml`.
- `src/record/` — `observer.ts` (injected listeners → raw element facts), `locatorFrom.ts` (facts →
  semantic locator), `verify.ts` (locator confirmed against the live DOM), `translate.ts`
  (interaction → recorded event), `stepBuilder.ts` (events → spec), `render.ts` (spec → review
  text), `session.ts` (browser lifecycle). CLI entry `src/cli/record.ts` (`npm run record`).
- `src/replay/` — `vars.ts`, `locator.ts`, `urlMatch.ts`, `runner.ts`, and a CLI entry
  `src/cli/replay.ts` (`npm run replay -- <spec.yaml>`).

## Canonical spec format

One YAML file per tutorial is the only artifact the runner reads: `tutorial`, `vars`, `steps`.
Each step may assert a `page`/`expect`, run `do` actions against semantic locators, and take a
`shot`. Values are literals or `$var` references; vars are `fixed` (literal or `env:VAR`) or
`generated` (template). See `specs/example-login.yaml` and `.claude/references/spec-format.md`.

## Framing a long page

Two shot modes, because they answer different questions:

- `crop: fullpage` grows the viewport and auto-tiles the whole page into N evenly distributed 16:9
  frames that overlap by construction. Continuity is free, but the page must hold one state
  throughout.
- `crop: anchored` captures one 16:9 frame whose top edge is a recorded anchor element, against
  whatever state is live. Use it when reaching the next frame needs an interaction first — opening a
  dropdown, expanding a section. Continuity becomes explicit: anchor each frame to an element that
  was visible in the previous one. The recorder warns when consecutive frames leave a gap.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 76/76 pass (transform geometry including anchored clips and continuity, spec
  validator, spec serialisation round trip, variable resolution, locator tiers and derivation, URL
  matching, step assembly, review render). Pure logic only.
- The recorder was driven end to end against a local fixture page: labelled fills, a password, a
  select, a checkbox, a button, two anchored frames, and an ambiguous control all recorded, verified,
  and assembled into a spec the validator accepts, with no credential in the output.
- Byte-comparable output against the previous pipeline still needs a live run and is not yet done.

## Next

Phases B and C both need a run against a real target app: the runner to confirm it drives real DOM
and to compare output with the prior pipeline, the recorder to confirm the observer holds up against
a framework-rendered SPA. Phase D beyond the y/n gate (per-step editing, re-ordering, dropping shots)
is still open, as is E.

## Known gaps

- File uploads are not recorded — the browser hides the real path; add those steps by hand.
- Unchecking a checkbox is not recorded; the spec has no `uncheck` action.
- Shadow DOM and cross-origin iframes are out of scope for the recorder.
- Clearing a field records nothing, since `fill` requires a value.
- The recorder reads `data-testid` only, matching the runner's default `getByTestId` attribute.
