# Setup

Local development setup for Margin. For deployment to Fly.io see [`deployment.md`](./deployment.md). For CI / integration-test secrets see [`testing.md`](./testing.md).

## Install + configure

1. **Install:**

   ```sh
   deno install --frozen
   ```

   This populates `node_modules/` (via `nodeModulesDir: "auto"` in `deno.jsonc`) for both the Deno backend and the npm-based extension/site builds. No separate `npm install` needed.

2. **Create a Google Cloud OAuth client.** In [console.cloud.google.com](https://console.cloud.google.com), create a project, enable the **Google Drive API**, **Google Docs API**, and **Google Picker API**, then create an OAuth 2.0 client (type: web application). Add `http://localhost:8787/api/auth/callback/google` as an authorized redirect URI (Better Auth's default callback path).

3. **Create a Picker API key.** In the same GCP project: APIs & Services → Credentials → "Create credentials" → API key. Restrict it to the Picker API. Note the GCP project number (Cloud Console → "Project info" → "Project number", *not* the project ID).

4. **Generate two independent 32-byte base64 secrets.** One for envelope encryption of Google refresh tokens at rest, one for Better Auth (cookie HMAC + OAuth-state encryption). Run the one-liner twice:

   ```sh
   deno eval 'console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))'
   ```

5. **Create `.env`** by copying `.env.example` and filling in:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_API_KEY=...                    # picker developer key (step 3)
   GOOGLE_PROJECT_NUMBER=...             # numeric project number (step 3)
   MARGIN_MASTER_KEY=<first base64 from step 4>
   BETTER_AUTH_SECRET=<second base64 from step 4>
   MARGIN_DB_PATH=./margin.db
   ```

   Deno tasks don't auto-load `.env` by default; run them under your shell's env (`set -a; source .env; set +a`) or pass `--env-file=.env` if you wire it into a task. The Picker vars are only required for the extension's "add doc" flow. The rest of the server works without them.

6. **Apply migrations:**

   ```sh
   deno task migrate
   ```

## CLI

Run any subcommand with `deno task margin <subcommand>`. Extra args after the task name pass through to the underlying CLI. The `--user <email>` flag selects which connected account acts as the doc owner; if omitted, the first user in the DB is used.

**Docs**

```
deno task margin doc create [--title <t>] [--seed]              create a fresh Docs API doc
deno task margin smoke <doc-url>                                getFile + copyFile + listComments
deno task margin inspect <doc-url>                              dump raw Drive/Docs API responses
```

Sign-in happens in the browser extension (Options → "Sign in with Google"), not on the CLI. Better Auth handles the OAuth dance and stores the envelope-encrypted refresh token in `account.refresh_token`.

**Projects, versions, comments**

```
deno task margin project create <doc-url> [--user <email>]      register a doc as a project
deno task margin project list
deno task margin version create <project-id> [--label v1]       snapshot the parent into a new version
deno task margin version list <project-id>
deno task margin comments ingest <version-id>                   pull Drive comments into the canonical store
deno task margin comments list <project-id>
deno task margin reanchor <target-version-id>                   project canonical comments onto a version
```

**Overlays & derivatives**

```
deno task margin overlay create <project-id> --name <name>      register a new overlay
deno task margin overlay list <project-id>
deno task margin overlay add-op <overlay-id> --type ...         append an op (redact|replace|insert|append)
deno task margin overlay ops <overlay-id>
deno task margin overlay apply <overlay-id> --version <id>      copy + apply overlay → derivative doc
deno task margin derivative list <project-id>
```

**Watcher (Drive push notifications)**

```
deno task margin watcher subscribe <version-id> --address ...   subscribe drive.files.watch on a version
deno task margin watcher list
deno task margin watcher unsubscribe <channel-row-id>
deno task margin watcher renew                                  renew channels nearing expiration
deno task margin watcher poll                                   polling fallback: re-ingest active versions
deno task margin watcher simulate <channel-id> [--state ...]    exercise the push handler locally
```

**Server**

```
deno task serve [--port <n>]                                    start the HTTP API (Deno.serve)
```

## Validate the backend end-to-end

After the steps above, connect a real Google account and exercise the full backend stack:

```sh
# 1. Build and load the browser extension (see "Test the browser extension"
#    below), then click "Sign in with Google" on its Options page. Better
#    Auth handles the OAuth dance and stores the envelope-encrypted refresh
#    token in `account.refresh_token`.

# 2. Create a fresh doc to test against.
#    drive.file access is granted automatically because the OAuth client created the file.
#    For pre-existing docs you own, use the Drive Picker entry; see "Track an
#    existing doc via the Drive Picker" below.
deno task margin doc create --seed
# -> created doc <doc-id>
#    url: https://docs.google.com/document/d/<doc-id>/edit
# Open the URL and add a few comments by highlighting text and clicking "Comment".

# 3. Sanity-check the Drive/Docs wrappers.
deno task margin smoke '<url-from-step-2>'

# 4. Register the doc as a project, then snapshot it into v1.
deno task margin project create '<url-from-step-2>'
deno task margin project list                # copy the project id
deno task margin version create <project-id>
deno task margin version list <project-id>   # copy the version id

# 5. Ingest Drive comments on that version into the canonical store.
deno task margin comments ingest <version-id>
deno task margin comments list <project-id>
```

`version create` copies the parent doc via Drive, names the copy `[Margin vN] <original>`, and stores a SHA-256 hash of the copy's plaintext as the snapshot fingerprint. `comments ingest` pulls Drive comments + replies, computes a canonical anchor (quoted text + paragraph hash + structural offset) against the version's doc, and is idempotent on re-run.

## Track an existing doc via the Drive Picker

The Picker is the only mechanism that grants `drive.file` access to a doc the OAuth client didn't create ([`spec.md` §9.2](./spec.md#92-drivefile-scope)). Open any Google Doc, click the Margin toolbar icon, click **Add to Margin**. The backend-hosted Picker (`/api/picker/page`) opens in a new tab. Pick the doc; the page POSTs to `/api/picker/register-doc` and auto-closes. Works on Chromium and Firefox.

## Test the browser extension

The MV3 extension lives in [`surfaces/extension/`](../surfaces/extension/). Build, load, configure, and sign-in steps are in its [README](../surfaces/extension/README.md). End-to-end smoke test after that:

1. Start the backend: `deno task serve` (defaults to `http://localhost:8787`).
2. Open a Google Doc, click the toolbar icon, click **Add to Margin**. The Picker tab opens; pick the doc and the page registers it as a project.
3. `deno task margin comments list <project-id>` shows ingested comments after the first webhook fires (or `deno task margin watcher poll` to force-pull).

For the manual test checklist covering popup states, toolbar routing, review flow, CORS, and cross-browser, see [`extension-qa.md`](./extension-qa.md).
