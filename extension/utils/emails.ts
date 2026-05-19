/**
 * Split a user-typed reviewer-emails textarea into a trimmed, de-empty list.
 * Used by the Settings view (one-per-line input) and the Dashboard's
 * Request-review inline form (comma/semicolon input). Permissive on
 * delimiter so either UX maps to the same parse — backend re-validates
 * email syntax with valibot, this is just the split.
 */
export function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;\s\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Pragmatic email regex (single @, dotted domain). Backend re-validates with
// valibot — this just catches obvious typos before the round-trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s);
}

export interface EmailValidationResult {
  valid: string[];
  invalid: string[];
}

/** Same split as parseEmails, but partitions valid vs invalid entries. */
export function validateEmails(raw: string): EmailValidationResult {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const entry of parseEmails(raw)) {
    if (isValidEmail(entry)) valid.push(entry);
    else invalid.push(entry);
  }
  return { valid, invalid };
}
