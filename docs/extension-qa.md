# Browser extension QA checklist

Run `deno task prepare`, `deno task test`, and the relevant WXT build before
manual testing. Chrome/Edge use `dist/chrome-mv3`; Firefox uses
`dist/firefox-mv3`.

## Install and sign in

1. Install the unpacked build and open Options.
2. Confirm production builds identify the production backend and development
   builds identify `http://localhost:8787`.
3. Click **Sign in with Google** and approve the backend host permission.
4. Complete OAuth in the opened tab. Options should update without reload and
   show the signed-in account.
5. Sign out and confirm Options, popup, and side panel all update without reload.
6. Repeat once after allowing the service worker to suspend; the OAuth callback
   must still be accepted only for the newly initiated tab/state.

## Popup and Picker

1. On a non-Docs tab, verify the popup asks for a Google Doc.
2. On an untracked Doc, verify **Add to Margin** opens the backend-hosted Picker.
3. Cancel Picker and verify no project is created.
4. Pick the active Doc, return to it, and verify the popup shows tracked state.
5. Run **Sync now** and verify success plus a refreshed timestamp/count.
6. Expand Diagnostics and verify health status is delivered through the service
   worker rather than a direct page fetch.

## Side panel and toolbar

1. On a tracked Doc, click the toolbar icon to open the native side panel.
2. Click again to close it; repeat after service-worker suspension.
3. In a browser without usable native side-panel support, verify the detached
   window opens the originating project and a second click closes it.
4. Switch active Docs tabs and windows. The panel should follow only the active
   context and should not abandon an explicitly opened diff/comments/settings
   view because a background tab completed loading.
5. Refresh the dashboard, open a child view, close it, and verify refreshed data
   remains visible.

## Projects, versions, and comments

1. Rename a project and verify the Google Doc title is unchanged.
2. Create a snapshot and open its Drive document.
3. Open a structural diff between parent and child.
4. Sync a version and verify errors are surfaced rather than becoming unhandled
   promise rejections.
5. Exercise comment actions and confirm owner scoping with a second account.
6. Delete a disposable project and verify the Google Docs remain intact.

## Reviews and notifications

1. Request review from a test address and verify only delivery/share status is
   shown in the requester UI—never the redeemable review URL.
2. Verify the email contains the action URLs and that GET shows confirmation
   while POST performs the selected state change.
3. Trigger notification events, mark one and all as read, and verify a failed
   background refresh does not blank the existing list or badge.

## Cross-browser checks

- Chrome and Edge: `sidePanel`, external-message OAuth delivery, toolbar toggle.
- Firefox: MV3 sidebar, fragment OAuth fallback, temporary add-on reload.
- A Chromium derivative without working native side-panel support: detached
  window focus, context handoff, and close behavior.
