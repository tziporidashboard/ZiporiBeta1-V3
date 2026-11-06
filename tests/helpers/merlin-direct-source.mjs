import assert from "node:assert/strict";
import Papa from "papaparse";
import {
  evaluate,
  functionText,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./observation-source.mjs";

export const direct = loadProductionModule("src/lib/merlin-source.ts");

/** Executes the current production effect, including source requests and default filters. */
export async function loadDirectDashboard({ failSource = false, text } = {}) {
  const ast = tree(read("src/lib/observations-store.tsx"));
  const state = { requests: [], errors: [] };
  const load = evaluate(
    `
    ${["CATEGORY_MAP"].map((n) => `const ${variable(ast, n).getText(ast)};`).join("\n")}
    ${["getSupergroup", "parseObservedOn", "parseObservedTime"].map((n) => functionText(ast, n)).join("\n")}
    return ${variable(ast, "loadData").initializer.getText(ast)};`,
    {
      ...direct,
      ...loadProductionModule("src/lib/observation-enrichment.ts"),
      ...loadProductionModule("src/lib/inaturalist-additions.ts"),
      Papa,
      console: { log() {}, info() {}, error: (...a) => state.errors.push(a.map(String)) },
      fetch: async (url) => {
        state.requests.push(url);
        assert.ok(
          [
            "/user_groups.csv",
            "/Until_June26.csv",
            "/inaturalist-september-2026-additions.json",
            `/${direct.MERLIN_SOURCE.file_name}`,
          ].includes(url),
          `Unexpected active source: ${url}`,
        );
        return {
          ok: !(failSource && url === `/${direct.MERLIN_SOURCE.file_name}`),
          text: async () =>
            url === `/${direct.MERLIN_SOURCE.file_name}` && text !== undefined
              ? text
              : read(`public${url}`),
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
  await load();
  return state;
}
