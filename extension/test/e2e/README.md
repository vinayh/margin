# Extension end-to-end smoke test

The E2E rig uses `chrome-devtools-mcp` from the repository's `.mcp.json` and a
persistent, gitignored Chrome profile at `.margin-test-chrome/`. The profile may
be pre-authenticated to a dedicated Google test account; do not put session or
API tokens in this directory or in documentation.

## Prepare

1. Start the local backend from `backend/` with the required `.env` values and
   confirm `http://localhost:8787/healthz` responds.
2. From `extension/`, run `deno task prepare`, `deno task test`, and
   `deno task build:local` so the unpacked manifest includes localhost.
3. Start the configured `chrome-devtools-mcp` server. Its `--categoryExtensions`
   flag is required for extension installation tools.
4. Install `extension/dist/chrome-mv3-dev` with the MCP extension-install
   command. Chromium launched through Puppeteer ignores `--load-extension`, so
   do not substitute that flag.

## Authenticate

Open the extension Options page and click **Sign in with Google**. This real
user gesture is required for Chrome to grant the localhost host permission. The
service worker opens the OAuth tab, binds the callback to a short-lived client
state and tab ID, and stores the resulting Better Auth session token itself. Do
not seed or inspect the token from popup/page context.

## Smoke path

1. Open a Google Doc accessible to the test account.
2. Open the Margin popup and verify the untracked state.
3. Click **Add to Margin**, choose the document in the backend-hosted Picker,
   and return to the Doc.
4. Reopen Margin and verify tracked state, project title, and **Sync now**.
5. Open the side panel and exercise project refresh, snapshot creation, diff,
   comments, review-request delivery status, notifications, and settings.
6. Click the toolbar icon twice in native-sidebar and detached-window modes to
   verify open/close behavior. In detached mode, confirm the originating Doc is
   selected rather than the extension window itself.
7. Sign out from Options and verify popup and side panel return to signed-out
   state without a reload.

Live Google tests create Drive files. Use a dedicated account and clean them up
manually after the run.
