import { Layout } from "./Layout.tsx";
import type { ReviewActionKind } from "../../db/schema.ts";

export interface ChooserAction {
  kind: ReviewActionKind;
  label: string;
}

export interface ReviewActionChooserPageProps {
  token: string;
  /** When set, the user navigated with an unrecognized `?action=` param. */
  rejectedAction?: string;
  actions: readonly ChooserAction[];
}

/**
 * Each action is submitted as a POST form, not a GET link. Email link
 * checkers and antivirus scanners pre-fetch via GET; converting the
 * state-changing step to POST means the action only fires on a human click.
 */
export function ReviewActionChooserPage(props: ReviewActionChooserPageProps) {
  const encodedToken = encodeURIComponent(props.token);
  return (
    <Layout title="Margin — choose a review action">
      <h1 class="font-display text-3xl leading-tight tracking-tight">Choose a review action</h1>
      {props.rejectedAction !== undefined
        ? (
          <p class="mt-4 text-ink-2">
            The <code class="font-mono text-sm">action</code> query parameter{" "}
            <code class="font-mono text-sm">{props.rejectedAction}</code>{" "}
            isn't a recognized review action. Pick one below:
          </p>
        )
        : (
          <p class="mt-4 text-ink-2">
            Pick the action you'd like to record. You can change your response later by re-clicking
            a different link.
          </p>
        )}
      <ul class="mt-6 space-y-2">
        {props.actions.map(({ kind, label }) => (
          <li>
            <form method="POST" action={`/r/${encodedToken}`}>
              <input type="hidden" name="action" value={kind} />
              <button
                type="submit"
                class="bg-transparent border-0 p-0 cursor-pointer underline decoration-accent decoration-2 underline-offset-4 hover:decoration-ink text-ink font-sans text-base"
              >
                {label}
              </button>
            </form>
          </li>
        ))}
      </ul>
      <p class="mt-10 pt-4 border-t border-rule text-xs text-muted">
        Margin · review action handler
      </p>
    </Layout>
  );
}
