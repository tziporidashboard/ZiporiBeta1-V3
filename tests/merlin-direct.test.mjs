import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import { incoming as priorRaw, pipeline, runSync, store } from "./helpers/merlin-source.mjs";
import { direct, loadDirectDashboard } from "./helpers/merlin-direct-source.mjs";
import { readMerlinHistory, readPreviousMerlinSnapshot } from "./helpers/merlin-history.mjs";

const key = (id) => `expert_ai4biodiversity.haifa.ac.il_${id}`;
const removed = new Set(["114696", "114697", "114782"].map(key));
const corrected = key("113424");
const baseline = runSync().observations.filter((o) => !removed.has(o.composite_id));
const state = await loadDirectDashboard();
const rows = state.observations;
const byId = new Map(rows.map((o) => [o.composite_id, o]));
const baselineIds = new Set(baseline.map((o) => o.composite_id));
const added = rows.filter((o) => !baselineIds.has(o.composite_id));
const experts = rows.filter((o) => o.source === "merlin");
const incoming = Papa.parse(read(`public/${direct.MERLIN_SOURCE.file_name}`), {
  header: true,
  skipEmptyLines: true,
}).data;
const rawById = new Map(incoming.map((r) => [r.composite_id, r]));
const ids = (data) => data.map((o) => o.composite_id);
const count = (data, fn) =>
  Object.fromEntries([...Map.groupBy(data, fn)].map(([k, v]) => [k, v.length]));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const parse = (data) =>
  direct.parseMerlinRows(data, pipeline.parseObservedOn, pipeline.parseObservedTime);
// Compare every visible/raw field, excluding snapshot provenance and two unused
// family/order fields that were already removed by the direct-loader release.
function visible(o) {
  if (o.source !== "merlin") return o;
  const { iconic_taxon_name, taxon_order_name, professional_metadata, ...rest } = o;
  return { ...rest, taxonomy: professional_metadata.taxonomy, raw: professional_metadata.values };
}
const unchangedBaseline = baseline.filter((o) => o.composite_id !== corrected);
const unchangedIds = new Set(ids(unchangedBaseline));
const unchangedCurrent = rows.filter((o) => unchangedIds.has(o.composite_id));
const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const index = areas.buildObservationMonitoringAreaIndex(rows, geo);
const oldIndex = areas.buildObservationMonitoringAreaIndex(baseline, geo);
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);
// Recover the previously published snapshot without shipping a second active CSV.
const beforeNameFixBytes = execFileSync(
  "git",
  ["cat-file", "blob", "b9680d85f77506b716e4283fb7f9b26890f96743"],
  { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
);
const beforeNameFixRaw = Papa.parse(beforeNameFixBytes.toString("utf8"), {
  header: true,
  skipEmptyLines: true,
}).data;
const beforeNameFix = parse(beforeNameFixRaw);

test("137747 correction changes exactly three source names and preserves every other record and classification", () => {
  assert.equal(
    hash(beforeNameFixBytes),
    "7d1d516e7a51b8fb7eaffc5a2ca71b76e57d19e89d1a6d714796d4bfc2ca6a34",
  );
  assert.deepEqual(ids(incoming), ids(beforeNameFixRaw));
  const changes = [];
  for (const old of beforeNameFixRaw) {
    const current = rawById.get(old.composite_id);
    for (const field of Object.keys(old))
      if (current[field] !== old[field])
        changes.push([old.composite_id, field, old[field], current[field]]);
  }
  assert.deepEqual(changes, [
    ["ai4biodiversity.haifa.ac.il_137747", "scientific_name", "gomphus davidi", "zygonyx torridus"],
    ["ai4biodiversity.haifa.ac.il_137747", "hebrew_name", "מלקחית נהרות", "דאונית אשדים"],
    ["ai4biodiversity.haifa.ac.il_137747", "english_name", "Levant Clubtail", "Ringed cascader"],
  ]);
  for (const old of beforeNameFix) {
    const current = byId.get(old.composite_id);
    assert.equal(store.getTaxaGroup(current), store.getTaxaGroup(old));
    assert.equal(store.getSpeciesClassification(current), store.getSpeciesClassification(old));
    assert.equal(
      store.getObservationTaxonDetails(current).isGeneric,
      store.getObservationTaxonDetails(old).isGeneric,
    );
    if (old.composite_id !== key("137747")) assert.deepEqual(current, old);
  }
  const fixed = byId.get(key("137747"));
  assert.equal(fixed.scientific_name, "zygonyx torridus");
  assert.equal(fixed.common_name, "דאונית אשדים");
  assert.equal(store.getObservationTaxonDetails(fixed).englishName, "Ringed cascader");
});

test("current loader loads 14,960 unique rows with correct source, year, observer and new-data totals", async () => {
  assert.deepEqual(state.errors, []);
  assert.equal(state.requests.length, 4);
  assert.equal(state.requests.filter((p) => p === `/${direct.MERLIN_SOURCE.file_name}`).length, 1);
  assert.equal(rows.length, 14960);
  assert.equal(new Set(ids(rows)).size, 14960);
  assert.equal(added.length, 1020);
  assert.deepEqual(
    count(rows, (o) => o.source),
    { inaturalist: 11296, merlin: 3664 },
  );
  assert.deepEqual(
    count(experts, (o) => o.observed_on.slice(6)),
    { 2024: 600, 2025: 1754, 2026: 1310 },
  );
  assert.deepEqual(
    count(experts, (o) => o.user_login),
    { "רחלי שוורץ-צחור": 771, "אסף בן-דוד": 455, "רע שיש": 2438 },
  );
  assert.ok(
    added.every(
      (o) => o.source === "merlin" && o.user_login === "רע שיש" && o.observed_on.endsWith("2026"),
    ),
  );
  assert.deepEqual(count(added, store.getTaxaGroup), { dragonflies: 501, birds: 519 });
  assert.deepEqual(count(added, store.getSpeciesClassification), {
    other_species: 903,
    rare: 87,
    invasive: 30,
  });
  assert.equal(
    [...state.counts.values()].reduce((n, c) => n + c, 0),
    14960,
  );
  assert.equal(
    state.stats.reduce((n, s) => n + s.totalObservations, 0),
    14960,
  );
  assert.ok(state.filters.groups.has("expert") && state.filters.time.has("2026"));
  assert.deepEqual((await loadDirectDashboard()).observations, rows);
});

test("all prior IDs remain, only 113424 coordinates change, iNaturalist is identical and empty sessions stay excluded", () => {
  const changes = [];
  for (const old of priorRaw) {
    const current = rawById.get(old.composite_id);
    assert.ok(current);
    for (const field of Object.keys(old))
      if (current[field] !== old[field])
        changes.push([old.composite_id, field, old[field], current[field]]);
  }
  assert.deepEqual(changes, [
    ["ai4biodiversity.haifa.ac.il_113424", "latitude", "0", "32.745815"],
    ["ai4biodiversity.haifa.ac.il_113424", "longitude", "0", "35.221931"],
  ]);
  assert.deepEqual(ids(rows.filter((o) => baselineIds.has(o.composite_id))), ids(baseline));
  assert.deepEqual(unchangedCurrent.map(visible), unchangedBaseline.map(visible));
  assert.deepEqual(
    rows.filter((o) => o.source === "inaturalist"),
    baseline.filter((o) => o.source === "inaturalist"),
  );
  for (const id of removed) assert.equal(byId.has(id), false);
  const old = baseline.find((o) => o.composite_id === corrected),
    current = byId.get(corrected);
  assert.deepEqual(
    {
      ...visible(current),
      latitude: old.latitude,
      longitude: old.longitude,
      raw: old.professional_metadata.values,
    },
    visible(old),
  );
});

test("corrected source is byte-exact; previous 22-column snapshot and full 88-column history remain recoverable", () => {
  assert.equal(direct.MERLIN_SOURCE.expected_rows, 3664);
  assert.equal(
    direct.MERLIN_SOURCE.file_sha256,
    "b706693f023d5bc233b6bea758ea7994fbcf86e405d9c0ed51e9be48b7220684",
  );
  assert.equal(
    hash(fs.readFileSync(`public/${direct.MERLIN_SOURCE.file_name}`)),
    direct.MERLIN_SOURCE.file_sha256,
  );
  assert.equal(
    hash(readPreviousMerlinSnapshot()),
    "3deb438394ea85a0296995c4ca6caad605f554bc7565d37ced2f965bffca8e43",
  );
  assert.deepEqual(readPreviousMerlinSnapshot({ fromGit: true }), readPreviousMerlinSnapshot());
  assert.equal(
    hash(readMerlinHistory()),
    "42438b9a029b8ba81ff8625e7a28b8863adde48a70c69b5d30d3823981de8b75",
  );
  assert.ok(!fs.existsSync("public/merlin-experts-2026-11-05.csv"));
  assert.ok(!fs.existsSync("public/MERLIN all observations for Zohar.csv"));
});

test("every source row retains names, classifications, raw metadata, date/time and coordinates", () => {
  assert.equal(experts.length, incoming.length);
  for (const raw of incoming) {
    const o = byId.get(`expert_${raw.composite_id}`);
    assert.deepEqual(o.professional_metadata.values, raw);
    assert.equal(o.professional_metadata.file_name, direct.MERLIN_SOURCE.file_name);
    assert.equal(o.professional_metadata.file_sha256, direct.MERLIN_SOURCE.file_sha256);
    assert.equal(o.scientific_name, raw.scientific_name.trim());
    assert.equal(o.user_login, raw.user_name.trim());
    assert.equal(o.observed_on, pipeline.parseObservedOn(raw.observed_on, "merlin"));
    assert.equal(o.observed_time, pipeline.parseObservedTime(raw.observed_on));
    assert.deepEqual([o.latitude, o.longitude], [+raw.latitude, +raw.longitude]);
    const details = store.getObservationTaxonDetails(o);
    assert.equal(details.name, raw.hebrew_name.trim() || raw.scientific_name.trim());
    assert.equal(details.englishName, raw.english_name.trim());
    assert.equal(details.category, raw.taxa_category_he);
    assert.equal(
      details.status,
      raw.is_invasive === "1" ? "invasive" : raw.is_rare === "1" ? "rare" : "other",
    );
  }
  assert.ok(added.every((o) => !store.getObservationTaxonDetails(o).isGeneric));
  assert.equal(experts.filter((o) => store.getObservationTaxonDetails(o).isGeneric).length, 8);
});

test("113424 uses the corrected source position directly and no longer accepts 0,0", () => {
  const raw = rawById.get("ai4biodiversity.haifa.ac.il_113424"),
    o = byId.get(corrected);
  assert.deepEqual([o.latitude, o.longitude], [32.745815, 35.221931]);
  assert.equal(direct.MERLIN_COORDINATE_CORRECTION, undefined);
  assert.throws(() => parse([{ ...raw, latitude: "0", longitude: "0" }]), /coordinates/);
  assert.deepEqual(
    parse([{ ...raw, latitude: "32.8", longitude: "35.2" }]).map((o) => [o.latitude, o.longitude]),
    [[32.8, 35.2]],
  );
  assert.ok(
    experts.every(
      (o) =>
        Number.isFinite(o.latitude) &&
        Number.isFinite(o.longitude) &&
        Math.abs(o.latitude) <= 90 &&
        Math.abs(o.longitude) <= 180 &&
        !(o.latitude === 0 && o.longitude === 0),
    ),
  );
});

test("invalid/duplicate/unreviewed sources fail atomically; different species at the same event stay distinct", async () => {
  assert.throws(() => parse([incoming[0], incoming[0]]), /duplicate/);
  for (const patch of [
    { composite_id: "" },
    { observed_on: "2026-02-30 08:00:00" },
    { user_name: "", user_login: "" },
    { latitude: "" },
    { longitude: "Infinity" },
    { latitude: "0", longitude: "0" },
    { is_rare: "1", is_invasive: "1" },
    { taxa_category_en: "invalid" },
  ])
    assert.throws(() => parse([{ ...incoming[0], ...patch }]), /Invalid MERLIN/);
  assert.equal(parse([incoming[0], incoming[1]]).length, 2);
  for (const text of [
    "",
    readPreviousMerlinSnapshot().toString("utf8"),
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
});

test("map counts/details cover all records; unchanged coordinates retain all memberships", () => {
  for (const old of unchangedBaseline) {
    const now = byId.get(old.composite_id);
    assert.deepEqual(index.get(now), oldIndex.get(old));
    assert.equal(
      survey.getObservationArea(now.latitude, now.longitude),
      survey.getObservationArea(old.latitude, old.longitude),
    );
  }
  const ast = tree(read("src/components/observation-map.tsx"));
  const bubbles = evaluate(`return(data)=>(${memo(ast, "bubbles")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
  });
  assert.deepEqual(bubbles(unchangedCurrent), bubbles(unchangedBaseline));
  assert.equal(
    bubbles(rows).reduce((n, b) => n + b.count, 0),
    14960,
  );
  assert.equal(evaluate(`return(data)=>(${memo(ast, "observationsMap")})();`)(rows).size, 14960);
});

test("five filtering pipelines preserve existing data and include new rows in all relevant filters", () => {
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
    ...["04", "05", "07", "08", "09", "11"].map((m) => ({
      time: new Map([["2026", new Set([m])]]),
    })),
    ...["research", "needs_id", "casual"].map((q) => ({ qualityGrades: new Set([q]) })),
    ...geo.features.map((f) => ({ areas: new Set(), monitoringAreas: new Set([f.properties.id]) })),
    ...survey.SURVEY_AREA_KEYS.map((a) => ({ areas: new Set([a]), monitoringAreas: new Set() })),
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
    {
      drawnPolygon: {
        type: "Polygon",
        coordinates: [
          [
            [35.221, 32.745],
            [35.223, 32.745],
            [35.223, 32.747],
            [35.221, 32.747],
            [35.221, 32.745],
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
        `${functionText(ast, "parseObsTimestamp")}return(observations,filters)=>(${memo(ast, name)})();`,
        { ...store, ...areas, ...quality, observationMonitoringAreaIndex: membership },
      );
    const current = make(index),
      before = make(oldIndex);
    for (const patch of scenarios)
      assert.deepEqual(
        ids(
          current(rows, { ...defaults, ...patch }).filter((o) => unchangedIds.has(o.composite_id)),
        ),
        ids(before(unchangedBaseline, { ...defaults, ...patch })),
        name,
      );
    assert.equal(current(rows, defaults).length, 14960);
    assert.equal(
      current(rows, { ...defaults, time: new Map([["2026", new Set()]]) }).filter(
        (o) => o.source === "merlin",
      ).length,
      1310,
    );
    const source = (patch) => current(added, { ...defaults, ...patch });
    assert.equal(source({ taxa: new Set(["birds"]) }).length, 519);
    assert.equal(source({ taxa: new Set(["dragonflies"]) }).length, 501);
    assert.equal(source({ speciesTypes: new Set(["rare"]) }).length, 87);
    assert.equal(source({ speciesTypes: new Set(["invasive"]) }).length, 30);
    assert.deepEqual(ids(current([byId.get(corrected)], { ...defaults, ...scenarios.at(-1) })), [
      corrected,
    ]);
    assert.equal(
      before([baseline.find((o) => o.composite_id === corrected)], {
        ...defaults,
        ...scenarios.at(-1),
      }).length,
      0,
    );
  }
});

test("metrics, species choices and time-series include all new observations", () => {
  const metrics = tree(read("src/components/metrics-table.tsx"));
  const compute = evaluate(`${functionText(metrics, "computeRow")}return computeRow;`, store);
  assert.deepEqual(compute(unchangedCurrent), compute(unchangedBaseline));
  assert.equal(compute(rows).observations, 14960);
  assert.equal(compute(experts).observations, 3664);
  assert.equal(compute(added).distinctSpecies, 100);
  const deep = tree(read("src/components/species-deep-dive.tsx"));
  const speciesMap = loadProductionModule("src/lib/species-map.ts").speciesMap;
  const choices = evaluate(`return(observations)=>(${memo(deep, "groupedSpecies")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
    speciesMap,
    categories: store.TAXA_GROUP_KEYS,
  })(rows);
  for (const o of added)
    assert.ok(choices[store.getTaxaGroup(o)].some((s) => s.Scientific_Name === o.scientific_name));
  const summary = evaluate(`return(deepDiveFiltered)=>(${memo(deep, "summary")})();`, store);
  assert.deepEqual(summary(added), { rows: 1020, observers: 1, species: 100, unidentified: 0 });
  const chart = tree(read("src/components/time-series-chart.tsx"));
  const counts = evaluate(
    `return(data)=>(${memo(chart, "{ rawCounts, allSortKeys, allGroups }")})();`,
    { lang: "en", translateMonth: String, PROFESSIONAL_MONITORING_KEY: "expert" },
  )(rows);
  assert.equal(
    [...counts.rawCounts.values()].reduce(
      (s, m) => s + [...m.counts.values()].reduce((a, n) => a + n, 0),
      0,
    ),
    14960,
  );
  assert.equal(
    [...counts.rawCounts.values()].reduce((s, m) => s + (m.counts.get("expert") ?? 0), 0),
    3664,
  );
  const insights = loadProductionModule("src/components/species-insights-table.tsx");
  assert.deepEqual(
    insights.getTopSpecies(unchangedCurrent, new Set(), null),
    insights.getTopSpecies(unchangedBaseline, new Set(), null),
  );
});

test("both CSV languages preserve all prior rows except 113424 and export exact source names and coordinates", async () => {
  let blob;
  const ast = tree(read("src/lib/export-observations.ts"));
  const exporter = evaluate(
    `const ${variable(ast, "ENGLISH_HEADERS").getText(ast)};${functionText(ast, "exportObservations")}return exportObservations;`,
    {
      ...store,
      ...areas,
      ...survey,
      ...loadProductionModule("src/lib/species-dictionary.ts"),
      ...loadProductionModule("src/lib/i18n.tsx"),
      Papa,
      Blob,
      URL: { createObjectURL: (b) => ((blob = b), "blob:test"), revokeObjectURL() {} },
      document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
      setTimeout: (f) => f(),
    },
  );
  for (const lang of ["he", "en"]) {
    exporter(baseline, geo, oldIndex, lang);
    const before = Papa.parse(await blob.text(), { header: true }).data;
    exporter(rows, geo, index, lang);
    const after = Papa.parse(await blob.text(), { header: true }).data;
    const id = lang === "he" ? "מזהה תצפית" : "Observation ID";
    const lat = lang === "he" ? "קו רוחב" : "Latitude",
      lon = lang === "he" ? "קו אורך" : "Longitude";
    const common = lang === "he" ? "שם נפוץ" : "Common Name";
    assert.equal(after.length, 14960);
    assert.equal(Object.keys(after[0]).length, 18);
    assert.deepEqual(
      after.filter((o) => unchangedIds.has(o[id])),
      before.filter((o) => unchangedIds.has(o[id])),
    );
    for (const row of after.filter((r) => r.Source === "MERLIN" || r["מקור"] === "MERLIN")) {
      const o = byId.get(row[id]);
      assert.equal(+row[lat], o.latitude);
      assert.equal(+row[lon], o.longitude);
      assert.equal(
        row[common],
        lang === "he" ? o.common_name : o.professional_metadata.taxonomy.englishName,
      );
    }
    const fixed = after.find((r) => r[id] === corrected);
    assert.equal(+fixed[lat], 32.745815);
    assert.equal(+fixed[lon], 35.221931);
    exporter(
      beforeNameFix,
      geo,
      areas.buildObservationMonitoringAreaIndex(beforeNameFix, geo),
      lang,
    );
    const beforeNames = Papa.parse(await blob.text(), { header: true }).data;
    const currentExperts = after.filter((r) => r.Source === "MERLIN" || r["מקור"] === "MERLIN");
    const scientific = lang === "he" ? "שם מדעי" : "Scientific Name";
    const expected = beforeNames.map((r) =>
      r[id] === key("137747")
        ? {
            ...r,
            [scientific]: "zygonyx torridus",
            [common]: lang === "he" ? "דאונית אשדים" : "Ringed cascader",
          }
        : r,
    );
    assert.equal(currentExperts.length, expected.length);
    const expectedById = new Map(expected.map((r) => [r[id], r]));
    for (const current of currentExperts)
      assert.deepEqual(current, expectedById.get(current[id]), current[id]);
  }
});

test("active code has no archive, old-snapshot or temporary coordinate-correction dependency", () => {
  assert.doesNotMatch(
    read("src/lib/observations-store.tsx"),
    /MERLIN all observations|synchronizeMerlin|MERLIN_SYNC|parseMerlinRow|data-archive/,
  );
  assert.doesNotMatch(
    read("src/lib/merlin-source.ts"),
    /MERLIN_COORDINATE_CORRECTION|113424|32\.74648|35\.218938/,
  );
  assert.ok(
    !state.requests.some(
      (p) => p.includes("2026-11-05") || p.includes("Zohar") || p.includes("archive"),
    ),
  );
});
