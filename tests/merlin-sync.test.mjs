import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import Papa from "papaparse";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { readMerlinHistory } from "./helpers/merlin-history.mjs";
import {
  evaluate,
  functionText,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";
import {
  historical,
  incoming,
  merlin,
  pipeline,
  runSync,
  store,
  sync,
  loadDashboard,
} from "./helpers/merlin-source.mjs";

const hash = (v) => createHash("sha256").update(v).digest("hex");
const baseline = JSON.parse(read("docs/merlin-sync-2026-11-05/baseline.json"));
const ids = (rows) => rows.map((o) => o.composite_id).sort();
const count = (rows, fn) =>
  Object.fromEntries([...Map.groupBy(rows, fn)].map(([k, v]) => [k, v.length]));
function freeze(o) {
  if (o && typeof o === "object") {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
}
freeze(historical);
freeze(incoming);
const result = runSync();
const observations = freeze(result.observations);
const old = new Map(historical.map((o) => [o.composite_id, o]));
const byId = new Map(observations.map((o) => [o.composite_id, o]));
const expert = observations.filter((o) => o.source === "merlin");
const inat = observations.filter((o) => o.source === "inaturalist");
const sourceById = new Map(incoming.map((r) => [`expert_${r.composite_id}`, r]));
const key = (suffix) => `expert_ai4biodiversity.haifa.ac.il_${suffix}`;

test("archived synchronized loader loads 13,943 unique records, exact source/observer/year totals and all defaults", async () => {
  const state = await loadDashboard();
  assert.deepEqual(state.errors, []);
  assert.equal(state.requests.length, 5);
  assert.deepEqual(state.observations, observations);
  assert.equal(observations.length, 13943);
  assert.equal(new Set(ids(observations)).size, 13943);
  assert.deepEqual(result.summary, {
    source_rows: 2644,
    matched: 2354,
    added: 290,
    rejected: 0,
    retained_missing: 3,
  });
  assert.deepEqual(
    count(observations, (o) => o.source),
    { inaturalist: 11296, merlin: 2647 },
  );
  assert.deepEqual(
    count(expert, (o) => o.user_login),
    { "רחלי שוורץ-צחור": 771, "אסף בן-דוד": 455, "רע שיש": 1421 },
  );
  assert.deepEqual(
    count(expert, (o) => o.observed_on.slice(6)),
    { 2024: 600, 2025: 1757, 2026: 290 },
  );
  assert.equal(
    [...state.counts.values()].reduce((a, b) => a + b, 0),
    13943,
  );
  assert.equal(
    state.stats.reduce((a, b) => a + b.totalObservations, 0),
    13943,
  );
  assert.ok(state.filters.groups.has("expert"));
  assert.ok(state.filters.time.has("2026"));
});

test("all iNaturalist records, communities, classifications and protected sources remain exactly unchanged", () => {
  assert.equal(hash(JSON.stringify(inat)), baseline.inatSha256);
  assert.equal(
    hash(
      JSON.stringify(
        inat.map((o) => [
          o.composite_id,
          store.getTaxaGroup(o),
          store.getSpeciesClassification(o),
          store.getObservationTaxonDetails(o),
        ]),
      ),
    ),
    baseline.inatClassificationSha256,
  );
  inat.forEach((o) => assert.equal(o, old.get(o.composite_id)));
  assert.deepEqual(
    count(inat, (o) => o.user_category),
    { online_communities: 7868, local_communities: 3428 },
  );
  for (const [file, expected] of Object.entries(baseline.files)) {
    // Preserve the approved hashes across Windows and Linux Git checkouts.
    // Only LF/CRLF are equivalent; content, whitespace and lone CR stay significant.
    const content = file === "public/MERLIN all observations for Zohar.csv"
      ? readMerlinHistory().toString("utf8")
      : read(file);
    assert.ok(
      [content, content.replace(/\r\n/g, "\n"), content.replace(/\r?\n/g, "\r\n")]
        .some((candidate) => hash(candidate) === expected),
      file,
    );
  }
  assert.equal(
    hash(read(`public/${sync.MERLIN_SYNC_SOURCE.file_name}`)),
    sync.MERLIN_SYNC_SOURCE.file_sha256,
  );
});

test("all 2,354 matched IDs and 290 new IDs follow literal source fields and preserve provenance", () => {
  for (const [id, r] of sourceById) {
    const o = byId.get(id);
    assert.equal(o.composite_id, old.get(id)?.composite_id ?? id);
    assert.equal(o.source, "merlin");
    assert.equal(o.scientific_name, r.scientific_name.trim());
    assert.equal(o.common_name, r.hebrew_name.trim());
    assert.equal(o.observed_on, pipeline.parseObservedOn(r.observed_on, "merlin"));
    assert.equal(o.observed_time, pipeline.parseObservedTime(r.observed_on));
    assert.equal(o.user_login, r.user_name);
    assert.equal(o.user_category, "expert");
    assert.equal(o.user_subcategory, "expert");
    assert.equal(o.quality_grade, r.quality_grade);
    assert.deepEqual(o.professional_metadata.values, r);
    if (id !== key("113424")) {
      assert.equal(o.latitude, +r.latitude);
      assert.equal(o.longitude, +r.longitude);
    }
    if (old.has(id)) {
      assert.equal(o.taxon_order_name, old.get(id).taxon_order_name);
      assert.equal(o.iconic_taxon_name, old.get(id).iconic_taxon_name);
    }
  }
});

test("0,0 is rejected without losing the observation; the three missing zero sessions survive untouched", () => {
  assert.equal(byId.get(key("113424")).latitude, 32.74648);
  assert.equal(byId.get(key("113424")).longitude, 35.218938);
  assert.equal(result.exceptions.filter((e) => e.type === "invalid_coordinates").length, 1);
  for (const suffix of ["114696", "114697", "114782"])
    assert.equal(byId.get(key(suffix)), old.get(key(suffix)));
  assert.ok(
    expert.every(
      (o) =>
        Number.isFinite(o.latitude) &&
        Number.isFinite(o.longitude) &&
        !(o.latitude === 0 && o.longitude === 0),
    ),
  );
});

test("repeat synchronization is idempotent; coincident events and distinct species never collapse", () => {
  assert.deepEqual(runSync(observations).observations, observations);
  assert.deepEqual(runSync().observations, observations);
  const repeated = runSync(historical, [...incoming, incoming[0]]);
  assert.deepEqual(repeated.observations, observations);
  assert.equal(repeated.exceptions.filter((e) => e.type === "duplicate_id_identical").length, 1);
  assert.ok(byId.has(key("114198")) && byId.has(key("114207")));
  assert.deepEqual(
    merlin
      .filter((r) =>
        ["ai4biodiversity.haifa.ac.il_114198", "ai4biodiversity.haifa.ac.il_114207"].includes(
          r.observationID,
        ),
      )
      .map((r) => r.count),
    ["2", "1"],
  );
  for (const suffix of ["112553", "112554", "112555"]) assert.ok(byId.has(key(suffix)));
});

test("later snapshots update by ID while retaining records introduced by an earlier snapshot", () => {
  const firstNew = incoming.find((r) => !old.has(`expert_${r.composite_id}`));
  const futureRow = { ...firstNew, longitude: String(+firstNew.longitude + 0.001) };
  const source = { file_name: "future-fixture.csv", file_sha256: "fixture" };
  const later = sync.synchronizeMerlin(
    observations, [futureRow], pipeline.parseObservedOn, pipeline.parseObservedTime, source,
  );
  assert.equal(later.observations.length, 13943);
  assert.equal(later.summary.added, 0);
  assert.equal(later.summary.matched, 1);
  assert.equal(later.summary.retained_missing, 2646);
  for (const o of later.observations) {
    if (o.composite_id === `expert_${firstNew.composite_id}`) {
      assert.equal(o.longitude, +futureRow.longitude);
      assert.equal(o.professional_metadata.file_name, source.file_name);
    } else assert.equal(o, byId.get(o.composite_id));
  }
});

test("conflicting IDs, malformed dates/flags/groups and invalid new locations are isolated, not guessed", () => {
  const duplicate = { ...incoming[0], scientific_name: "Different species" };
  const conflict = runSync(historical, [...incoming, duplicate]);
  assert.equal(
    conflict.observations.find((o) => o.composite_id === `expert_${incoming[0].composite_id}`),
    old.get(`expert_${incoming[0].composite_id}`),
  );
  assert.equal(conflict.observations.length, 13943);
  assert.equal(conflict.exceptions.filter((e) => e.type === "duplicate_id_conflict").length, 1);
  for (const patch of [
    { observed_on: "2025-02-30 01:00:00" },
    { user_category: "online communities" },
    { is_rare: "1", is_invasive: "1" },
    { latitude: "" },
    { latitude: "Infinity" },
    { latitude: "91" },
    { latitude: "0", longitude: "0" },
  ]) {
    const bad = { ...incoming.find((r) => !old.has(`expert_${r.composite_id}`)), ...patch };
    const attempt = runSync(historical, [bad]);
    assert.deepEqual(attempt.observations, historical);
    assert.equal(attempt.summary.rejected, 1);
    assert.ok(
      attempt.exceptions.some(
        (e) => e.observation_id === bad.composite_id && e.requires_clarification,
      ),
    );
  }
});

test("source-scoped taxonomy includes missing dictionary names and all source rarity without changing iNaturalist", () => {
  assert.deepEqual(count(expert, store.getTaxaGroup), {
    butterflies: 771,
    mammals: 455,
    birds: 741,
    dragonflies: 677,
    other: 3,
  });
  assert.deepEqual(count(expert, store.getSpeciesClassification), {
    other_species: 2507,
    rare: 114,
    invasive: 26,
  });
  const missing = result.exceptions.filter((e) => e.type === "dictionary_missing");
  assert.equal(missing.length, 69);
  assert.equal(new Set(missing.map((e) => e.new_value)).size, 12);
  assert.equal(result.exceptions.filter((e) => e.type === "status_conflict").length, 39);
  assert.equal(result.exceptions.filter((e) => e.type === "generic_conflict").length, 8);
  for (const o of expert.filter((o) => ["Equus", "Orthetrum"].includes(o.scientific_name)))
    assert.equal(store.getObservationTaxonDetails(o).isGeneric, true);
  assert.equal(result.exceptions.filter((e) => e.type === "scientific_identity_review").length, 1);
  for (const o of expert.filter((o) => o.professional_metadata)) {
    const spoof = { ...o, source: "inaturalist" };
    assert.equal(store.getProfessionalTaxonomy(spoof), undefined);
    assert.equal(store.getProfessionalTaxonomy({ ...o, scientific_name: "different" }), undefined);
  }
});

const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const index = areas.buildObservationMonitoringAreaIndex(observations, geo);
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);
const consumers = [
  ["dashboard.tsx", "filtered"],
  ["dashboard.tsx", "chartData"],
  ["dashboard.tsx", "metricsData"],
  ["people-dashboard.tsx", "globallyFilteredObservations"],
  ["species-deep-dive.tsx", "globallyFilteredObservations"],
].map(([file, name]) => {
  const ast = tree(read(`src/components/${file}`));
  return {
    file,
    name,
    run: evaluate(
      `${functionText(ast, "parseObsTimestamp")} return (observations,filters)=>(${memo(ast, name)})();`,
      { ...store, ...areas, ...quality, observationMonitoringAreaIndex: index },
    ),
  };
});
const defaults = () => ({
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
});

test("all five actual filter pipelines agree for every taxon, status, year/month, quality and monitoring polygon", () => {
  const scenarios = [
    { patch: {}, predicate: () => true },
    ...store.TAXA_GROUP_KEYS.map((g) => ({
      patch: { taxa: new Set([g]) },
      predicate: (o) => store.getTaxaGroup(o) === g,
    })),
    ...["rare", "invasive", "other_species"].map((s) => ({
      patch: { speciesTypes: new Set([s]) },
      predicate: (o) => store.getSpeciesClassification(o) === s,
    })),
    ...["2024", "2025", "2026"].map((y) => ({
      patch: { time: new Map([[y, new Set()]]) },
      predicate: (o) => o.observed_on.slice(6) === y,
    })),
    ...["08", "10"].map((m) => ({
      patch: { time: new Map([["2026", new Set([m])]]) },
      predicate: (o) => o.observed_on.slice(3) === `${m}/2026`,
    })),
    ...["research", "needs_id", "casual"].map((q) => ({
      patch: { qualityGrades: new Set([q]) },
      predicate: (o) => o.quality_grade === q,
    })),
    ...geo.features.map((f) => ({
      patch: { areas: new Set(), monitoringAreas: new Set([f.properties.id]) },
      predicate: (o) => index.get(o).has(f.properties.id),
    })),
  ];
  for (const { patch, predicate } of scenarios)
    for (const { name, run } of consumers)
      assert.deepEqual(
        ids(run(observations, { ...defaults(), ...patch })),
        ids(observations.filter(predicate)),
        name,
      );
  for (const { name, run } of consumers.filter(
    (c) =>
      c.name === "filtered" ||
      (c.file === "species-deep-dive.tsx" && c.name === "globallyFilteredObservations"),
  )) {
    assert.deepEqual(
      ids(run(observations, { ...defaults(), groups: new Set(["expert"]) })),
      ids(expert),
    );
  }
});

test("spatial membership matches independent point-in-polygon tests; map bubbles preserve every ID", () => {
  const oldIndex = areas.buildObservationMonitoringAreaIndex(historical, geo);
  for (const o of observations) {
    assert.deepEqual(
      [...index.get(o)],
      geo.features
        .filter((f) => booleanPointInPolygon([o.longitude, o.latitude], f))
        .map((f) => f.properties.id),
    );
    if (o.source === "inaturalist") assert.deepEqual(index.get(o), oldIndex.get(o));
  }
  const ast = tree(read("src/components/observation-map.tsx"));
  const bubbles = evaluate(`return(data)=>(${memo(ast, "bubbles")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
  })(observations);
  assert.equal(
    bubbles.reduce((n, b) => n + b.count, 0),
    13943,
  );
  assert.deepEqual(bubbles.flatMap((b) => b.observation_ids).sort(), ids(observations));
  // Historical iNaturalist bubbles can already contain differing fallback
  // categories. Preserve that behavior; all newly scoped MERLIN bubbles must
  // be homogeneous and must never absorb an iNaturalist record.
  for (const b of bubbles.filter((b) =>
    b.observation_ids.some((id) => byId.get(id).professional_metadata),
  )) {
    assert.equal(new Set(b.observation_ids.map((id) => store.getTaxaGroup(byId.get(id)))).size, 1);
    assert.ok(b.observation_ids.every((id) => byId.get(id).source === "merlin"));
  }
});

test("missing dictionary species appear in choices, insights, chart totals and metrics; genus IDs remain uncounted as species", () => {
  const { speciesMap } = loadProductionModule("src/lib/species-map.ts");
  const ast = tree(read("src/components/species-deep-dive.tsx"));
  const groups = evaluate(`return(observations)=>(${memo(ast, "groupedSpecies")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
    speciesMap,
    categories: store.TAXA_GROUP_KEYS,
  })(observations);
  const { getTopSpecies } = loadProductionModule("src/components/species-insights-table.tsx");
  for (const scientific_name of [
    "Lycaena thersamon",
    "Capra hircus",
    "Calopteryx splendens ssp. Syriaca",
  ]) {
    const rows = expert.filter((o) => o.scientific_name === scientific_name),
      group = store.getTaxaGroup(rows[0]);
    assert.ok(groups[group].some((s) => s.Scientific_Name === scientific_name));
    const insight = getTopSpecies(expert, new Set([scientific_name]), group)[0];
    assert.equal(insight.scientificName, scientific_name);
    assert.equal(insight.observations, rows.length);
    assert.equal(insight.hebrewName, rows[0].common_name);
  }
  const summarize = evaluate(
    `return(deepDiveFiltered)=>(${memo(ast, "summary")})();`,
    store,
  )(expert);
  assert.equal(summarize.rows, 2647);
  assert.equal(summarize.unidentified, 11);
  const metricsAst = tree(read("src/components/metrics-table.tsx"));
  const metrics = evaluate(
    `${functionText(metricsAst, "computeRow")}return computeRow;`,
    store,
  )(expert);
  assert.equal(metrics.observations, 2647);
  assert.equal(metrics.rareSpecies, 7);
  assert.equal(metrics.invasiveSpecies, 3);
  const chartAst = tree(read("src/components/time-series-chart.tsx"));
  const chart = evaluate(
    `return(data)=>(${memo(chartAst, "{ rawCounts, allSortKeys, allGroups }")})();`,
    { lang: "en", translateMonth: String, PROFESSIONAL_MONITORING_KEY: "expert" },
  )(observations);
  assert.equal(
    [...chart.rawCounts.values()].reduce(
      (n, m) => n + [...m.counts.values()].reduce((a, b) => a + b, 0),
      0,
    ),
    13943,
  );
});

test("Hebrew and English exports retain source IDs, updated names/status/coordinates and all 11,296 original iNaturalist export rows", async () => {
  const ast = tree(read("src/lib/export-observations.ts"));
  let blob;
  const exportRows = evaluate(
    `const ${variable(ast, "ENGLISH_HEADERS").getText(ast)};${functionText(ast, "exportObservations")}return exportObservations;`,
    {
      ...store,
      ...survey,
      ...areas,
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
    exportRows(historical, geo, areas.buildObservationMonitoringAreaIndex(historical, geo), lang);
    const before = Papa.parse(await blob.text(), { header: true, skipEmptyLines: true }).data;
    exportRows(observations, geo, index, lang);
    const after = Papa.parse(await blob.text(), { header: true, skipEmptyLines: true }).data;
    const id = lang === "he" ? "מזהה תצפית" : "Observation ID";
    assert.equal(after.length, 13943);
    assert.deepEqual(
      after.filter((r) => r[id].startsWith("inat_")),
      before.filter((r) => r[id].startsWith("inat_")),
    );
    const r = after.find((r) => r[id] === key("113424"));
    assert.equal(+r[lang === "he" ? "קו רוחב" : "Latitude"], 32.74648);
    const n = after.find((r) => r[id] === key("112556"));
    assert.equal(n[lang === "he" ? "שם מדעי" : "Scientific Name"], "Colias crocea");
    assert.equal(
      n[lang === "he" ? "שם נפוץ" : "Common Name"],
      lang === "he" ? "צהבוני התלתן" : "Clouded Yellow",
    );
  }
});

test("rollback and unavailable snapshot both preserve the full original 13,653-observation dashboard", async () => {
  const rollback = await loadDashboard({ enabled: false });
  assert.deepEqual(rollback.observations, historical);
  assert.deepEqual(rollback.errors, []);
  assert.equal(rollback.requests.length, 4);
  const failure = await loadDashboard({ failSnapshot: true });
  assert.deepEqual(failure.observations, historical);
  assert.equal(failure.errors.length, 1);
});
