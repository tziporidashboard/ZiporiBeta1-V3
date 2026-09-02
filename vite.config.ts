// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Vercel sets the `VERCEL` env var during every build it runs. We use this
// to pick the correct Nitro preset automatically instead of hard-pinning
// "cloudflare-pages" (which previously caused 404s on Vercel: that preset
// emits a Cloudflare Worker bundle — `_worker.js`, `_routes.json`,
// `nitro.json` — with NO index.html anywhere, which Vercel cannot execute
// or serve as static files).
const isVercel = !!process.env.VERCEL;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Build for Cloudflare Pages by default; auto-switch to the Vercel
  // preset when building on Vercel (produces .vercel/output, Vercel's
  // native Build Output API format, instead of a Cloudflare Worker).
  nitro: isVercel
    ? { preset: "vercel" }
    : {
        preset: "cloudflare-pages",
        output: {
          dir: "dist",
        },
      },
});
