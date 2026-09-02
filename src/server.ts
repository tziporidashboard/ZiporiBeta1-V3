/**
 * server.ts — Cloudflare Workers / TanStack Start server entry point.
 *
 * What it does:
 *   - Lazily imports and delegates to the real
 *     `@tanstack/react-start/server-entry` handler.
 *   - `normalizeCatastrophicSsrResponse` — detects the specific case
 *     where h3 has swallowed an in-handler throw into a generic 500 JSON
 *     `{"unhandled":true,"message":"HTTPError"}` response, logs the real
 *     captured error (via `@/lib/error-capture`), and replaces it with a
 *     friendlier static HTML error page (`@/lib/error-page`).
 *   - Top-level `fetch` handler also catches any error thrown before a
 *     response is produced at all, returning the same fallback page.
 *
 * Depends on: `@tanstack/react-start/server-entry`,
 *   `@/lib/error-capture`, `@/lib/error-page`.
 */
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
