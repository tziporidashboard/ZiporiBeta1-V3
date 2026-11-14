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

const payload = JSON.parse(read("public/inaturalist-october-2026-additions.json"));
const state = await loadDirectDashboard();
assert.deepEqual(state.errors, []);
// Preserve the original 792-record import's regression scope. The separately
// reviewed six-record follow-up is covered by inaturalist-observed-display.test.
const all = state.observations.slice(0, 16181);
const historical = all.slice(0, 15389);
const added = all.slice(15389);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const ids = (rows) => rows.map((o) => o.composite_id);
const store = loadProductionModule("src/lib/observations-store.tsx");
const { appendInaturalistAdditions } = loadProductionModule("src/lib/inaturalist-additions.ts");
const { parseObservedOn, parseObservedTime } = loadPipeline(read("src/lib/observations-store.tsx"));
const append = (rows = historical, batch = payload) =>
  appendInaturalistAdditions(rows, batch, parseObservedOn, parseObservedTime);
const byId = new Map(all.map((o) => [o.composite_id, o]));
const dateOnly = ["410656322", "410656327", "410526238"];
const held = ["410656308", "410656312", "410656314", "410656316", "410656320", "410656326"];
const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const index = areas.buildObservationMonitoringAreaIndex(all, geo);
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);

test("792 verified additions preserve the entire 15,389-row production snapshot, including all 99 missing IDs and MERLIN", () => {
  // Captured by executing the unmodified production effect at 59ca8d5; the
  // relevant 96 files match official main 91cad70 byte-for-byte after Git EOL normalization.
  assert.equal(
    hash(JSON.stringify(historical)),
    "ebff2a887d42003b3c02990d5928abc71a59e2c2124d78c8d4d20f9d2334a0a4",
  );
  assert.equal(all.length, 16181);
  assert.equal(added.length, 792);
  assert.equal(new Set(ids(all)).size, 16181);
  assert.equal(all.filter((o) => o.source === "inaturalist").length, 12088);
  assert.equal(all.filter((o) => o.source === "merlin").length, 4093);
  assert.deepEqual(payload.source.heldUnverifiedDateIds, held);
  for (const id of held) assert.ok(!byId.has(`inat_${id}`));
  historical.forEach(Object.freeze);
  Object.freeze(historical);
  assert.deepEqual(append(), all);
  const repeated = append(all);
  assert.deepEqual(repeated, all);
  all.forEach((row, i) => assert.equal(repeated[i], row));
  assert.equal(
    [...state.counts.values()].reduce((a, b) => a + b, 0),
    16187,
  );
  assert.equal(
    state.stats.reduce((n, s) => n + s.totalObservations, 0),
    16187,
  );
});

test("stable numeric IDs, UUIDs, source literals and API provenance are retained independently", () => {
  assert.equal(
    hash(read("public/inaturalist-october-2026-additions.json")),
    "b367c3fd3c6efc48100efd039fdffe23f2595539bd5194004c196f79795b2c28",
  );
  assert.equal(
    payload.source.sha256,
    "458236338a35c2a8ae43a5724e5b031bcf720d02a66bed6a96d717d9ea4edf14",
  );
  assert.equal(new Set(payload.records.map((r) => r.verification.uuid)).size, 792);
  for (const r of payload.records) {
    const o = byId.get(`inat_${r.inaturalist_id}`);
    const v = r.verification;
    assert.equal(v.uuid, r.values.originalRecordId);
    assert.equal(o.source_url, `https://www.inaturalist.org/observations/${r.inaturalist_id}`);
    assert.notEqual(o.composite_id, r.values.composite_id);
    assert.equal(Object.keys(o.source_metadata.values).length, 22);
    assert.deepEqual(o.source_metadata.values, r.values);
    assert.deepEqual(o.source_metadata.verification, v);
    assert.equal(o.quality_grade, v.quality_grade);
    assert.equal(o.scientific_name, v.scientific_name);
    assert.equal(o.user_login, v.user_login);
    assert.ok(Math.abs(o.latitude - v.latitude) <= 1e-8);
    assert.ok(Math.abs(o.longitude - v.longitude) <= 1e-8);
    assert.equal(v.obscured, false);
    assert.ok([null, "open"].includes(v.geoprivacy));
    assert.ok([null, "open"].includes(v.taxon_geoprivacy));
  }
});

test("verified calendar dates and times survive; three date-only rows never acquire midnight", () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (const r of payload.records) {
    const o = byId.get(`inat_${r.inaturalist_id}`),
      v = r.verification;
    assert.equal(o.observed_on, r.observed_date);
    assert.equal(o.observed_on.split("/").reverse().join("-"), v.observed_on);
    if (dateOnly.includes(r.inaturalist_id)) {
      assert.equal(o.observed_time, undefined);
      assert.equal(r.values.observed_on, "2026-10-24");
    } else {
      const p = Object.fromEntries(
        formatter
          .formatToParts(new Date(v.time_observed_at))
          .map((part) => [part.type, part.value]),
      );
      assert.equal(
        `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`,
        r.values.observed_on,
      );
      assert.equal(o.observed_time, `${p.hour}:${p.minute}:${p.second}`);
    }
  }
  assert.equal(added.filter((o) => o.observed_time === undefined).length, 3);
});

test("approved observation-level groups preserve both historical assignments of mixed users", () => {
  for (const [login, online, subgroup, priorLocal, newLocal] of [
    ["roni77791", 94, "zevulun", 20, 7],
    ["sarafiscer2", 73, "yizrael", 9, 18],
  ]) {
    const old = historical.filter((o) => o.user_login === login);
    assert.equal(old.filter((o) => o.user_category === "online_communities").length, online);
    assert.equal(old.filter((o) => o.user_subcategory === subgroup).length, priorLocal);
    const next = added.filter((o) => o.user_login === login);
    assert.equal(next.length, newLocal);
    assert.ok(
      next.every((o) => o.user_category === "local_communities" && o.user_subcategory === subgroup),
    );
  }
  assert.equal(added.filter((o) => o.user_category === "online_communities").length, 651);
  assert.equal(added.filter((o) => o.user_subcategory === "zevulun").length, 121);
  assert.equal(added.filter((o) => o.user_subcategory === "yizrael").length, 20);
});

test("more specific public taxon identifications are retained without changing local dictionaries or species status", () => {
  for (const id of ["406949928", "336785591"]) {
    assert.equal(byId.get(`inat_${id}`).scientific_name, "Garrulus glandarius atricapillus");
    assert.equal(byId.get(`inat_${id}`).source_metadata.verification.taxon_id, 509323);
  }
  assert.equal(byId.get("inat_408300349").scientific_name, "Columba livia domestica");
  const changed = structuredClone(payload);
  for (const r of changed.records) {
    r.values.is_rare = "1";
    r.values.is_invasive = "1";
  }
  const withSourceFlags = append([], changed);
  assert.deepEqual(
    withSourceFlags.map(store.getSpeciesClassification),
    added.map(store.getSpeciesClassification),
  );
  assert.deepEqual(withSourceFlags.map(store.getTaxaGroup), added.map(store.getTaxaGroup));
});

test("unverified dates, incompatible privacy, UUID mismatches, invalid coordinates and duplicates fail closed", () => {
  for (const mutate of [
    (r) => (r.verification.date_status = "unresolved"),
    (r) => (r.verification.uuid = "a".repeat(36)),
    (r) => (r.verification.obscured = true),
    (r) => (r.verification.geoprivacy = "private"),
    (r) => (r.verification.latitude = 0),
    (r) => (r.observed_date = "31/02/2026"),
    (r) => (r.observed_time = "25:10:00"),
    (r) => (r.values.quality_grade = "invalid"),
    (r) => (r.values.user_subcategory = "unknown"),
  ]) {
    const batch = structuredClone(payload);
    batch.records = [batch.records[0]];
    mutate(batch.records[0]);
    assert.throws(() => append([], batch), /Invalid|Unverified/);
  }
  const duplicate = structuredClone(payload);
  duplicate.records.push(duplicate.records[0]);
  assert.throws(() => append([], duplicate), /duplicate/);
  const fakeHour = structuredClone(payload);
  fakeHour.records = fakeHour.records.filter((r) => dateOnly.includes(r.inaturalist_id));
  fakeHour.records[0].observed_time = "00:00:00";
  assert.throws(() => append([], fakeHour), /Unverified/);
});

test("all five filter consumers include new dates, source grades, groups, taxa and monitoring memberships", () => {
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
    for (const [grade, n] of [
      ["research", 302],
      ["needs_id", 314],
      ["casual", 176],
    ])
      assert.equal(run(added, { ...defaults, qualityGrades: new Set([grade]) }).length, n);
    for (const group of ["online_communities", "local_communities"])
      assert.deepEqual(
        ids(run(added, { ...defaults, groups: new Set([group]) })),
        // Comparison chart and metrics intentionally retain all groups.
        ids(
          name === "chartData" || name === "metricsData" || file === "people-dashboard.tsx"
            ? added
            : added.filter((o) => o.user_category === group),
        ),
      );
    for (const taxa of store.TAXA_GROUP_KEYS)
      assert.deepEqual(
        ids(run(added, { ...defaults, taxa: new Set([taxa]) })),
        ids(added.filter((o) => store.getTaxaGroup(o) === taxa)),
      );
    for (const day of new Set(added.map((o) => o.observed_on))) {
      const [d, m, y] = day.split("/").map(Number),
        ts = new Date(y, m - 1, d).getTime();
      assert.deepEqual(
        ids(run(added, { ...defaults, dateRange: { start: ts, end: ts } })),
        ids(added.filter((o) => o.observed_on === day)),
      );
    }
    for (const area of geo.features)
      assert.deepEqual(
        ids(
          run(added, {
            ...defaults,
            areas: new Set(),
            monitoringAreas: new Set([area.properties.id]),
          }),
        ),
        ids(added.filter((o) => index.get(o)?.has(area.properties.id))),
      );
  }
});

test("both CSV languages include every new ID and preserve date-only precision", async () => {
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
    exporter(all, geo, index, lang);
    const parsed = Papa.parse(await blob.text(), { header: true });
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.data.length, 16181);
    const id = lang === "he" ? "מזהה תצפית" : "Observation ID";
    const time = lang === "he" ? "שעת תצפית" : "Observation Time";
    assert.deepEqual(
      parsed.data.map((r) => r[id]),
      ids(all),
    );
    for (const r of parsed.data.filter((r) => dateOnly.some((n) => r[id] === `inat_${n}`)))
      assert.equal(r[time], "");
  }
});
