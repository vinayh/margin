import { Layout } from "./Layout.tsx";
import type { ReviewActionKind } from "../../db/schema.ts";

export interface ReviewActionConfirmPageProps {
  token: string;
  action: ReviewActionKind;
  label: string;
}

/**
 * Confirm-before-mutate page rendered on `GET /r/<token>?action=<kind>`.
 * The state change only happens when the reviewer submits the form (POST).
 * Email link-checkers + antivirus pre-fetchers issue GETs only, so they
 * stop on this page instead of recording a response on the reviewer's
 * behalf.
 */
export function ReviewActionConfirmPage(props: ReviewActionConfirmPageProps) {
  const encodedToken = encodeURIComponent(props.token);
  return (
    <Layout title={`Margin — ${props.label.toLowerCase()}`}>
      <h1 class="font-display text-3xl leading-tight tracking-tight">{props.label}</h1>
      <p class="mt-4 text-ink-2">
        Click the button to record this response. You can change it later by re-clicking a different
        link from the original email.
      </p>
      <form method="POST" action={`/r/${encodedToken}`} class="mt-6">
        <input type="hidden" name="action" value={props.action} />
        <button
          type="submit"
          class="px-4 py-2 border border-rule rounded bg-cream-2 hover:bg-cream cursor-pointer text-ink font-sans"
        >
          Confirm — {props.label}
        </button>
      </form>
      <p class="mt-10 pt-4 border-t border-rule text-xs text-muted">
        Margin · review action handler
      </p>
    </Layout>
  );
}
