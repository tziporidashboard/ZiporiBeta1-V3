// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NitroConfig } from "nitro/types";

// Vercel sets the `VERCEL` env var during every build it runs. We use this
// to pick the correct Nitro preset automatically instead of hard-pinning
// "cloudflare-pages" (which previously caused 404s on Vercel: that preset
// emits a Cloudflare Worker bundle — `_worker.js`, `_routes.json`,
// `nitro.json` — with NO index.html anywhere, which Vercel cannot execute
// or serve as static files).
const isVercel = !!process.env.VERCEL;

// Keep rollback files in the repository while shipping only reviewed web assets.
const publicAssets = new URL("./dashboard-public/", import.meta.url);
const publicCsv = "zipori-observations-2026-11-20.csv";
const metadataFile = "zipori-observation-metadata-2026-11-20.json";
const approvedFiles = new Set(["favicon.ico", "monitoring-areas.geojson", publicCsv, metadataFile]);
const files = readdirSync(publicAssets);
if (files.length !== approvedFiles.size || files.some((file) => !approvedFiles.has(file))) {
  throw new Error("Unexpected files in the reviewed dashboard assets directory");
}
const metadata = JSON.parse(readFileSync(new URL(metadataFile, publicAssets), "utf8"));
const csvHash = createHash("sha256")
  .update(readFileSync(new URL(publicCsv, publicAssets)))
  .digest("hex");
if (csvHash !== metadata.csvSha256 || csvHash === metadata.approvedSha256) {
  throw new Error("The dashboard CSV must be the reviewed public projection");
}

const nitroBuild = {
  ...(isVercel ? { preset: "vercel" } : { preset: "cloudflare-pages", output: { dir: "dist" } }),
  publicAssets: [
    // Nitro discovers this directory independently of Vite's publicDir.
    { dir: "public", ignore: ["**/*"], maxAge: 0 },
    { dir: "dashboard-public", maxAge: 0 },
  ],
} satisfies NitroConfig;

export default defineConfig({
  vite: {
    publicDir: "dashboard-public",
    server: {
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "**/public/**",
          "**/data-archive/**",
          "**/.vercel/**",
          "**/.wrangler/**",
          fileURLToPath(new URL("./dist/", import.meta.url)).replaceAll("\\", "/") + "**",
          "**/zipori_shalom_2026-11-20_final.csv",
        ],
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Build for Cloudflare Pages by default; auto-switch to the Vercel
  // preset when building on Vercel (produces .vercel/output, Vercel's
  // native Build Output API format, instead of a Cloudflare Worker).
  nitro: nitroBuild,
});
