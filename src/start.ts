/**
 * start.ts — TanStack Start app configuration (`createStart`).
 *
 * What it does:
 *   - Registers `errorMiddleware`, a server request middleware that
 *     catches unhandled errors in request handlers, re-throws framework
 *     HTTP errors (objects with `statusCode`) untouched, and otherwise
 *     logs + returns the static fallback error page
 *     (`@/lib/error-page`).
 *
 * Called by: TanStack Start's server bootstrap (referenced from the
 *   generated server entry / `@/server.ts` chain).
 */
import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [],
  requestMiddleware: [errorMiddleware],
}));
