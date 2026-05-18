import { afterEach, describe, expect, test } from "bun:test";
import { setFetch } from "../../test/fetch.ts";
import {
  LogSlackTransport,
  WebhookSlackTransport,
  _setSlackTransportForTests,
  getSlackTransport,
} from "./slack.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  _setSlackTransportForTests(null);
  delete (Bun.env as Record<string, string | undefined>).MARGIN_SLACK_WEBHOOK_URL;
});

describe("WebhookSlackTransport", () => {
  test("POSTs JSON {text} to the webhook URL", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    setFetch(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response("ok", { status: 200 });
    });

    const t = new WebhookSlackTransport("https://hooks.slack.com/services/AAA/BBB/CCC");
    await t.send({ text: "review requested on v2" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://hooks.slack.com/services/AAA/BBB/CCC",
    );
    expect(calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toEqual({ text: "review requested on v2" });
  });

  test("rejects with status + body on non-2xx", async () => {
    setFetch(async () => new Response("invalid_payload", { status: 400 }));
    const t = new WebhookSlackTransport("https://hooks.slack.com/services/X/Y/Z");
    await expect(t.send({ text: "hi" })).rejects.toThrow(/slack: 400 invalid_payload/);
  });
});

describe("getSlackTransport", () => {
  test("defaults to LogSlackTransport when MARGIN_SLACK_WEBHOOK_URL is unset", () => {
    const t = getSlackTransport();
    expect(t).toBeInstanceOf(LogSlackTransport);
  });

  test("returns WebhookSlackTransport when MARGIN_SLACK_WEBHOOK_URL is set", () => {
    Bun.env.MARGIN_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/A/B/C";
    const t = getSlackTransport();
    expect(t).toBeInstanceOf(WebhookSlackTransport);
  });

  test("respects _setSlackTransportForTests override", () => {
    const stub: { send: (m: unknown) => Promise<void> } = { send: async () => {} };
    _setSlackTransportForTests(stub);
    expect(getSlackTransport()).toBe(stub);
  });
});
