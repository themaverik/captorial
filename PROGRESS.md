# Progress

Tracking the move from a use-case-specific capture pipeline to a resilient, app-agnostic
record → review → replay pipeline built on semantic locators and one canonical spec per tutorial.
The stable boundary is documented in `docs/transform-contract.md`.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Extract the transform (scale / frame / store) layer into a standalone module | [x] Done, verified |
| A | Canonical spec types + validator + sample spec | [x] Done, verified |
| B | Replay runner (spec → semantic locators → transform), basic version | [~] Runner + CLI landed; first live run failed on step 1, fixed in `edf17a2`, not yet re-run |
| C | Live recorder (headed capture → spec) | [~] Recorder + CLI landed, verified against a fixture page; first live run produced a spec but missed the login form |
| D | Review CLI (draft spec → final spec) | [~] Editing pass landed inside `record`; smoke-tested with a scripted prompt, not yet used in a live recording |
| E | CI (typecheck + unit tests on push and pull request) | [x] Done, verified — green on a clean checkout |

The work is spread across `f4e4aca` (anchored frames), `df977ec` (recorder), `88d86ee` (review
pass), `639ea9e` (env template + guide), `ffc47cb` (CI) and `edf17a2` (the first live run's fixes,
on `fix/viewport-and-auth-hops`, not yet merged). B, C and D stay `[~]`: the first live run happened
and produced the fixes in `edf17a2`, but no run has yet completed end to end against a real app.

Phase E used to read "retire the legacy generators behind `--legacy`". That half is gone: no legacy
generator survives in this repo — `src/` is `cli`, `record`, `replay`, `spec`, `transform` and
nothing else — so the phase is now only the CI half.

## What is app-agnostic now

- `src/transform/` — viewport-grow, 16:9 tiling, anchored frames, screenshot storage. Pure geometry
  (`tileGeometry.ts`) plus a Playwright capturer (`pageCapture.ts`) parameterised by
  `contentSelector`, `topAnchorSelectors`, and an `onSettle` hook. No product terms.
- `src/spec/` — `types.ts` (canonical spec), `validate.ts` (hand-rolled validator, no schema
  dependency), `serialize.ts` (spec → YAML). Sample: `specs/example-login.yaml`.
- `src/record/` — `observer.ts` (injected listeners → raw element facts), `locatorFrom.ts` (facts →
  semantic locator), `verify.ts` (locator confirmed against the live DOM), `translate.ts`
  (interaction → recorded event), `stepBuilder.ts` (events → spec), `render.ts` (spec → review
  text), `edit.ts` (pure spec transforms for the review pass), `review.ts` (the review loop and its
  command parser), `authNav.ts` (single-use sign-in hops, filtered out), `session.ts` (browser
  lifecycle). CLI entry `src/cli/record.ts` (`npm run record`).
- `src/replay/` — `vars.ts`, `locator.ts`, `urlMatch.ts`, `display.ts` (viewport sizing), `runner.ts`,
  and a CLI entry `src/cli/replay.ts` (`npm run replay -- <spec.yaml>`).
- Configuration — generic env only (`BASE_URL`, `OUTPUT_DIR`, `STORAGE_STATE`, `VIEWPORT`,
  `DEVICE_SCALE_FACTOR`, `CROP_169`, `HEADED`, `SLOWMO`), documented in `.env.example`. Credentials
  are not tool config: a spec's `vars` block names the variables it reads (`source: env:NAME`), so
  no target-specific key is baked into the tool.

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
- Both gates run in CI (`.github/workflows/ci.yml`) on every push to `main` and every pull request,
  on Node 20 with the Playwright browser download skipped — nothing in the suite launches a browser.
  Confirmed green on a clean checkout, so `npm ci` and the shell-expanded test globs both hold on
  Linux and on the Node the runner ships, not just on the dev machine.
- `npm test` — 123/123 pass (transform geometry including anchored clips and continuity, spec
  validator, spec serialisation round trip, variable resolution, locator tiers and derivation, URL
  matching and rebasing, viewport fitting, sign-in navigation detection, step assembly including
  redirect-chain collapse, review render, review edits, review command parsing). Pure logic only.
- The review loop itself is interactive, so it is not unit-tested. It was driven end to end with a
  scripted prompt: an unrecognised command, a dropped step, a renamed and re-framed shot, a rejected
  `$var` reference, an accepted literal, then write — producing a spec the validator accepts, with
  the orphaned vars pruned and the input spec unmutated.
- The recorder was driven end to end against a local fixture page: labelled fills, a password, a
  select, a checkbox, a button, two anchored frames, and an ambiguous control all recorded, verified,
  and assembled into a spec the validator accepts, with no credential in the output.
- First live run against a real target app (2026-07-28) — the recorder produced a spec and replay
  then failed on its first step. Three defects, all fixed in `edf17a2` and covered by unit tests:
  the recorder's fixed viewport exceeded the screen so the operator could not reach part of the
  page; single-use sign-in redirect hops were recorded as replayable steps; and a step's path was
  appended to the base URL rather than resolved against its origin, doubling the prefix. The
  recorder also missed the password fill and the sign-in click on that app — unexplained, and the
  reason a re-record is the next step rather than a re-replay.
- Headed viewport fitting was verified live: probing a 1366x768 display yielded a 1125x633 window
  matching the page's reported inner size exactly, and the transform's viewport grow still worked
  afterwards, so tiling is unaffected.
- Byte-comparable output against the previous pipeline still needs a live run and is not yet done.

## Next

Re-record the flow from the start, against the fixes in `edf17a2`. The open question is why that
app's password field and sign-in button were not recorded while its email field was: the recorder
warns when it skips a control for want of a role+name, testid, or text, so that warning is the
thread to pull. If the observer cannot see an SSO login form, `STORAGE_STATE` sidesteps it by
starting the flow already authenticated — the more robust route for replay regardless.

Beyond that, B and C still need one run that completes: the runner to confirm it drives real DOM and
to compare output with the prior pipeline, the recorder to confirm the observer holds up across a
framework-rendered SPA, and the review pass to be used against a real recording rather than a
scripted prompt. What Phase D deliberately leaves out is locator editing: locators are verified
against the live DOM at record time and the page has closed by review, so editing one there would
ship it unverified. That belongs in an in-session review while the browser is still open.

## Known gaps

- File uploads are not recorded — the browser hides the real path; add those steps by hand.
- Unchecking a checkbox is not recorded; the spec has no `uncheck` action.
- Shadow DOM and cross-origin iframes are out of scope for the recorder.
- Clearing a field records nothing, since `fill` requires a value.
- The recorder reads `data-testid` only, matching the runner's default `getByTestId` attribute.
- A sign-in exchange is deliberately not recorded: its redirect hops carry single-use credentials
  and can never replay. Replay reaches the app and lets it start a fresh sign-in, so the login form
  itself must still be recordable — or be skipped entirely via `STORAGE_STATE`.
- Recorded specs carry the target's real hostname and paths, so they are excluded locally rather
  than committed. Only `specs/example-login.yaml` is tracked.
