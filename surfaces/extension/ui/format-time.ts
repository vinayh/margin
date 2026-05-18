// Time-format helpers shared across the popup, side panel, and options
// surfaces. Keep here so the wording ("never", "just now", "5m ago") and the
// rounding stay identical wherever timestamps land in the UI.

/**
 * Relative time string for a millisecond timestamp.
 *   null → "never"
 *   future → "just now"
 *   < 1 minute → "Ns ago"
 *   < 1 hour → "Nm ago"
 *   < 1 day → "Nh ago"
 *   else → "Nd ago"
 */
export function formatRelative(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
