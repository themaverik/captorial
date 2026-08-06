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
- `npm test` — 145/145 pass (transform geometry including anchored clips and continuity, spec
  validator including unknown-key rejection, spec serialisation round trip, variable resolution,
  locator tiers and derivation including the label tier, navigation detection during recording, URL
  matching and rebasing, viewport fitting, sign-in navigation detection, step assembly including
  redirect-chain collapse and path generalisation, skip reporting, review render, review edits,
  review command parsing). Pure logic only.
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
  recorder also missed the password fill and the sign-in click on that app.
- That miss was diagnosed and fixed (2026-08-06). It was two independent defects, and neither alone
  accounts for it:
  - *Nothing that navigates could be recorded.* Locators are verified against the live page, but the
    binding handler is queued and runs after the interaction's default action. A click that
    navigates takes its own page away first, and `findMatch` swallowed the resulting error as a
    clean miss, so the step was dropped through the silent `skip` path. Verification now tells
    `unmatched` (the page was there; the locator genuinely missed) from `unverifiable` (the page
    moved, so the miss proves nothing), and the observer reports the URL each interaction happened
    on as a second signal. An unverifiable interaction keeps its derived locator and warns, instead
    of vanishing. This was never login-specific: every navigating click was affected.
  - *A labelled password field offered no locator at all.* `input[type=password]` has no implicit
    ARIA role, its text is not a locator, and the form carried no `data-testid` — so `locatorFor`
    returned an empty candidate and the fill was dropped before verification even ran. The spec
    gained a `label` tier (`getByLabel`), resolving after `testid` and before `text`; it is the only
    tier that reaches a control with no implicit role, password and file inputs alike.
  Verified live against a two-page fixture whose submit navigates: all three interactions are now
  recorded where previously only the email was, and the password locator verifies as
  `{ label: Password }` on a page that is not navigating.
- Headed viewport fitting was verified live: probing a 1366x768 display yielded a 1125x633 window
  matching the page's reported inner size exactly, and the transform's viewport grow still worked
  afterwards, so tiling is unaffected.
- Byte-comparable output against the previous pipeline still needs a live run and is not yet done.

- First live *replay* against the real target app (2026-08-06). It failed on step 1 and, once that
  was fixed, drove sign-in and the first page cleanly. Six defects, all found by running it:
  - *A blank env var counted as set.* `resolveVar` tested `value === undefined`, but an unfilled
    `.env` supplies `""`. A credential field was filled with nothing and the run failed later with
    an unrelated network error. Blank now fails fast, naming the variable.
  - *A configured but missing `STORAGE_STATE` was silently ignored*, replaying signed out with no
    indication. It is now an error naming the path.
  - *An aborted navigation ended the run.* An app-driven redirect — a sign-in still completing, or
    a guard bouncing an unauthenticated visit — is reported by Chromium as a bare `ERR_ABORTED`.
    `goToStepPage` now settles, accepts the position if the app already arrived (`samePage`), and
    otherwise retries once before failing with where the browser actually is.
  - *Warnings were logged only on success*, so a run that threw discarded the diagnosis that
    explained it. They are now flushed in the `finally`.
  - *`resolveLocator` never waited.* `count()` is a snapshot, so against a page that had only
    reached `domcontentloaded` every candidate missed and every action was skipped — measured on
    the target's hosted sign-in page as 0 matches at `domcontentloaded` and 1 a second later. It now
    polls every tier in preference order against one deadline (`DEFAULT_RESOLVE_TIMEOUT_MS`). This
    was the single cause of 35 skipped actions.
  - *One unperformable action ended the run*, and warnings identified neither the step nor the
    element. An action failure now warns and continues like an unresolved locator already did, with
    a 10s bound, and every warning carries `steps[i].do[j]` and a `describeLocator` description.
- A recorder defect the replay exposed, fixed the same day: *a click that caused a navigation was
  recorded against the page it led to, not the page it was made on.* `framenavigated` pushed onto
  the event stream synchronously while interactions waited in the observer's queue behind their own
  verification, so the destination always won the race. Navigation now goes through that same queue.
  Verified against a two-page fixture: before, `navigate /`, `navigate /two`, `click`; after,
  `navigate /`, `click`, `navigate /two` — the click keeps the step it belongs to.

- Two further recorder defects the same replay exposed, fixed 2026-08-06:
  - *A recorded path was replayed as an instruction when it was really an outcome.* Every navigation
    became a `page:` to visit. For a page the flow's own actions led to, that is wrong twice over:
    the visit is redundant, and a path naming an entity created while recording
    (`/ops/tasks/<uuid>`) sends every later run back to that same entity instead of the one the run
    just made. A navigation caused by the step being left now becomes an `expect.url` assertion,
    with generated segments globbed (`/ops/tasks/*`) by `generalisePath`; only a page opened
    directly stays a `page:`. The runner already glob-matched `expect.url`, so nothing changed there.
  - *The silent `skip` path reported a number.* An interaction the recorder could not name was
    counted and summarised as "N interaction(s) were skipped", which cannot distinguish a control
    needing a `data-testid` from a locator derived wrongly — opposite remedies. Each distinct drop is
    now a warning naming the interaction, the element, the page and the remedy, deduped so one
    control touched repeatedly stays one line.

- Third live replay (2026-08-06), against a re-recording. Sign-in, the task list and its navigation
  replayed cleanly; task creation did not. Three defects, two of them the tool's:
  - *A URL assertion was read once, mid-flight.* Replacing `page:` with `expect.url` removed a
    `goto` that waited for navigation and did not replace the wait, so the check read the address bar
    while a sign-in redirect was still in progress and reported the identity provider's URL as a
    mismatch. `expect.url` now polls to `URL_SETTLE_TIMEOUT_MS`.
  - *An action on an ambiguous locator ended the step.* Playwright is strict: acting on a locator
    matching several elements throws. Shots already resolved this with `.first()`; actions did not,
    so a second `Save` on the page killed the step. An action now narrows to the first match and
    warns, since narrowing silently is how a replay does the wrong thing and still reports success.
  - *A click was recorded against a container that merely held the control.* `closest(INTERACTIVE)`
    walks up from the deepest element under the pointer, which is right for a span inside a button
    and wrong for a dropdown trigger inside a form section carrying the only `data-testid`. The
    recorded click landed on the section, did nothing, and the options it should have opened were
    never in the DOM. The observer now reports both elements and `record/attribute.ts` decides in
    Node: a real control tag wins outright, an ancestor within `SAME_CONTROL_AREA_RATIO` of the
    clicked element is taken as the same control, and one that dwarfs it is a container — in which
    case the inner element is recorded, scoped to the container by the new `within` field.

- Fourth recording (2026-08-06), the first driven by the attribution fix. Confirmed working: the
  container click is gone, `within` scopes the two testid-bearing form wrappers, step ordering is
  right, the sign-in exchange is dropped, the landing page is an `expect.url` with the task id
  globbed, and the dropdown-opening clicks are present. One defect, and it was in the new code:
  - *Attribution descended past an element that was already the control.* `CONTROL_TAGS` asks about
    the tag, so an app composing a listbox from divs gets `role="option"` on a row far wider than its
    label, the size rule reads that as a container, and the click is recorded as a bare `text` locator
    scoped by the very role+name it discarded. The same recording holds both forms of the same control
    — proof the heuristic, not the app, was inconsistent. Attribution now asks `inferRole` as well as
    the tag, and treats an interactive role as a control outright. Deliberately a question about
    interactivity, not namability: a wrapper carrying a testid is easy to name and still not clickable.

## Next

Capture is the blocker, not locators. Four recordings have produced no `shot:` at all, so even a
flawless run writes zero files and the tool's whole purpose goes unexercised. Everything else is
downstream of settling that; see Known gaps for the diagnosis so far.

Two hazards to read off the next replay rather than pre-empt, since both look identical in a spec to
something correct:

- *An `nth` is recorded against the count at that instant.* A calendar cell recorded as `text: '6'`
  with `nth: 4` is the fifth "6" only in the month it was recorded. Verification prefers a unique tier
  and only falls back to an index, so an `nth` in a spec marks a locator with nothing better — worth
  reading as a warning sign, not as a value to trust.
- *A trigger unique at record time may not be unique at replay.* Three separate dropdowns recorded as
  a bare `text: Select` each verified as unique, which means the page held one at a time; if replay
  reaches them in a different order the runner narrows to the first and warns. That warning is the
  signal that the trigger needs a `within` scope, and the attribution change may already supply it.

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
- The shot shortcuts (`Ctrl+Shift+S` / `Ctrl+Shift+F`) have not been seen to register on Windows
  across three live recordings, all of which produced specs with no `shot:` at all. The rest of the
  path is exonerated by reading it: a `shot-fullpage` event needs no anchor, is dropped nowhere in
  `translate.ts` or `stepBuilder.ts`, and logs `shot: whole page, auto-tiled` the moment it arrives.
  So the keypress is not reaching the listener. `observer.ts` now reads `event.code` rather than
  `event.key`, which closes the layout-dependent case; what remains is a desktop-global bind, which
  screenshot tools commonly place on `Ctrl+Shift+S`. The test is to press `Ctrl+Shift+F` and watch
  for that line. If it stays silent, the fix is configurable shot keys.
- The recorder reads `data-testid` only, matching the runner's default `getByTestId` attribute.
- A sign-in exchange is deliberately not recorded: its redirect hops carry single-use credentials
  and can never replay. Replay reaches the app and lets it start a fresh sign-in, so the login form
  itself must still be recordable — or be skipped entirely via `STORAGE_STATE`.
- Recorded specs carry the target's real hostname and paths, so they are excluded locally rather
  than committed. Only `specs/example-login.yaml` is tracked.
