---
name: add-spec-action
description: Use when adding, renaming, or removing a canonical-spec step action (fill, click, hover, etc.) in captorial. Keeps the four coupled sites in sync — spec types, the validator, the runner switch, and tests — so the spec, its validation, and its execution never drift.
---

# Add a spec action

A step action is defined in four places that must stay in sync. Changing one without the others
either lets an invalid spec validate or lets a valid spec fail at replay. Touch all four, in order.

## Steps

1. **Type** — `src/spec/types.ts`
   - Add the action name to the `ActionType` union.
   - If it needs a `value` (like `fill` or `select`), add it to `VALUE_ACTIONS`.

2. **Validator** — `src/spec/validate.ts`
   - Add the name to the `ACTIONS` array so it is accepted.
   - `VALUE_ACTIONS` from types already drives the "requires a value" check; no extra rule needed
     unless the action has a bespoke constraint (then add it in `validateAction`).

3. **Runner** — `src/replay/runner.ts`
   - Add a `case` to the `switch` in `runAction` that performs the Playwright interaction on the
     resolved locator. Dereference the value via `resolveValue` (already done before the switch).

4. **Tests** — `src/spec/validate.test.ts` (and `src/replay/*.test.ts` if pure logic changed)
   - Add a case proving the new action validates, and, if it requires a value, that a missing value
     is rejected.

## Verify

```bash
npm run typecheck   # union + switch exhaustiveness
npm test            # validator + any pure-logic tests
```

The runner's DOM behaviour is confirmed against a live app, not in unit tests, so also replay a spec
that uses the new action once a target app is available.

## Notes

- Keep actions small and generic; they must work for any app, not a specific one.
- If an action takes multiple inputs, prefer encoding them in the `value` string (e.g. comma list)
  over widening `StepAction`, to keep the spec format stable.
