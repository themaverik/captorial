# Project conventions

Project-specific rules for captorial. Global coding-style / testing / git rules still apply; these
add what is particular to this codebase.

## Module boundaries

- `src/transform/` is the stable contract boundary (see `docs/transform-contract.md`). It must stay
  app-agnostic: it takes `contentSelector`, `topAnchorSelectors`, and an `onSettle` hook as options
  and hardcodes no app's DOM. Do not import app or config modules into it.
- `src/spec/` owns the canonical spec (types + validator). It has no Playwright dependency.
- `src/replay/` depends on `spec` and `transform`, never the reverse.
- A change that crosses these layers should keep the dependency direction spec -> replay -> transform.

## Locators

- Author locators as role+name first, then testid, then label, then text. The runner resolves in that
  order and logs the winning tier. Never write raw CSS selectors or XPath that bind to DOM structure.
- Store every candidate a recorder can capture, so the runner can fall through on drift.
- `label` is the tier for a control with no implicit ARIA role (`input[type=password]`,
  `input[type=file]`). Adding a tier is a coupled change: `SpecLocator` and `LOCATOR_KEYS`,
  `LocatorTier` / `locatorTiers` / `buildLocator`, `pick` in `record/verify.ts`, `locatorFor` in
  `record/locatorFrom.ts`, `orderLocator` in `spec/serialize.ts`, and the tests for each.
- `within` is scoping, not a tier: it narrows whichever tier wins, and adds no candidate of its own
  (`locatorTiers` ignores it). It is how a control an app leaves unnamable stays locatable — a
  trigger with only placeholder text is ambiguous page-wide and unique inside its field. Both halves
  stay semantic, so this is not a back door for CSS. It must ride along in `pick`, or a verified
  locator is stored without the scope that made it resolve.
- Which element a click meant is decided in `record/attribute.ts`, in Node and pure, never in the
  injected script. The observer reports both the ancestor it walked to and what the pointer was over;
  an ancestor that dwarfs the clicked element is a container, and recording the container as if it
  were the control writes down an action the user never performed.

## Adding a step action

Adding an action (e.g. `hover`) is a four-file change kept in sync: `ActionType` and `VALUE_ACTIONS`
in `spec/types.ts`, the `ACTIONS` list and any value rule in `spec/validate.ts`, the `switch` in
`replay/runner.ts`, and a validator test. See the `add-spec-action` skill.

## Dependencies

- Playwright, js-yaml, dotenv, tsx, typescript only. The spec validator is hand-rolled — do not pull
  in zod or another schema library. Ask before adding anything else.

## TypeScript

- Strict, ESM, `.js` import specifiers. `tsc --noEmit` must pass. `noUnusedLocals` /
  `noUnusedParameters` are on — no dead imports or params.
