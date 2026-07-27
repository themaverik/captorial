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

- Author locators as role+name first, then testid, then text. The runner resolves in that order and
  logs the winning tier. Never write raw CSS selectors or XPath that bind to DOM structure.
- Store every candidate a recorder can capture, so the runner can fall through on drift.

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
