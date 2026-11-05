import assert from "node:assert/strict";
import Papa from "papaparse";
import {
  evaluate,
  functionText,
  loadPipeline,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./observation-source.mjs";

export const sync = loadProductionModule("src/lib/merlin-sync.ts");
export const store = loadProductionModule("src/lib/observations-store.tsx");
export const csv = (file) => {
  const result = Papa.parse(read(file), { header: true, skipEmptyLines: true });
  assert.deepEqual(result.errors, []);
  return result.data;
};
export const merlin = csv("public/MERLIN all observations for Zohar.csv");
export const incoming = csv(`public/${sync.MERLIN_SYNC_SOURCE.file_name}`);
export const pipeline = loadPipeline(read("src/lib/observations-store.tsx"));
export const historical = loadProductionModule(
  "src/lib/inaturalist-additions.ts",
).appendInaturalistAdditions(
  pipeline.load(
    csv("public/Until_June26.csv"),
    merlin,
    new Map(csv("public/user_groups.csv").map((r) => [r.user_login, r.group])),
  ),
  JSON.parse(read("public/inaturalist-september-2026-additions.json")),
  pipeline.parseObservedOn,
  pipeline.parseObservedTime,
);
export const runSync = (previous = historical, rows = incoming) =>
  sync.synchronizeMerlin(previous, rows, pipeline.parseObservedOn, pipeline.parseObservedTime);

/** Execute the actual React effect body with local assets, no browser/network. */
export async function loadDashboard({
  enabled = sync.MERLIN_SYNC_ENABLED,
  failSnapshot = false,
} = {}) {
  const ast = tree(read("src/lib/observations-store.tsx"));
  const state = { requests: [], errors: [] };
  const loader = evaluate(
    `
    ${["CATEGORY_MAP", "ODONATA_FAMILIES", "REA_SHAISH_NAME"].map((n) => `const ${variable(ast, n).getText(ast)};`).join("\n")}
    ${["getSupergroup", "parseObservedOn", "parseObservedTime", "parseMerlinRow"].map((n) => functionText(ast, n)).join("\n")}
    return ${variable(ast, "loadData").initializer.getText(ast)};`,
    {
      ...sync,
      MERLIN_SYNC_ENABLED: enabled,
      ...loadProductionModule("src/lib/observation-enrichment.ts"),
      ...loadProductionModule("src/lib/inaturalist-additions.ts"),
      Papa,
      console: { log() {}, info() {}, error: (...args) => state.errors.push(args.map(String)) },
      fetch: async (url) => {
        state.requests.push(url);
        assert.ok(
          [
            "/user_groups.csv",
            "/Until_June26.csv",
            "/MERLIN all observations for Zohar.csv",
            "/inaturalist-september-2026-additions.json",
            `/${sync.MERLIN_SYNC_SOURCE.file_name}`,
          ].includes(url),
        );
        return {
          ok: !(failSnapshot && url === `/${sync.MERLIN_SYNC_SOURCE.file_name}`),
          text: async () => read(`public${url}`),
          json: async () => JSON.parse(read(`public${url}`)),
        };
      },
      setObservations: (rows) => (state.observations = rows),
      setUserObservationCounts: (counts) => (state.counts = counts),
      setObserverStats: (stats) => (state.stats = stats),
      setDatasetBounds: (bounds) => (state.bounds = bounds),
      setFilters: (update) => (state.filters = update({})),
    },
  );
  await loader();
  return state;
}
