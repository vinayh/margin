# Margin browser extension

MV3 extension for Chrome / Edge / Firefox. Two surfaces:

- **Popup.** State machine driven by the active Docs tab: configure backend,
  sign in, open a Doc, _Add to Margin_ (opens the backend-hosted Drive Picker in
  a new tab), tracked view with role / version / comment count / last-synced /
  _Sync now_. All backend calls flow through the service worker; the session
  token never touches the popup.
- **Side panel.** Preact app: project dashboard (versions, derivatives, review
  history, reviewer participation), structured side-by-side version diff,
  comment reconciliation view.

Comment ingest is not an extension concern; it lives in the backend (`.docx`
export,
[`docs/spec.md` §9.8](../../docs/spec.md#98-docx-export-is-the-canonical-ingest-source)).

## Build

[WXT](https://wxt.dev) drives the build (Vite under the hood). The extension
uses Deno as the package manager + task runner; WXT itself runs under Node (via
the `#!/usr/bin/env node` shebang on `node_modules/.bin/wxt`). `package.json` +
`deno.json` + `deno.lock` live here; root scripts don't drive it.

```sh
cd extension
deno install                   # first time / after package.json bumps
deno task build                # production build, Chrome/Edge target
deno task build:firefox        # production build, Firefox target
deno task dev                  # dev server with HMR (Chrome/Edge)
deno task dev:firefox          # dev server with HMR (Firefox)
deno task zip                  # bundle dist/<target>/ into a publishable .zip
deno task test                 # unit tests (node --test)
```

Outputs to `extension/dist/{chrome-mv3,firefox-mv3}/`. Each output directory is
loadable directly:

- **Chrome / Edge:** `chrome://extensions` → enable Developer Mode → Load
  unpacked → pick `dist/chrome-mv3`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
  pick any file inside `dist/firefox-mv3` (e.g. `manifest.json`).

## Configure

1. Open the extension's Options page. Enter the **Backend URL**
   (`http://localhost:8787` for local dev, or your Fly.io app URL in
   production), click **Test connection** to confirm `/healthz` responds (Chrome
   will prompt for the backend origin; approve it), then **Save backend URL**.
2. Click **Sign in with Google**. The Options page opens a top-level tab at
   `/api/auth/ext/launch-tab`. Better Auth runs the Google consent flow, lands
   on the `/api/auth/ext/success` bridge page, and the bridge hands the session
   token to the SW (Chromium: `chrome.runtime.sendMessage`; Firefox fallback:
   `location.hash`, picked up by the SW's `tabs.onUpdated` listener). The SW
   persists it under `chrome.storage.local.settings.sessionToken`; the Options
   page's `chrome.storage.onChanged` listener flips the UI to "Signed in"
   without a reload.

## Popup project surface

The popup (`entrypoints/popup/Popup.tsx`) is a Preact state machine over a
single `View` discriminated union. `boot()` drives the transitions:

1. **No settings** → options page nudge.
2. **No Doc tab** → muted "open a Google Doc."
3. Active Docs tab → SW `doc/state` (`POST /api/extension/doc-state`).
4. **Untracked** → "Add to Margin" opens `${backendUrl}/api/picker/page` in a
   new tab; the popup closes. The user picks a Doc; the page POSTs to
   `/api/picker/register-doc` via the session cookie and auto-closes.
5. User returns to the Docs tab and re-opens the extension → fresh `doc/state`
   call lands in the **Tracked** view. "Sync now" calls SW `doc/sync`
   (`POST /api/extension/doc-sync`), which re-runs `ingestVersionComments` and
   returns refreshed state.

Every backend call routes through the SW, which adds
`Authorization: Bearer <sessionToken>` from `chrome.storage.local`. The Picker
page uses the session cookie set by Better Auth on sign-in (same-origin with
`/api/picker/register-doc`), so no bearer token leaves the extension surface.

## Toolbar-icon routing

For Doc tabs that already belong to a project, clicking the toolbar icon opens
the **side panel** directly instead of the popup. The SW watches
`tabs.onActivated` / `tabs.onUpdated`, calls `doc/state` (cached briefly per
`docId`), and toggles the per-tab popup: `action.setPopup({ tabId, popup: "" })`
for tracked Docs (so `action.onClicked` fires), `popup: "popup.html"` for
everything else. The cache is invalidated on settings change (sign-in /
sign-out) and on `doc/sync` / `doc/register` flips.

"Dashboard" resolves at click time via `utils/ui-surfaces.ts`. The policy is
conservative: the native sidebar (Chromium `chrome.sidePanel` / Firefox
`sidebar_action`) is used only when we're confident the host browser actually
renders it. Everywhere else (Edge, Brave, Opera, Arc, the long tail of Chromium
derivatives) `openDashboard` opens a detached popup window loading
`sidepanel.html`. Repeat icon clicks focus the existing popup window rather than
stacking duplicates.

`runtime.onInstalled` opens the Options page in a new tab on first install so
users on browsers without a working `runtime.openOptionsPage()` (Arc) can still
reach setup. All "Open Options" buttons in the UI also go through
`tabs.create({ url: getURL("options.html") })` for the same reason.

### Browser detection (`utils/browser-detect.ts`)

`detectNativeSidebarSupport()` is the source of truth:

- Firefox (UA string `Firefox/<n>`): true.
- Real Google Chrome (`userAgentData.brands` includes `Google Chrome`, with no
  Brave / Edge / Opera UA markers and, if a DOM is available, no Arc
  `--arc-palette-*` CSS custom properties): true.
- Everything else: false. The detached window is used.

The SW can only run the UA half of the probe (no DOM, so no Arc CSS-vars check).
Extension-page entrypoints (`entrypoints/popup/main.tsx`,
`entrypoints/options/main.ts`) call `detectAndPersistBrowserQuirks()` on load,
which runs the full probe and writes the boolean to
`chrome.storage.local.browserQuirks`. The SW's `storage.onChanged` listener
picks the value up and reprimes `cachedUseNativeSidebar`.

## Manifest permissions

Static `host_permissions: ["https://docs.google.com/*"]`: the extension never
injects into the Docs tab, but the grant is what lets `tabs.query({url: ...})`
return the active Doc's URL + title (Chrome strips both on Doc pages otherwise).
User-configured backend origins stay on
`optional_host_permissions: ["<all_urls>"]` and are requested at sign-in time
inside a user gesture.

## Doc title

Tracked docs use `DocState.title` from `/api/extension/doc-state`, which is the
canonical Drive name (`files.get` result, stored on `project.name` /
`version.name` at register / create time). Untracked docs fall back to
`cleanDocTitleFallback(tab.title)` in `utils/ids.ts`: a locale-agnostic strip
that drops the trailing `- <suffix>` only when the suffix contains the literal
word "Google" (the brand is never localized).

## Layout

```
extension/
  wxt.config.ts             one config, per-browser manifest via (env) callback
  tsconfig.json             extends .wxt/tsconfig.json + DOM + WebWorker libs
  entrypoints/
    background.ts           defineBackground: message router + auth/token bridge listener
    options/                backend URL form + Sign-in / Sign-out controls (plain TS)
    popup/                  Preact state machine over View discriminated union
    sidepanel/              Preact rich UI: dashboard, diff, reconciliation
  ui/                       shared Preact components (Header, project-row, sendMessage)
  utils/                    ids, messages, storage, types, browser-detect
  public/icons/             placeholder artwork; replace before publish
  dist/                     build output, gitignored
  .wxt/                     generated types (wxt prepare), gitignored
```
