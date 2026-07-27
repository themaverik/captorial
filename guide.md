# captorial pipeline guide

captorial is a standalone Playwright tool that drives an already-deployed web app and captures
screenshots at each step of a flow, for use in tutorials, guides, and slide decks. It is
app-agnostic: locators are resolved semantically (role and accessible name first, then
`data-testid`, then visible text), so the target app can restyle or reshuffle its DOM without
breaking capture.

## What you'll build

By the end of this guide you will have a canonical spec file describing a flow in a web app (a
login screen, in the examples here), and you will have replayed that spec against a running
instance of the app to produce PNG screenshots plus element-bounds sidecar files.

## Prerequisites

- Node >= 20
- A running instance of the target web app, reachable from your machine
- The ability to authenticate against that app, if the flow you're capturing starts past a login
  screen (via env vars for form fields, or a saved Playwright storage-state file)

## Pipeline overview

captorial's pipeline has three stages:

```
record   headed browser: perform the flow once -> spec              (npm run record)
review   read back the derived steps, correct them, write or discard (inside npm run record)
replay   drive the app from the spec, capture PNG + element bounds  (npm run replay)
```

**Record** and **replay** exist today. Review runs at the end of recording rather than as a separate
command: it prints the replayable steps and takes commands against them before anything is written.

```
  d <n>        drop step n
  s <n>        drop step n's screenshot, keeping its actions
  m <n> <to>   move step n to position <to>
  i <n>        rename step n's screenshot
  c <n>        change how step n's screenshot is framed
  v <n> <a>    change the value of action <a> in step n
  w / q        write the spec / discard it
```

Locators are deliberately not editable. They are verified against the live DOM while you record, and
the browser has closed by the time you review, so an edited locator would go out unverified — the
drift semantic locators exist to catch. To change one, re-record the step or edit the YAML by hand.

Dropping a step also drops any variable nothing references afterwards, so the credentials prompt at
the end reflects what the spec still needs.

You can also skip recording entirely and author a spec by hand, copying `specs/example-login.yaml`.

## 1. Install and set up

Clone or open the repository, then install dependencies and the Playwright browser binary:

```bash
npm install
npx playwright install chromium
```

Then create your local configuration from the annotated template. Nothing in it is needed to start
recording — `npm run record` prompts for the base URL and credentials. Replay is what reads it,
including the variables a spec's `vars` block points at. `.env` is gitignored; keep real hostnames
and credentials there and nowhere else.

```bash
cp .env.example .env
```

Confirm the project builds and its unit tests pass before doing anything else:

```bash
npm run typecheck
npm test
```

`npm run typecheck` runs `tsc --noEmit`. `npm test` runs the unit test suite (transform geometry,
spec validator, variable resolution, locator tiers, URL matching) with Node's built-in test
runner via `tsx`.

## 2. Recording a spec

```bash
npm run record
```

The recorder asks for four things — base URL, email, password, and a name for the tutorial — then
opens the app in a browser window. Perform the flow exactly as a reader of your tutorial would. Your
credentials are held in memory for the session only: they become `env:APP_EMAIL` and
`env:APP_PASSWORD` variables in the spec, never literals, and a password's value never leaves the
browser at all.

While you drive the app, two shortcuts mark screenshots:

| Shortcut | Captures |
|---|---|
| `Ctrl+Shift+S` | One 16:9 frame, anchored to the element at the top of the view |
| `Ctrl+Shift+F` | The whole page, auto-tiled into overlapping 16:9 frames |

Use `Ctrl+Shift+F` for a tall page that holds still — the tiling grows the viewport, slices the
content top to bottom, and guarantees consecutive tiles overlap. Use `Ctrl+Shift+S` when getting to
the next frame needs an interaction first: scroll down, open a dropdown, expand a section, then mark
another frame. Anything you do between frames is recorded as a step, so replay reproduces the same
sequence.

For a long form, scroll so the *last field you already captured* sits at the top of the view before
pressing `Ctrl+Shift+S` again. That field then appears at the bottom of one frame and the top of the
next, which is what carries the eye across the seam. The recorder checks this as you go and warns if
a frame starts below where the previous one ended, since that strip would appear in no screenshot.

Press Enter in the terminal when the flow is done, or just close the browser. The recorder prints
the steps it derived:

```
Step 1  ->  /login
    fill    "Email address" (textbox) = $email (from env:APP_EMAIL)
    fill    [password-field] = $password (from env:APP_PASSWORD)
    click   "Sign in" (button)
Step 2  ->  /orders/new
    fill    "Company name" (textbox) = $companyName ("Acme Ltd")
    shot    01-company-name — anchored, framed from "Company name" down
```

Each field you filled becomes a variable named after its **label**, defaulting to the value you
typed, so the same flow can be replayed with different data by overriding one variable. Confirm, and
the spec is written to `specs/<tutorial>.yaml`.

Things the recorder will tell you about rather than guess at: a control that matched several
elements (it records the position and asks you to add a `data-testid`), a file upload (the browser
hides the real path), unchecking a checkbox, and any interaction with no semantic locator at all.

## 3. Authoring a spec by hand

A canonical spec is a single YAML file describing one tutorial: which pages to visit, which
actions to perform, and which screenshots to take. It is the only artifact the replay runner
reads. `specs/example-login.yaml` is a worked example; copy it as your starting point.

```yaml
tutorial: example-login
vars:
  email:
    type: fixed
    source: env:DEMO_EMAIL          # pulled from the environment at replay time
  password:
    type: fixed
    source: env:DEMO_PASSWORD
  projectName:
    type: fixed
    value: Demo Project             # literal
  runId:
    type: generated
    template: run-{date}            # regenerated per run
steps:
  - page: /login                    # page boundary; the runner asserts the URL
    do:
      - { action: fill, locator: { role: textbox, name: Email }, value: $email }
      - { action: fill, locator: { role: textbox, name: Password }, value: $password }
      - { action: click, locator: { role: button, name: Sign in } }
    shot:
      id: 01-login
      crop: element
      target: { testid: login-card }
  - expect:
      url: /projects/*
      visible: { text: $projectName }
    shot: { id: 02-detail, crop: element, target: { testid: project-header } }
```

### Top level

Every spec has three top-level keys:

- `tutorial` — a non-empty slug identifying the tutorial
- `vars` — an optional map of variable name to definition
- `steps` — a non-empty list of steps to perform

### Variables

A variable is one of two shapes:

| Shape | Meaning |
|---|---|
| `{ type: fixed, value: "..." }` | a literal string |
| `{ type: fixed, source: env:VAR }` | read from the environment at replay time |
| `{ type: generated, template: "run-{date}" }` | regenerated each run |

A `fixed` variable needs exactly one of `value` or `source`; `source` must look like
`env:VAR_NAME`. Template placeholders available to `generated` variables: `{date}` expands to
`YYYY-MM-DD`, `{time}` to `HHMM`, `{timestamp}` to the epoch millisecond count.

Reference a variable anywhere a step needs a value by prefixing its name with `$`, for example
`$email`. Referencing an undeclared variable fails spec validation before replay even starts.

### Locators

A locator is a small object carrying every candidate the runner can try:

```yaml
{ role: button, name: "Sign in", testid: signin, text: "Sign in", nth: 0 }
```

The runner resolves candidates in a fixed order: `role` + `name` first, then `testid`, then
`text`. It logs which tier actually matched, so drift between the spec and the app's real DOM is
visible in the console instead of silently producing a wrong screenshot. At least one candidate
is required. `nth` disambiguates when more than one element matches the same tier — prefer adding
a `testid` to the app instead of relying on `nth` where you can.

### Steps

Each step in `steps` supports four optional keys, and needs at least one of them:

```yaml
- page: /login                 # navigate + assert the resulting URL
  expect:                      # assertions checked before the step proceeds
    url: /projects/*           #   glob match against the current URL
    visible: { text: $who }    #   a locator that must be visible
  do:                          # actions performed in order
    - { action: fill,  locator: { role: textbox, name: Email }, value: $email }
    - { action: click, locator: { role: button,  name: Sign in } }
  shot:                        # capture a screenshot
    id: 01-login
    crop: element              # element | viewport | fullpage
    target: { testid: login-card }   # required when crop is element
```

Supported actions: `fill`, `click`, `select`, `check`, `upload`, `press`. `fill`, `select`,
`press`, and `upload` require a `value` (a literal or a `$var`); `upload` takes a comma-separated
list of file paths.

Shots have four crop modes:

| `crop` | Captures |
|---|---|
| `element` | Just the `target` locator's element (`target` required) |
| `viewport` | The current viewport as-is |
| `fullpage` | Grows the viewport and tiles the whole page's content into overlapping 16:9 images |
| `anchored` | One 16:9 frame whose top edge is `anchor` (`anchor` required) |

`fullpage` and `anchored` are the two ways to cover a page taller than one frame, and they trade
off against each other. `fullpage` slices a single snapshot, so overlap between tiles is guaranteed
but the page must hold one state throughout. `anchored` shoots one frame against whatever state is
live, so you can open a dropdown or expand a section between frames — but continuity becomes yours
to arrange, by anchoring each frame to an element that was visible in the previous one:

```yaml
- shot: { id: 01-address, crop: anchored, anchor: { role: textbox, name: Address line 1 } }
- do: [{ action: click, locator: { role: button, name: Country } }]   # opens the dropdown
  shot: { id: 02-country, crop: anchored, anchor: { role: textbox, name: Address line 4 } }
```

Every shot that has a `target` also writes a `<id>.bounds.json` sidecar next to the PNG, recording
the element's bounds and device pixel ratio for any downstream processing.

## 4. Running replay

Once you have a spec, run it with:

```bash
npm run replay -- specs/example-login.yaml
```

The CLI validates the spec first and reports every error before touching the browser. If the
spec is valid, it launches Chromium and drives the app step by step.

Replay reads all of its configuration from generic environment variables — nothing
product-specific is hardcoded:

| Variable | Meaning |
|---|---|
| `BASE_URL` | Base for relative `page:` paths and URL assertions |
| `OUTPUT_DIR` | Where screenshots and bounds sidecars are written (default `./replay-output`) |
| `STORAGE_STATE` | Playwright storage-state file for an authenticated session (optional) |
| `DEVICE_SCALE_FACTOR` | Screenshot DPI multiplier (default 1) |
| `CROP_169` | Crop full-page shots to 16:9 tiles (default true) |
| `HEADED`, `SLOWMO` | Run headed / slow down actions for debugging |

A spec's credentials are a separate thing, and the CLIs never read them. A spec declares
`source: env:DEMO_EMAIL`, and `vars.ts` resolves that name at replay time — so which variables you
need depends on the spec. `specs/example-login.yaml` refers to `DEMO_EMAIL` and `DEMO_PASSWORD`;
anything `npm run record` produces refers to `APP_EMAIL` and `APP_PASSWORD` instead.

Set variables inline, or in a `.env` file (loaded automatically via `dotenv/config`). Copy the
annotated template, which lists every variable above plus both credential pairs:

```bash
cp .env.example .env
```

Or pass them inline for a one-off run:

```bash
BASE_URL=https://your-app.example.com \
DEMO_EMAIL=demo@example.com \
DEMO_PASSWORD=secret \
OUTPUT_DIR=./out \
npm run replay -- specs/example-login.yaml
```

If you need to watch the browser to debug a flaky step:

```bash
HEADED=true SLOWMO=250 npm run replay -- specs/example-login.yaml
```

If the flow you're capturing starts past a login screen, point `STORAGE_STATE` at a saved
Playwright storage-state file instead of scripting the login in the spec itself.

### Checkpoint

After a successful run you should see log lines like:

```
Replaying "example-login" (2 steps) -> /absolute/path/to/out
Captured 2 shot(s); 0 warning(s).
```

If the shot count is lower than the number of `shot:` entries in your spec, or warnings are
non-zero, check the console output above that summary line — the runner logs which locator tier
it fell back to (or failed on) for each step.

## 5. Reading the output

Replay writes into `OUTPUT_DIR/<tutorial>/`. For the example spec with `OUTPUT_DIR=./out` that's
`./out/example-login/`. Expect one PNG per shot (or several `-1`, `-2`, ... tiles for a
`crop: fullpage` shot whose content is taller than one 16:9 frame), plus a bounds sidecar for
every shot that had a `target`:

```
out/example-login/
  01-login.png
  01-login.bounds.json
  02-detail.png
  02-detail.bounds.json
```

`<id>.bounds.json` records the target element's bounding box and the device pixel ratio at
capture time. It exists so a later processing step (cropping, annotation, layout) can work from
exact coordinates instead of re-measuring the page.

## 6. Verifying your work

Before trusting a spec (or a change to the replay runner itself), run the two checks the project
uses in development:

```bash
npm run typecheck   # tsc --noEmit
npm test            # unit tests: transform geometry, spec validator, vars, locators, url matching
```

Both also run in CI on every push to `main` and every pull request, so a change that breaks either
is caught before it lands.

These do not exercise the Playwright-driven runner against a live app — that part is only
verified by actually running `npm run replay -- <spec>` against your target and inspecting the
output described in the previous section.

## Troubleshooting

**Locator fell through to the text tier.** The runner logs which tier resolved each locator. If
you see it falling back to `text` for an element you expected to resolve on `role`+`name` or
`testid`, the app's accessible name or your `testid` guess doesn't match the real DOM. Add a
stable `data-testid` to the element in the app (or correct the `role`/`name` in the spec) so the
locator resolves on a tier that won't break if button copy changes.

**URL assertion mismatch.** `expect.url` and `page:` are matched as a glob against the current
URL after navigation or an action. A mismatch usually means either `BASE_URL` is wrong for the
environment you're targeting, or the app redirected somewhere other than what the spec expects
(for example, a failed login going back to `/login` instead of on to `/projects/*`). Run with
`HEADED=true` to watch where the browser actually ends up.

**Missing environment variable.** A `fixed` variable with `source: env:VAR_NAME` fails at replay
time if `VAR_NAME` isn't set. Set it inline, add it to `.env`, or check for a typo between the
spec's `source:` value and the variable name you exported.

## What's next

Record and review are the two remaining planned stages. Record will drive a headed browser and
draft a spec from what you click and type, instead of requiring you to hand-write YAML. Review
will take that draft, resolve which variables should be fixed vs. generated, and let you pick
screenshot points, before handing the result to the same replay runner used today. Until those
land, hand-authoring a spec from `specs/example-login.yaml` and running `npm run replay` is the
full workflow. See `PROGRESS.md` for current status.
