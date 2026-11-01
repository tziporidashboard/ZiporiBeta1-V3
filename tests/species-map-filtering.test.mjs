import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import {
  evaluate,
  find,
  functionText,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";

const store = loadProductionModule("src/lib/observations-store.tsx");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const taxonomy = loadProductionModule("src/lib/taxonomy-engine.ts");
const overrides = loadProductionModule("src/lib/observation-taxonomy-overrides.ts");
const { getTopSpecies } = loadProductionModule("src/components/species-insights-table.tsx");
const speciesAst = tree(read("src/components/species-deep-dive.tsx"));
const mapAst = tree(read("src/components/observation-map.tsx"));
const storeAst = tree(read("src/lib/observations-store.tsx"));
const routeAst = tree(read("src/routes/index.tsx"));
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);

// Evaluate the actual JSX inputs as well as the production filters: testing only
// deepDiveFiltered would pass even when the map was wired to category-only data.
function propsFor(component, bindings) {
  const element = find(
    speciesAst,
    (n) => ts.isJsxSelfClosingElement(n) && n.tagName.getText(speciesAst) === component,
  );
  return Object.fromEntries(
    element.attributes.properties.map((prop) => [
      prop.name.text,
      evaluate(`return (${prop.initializer.expression.getText(speciesAst)});`, bindings),
    ]),
  );
}

const A = "Acridotheres tristis";
const B = "Psittacula krameri";
const C = "Vanellus spinosus";
const M = "Canis aureus";
const observation = (id, name, patch = {}) =>
  Object.freeze({
    composite_id: id,
    scientific_name: name,
    iconic_taxon_name: "Aves",
    taxon_order_name: "",
    observed_on: "15/09/2025",
    latitude: 32,
    longitude: 35,
    user_login: id,
    user_category: "online_communities",
    user_subcategory: "",
    quality_grade: "research",
    ...patch,
  });
const observations = Object.freeze([
  observation("a1", A, { observed_on: "15/09/2024" }),
  observation("a1-duplicate", A, { observed_on: "15/09/2024" }),
  observation("a2", A, {
    observed_on: "15/08/2025",
    quality_grade: "needs_id",
    user_category: "local_communities",
    user_subcategory: "student",
  }),
  observation("a3", A, {
    latitude: 31,
    longitude: 34,
    user_category: "local_communities",
    user_subcategory: "zevulun",
  }),
  observation("b", B, { user_category: "expert", quality_grade: "casual" }),
  observation("c", C),
  observation("m", M, { iconic_taxon_name: "Mammalia" }),
]);
const monitoringAreas = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "zone", name: "Test zone", color: "blue" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [33.9, 30.9],
            [34.1, 30.9],
            [34.1, 31.1],
            [33.9, 31.1],
            [33.9, 30.9],
          ],
        ],
      },
    },
  ],
};
const observationMonitoringAreaIndex = areas.buildObservationMonitoringAreaIndex(
  observations,
  monitoringAreas,
);
const defaults = () => ({
  dateRange: null,
  time: new Map(),
  taxa: new Set(store.TAXA_GROUP_KEYS),
  groups: new Set(["expert", "local_communities", "online_communities"]),
  localCommunitySubgroups: new Set(["student", "mechnistim", "zevulun", "yizrael"]),
  qualityGrades: quality.createDefaultQualitySelection(),
  areas: new Set(survey.SURVEY_AREA_KEYS),
  monitoringAreas: new Set(["zone"]),
  speciesTypes: new Set(["invasive", "rare", "other_species"]),
});
const globallyFilter = evaluate(
  `${functionText(speciesAst, "parseObsTimestamp")}
   return (observations, filters) => (${memo(speciesAst, "globallyFilteredObservations")})();`,
  { ...store, ...quality, ...areas, observationMonitoringAreaIndex },
);
const narrow = evaluate(
  `return (globallyFilteredObservations, category, species) => (${memo(speciesAst, "deepDiveFiltered")})();`,
  store,
);
const summarize = evaluate(
  `return (deepDiveFiltered) => (${memo(speciesAst, "summary")})();`,
  taxonomy,
);
const bubblesFor = evaluate(`return (data) => (${memo(mapAst, "bubbles")})();`, {
  ...store,
  ...overrides,
});
const ids = (rows) => rows.map((o) => o.composite_id).sort();
function view(category = "birds", selected = [], filters = defaults()) {
  const species = new Set(selected);
  const globallyFilteredObservations = globallyFilter(observations, filters);
  const deepDiveFiltered = narrow(globallyFilteredObservations, category, species);
  const bindings = {
    ...store,
    globallyFilteredObservations,
    deepDiveFiltered,
    category,
    activeCategory: category,
    species,
    getTopSpecies,
  };
  const map = propsFor("ObservationMap", bindings);
  return { ...bindings, map, summary: summarize(deepDiveFiltered) };
}
function expectMap(result, expected) {
  assert.deepEqual(ids(result.map.data), [...expected].sort());
  assert.equal(result.summary.rows, expected.length, "KPI and actual map records agree");
  const bubbles = bubblesFor(result.map.data);
  assert.equal(
    bubbles.reduce((total, bubble) => total + bubble.count, 0),
    expected.length,
  );
  assert.deepEqual(bubbles.flatMap((b) => b.observation_ids).sort(), [...expected].sort());
}

test("one species removes every other species from actual map input and keeps grouped counts", () => {
  const result = view("birds", [A]);
  expectMap(result, ["a1", "a1-duplicate", "a2", "a3"]);
  assert.equal(result.summary.species, 1);
  assert.equal(bubblesFor(result.map.data).length, 3, "two records share one bubble");
});

test("multiple species form a union; zero matches produces an empty map", () => {
  expectMap(view("birds", [A, B]), ["a1", "a1-duplicate", "a2", "a3", "b"]);
  expectMap(view("birds", [M]), []);
  expectMap(view(null, [A, M]), ["a1", "a1-duplicate", "a2", "a3", "m"]);
});

function stateHarness() {
  let state = { category: "birds", species: new Set(), search: "" };
  const actions = evaluate(`return (${memo(storeAst, "deepDiveActions")})();`, {
    setDeepDive: (next) => {
      state = typeof next === "function" ? next(state) : next;
    },
  });
  return { actions, state: () => state, view: () => view(state.category, state.species) };
}

test("toggling, clearing species and switching categories preserve existing reset behavior", () => {
  const h = stateHarness();
  h.actions.toggleDeepDiveSpecies(A);
  h.actions.toggleDeepDiveSpecies(B);
  h.actions.toggleDeepDiveSpecies(A);
  expectMap(h.view(), ["b"]);
  h.actions.toggleDeepDiveSpecies(B);
  expectMap(h.view(), ["a1", "a1-duplicate", "a2", "a3", "b", "c"]);
  h.actions.toggleDeepDiveSpecies(A);
  h.actions.clearDeepDiveSpecies();
  expectMap(h.view(), ["a1", "a1-duplicate", "a2", "a3", "b", "c"]);
  h.actions.toggleDeepDiveSpecies(A);
  h.actions.setDeepDiveSearch("מיינה");
  h.actions.setDeepDiveCategory("mammals");
  assert.deepEqual(h.state(), { category: "mammals", species: new Set(), search: "" });
  expectMap(h.view(), ["m"]);
  h.actions.setDeepDiveCategory(null);
  expectMap(h.view(), ids(observations));
});

test("species selection intersects every shared filter and combined filters", () => {
  const cases = [
    [
      {
        dateRange: { start: new Date(2025, 0, 1).getTime(), end: new Date(2025, 11, 31).getTime() },
      },
      ["a2", "a3", "b"],
    ],
    [{ time: new Map([["2025", new Set(["09"])]]) }, ["a3", "b"]],
    [{ qualityGrades: new Set(["needs_id"]) }, ["a2"]],
    [{ qualityGrades: new Set() }, []],
    [{ groups: new Set(["local_communities"]) }, ["a2", "a3"]],
    [
      { groups: new Set(["local_communities"]), localCommunitySubgroups: new Set(["zevulun"]) },
      ["a3"],
    ],
    [{ areas: new Set(), monitoringAreas: new Set(["zone"]) }, ["a3"]],
    [{ areas: new Set(), monitoringAreas: new Set() }, []],
    [
      { areas: new Set(["other_areas"]), monitoringAreas: new Set() },
      ["a1", "a1-duplicate", "a2", "a3", "b"],
    ],
    [{ speciesTypes: new Set(["other_species"]) }, []],
    [{ taxa: new Set(["mammals"]) }, []],
    [
      {
        dateRange: { start: new Date(2025, 8, 1).getTime(), end: new Date(2025, 8, 30).getTime() },
        time: new Map([["2025", new Set(["09"])]]),
        qualityGrades: new Set(["research"]),
        groups: new Set(["local_communities"]),
        localCommunitySubgroups: new Set(["zevulun"]),
        areas: new Set(),
        monitoringAreas: new Set(["zone"]),
        speciesTypes: new Set(["invasive"]),
      },
      ["a3"],
    ],
  ];
  for (const [patch, expected] of cases)
    expectMap(view("birds", [A, B], { ...defaults(), ...patch }), expected);
});

test("global reset restores all map records, species, search and shared filters", () => {
  const h = stateHarness();
  h.actions.toggleDeepDiveSpecies(A);
  h.actions.setDeepDiveSearch("מיינה");
  let filters = { ...defaults(), qualityGrades: new Set() };
  let resets = 0;
  const reset = evaluate(`return (${variable(routeAst, "reset").initializer.getText(routeAst)});`, {
    ...quality,
    ...survey,
    observations,
    monitoringAreas,
    datasetBounds: null,
    uniqueYears: ["2024", "2025"],
    deepDiveActions: h.actions,
    setFilters: (next) => {
      filters = next;
    },
    bumpResetVersion: () => {
      resets++;
    },
  });
  reset();
  assert.deepEqual(h.state(), { category: null, species: new Set(), search: "" });
  assert.equal(resets, 1);
  expectMap(view(h.state().category, h.state().species, filters), ids(observations));
});

test("filtered bubbles remain clickable and resolve original observation details", () => {
  const result = view("birds", [A, B]);
  const bubbles = bubblesFor(result.map.data);
  const clickable = evaluate(`return (${memo(mapAst, "clickableBubbles")})();`, {
    bubbles,
    selectedSpecies: result.map.selectedSpecies,
  });
  assert.deepEqual(clickable, bubbles);
  const observationsMap = new Map(observations.map((o) => [o.composite_id, o]));
  for (const bubble of clickable) {
    const details = evaluate(`return (${memo(mapAst, "selectedObservations")})();`, {
      observationsMap,
      selectedBubbleIds: bubble.observation_ids,
    });
    assert.deepEqual(ids(details), [...bubble.observation_ids].sort());
    assert.ok(details.every((o) => result.map.data.includes(o)));
  }
});

test("table and chart retain comparison species and localized labels in Hebrew and English", () => {
  const result = view("birds", [B]);
  const table = propsFor("SpeciesInsightsTable", result);
  assert.equal(table.data, result.globallyFilteredObservations);
  const rows = getTopSpecies(table.data, table.prioritySpecies, table.priorityCategory);
  assert.deepEqual(
    rows.map((r) => [r.scientificName, r.observations]),
    [
      [B, 1],
      [A, 4],
      [C, 1],
    ],
  );
  const tableSpecies = evaluate(`return (${memo(speciesAst, "tableSpecies")})();`, result);
  const chartProps = propsFor("DeepDiveTimeSeriesChart", {
    ...result,
    tableSpecies,
    CATEGORY_HEX: { birds: "blue" },
  });
  assert.equal(chartProps.allObservations, result.globallyFilteredObservations);
  assert.deepEqual(chartProps.selectedSpecies, new Set([B, A, C]));
  const chartAst = tree(read("src/components/deep-dive-time-series-chart.tsx"));
  for (const lang of ["he", "en"]) {
    const chart = evaluate(
      `
      ${["SPECIES_PALETTE", "BACKGROUND_COLOR", "HEBREW_LETTER_REGEX"].map((n) => `const ${variable(chartAst, n).getText(chartAst)};`).join("\n")}
      ${functionText(chartAst, "getSpeciesLabel")}
      return (${memo(chartAst, "{ chartData, seriesKeys, seriesColors, seriesLabels }")})();`,
      {
        ...store,
        ...loadProductionModule("src/lib/i18n.tsx"),
        ...loadProductionModule("src/lib/species-dictionary.ts"),
        ...chartProps,
        lang,
      },
    );
    for (const row of rows) {
      assert.equal(
        chart.chartData.reduce((total, point) => total + point[row.scientificName], 0),
        row.observations,
      );
      assert.equal(
        chart.seriesLabels[row.scientificName],
        lang === "he" ? row.hebrewName : row.englishName,
      );
    }
  }
});
