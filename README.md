# captorial

Automated tutorial-screenshot capture for web apps. A standalone Playwright tool that drives an
already-deployed web app and captures a framed, tiled screenshot at each step of a flow, ready for
guides, slide decks, and lessons.

captorial is moving to a resilient, app-agnostic pipeline: a flow is recorded once into a single
canonical spec, reviewed, then replayed to capture screenshots. Locators are semantic (role and
accessible name first, `data-testid` next, visible text last), so a target app can restyle or
reshuffle its DOM without breaking capture. See `PROGRESS.md` for status.

## Pipeline

```
record   headed browser: browse the target app -> draft spec        (planned)
review   resolve variables, choose screenshot points -> final spec   (planned)
replay   drive the app from the spec, capture PNG + element bounds    (basic version landed)
```

The transform layer (viewport-grow, 16:9 tiling, storage) is the stable boundary every stage feeds;
its contract is documented in `docs/transform-contract.md`.

## Replay

```bash
npm install
npx playwright install chromium
npm run replay -- specs/example-login.yaml
```

Config is read from generic environment variables only:

| Variable | Meaning |
|---|---|
| `BASE_URL` | Base for relative `page:` paths and URL assertions |
| `OUTPUT_DIR` | Where screenshots and bounds sidecars are written (default `./replay-output`) |
| `STORAGE_STATE` | Playwright storage-state file for an authenticated session (optional) |
| `DEVICE_SCALE_FACTOR` | Screenshot DPI multiplier (default 1) |
| `CROP_169` | Crop full-page shots to 16:9 tiles (default true) |
| `HEADED`, `SLOWMO` | Run headed / slow actions for debugging |

## Canonical spec

One YAML file per tutorial is the only artifact the runner reads.

```yaml
tutorial: example-login
vars:
  email:    { type: fixed, source: env:DEMO_EMAIL }   # from the environment
  who:      { type: fixed, value: Demo Project }        # literal
  runId:    { type: generated, template: run-{date} }   # regenerated per run
steps:
  - page: /login
    do:
      - { action: fill,  locator: { role: textbox, name: Email }, value: $email }
      - { action: click, locator: { role: button,  name: Sign in } }
    shot: { id: 01-login, crop: element, target: { testid: login-card } }
  - expect: { url: /projects/*, visible: { text: $who } }
    shot:   { id: 02-detail, crop: element, target: { testid: project-header } }
```

Locators resolve in order role+name → testid → text; the runner logs which tier it used so drift is
visible before it becomes breakage. See `specs/example-login.yaml`.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # unit tests (transform geometry, spec validator, vars, locators, url matching)
```

Requirements: Node >= 20. TypeScript, strict, ESM.

## Layout

```
src/transform/   scale / frame / store (app-agnostic; see docs/transform-contract.md)
src/spec/        canonical spec types + validator
src/replay/      variable + locator resolution, replay runner, url matching
src/cli/         command entry points
specs/           canonical specs (one YAML per tutorial)
```

This replaces an earlier use-case-specific capture pipeline with a spec-driven, app-agnostic one.
