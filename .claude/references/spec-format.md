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
    crop: element              # element | viewport | fullpage | anchored
    target: { testid: login-card }   # required when crop is element
```

A step needs at least one of `page` / `expect` / `do` / `shot`.

### Actions

`fill`, `click`, `select`, `check`, `upload`, `press`. `fill`, `select`, `press`, and `upload`
require a `value` (a literal or a `$var`). `upload` takes a comma-separated list of file paths.

### Shots

| `crop` | Framing |
|---|---|
| `element` | Crops to `target` (required). |
| `viewport` | Whatever is on screen, unchanged. |
| `fullpage` | Grows the viewport and auto-tiles the whole page into overlapping frames. |
| `anchored` | One aspect-ratio frame whose top edge is `anchor` (required). |

Every shot with a `target` also writes a `<id>.bounds.json` sidecar (element bounds plus device pixel
ratio) for downstream transformation.

#### Choosing between `fullpage` and `anchored`

`fullpage` grows the viewport to the whole content height and slices it into N evenly distributed
16:9 tiles, so consecutive tiles always share an overlap strip — a field at the bottom of tile 1 is
also at the top of tile 2. Continuity is automatic. Use it for a tall but **static** page.

Because it slices one snapshot, it cannot express a page whose state differs between frames. When
capturing frame 2 needs an interaction first — opening a dropdown, expanding a section — use
`anchored` frames instead: one shot each, with the interactions recorded as ordinary `do` actions
between them.

```yaml
- shot: { id: 01-address, crop: anchored, anchor: { role: textbox, name: Address line 1 } }
- do: [{ action: click, locator: { role: button, name: Country } }]     # opens the dropdown
  shot: { id: 02-country, crop: anchored, anchor: { role: textbox, name: Address line 4 } }
```

Continuity is then the author's to arrange: anchor each frame to an element that was visible in the
previous one. Anchoring frame 2 to the *last field visible in frame 1* is what carries the eye
across the seam. The recorder checks this while the page is still open and warns when a frame's
anchor sits below the previous frame's bottom edge, since that strip would appear in no shot.
