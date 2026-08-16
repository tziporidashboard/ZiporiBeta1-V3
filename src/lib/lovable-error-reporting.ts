/**
 * lovable-error-reporting.ts \u2014 client-side bridge to the Lovable.dev
 * error-reporting/monitoring integration (injected globally as
 * `window.__lovableEvents`).
 *
 * What it does:
 *   - `reportLovableError(error, context)` forwards a caught error (with
 *     the current pathname and any extra context) to
 *     `window.__lovableEvents.captureException`, tagged as coming from a
 *     React error boundary. No-ops on the server (`typeof window ===
 *     "undefined"`) or if the Lovable script hasn't loaded.
 *
 * Called by: the app's top-level React error boundary (see
 *   `@/src/routes/__root.tsx`).
 */
type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
  }
}

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.__lovableEvents?.captureException?.(
    error,
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...context,
    },
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );
}
