/**
 * router.tsx — TanStack Router factory, wiring up the file-based
 * `routeTree.gen.ts` (auto-generated from `@/src/routes/`).
 *
 * `getRouter()` is called once per request/app instance to create a
 * fresh router (required for SSR — routers must not be shared across
 * requests).
 *
 * Called by: TanStack Start's client/server entry points.
 */
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
