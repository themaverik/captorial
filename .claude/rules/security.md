# Security rules

Project-specific security rules for captorial. This is a local automation tool (no server, database,
or served endpoints), so the surface is filesystem paths, secrets, and third-party egress.

## Filesystem paths from app-supplied names

Any string that comes from a target app (element names, a recorded tutorial slug, a shot id) and ends
up in a filesystem path MUST be sanitised first:

- Strip `..` and leading path separators, not only reserved characters.
- `path.resolve` the final path and assert it stays under the configured output root before writing.

A hostile or compromised target app returning a name like `../../x` must not write outside the output
directory.

## Secrets and session state

- Never hardcode credentials, API keys, or tokens. Read them from the environment.
- `.env`, `.auth/`, and any storage-state file stay gitignored and untracked. Session-state files hold
  live tokens; restrict their permissions and never commit them.
- Never commit environment-specific target config (real hostnames, entity names, ids). Keep it local.

## Logging

- Do not interpolate upstream HTTP response bodies into thrown errors or logs; they can carry
  sensitive content into CI output. Log the status and a short, safe message.
- Never log environment variables, API keys, or values that may contain secrets.

## Third-party egress

- Sending screenshots or page content to an external service (an LLM captioning API) publishes that
  data. Screenshots can contain PII or customer data.
- Treat egress as opt-in and target-aware. Prefer a local model for sensitive runs. A safety gate that
  blocks a destructive action does not automatically gate data egress; gate them separately.

## Browser automation

- No `eval`, `new Function`, or string-form `page.evaluate`. Pass data into the page as evaluate
  arguments, never by string-concatenating it into script.
- Do not disable the browser sandbox or TLS verification.

## Dependencies

- Before any install/update, run `npm audit` and `npm audit signatures`; screen for known
  supply-chain compromises. Do not install blind.
