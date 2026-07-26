import "../../test/setup.ts";
import { afterEach, describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { setFetch } from "../../test/fetch.ts";
import { UpstreamTransportError } from "../errors.ts";
import {
  _setSlackTransportForTests,
  getSlackTransport,
  LogSlackTransport,
  WebhookSlackTransport,
} from "./slack.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  _setSlackTransportForTests(null);
  Deno.env.delete("MARGIN_SLACK_WEBHOOK_URL");
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

  test("rejects without putting the response body in the message", async () => {
    setFetch(async () => new Response("invalid_payload", { status: 400 }));
    const t = new WebhookSlackTransport("https://hooks.slack.com/services/X/Y/Z");
    const err = await t.send({ text: "hi" }).catch((caught) => caught);
    expect(err).toBeInstanceOf(UpstreamTransportError);
    expect((err as Error).message).toBe("slack: 400");
    expect((err as UpstreamTransportError).body).toBe("invalid_payload");
  });
});

describe("getSlackTransport", () => {
  test("defaults to LogSlackTransport when MARGIN_SLACK_WEBHOOK_URL is unset", () => {
    const t = getSlackTransport();
    expect(t).toBeInstanceOf(LogSlackTransport);
  });

  test("returns WebhookSlackTransport when MARGIN_SLACK_WEBHOOK_URL is set", () => {
    Deno.env.set("MARGIN_SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/A/B/C");
    const t = getSlackTransport();
    expect(t).toBeInstanceOf(WebhookSlackTransport);
  });

  test("respects _setSlackTransportForTests override", () => {
    const stub: { send: (m: unknown) => Promise<void> } = { send: async () => {} };
    _setSlackTransportForTests(stub);
    expect(getSlackTransport()).toBe(stub);
  });
});
