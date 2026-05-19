import { db } from "./client.ts";
import { auditLog } from "./schema.ts";

export interface AuditEntry {
  actorUserId: string;
  // Dotted form: `<targetType>.<verb>` — `targetType` is derived from the
  // prefix so callers don't have to keep both fields in sync.
  action: string;
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.action.split(".")[0]!,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
  });
}
