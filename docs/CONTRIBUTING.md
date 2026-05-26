# Contributing to Margin

## Quick start

```sh
cd backend
deno install --frozen
deno task migrate
deno task test
deno task typecheck
```

Deno is the package manager + runtime for the backend. `deno install` materializes `backend/node_modules/` (the extension and site have their own `node_modules/` under `extension/` and `site/`). To run the server against Google you also need an OAuth client, a Picker key, and a couple of secrets in `backend/.env`. See [`setup.md`](./setup.md). Deployment to Fly.io is in [`deployment.md`](./deployment.md); CI tiers and integration-test secrets are in [`testing.md`](./testing.md).

## Where things live

- [`spec.md`](./spec.md): design, data model, per-phase build plan, Google-side constraints.
- [`AGENTS.md`](../AGENTS.md): repo layout and code conventions (Deno tasks, domain/HTTP/CLI boundaries, schema migrations, secrets at rest, test layout).
- [`extension/README.md`](../extension/README.md): extension build pipeline, popup state machine, Picker mechanics.

Read `AGENTS.md` before opening a PR.

## Pull requests

- `deno task test` and `deno task typecheck` must pass.
- Keep diffs focused. Match the surrounding style. Don't introduce abstractions beyond what the task requires.
- If you touch a phase listed in [`spec.md` §12](./spec.md#12-build-sequence), keep its checkbox in the [README Build status list](../README.md#build-status) current.
