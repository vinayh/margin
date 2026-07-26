# Deployment (Fly.io)

The repo deploys as a single-region Fly.io app (see `backend/Dockerfile` +
`backend/fly.toml`). The multi-stage Deno-on-Alpine image runs the Tailwind CLI
through Deno's npm compatibility layer and exposes `/healthz`. Postgres lives
off-platform (Neon or any Postgres-compatible provider) — `DATABASE_URL`
(pooled, used by the app) and `DATABASE_URL_DIRECT` (unpooled, used by the
migrator at boot) are Fly secrets; no volume needed. When
`MARGIN_PUBLIC_BASE_URL` is set (it is, in `fly.toml`), the running server also
auto-subscribes a Drive `files.watch` channel on every new version and runs the
renew (~30 min) + polling (~10 min) loops in-process; no separate cron container
needed.

**Build context note.** `flyctl deploy --config backend/fly.toml` runs from the
repo root, so the Docker build context is the repo root. This lets the styles
stage in `backend/Dockerfile` pull `shared/tokens.css` alongside `backend/src`
without symlinks or duplication.

## Initial setup (once per deployment)

1. `flyctl apps create <your-app-name>` (names are global on Fly).
2. Provision a Postgres database with a provider (e.g. Neon: create a project,
   then grab the pooled connection string ending in
   `-pooler.<region>.aws.neon.tech` and the direct one without `-pooler`). Pick
   a region close to your Fly primary region.
3. Edit `backend/fly.toml`: set `app` and `primary_region` to match.
4. In Google Cloud Console, create a _separate_ OAuth client for production
   (don't reuse the local one) and add
   `https://<your-public-host>/api/auth/callback/google` to its authorized
   redirect URIs (Margin's own deployment runs at `https://api.margin.pub`).
   Create a Picker API key in the same project (restrict to Picker API) and note
   the project number.
5. Update `backend/fly.toml`'s `MARGIN_PUBLIC_BASE_URL` to match your app
   hostname.
6. Set the Fly secrets. The master-key generator is piped inline so the value
   never appears in your terminal:

   ```sh
   cd backend
   flyctl secrets set --app <your-app-name> \
     GOOGLE_CLIENT_ID='<prod-client-id>' \
     GOOGLE_CLIENT_SECRET='<prod-client-secret>' \
     GOOGLE_API_KEY='<picker-api-key>' \
     GOOGLE_PROJECT_NUMBER='<gcp-project-number>' \
     DATABASE_URL='<pooled-postgres-url>' \
     DATABASE_URL_DIRECT='<unpooled-postgres-url>' \
     MARGIN_MASTER_KEY="$(deno eval 'console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))')" \
     BETTER_AUTH_SECRET="$(deno eval 'console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))')"
   ```

   Stash the master key in a password manager too; losing it makes existing
   encrypted refresh tokens unrecoverable. `BETTER_AUTH_SECRET` is rotatable
   (rotating it invalidates active sessions but doesn't lose data) and MUST be
   different from `MARGIN_MASTER_KEY` so that compromise of one doesn't cascade
   into the other.

7. From the repo root, `flyctl deploy --config backend/fly.toml --remote-only`
   for the first deploy.

## Auto-deploy via GitHub Actions

`.github/workflows/ci.yml` runs on every push to `main`: typecheck →
`deno task test:coverage` (with coverage upload) →
`flyctl deploy --config backend/fly.toml --remote-only`. Add the deploy token as
the `FLY_API_TOKEN` repo secret:

```sh
flyctl tokens create deploy --app <your-app-name> --expiry 8760h \
  | gh secret set FLY_API_TOKEN --repo <owner>/<repo> --body-file -
```

## Verify a deploy

```sh
curl https://<your-public-host>/healthz   # → {"ok":true}  (Margin: https://api.margin.pub/healthz)
```

For an end-to-end OAuth round-trip, use an extension build whose
`DEFAULT_BACKEND_URL` targets the deployment, then click **Sign in with Google**
in Options. Better Auth runs the consent flow and the extension surface should
flip to "Signed in".

## Operational hardening backlog

The current single-machine deployment is the supported topology. Before adding
machines or regions:

- wrap renew and polling passes in Postgres advisory locks;
- move migrations from container startup to a Fly `release_command`;
- add database `statement_timeout` and `idle_in_transaction_session_timeout`;
- split background loops into a separate process group with their own runtime
  permission profile; and
- pin and verify database TLS according to the selected provider.

Ongoing maintenance should also keep the Deno image release and GitHub Action
commit pins current, inventory Deno read/write paths before narrowing filesystem
permissions, and revisit the broad production network permission once the
database hostname is fixed.
