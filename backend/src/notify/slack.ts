import { config } from "../config.ts";

export interface SlackMessage {
  /**
   * Optional channel override. Webhooks typically post to a single channel
   * configured at webhook-creation time, so passing a channel here only
   * takes effect with a workspace-token webhook or the chat.postMessage
   * route. Kept on the message shape for forward-compat — current
   * `WebhookSlackTransport` ignores it.
   */
  channel?: string;
  text: string;
}

export interface SlackTransport {
  send(msg: SlackMessage): Promise<void>;
}

/**
 * Default Slack transport: an incoming-webhook POST. Single-channel scope is
 * configured at webhook-creation time in the Slack admin; the transport just
 * relays the text payload.
 *
 * The Phase-5 Slack bot will replace this with a bot-token transport that
 * supports per-channel routing + slash-command dispatch, but the
 * `SlackTransport` interface stays the same so callers don't change.
 */
export class WebhookSlackTransport implements SlackTransport {
  constructor(private readonly webhookUrl: string) {}

  async send(msg: SlackMessage): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: msg.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      throw new Error(`slack: ${res.status} ${body}`);
    }
  }
}

/** No-op transport used when no webhook is configured. Logs the would-have-sent
 * payload so operators can confirm wiring without leaking to a real workspace. */
export class LogSlackTransport implements SlackTransport {
  async send(msg: SlackMessage): Promise<void> {
    console.log(`[slack/log] ${msg.channel ?? "(default channel)"}: ${msg.text}`);
  }
}

let testOverride: SlackTransport | null = null;

/**
 * Resolve the active transport from env on each call (config getters are
 * lazy + tests may mutate Deno.env between cases). `_setSlackTransportForTests`
 * takes precedence so tests don't need to set env at all.
 */
export function getSlackTransport(): SlackTransport {
  if (testOverride) return testOverride;
  const url = config.slack.webhookUrl;
  if (url) return new WebhookSlackTransport(url);
  return new LogSlackTransport();
}

export function _setSlackTransportForTests(t: SlackTransport | null): void {
  testOverride = t;
}
