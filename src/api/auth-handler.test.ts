import { beforeEach, describe, expect, test } from "bun:test";
import {
  _resetExtNoncesForTests,
  handleAuthExtLaunchTab,
  handleAuthExtSuccess,
} from "./auth-handler.tsx";
import { cleanDb, seedUser } from "../../test/db.ts";
import { issueTestSession } from "../../test/session.ts";

beforeEach(() => {
  cleanDb();
  _resetExtNoncesForTests();
});

const EXT_ID_OK = "a".repeat(32); // 32 lowercase a-p chars = valid Chrome ext id

describe("handleAuthExtLaunchTab", () => {
  test("missing ext param → 400", async () => {
    const req = new Request("http://localhost/api/auth/ext/launch-tab");
    const res = await handleAuthExtLaunchTab(req);
    expect(res.status).toBe(400);
  });

  test("rejects ext ids that don't match Chrome or Firefox shapes", async () => {
    const req = new Request(
      `http://localhost/api/auth/ext/launch-tab?ext=${encodeURIComponent("not-a-real-id")}`,
    );
    const res = await handleAuthExtLaunchTab(req);
    expect(res.status).toBe(400);
  });

  test("rejects ext ids with characters outside the a-p Chrome alphabet", async () => {
    const bad = `${"a".repeat(31)}z`;
    const req = new Request(
      `http://localhost/api/auth/ext/launch-tab?ext=${encodeURIComponent(bad)}`,
    );
    const res = await handleAuthExtLaunchTab(req);
    expect(res.status).toBe(400);
  });
});

// Test-only nonce mint that mirrors the production /launch-tab path without
// running Better Auth's social-sign-in (which we'd otherwise need to stub).
async function mintNonceForTest(ext: string): Promise<string> {
  const mod = await import("./auth-handler.tsx");
  return mod.__test_mintExtNonce(ext);
}

describe("handleAuthExtSuccess", () => {
  test("missing nonce → 400", async () => {
    const req = new Request("http://localhost/api/auth/ext/success");
    const res = await handleAuthExtSuccess(req);
    expect(res.status).toBe(400);
  });

  test("unknown nonce → 400", async () => {
    const req = new Request(
      `http://localhost/api/auth/ext/success?nonce=${encodeURIComponent("not-a-real-nonce")}`,
    );
    const res = await handleAuthExtSuccess(req);
    expect(res.status).toBe(400);
  });

  test("nonce is single-use: second consume → 400", async () => {
    const u = await seedUser();
    const { token } = await issueTestSession({ userId: u.id });
    const nonce = await mintNonceForTest(EXT_ID_OK);
    const headers = { authorization: `Bearer ${token}` };
    const req1 = new Request(
      `http://localhost/api/auth/ext/success?nonce=${encodeURIComponent(nonce)}`,
      { headers },
    );
    const res1 = await handleAuthExtSuccess(req1);
    expect(res1.status).toBe(200);
    const req2 = new Request(
      `http://localhost/api/auth/ext/success?nonce=${encodeURIComponent(nonce)}`,
      { headers },
    );
    const res2 = await handleAuthExtSuccess(req2);
    expect(res2.status).toBe(400);
  });

  test("no session cookie → 401 (after nonce consumed)", async () => {
    const nonce = await mintNonceForTest(EXT_ID_OK);
    const req = new Request(
      `http://localhost/api/auth/ext/success?nonce=${encodeURIComponent(nonce)}`,
    );
    const res = await handleAuthExtSuccess(req);
    expect(res.status).toBe(401);
  });

  test("renders both the sendMessage bridge and the fragment fallback", async () => {
    const u = await seedUser();
    const { token } = await issueTestSession({ userId: u.id });
    const nonce = await mintNonceForTest(EXT_ID_OK);
    const req = new Request(
      `http://localhost/api/auth/ext/success?nonce=${encodeURIComponent(nonce)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const res = await handleAuthExtSuccess(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).toContain("frame-ancestors 'none'");

    const html = await res.text();
    // Inline JSON-encoded values, so look for the JSON.stringify shape.
    expect(html).toContain(`"${token}"`);
    expect(html).toContain(`"${EXT_ID_OK}"`);
    expect(html).toContain("chrome.runtime.sendMessage");
    expect(html).toContain("'auth/token'");
    expect(html).toContain("location.hash");
    expect(html).toContain("token=");
  });
});
