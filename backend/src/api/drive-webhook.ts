import {
  authenticateDriveWatchChannel,
  handleAuthenticatedDriveWatchEvent,
} from "../domain/watcher.ts";

/**
 * Drive `files.watch` push receiver. Google posts an empty body with state in
 * the `X-Goog-*` headers (SPEC §8.3); we always respond 200 OK so Google
 * stops retrying — channel-level errors are logged for the operator.
 *
 * Drive retries failed pushes from multiple regions, so the same logical event
 * can arrive several times. We dedup on `(channelId, messageNumber)` using a
 * bounded in-memory set; revisits return 200 OK without re-running the ingest.
 * Falling back to non-dedup on missing header keeps us safe against a Google
 * envelope change, at the cost of one redundant ingest.
 */
const MAX_RECENT_EVENTS = 4096;
const seenEvents = new Set<string>();

function rememberEvent(key: string): boolean {
  if (seenEvents.has(key)) return false;
  seenEvents.add(key);
  // FIFO trim — `Set` iteration is insertion-ordered, so deleting the first
  // entry drops the oldest seen event.
  if (seenEvents.size > MAX_RECENT_EVENTS) {
    const oldest = seenEvents.values().next().value;
    if (oldest !== undefined) seenEvents.delete(oldest);
  }
  return true;
}

export async function handleDriveWebhook(req: Request): Promise<Response> {
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceState = req.headers.get("x-goog-resource-state") ?? undefined;
  const channelToken = req.headers.get("x-goog-channel-token") ?? undefined;
  const messageNumber = req.headers.get("x-goog-message-number") ?? undefined;

  if (!channelId) {
    return new Response("missing X-Goog-Channel-ID", { status: 400 });
  }

  try {
    const channel = await authenticateDriveWatchChannel({ channelId, channelToken });
    if (!channel) return new Response(null, { status: 200 });

    // Authenticate first: an invalid delivery must not reserve the legitimate
    // event's deduplication key and suppress its later processing.
    if (messageNumber) {
      const fresh = rememberEvent(`${channelId}:${messageNumber}`);
      if (!fresh) return new Response(null, { status: 200 });
    }

    await handleAuthenticatedDriveWatchEvent(channel, resourceState);
  } catch (err) {
    console.error(`drive webhook error for channel ${channelId}: ${err}`);
  }
  return new Response(null, { status: 200 });
}
