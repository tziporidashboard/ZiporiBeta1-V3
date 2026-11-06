import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import Papa from "papaparse";
import {
  evaluate,
  functionText,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";
import { incoming, merlin, pipeline, runSync, store } from "./helpers/merlin-source.mjs";
import { direct, loadDirectDashboard } from "./helpers/merlin-direct-source.mjs";
import { readMerlinHistory } from "./helpers/merlin-history.mjs";

const removed = new Set(
  ["114696", "114697", "114782"].map((id) => `expert_ai4biodiversity.haifa.ac.il_${id}`),
);
const previous = runSync().observations;
const expected = previous.filter((o) => !removed.has(o.composite_id));
const state = await loadDirectDashboard();
const rows = state.observations;
const experts = rows.filter((o) => o.source === "merlin");
const byId = new Map(rows.map((o) => [o.composite_id, o]));
const ids = (data) => data.map((o) => o.composite_id);
const count = (data, key) =>
  Object.fromEntries([...Map.groupBy(data, key)].map(([k, v]) => [k, v.length]));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const parse = (data) =>
  direct.parseMerlinRows(data, pipeline.parseObservedOn, pipeline.parseObservedTime);
const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const index = areas.buildObservationMonitoringAreaIndex(rows, geo);
const oldIndex = areas.buildObservationMonitoringAreaIndex(expected, geo);
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);

test("current production loader fetches one MERLIN snapshot, loads 13,940 unique rows and preserves defaults/order", async () => {
  assert.deepEqual(state.errors, []);
  assert.equal(state.requests.length, 4);
  assert.equal(state.requests.filter((p) => p === `/${direct.MERLIN_SOURCE.file_name}`).length, 1);
  assert.equal(rows.length, 13940);
  assert.equal(new Set(ids(rows)).size, 13940);
  assert.deepEqual(
    ids(rows),
    ids(expected),
    "published row order is unchanged apart from the removed sessions",
  );
  assert.deepEqual(
    count(rows, (o) => o.source),
    { inaturalist: 11296, merlin: 2644 },
  );
  assert.deepEqual(
    count(experts, (o) => o.observed_on.slice(6)),
    { 2024: 600, 2025: 1754, 2026: 290 },
  );
  assert.deepEqual(
    count(experts, (o) => o.user_login),
    { "רחלי שוורץ-צחור": 771, "אסף בן-דוד": 455, "רע שיש": 1418 },
  );
  assert.equal(
    [...state.counts.values()].reduce((a, b) => a + b, 0),
    13940,
  );
  assert.equal(
    state.stats.reduce((n, s) => n + s.totalObservations, 0),
    13940,
  );
  assert.ok(state.filters.groups.has("expert") && state.filters.time.has("2026"));
  assert.deepEqual((await loadDirectDashboard()).observations, rows);
});

test("only the three approved empty sessions disappear; full 88-column archive stays byte-identical outside public", () => {
  assert.deepEqual(
    previous
      .filter((o) => !byId.has(o.composite_id))
      .map((o) => o.composite_id)
      .sort(),
    [...removed].sort(),
  );
  assert.ok(!fs.existsSync("public/MERLIN all observations for Zohar.csv"));
  assert.equal(merlin.length, 2357);
  assert.equal(Object.keys(merlin[0]).length, 88);
  for (const id of removed) assert.ok(merlin.some((r) => `expert_${r.observationID}` === id));
  assert.equal(
    hash(readMerlinHistory()),
    "42438b9a029b8ba81ff8625e7a28b8863adde48a70c69b5d30d3823981de8b75",
  );
  assert.equal(
    hash(fs.readFileSync(`public/${direct.MERLIN_SOURCE.file_name}`)),
    direct.MERLIN_SOURCE.file_sha256,
  );
  assert.deepEqual(readMerlinHistory({ fromGit: true }), readMerlinHistory());
});

test("all remaining observation fields are unchanged except unused legacy family/iconic metadata on MERLIN", () => {
  const visible = (o) => {
    if (o.source !== "merlin") return o;
    const { iconic_taxon_name, taxon_order_name, ...kept } = o;
    return kept;
  };
  assert.deepEqual(rows.map(visible), expected.map(visible));
  assert.ok(experts.every((o) => o.iconic_taxon_name === "" && o.taxon_order_name === ""));
  assert.deepEqual(
    rows.filter((o) => o.source === "inaturalist"),
    expected.filter((o) => o.source === "inaturalist"),
  );
  for (let i = 0; i < rows.length; i++) {
    assert.equal(store.getTaxaGroup(rows[i]), store.getTaxaGroup(expected[i]));
    assert.deepEqual(
      store.getObservationTaxonDetails(rows[i]),
      store.getObservationTaxonDetails(expected[i]),
    );
  }
});

test("every one of the 2,644 raw rows keeps its ID, original fields, source classifications and clock/date", () => {
  assert.equal(experts.length, incoming.length);
  for (const raw of incoming) {
    const o = byId.get(`expert_${raw.composite_id}`);
    assert.ok(o);
    assert.deepEqual(o.professional_metadata.values, raw);
    assert.equal(o.scientific_name, raw.scientific_name.trim());
    assert.equal(o.user_login, raw.user_name.trim());
    assert.equal(o.observed_on, pipeline.parseObservedOn(raw.observed_on, "merlin"));
    assert.equal(o.observed_time, pipeline.parseObservedTime(raw.observed_on));
    assert.equal(store.getObservationTaxonDetails(o).category, raw.taxa_category_he);
    assert.equal(
      store.getSpeciesClassification(o),
      raw.is_invasive === "1" ? "invasive" : raw.is_rare === "1" ? "rare" : "other_species",
    );
    if (["Equus", "Orthetrum"].includes(o.scientific_name))
      assert.equal(store.getObservationTaxonDetails(o).isGeneric, true);
  }
});

test("only ID 113424 with source 0,0 is corrected; no other position is invented", () => {
  for (const raw of incoming) {
    const o = byId.get(`expert_${raw.composite_id}`);
    assert.ok(Number.isFinite(o.latitude) && Number.isFinite(o.longitude));
    assert.ok(Math.abs(o.latitude) <= 90 && Math.abs(o.longitude) <= 180);
    assert.ok(o.latitude !== 0 || o.longitude !== 0);
    assert.deepEqual(
      [o.latitude, o.longitude],
      raw.composite_id.endsWith("_113424")
        ? [32.74648, 35.218938]
        : [+raw.latitude, +raw.longitude],
    );
  }
  const raw = incoming.find((r) => r.composite_id.endsWith("_113424"));
  assert.deepEqual(
    parse([{ ...raw, latitude: "32.8", longitude: "35.2" }]).map((o) => [o.latitude, o.longitude]),
    [[32.8, 35.2]],
  );
  assert.throws(() => parse([{ ...incoming[0], latitude: "0", longitude: "0" }]), /coordinates/);
  assert.throws(() => parse([{ ...raw, latitude: "91" }]), /coordinates/);
});

test("duplicate IDs and malformed rows/snapshots are rejected without fuzzy merging or historical fallback", async () => {
  assert.throws(() => parse([incoming[0], incoming[0]]), /duplicate/);
  for (const patch of [
    { composite_id: "" },
    { observed_on: "2025-02-30 08:00:00" },
    { user_name: "", user_login: "" },
    { latitude: "" },
    { longitude: "Infinity" },
    { is_rare: "1", is_invasive: "1" },
    { taxa_category_en: "invalid" },
  ]) {
    assert.throws(() => parse([{ ...incoming[0], ...patch }]), /Invalid MERLIN/);
  }
  assert.equal(
    parse([incoming[0], incoming[1]]).length,
    2,
    "different species at one event remain separate",
  );
  for (const text of [
    "",
    read("data-archive/merlin/2026-11-05/MERLIN all observations for Zohar.csv"),
    Papa.unparse(incoming.slice(1)),
    Papa.unparse([...incoming, incoming[0]]),
  ]) {
    const failed = await loadDirectDashboard({ text });
    assert.equal(failed.observations, undefined);
    assert.equal(failed.errors.length, 1);
  }
  const failed = await loadDirectDashboard({ failSource: true });
  assert.equal(failed.observations, undefined);
  assert.equal(failed.errors.length, 1);
  assert.ok(!failed.requests.some((p) => p.includes("Zohar") || p.includes("archive")));
});

test("map bubbles, observation details and every survey/monitoring membership equal the previous remaining rows", () => {
  for (let i = 0; i < rows.length; i++)
    assert.deepEqual(index.get(rows[i]), oldIndex.get(expected[i]));
  const ast = tree(read("src/components/observation-map.tsx"));
  const bubbles = evaluate(`return (data) => (${memo(ast, "bubbles")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
  });
  assert.deepEqual(bubbles(rows), bubbles(expected));
  assert.equal(
    bubbles(rows).reduce((n, b) => n + b.count, 0),
    13940,
  );
  const details = evaluate(`return(data)=>(${memo(ast, "observationsMap")})();`)(rows);
  assert.equal(details.size, 13940);
  for (const id of removed) assert.equal(details.has(id), false);
});

test("all five filter pipelines preserve date, category, rarity, quality, area and drawn-polygon results", () => {
  const defaults = {
    drawnPolygon: null,
    dateRange: null,
    time: new Map(),
    taxa: new Set(store.TAXA_GROUP_KEYS),
    groups: new Set(["expert", "local_communities", "online_communities"]),
    localCommunitySubgroups: new Set(["student", "zevulun", "yizrael", "mechnistim"]),
    qualityGrades: quality.createDefaultQualitySelection(),
    areas: new Set(survey.SURVEY_AREA_KEYS),
    monitoringAreas: new Set(geo.features.map((f) => f.properties.id)),
    speciesTypes: new Set(["rare", "invasive", "other_species"]),
  };
  const scenarios = [
    {},
    ...store.TAXA_GROUP_KEYS.map((g) => ({ taxa: new Set([g]) })),
    ...["rare", "invasive", "other_species"].map((s) => ({ speciesTypes: new Set([s]) })),
    ...["2024", "2025", "2026"].map((y) => ({ time: new Map([[y, new Set()]]) })),
    ...["research", "needs_id", "casual"].map((q) => ({ qualityGrades: new Set([q]) })),
    ...geo.features.map((f) => ({ areas: new Set(), monitoringAreas: new Set([f.properties.id]) })),
    {
      drawnPolygon: {
        type: "Polygon",
        coordinates: [
          [
            [35.1, 32.7],
            [35.2, 32.7],
            [35.2, 32.8],
            [35.1, 32.8],
            [35.1, 32.7],
          ],
        ],
      },
    },
  ];
  for (const [file, name] of [
    ["dashboard.tsx", "filtered"],
    ["dashboard.tsx", "chartData"],
    ["dashboard.tsx", "metricsData"],
    ["people-dashboard.tsx", "globallyFilteredObservations"],
    ["species-deep-dive.tsx", "globallyFilteredObservations"],
  ]) {
    const ast = tree(read(`src/components/${file}`));
    const make = (membership) =>
      evaluate(
        `${functionText(ast, "parseObsTimestamp")}
      return(observations,filters)=>(${memo(ast, name)})();`,
        { ...store, ...areas, ...quality, observationMonitoringAreaIndex: membership },
      );
    const current = make(index),
      before = make(oldIndex);
    for (const patch of scenarios)
      assert.deepEqual(
        ids(current(rows, { ...defaults, ...patch })),
        ids(before(expected, { ...defaults, ...patch })),
        name,
      );
  }
});

test("tables, species choices, counts and time-series stay identical after excluding the three sessions", () => {
  const metrics = tree(read("src/components/metrics-table.tsx"));
  const compute = evaluate(`${functionText(metrics, "computeRow")}return computeRow;`, store);
  assert.deepEqual(compute(rows), compute(expected));
  const insights = loadProductionModule("src/components/species-insights-table.tsx");
  assert.deepEqual(
    insights.getTopSpecies(rows, new Set(), null),
    insights.getTopSpecies(expected, new Set(), null),
  );
  const species = tree(read("src/components/species-deep-dive.tsx"));
  const summary = evaluate(`return(deepDiveFiltered)=>(${memo(species, "summary")})();`, store);
  assert.deepEqual(summary(rows), summary(expected));
  const chart = tree(read("src/components/time-series-chart.tsx"));
  const counts = evaluate(
    `return(data)=>(${memo(chart, "{ rawCounts, allSortKeys, allGroups }")})();`,
    {
      lang: "en",
      translateMonth: String,
      PROFESSIONAL_MONITORING_KEY: "expert",
    },
  );
  assert.deepEqual(counts(rows), counts(expected));
});

test("every cell and row order in Hebrew and English CSV exports matches the previous export minus only three IDs", async () => {
  let blob;
  const ast = tree(read("src/lib/export-observations.ts"));
  const exportRows = evaluate(
    `const ${variable(ast, "ENGLISH_HEADERS").getText(ast)};
    ${functionText(ast, "exportObservations")}return exportObservations;`,
    {
      ...store,
      ...areas,
      ...survey,
      ...loadProductionModule("src/lib/species-dictionary.ts"),
      ...loadProductionModule("src/lib/i18n.tsx"),
      Papa,
      Blob,
      URL: {
        createObjectURL: (b) => {
          blob = b;
          return "blob:test";
        },
        revokeObjectURL() {},
      },
      document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
      setTimeout: (f) => f(),
    },
  );
  for (const lang of ["he", "en"]) {
    exportRows(expected, geo, oldIndex, lang);
    const before = await blob.text();
    exportRows(rows, geo, index, lang);
    assert.equal(await blob.text(), before);
  }
});

test("active source code contains no archive/synchronization imports or legacy row transformation", () => {
  const source = read("src/lib/observations-store.tsx");
  assert.doesNotMatch(
    source,
    /MERLIN all observations|synchronizeMerlin|MERLIN_SYNC|parseMerlinRow|data-archive/,
  );
  assert.ok(!fs.existsSync("src/lib/merlin-sync.ts"));
});
