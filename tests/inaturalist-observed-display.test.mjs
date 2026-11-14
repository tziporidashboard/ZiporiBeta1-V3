import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Papa from "papaparse";
import { loadDirectDashboard } from "./helpers/merlin-direct-source.mjs";
import {
  evaluate,
  functionText,
  loadPipeline,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";

const batch = JSON.parse(read("public/inaturalist-observed-display-additions.json"));
const review = JSON.parse(read("docs/inaturalist-observed-display-2026-11-14/review.json"));
const state = await loadDirectDashboard();
assert.deepEqual(state.errors, []);
const all = state.observations,
  before = all.slice(0, 16181),
  added = all.slice(16181);
const store = loadProductionModule("src/lib/observations-store.tsx");
const { appendInaturalistAdditions } = loadProductionModule("src/lib/inaturalist-additions.ts");
const pipeline = loadPipeline(read("src/lib/observations-store.tsx"));
const append = (rows = before, payload = batch) =>
  appendInaturalistAdditions(rows, payload, pipeline.parseObservedOn, pipeline.parseObservedTime);
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const ids = (rows) => rows.map((o) => o.composite_id);
const expectedIds = ["410656308", "410656312", "410656314", "410656316", "410656320", "410656326"];
const expectedTimes = ["00:09", "00:08", "00:08", "00:08", "00:08", "00:07"];

test("six reviewed additions preserve every field, order and derived classification of all 16,181 existing observations", () => {
  assert.equal(hash(before), "41c467d06891e15619c837d1533f1ac7e6230fb9fc329782717338d075df5eb8");
  assert.equal(
    hash(
      before.map((o) => ({
        id: o.composite_id,
        taxa: store.getTaxaGroup(o),
        details: store.getObservationTaxonDetails(o),
        status: store.getSpeciesClassification(o),
        key: store.getObservationSpeciesKey(o),
      })),
    ),
    "4157306bfbd6996eeb56866e52f392fd31a95291c67cd77f5450d78b84a7c67e",
  );
  assert.equal(all.length, 16187);
  assert.equal(new Set(ids(all)).size, 16187);
  assert.equal(all.filter((o) => o.source === "inaturalist").length, 12094);
  assert.equal(all.filter((o) => o.source === "merlin").length, 4093);
  assert.deepEqual(
    ids(added),
    expectedIds.map((id) => `inat_${id}`),
  );
  const frozen = before.map((o) => Object.freeze(o));
  Object.freeze(frozen);
  const result = append(frozen);
  assert.deepEqual(result, all);
  frozen.forEach((row, index) => assert.equal(result[index], row));
  const repeated = append(all);
  assert.deepEqual(repeated, all);
  all.forEach((row, index) => assert.equal(repeated[index], row));
  assert.equal(
    [...state.counts.values()].reduce((a, b) => a + b, 0),
    16187,
  );
  assert.equal(
    state.stats.reduce((n, s) => n + s.totalObservations, 0),
    16187,
  );
});

test("visible Observed field controls the six timestamps with minute precision; conflicting source fields remain intact", () => {
  assert.equal(review.mapping_confirmed_by_user, true);
  assert.equal(review.mapping_confirmation_he, "כן, זה סדר התמונות");
  const reviewHash = createHash("sha256")
    .update(read("docs/inaturalist-observed-display-2026-11-14/review.json").replace(/\r\n/g, "\n"))
    .digest("hex");
  assert.equal(batch.source.dateAuditSha256, reviewHash);
  added.forEach((o, i) => {
    const r = batch.records[i],
      v = o.source_metadata.verification,
      display = v.observed_display;
    assert.equal(o.observed_on, "25/10/2026");
    assert.equal(o.observed_time, expectedTimes[i]);
    assert.equal(display.displayed_time, expectedTimes[i]);
    assert.equal(display.precision, "minute");
    assert.equal(display.time_zone_label, "IDT");
    assert.equal(v.date_status, "verified_observed_display");
    assert.equal(v.observed_on, "2026-10-25");
    assert.ok(v.observed_on_string.startsWith("2026/10/24 23:"));
    assert.equal(v.time_observed_at, `2026-10-25T${expectedTimes[i]}:00+03:00`);
    assert.match(o.source_metadata.values.observed_on, /^2026-10-25 09:48:1[4-7]$/);
    assert.equal(Object.keys(o.source_metadata.values).length, 22);
    assert.deepEqual(o.source_metadata.values, r.values);
    assert.deepEqual(o.source_metadata.verification, r.verification);
    assert.equal(display.screenshot_sha256, review.records[i].screenshot_sha256);
    assert.equal(o.source_url, display.observation_url);
    assert.equal(v.uuid, r.values.originalRecordId);
  });
  for (const id of ["410656322", "410656327", "410526238"])
    assert.equal(all.find((o) => o.composite_id === `inat_${id}`).observed_time, undefined);
});

test("new records keep source user groups, public coordinates, taxonomic ranks and local species status", () => {
  const registry = loadProductionModule("src/lib/species-registry.ts");
  for (const o of added) {
    const v = o.source_metadata.verification;
    assert.equal(o.user_login, "yuvalev");
    assert.equal(o.user_category, "online_communities");
    assert.equal(o.user_subcategory, "community");
    assert.equal(o.quality_grade, v.quality_grade);
    assert.equal(o.latitude, v.latitude);
    assert.equal(o.longitude, v.longitude);
    assert.equal(v.obscured, false);
    assert.equal(v.geoprivacy, null);
    assert.equal(o.scientific_name, v.scientific_name);
    assert.equal(store.getObservationTaxonDetails(o).isGeneric, v.taxon_rank === "genus");
    const status = registry.classifySpecies(o.scientific_name);
    assert.equal(store.getSpeciesClassification(o), status === "other" ? "other_species" : status);
  }
  assert.equal(added.filter((o) => o.quality_grade === "research").length, 4);
  assert.equal(added.filter((o) => o.quality_grade === "needs_id").length, 2);
});

test("missing or forged display evidence, wrong IDs, source dates, times, privacy and duplicate records are rejected", () => {
  for (const mutate of [
    (p) => delete p.records[0].verification.observed_display,
    (p) => (p.records[0].verification.observed_display.screenshot_sha256 = "0".repeat(64)),
    (p) => (p.records[0].verification.observed_display.inaturalist_id = "410656312"),
    (p) =>
      (p.records[0].verification.observed_display.observation_url =
        "https://www.inaturalist.org/observations/1"),
    (p) => (p.records[0].verification.observed_display.displayed_date = "2026-10-24"),
    (p) => (p.records[0].verification.observed_display.time_zone_label = "IST"),
    (p) => (p.records[0].verification.observed_display.precision = "second"),
    (p) => (p.records[0].verification.observed_display.displayed_observer = "other"),
    (p) => (p.records[0].observed_time = "00:09:00"),
    (p) => (p.records[0].observed_date = "24/10/2026"),
    (p) => (p.records[0].values.observed_on = "2026-10-25 00:09"),
    (p) => (p.records[0].verification.time_observed_at = "2026-10-24T23:09:00+03:00"),
    (p) => (p.records[0].verification.obscured = true),
    (p) => (p.records[0].verification.geoprivacy = "private"),
    (p) => (p.records[0].verification.latitude = 0),
    (p) => (p.records[0].verification.uuid = p.records[1].verification.uuid),
    (p) => (p.records[0].verification.date_status = "verified_datetime"),
    (p) => (p.source.sha256 = "0".repeat(64)),
    (p) => (p.source.dateAuditSha256 = "0".repeat(64)),
    (p) => (p.schemaVersion = 2),
    (p) => (p.schemaVersion = "3"),
    (p) => {
      p.records[0].inaturalist_id = "12345";
      p.records[0].verification.inaturalist_id = "12345";
    },
    (p) => p.records.push(p.records[0]),
  ]) {
    const changed = structuredClone(batch);
    mutate(changed);
    assert.throws(() => append([], changed), /Invalid|Unverified|Unsupported|duplicate/);
  }
});

test("an unavailable supplemental source does not publish a partial dataset", async () => {
  const failed = await loadDirectDashboard({
    failUrl: "/inaturalist-observed-display-additions.json",
  });
  assert.equal(failed.observations, undefined);
  assert.equal(failed.errors.length, 1);
});

const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const index = areas.buildObservationMonitoringAreaIndex(all, geo);
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);

test("dashboard, chart, metrics, people and species filters include all six on the reviewed day", () => {
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
  for (const [file, name] of [
    ["dashboard.tsx", "filtered"],
    ["dashboard.tsx", "chartData"],
    ["dashboard.tsx", "metricsData"],
    ["people-dashboard.tsx", "globallyFilteredObservations"],
    ["species-deep-dive.tsx", "globallyFilteredObservations"],
  ]) {
    const ast = tree(read(`src/components/${file}`));
    const run = evaluate(
      `${functionText(ast, "parseObsTimestamp")}return(observations,filters)=>(${memo(ast, name)})();`,
      { ...store, ...areas, ...quality, observationMonitoringAreaIndex: index },
    );
    assert.deepEqual(ids(run(added, defaults)), ids(added));
    const date = (day) => ({
      start: new Date(2026, 9, day).getTime(),
      end: new Date(2026, 9, day).getTime(),
    });
    assert.deepEqual(ids(run(added, { ...defaults, dateRange: date(25) })), ids(added));
    assert.equal(run(added, { ...defaults, dateRange: date(24) }).length, 0);
    assert.equal(run(added, { ...defaults, qualityGrades: new Set(["research"]) }).length, 4);
    assert.equal(run(added, { ...defaults, qualityGrades: new Set(["needs_id"]) }).length, 2);
    for (const taxa of store.TAXA_GROUP_KEYS)
      assert.deepEqual(
        ids(run(added, { ...defaults, taxa: new Set([taxa]) })),
        ids(added.filter((o) => store.getTaxaGroup(o) === taxa)),
      );
  }
});

test("map bubbles resolve all six original IDs and their reviewed times", () => {
  const ast = tree(read("src/components/observation-map.tsx"));
  const run = evaluate(`return(data)=>(${memo(ast, "bubbles")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
  });
  const bubbles = run(added);
  assert.equal(
    bubbles.reduce((n, b) => n + b.count, 0),
    6,
  );
  assert.deepEqual(bubbles.flatMap((b) => b.observation_ids).sort(), ids(added).sort());
  const observationMap = evaluate(`return(data)=>(${memo(ast, "observationsMap")})();`)(all);
  added.forEach((o) => assert.equal(observationMap.get(o.composite_id), o));
});

test("Hebrew and English CSV exports preserve every historical cell and include the six minute-precision dates", async () => {
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
    exporter(before, geo, index, lang);
    const previous = Papa.parse(await blob.text(), { header: true }).data;
    exporter(all, geo, index, lang);
    const exported = Papa.parse(await blob.text(), { header: true });
    assert.deepEqual(exported.errors, []);
    assert.equal(exported.data.length, 16187);
    assert.deepEqual(exported.data.slice(0, 16181), previous);
    const fields =
      lang === "he"
        ? ["מזהה תצפית", "תאריך תצפית", "שעת תצפית"]
        : ["Observation ID", "Observation Date", "Observation Time"];
    exported.data.slice(16181).forEach((r, i) => {
      assert.equal(r[fields[0]], `inat_${expectedIds[i]}`);
      assert.equal(r[fields[1]], "2026-10-25");
      assert.equal(r[fields[2]], expectedTimes[i]);
    });
  }
});
