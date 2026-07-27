# CLAUDE.md — captorial

App-agnostic tutorial-screenshot capture for web apps. A flow is recorded once into a canonical
spec, reviewed, then replayed against a live app to capture framed, tiled screenshots. Locators are
semantic, so a target app can restyle its DOM without breaking capture.

Standalone Playwright tool. No product-specific code lives here; keep it that way.

## Architecture

```
spec/        canonical spec: types + hand-rolled validator (the only artifact the runner reads)
replay/      variable resolution, semantic locator resolution, url matching, the replay runner
transform/   scale / frame (16:9 tiling) / store — the STABLE contract boundary
cli/         command entry points (replay)
specs/       one YAML spec per tutorial
```

The transform layer is the stable boundary the whole pipeline feeds. Its contract is documented in
`docs/transform-contract.md`; do not couple it to any specific app. Roadmap in `PROGRESS.md`.

## Conventions

- TypeScript strict + ESM (tsx). Import paths carry the `.js` extension (`moduleResolution: Bundler`).
- Arrow functions; `interface` over `type` for object shapes; `camelCase` / `PascalCase` / `UPPER_SNAKE`.
- Many small, cohesive files (200-400 lines typical). Immutable data — return new objects, don't mutate.
- No new heavyweight dependencies. The spec validator is hand-rolled on purpose (no zod). Ask before
  adding anything beyond playwright / js-yaml / dotenv / tsx.
- Locators are semantic only: resolve role+name -> testid -> text. Never author raw CSS or XPath tied
  to DOM structure; the runner logs which tier it used so drift is visible before it breaks.

## Commands

```bash
npm run replay -- specs/<tutorial>.yaml   # drive a target app from a spec
npm run typecheck                         # tsc --noEmit
npm test                                  # node --import tsx --test (unit tests)
```

Replay config is generic env only: `BASE_URL`, `OUTPUT_DIR`, `STORAGE_STATE`, `DEVICE_SCALE_FACTOR`,
`CROP_169`, `HEADED`, `SLOWMO`. Never hardcode target URLs or entity values in the tool; put them in
a spec's `vars` (fixed / `env:VAR` / generated).

## Testing

Pure logic (geometry, validator, vars, locator tiers, url matching) is unit-tested and must stay
green. Playwright-coupled code (the runner) is verified against a live app, not in unit tests. Add a
test with any new pure function or spec rule.

## Security musts

See `.claude/rules/security.md`. In short: sanitise any app-supplied name before it enters a
filesystem path (guard against `..`), keep writes under the output root, never log upstream response
bodies, treat screenshot/LLM egress as sensitive, and never commit secrets, session state, or
environment-specific target config.

## Git

- No product/domain terms in commit messages or history.
- Conventional Commits; subject <= 50 chars, imperative, no period. No AI-tool attribution.
- Never push without explicit confirmation.
