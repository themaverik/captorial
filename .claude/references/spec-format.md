# Canonical spec format

One YAML file per tutorial is the only artifact the replay runner reads. Types live in
`src/spec/types.ts`; the validator in `src/spec/validate.ts`. A worked example is
`specs/example-login.yaml`.

## Top level

```yaml
tutorial: <slug>      # required, non-empty
vars: { ... }         # optional map of name -> variable
steps: [ ... ]        # required, non-empty
```

## Variables (`vars`)

| Shape | Meaning |
|---|---|
| `{ type: fixed, value: "..." }` | literal |
| `{ type: fixed, source: env:VAR }` | read from the environment at replay time |
| `{ type: generated, template: "run-{date}" }` | regenerated per run |

A fixed var needs exactly one of `value` or `source`. `source` must look like `env:VAR_NAME`.
Template placeholders: `{date}` -> `YYYY-MM-DD`, `{time}` -> `HHMM`, `{timestamp}` -> epoch ms.

Reference a var in any step value as `$name`. Unknown references fail validation.

## Locators

A locator carries every candidate a recorder could capture. The runner resolves in this order and
logs the winning tier:

```yaml
{ role: button, name: "Sign in", testid: signin, text: "Sign in", nth: 0 }
```

Resolution order: `role`+`name` -> `testid` -> `text`. At least one candidate is required. `nth`
disambiguates when several match (prefer a testid instead).

## Steps

```yaml
- page: /login                 # optional: navigate + URL boundary
  expect:                      # optional: assertions before proceeding
    url: /projects/*           #   glob match against the current URL
    visible: { text: $who }    #   a locator that must be visible
  do:                          # optional: actions in order
    - { action: fill,  locator: { role: textbox, name: Email }, value: $email }
    - { action: click, locator: { role: button,  name: Sign in } }
  shot:                        # optional: capture a screenshot
    id: 01-login
    crop: element              # element | viewport | fullpage
    target: { testid: login-card }   # required when crop is element
```

A step needs at least one of `page` / `expect` / `do` / `shot`.

### Actions

`fill`, `click`, `select`, `check`, `upload`, `press`. `fill`, `select`, `press`, and `upload`
require a `value` (a literal or a `$var`). `upload` takes a comma-separated list of file paths.

### Shots

`crop: fullpage` grows the viewport and tiles the whole form via the transform layer. `element` crops
to the `target`. Every shot with a `target` also writes a `<id>.bounds.json` sidecar (element bounds
plus device pixel ratio) for downstream transformation.
