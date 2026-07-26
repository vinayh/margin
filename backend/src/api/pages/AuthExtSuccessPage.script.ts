import { inlineJson } from "../render.ts";

/**
 * Inline bridge script for `/api/auth/ext/success`. Hands the session
 * token to the extension's service worker. Chromium path:
 * `chrome.runtime.sendMessage` (gated by `externally_connectable.matches`).
 * Firefox path: `location.hash` picked up by the SW's `tabs.onUpdated`
 * listener (Firefox doesn't expose `chrome.runtime` on regular pages,
 * Bugzilla 1319168).
 *
 * `inlineJson` handles JS-string-literal escaping AND closes the
 * `</script>` / `<!--` breakout vectors that bare `JSON.stringify` leaves
 * open. Defense in depth on top of the CSP nonce.
 */
export function buildBridgeScript(extId: string, token: string, clientState: string): string {
  const extJson = inlineJson(extId);
  const tokenJson = inlineJson(token);
  const stateJson = inlineJson(clientState);
  return [
    "(function () {",
    `  var extId = ${extJson};`,
    `  var token = ${tokenJson};`,
    `  var state = ${stateJson};`,
    "  var statusEl = document.getElementById('status');",
    "  function setText(t) { if (statusEl) statusEl.textContent = t; }",
    "  function closeTab() { try { window.close(); } catch (_) {} }",
    "  var done = false;",
    "  function fallbackToFragment() {",
    "    if (done) return; done = true;",
    "    try { location.hash = 'token=' + encodeURIComponent(token) + '&state=' + encodeURIComponent(state); } catch (_) {}",
    "    setText('Signed in. You can close this tab.');",
    "  }",
    "  var hasSendMessage = (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function');",
    "  if (!hasSendMessage) { fallbackToFragment(); return; }",
    // 1.5s gives a sleeping SW time to wake; on timeout we fall through to the hash path.
    "  var timer = setTimeout(fallbackToFragment, 1500);",
    "  try {",
    "    chrome.runtime.sendMessage(extId, { kind: 'auth/token', token: token, state: state }, function (r) {",
    "      clearTimeout(timer);",
    "      if (done) return;",
    "      if (r && r.ok) { done = true; setText('Signed in. You can close this tab.'); setTimeout(closeTab, 400); }",
    "      else { fallbackToFragment(); }",
    "    });",
    "  } catch (_) { clearTimeout(timer); fallbackToFragment(); }",
    "})();",
  ].join("\n");
}
