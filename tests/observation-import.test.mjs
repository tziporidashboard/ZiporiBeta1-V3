import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Papa from "papaparse";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import {
  evaluate,
  functionText,
  loadPipeline,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";

const dataPath = "public/inaturalist-september-2026-additions.json";
const batch = JSON.parse(read(dataPath));
const storePath = "src/lib/observations-store.tsx";
const source = read(storePath);
const storeAst = tree(source);
const store = loadProductionModule(storePath);
const quality = loadProductionModule("src/lib/quality-filter.ts");
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const dictionary = loadProductionModule("src/lib/species-dictionary.ts");
const i18n = loadProductionModule("src/lib/i18n.tsx");
const enrichment = loadProductionModule("src/lib/observation-enrichment.ts");
const { appendInaturalistAdditions } = loadProductionModule("src/lib/inaturalist-additions.ts");
const csv = (path) => {
  const result = Papa.parse(read(path), { header: true, skipEmptyLines: true });
  assert.deepEqual(result.errors, []);
  return result.data;
};
const inat = csv("public/Until_June26.csv");
const merlin = csv("public/MERLIN all observations for Zohar.csv");
const users = new Map(csv("public/user_groups.csv").map((row) => [row.user_login, row.group]));
const pipeline = loadPipeline(source);
const historical = pipeline.load(inat, merlin, users);
historical.forEach(Object.freeze);
Object.freeze(historical);
const append = (existing = historical, payload = batch) =>
  appendInaturalistAdditions(
    existing,
    payload,
    pipeline.parseObservedOn,
    pipeline.parseObservedTime,
  );
const ids = (rows) => rows.map((row) => row.composite_id).sort();
const countBy = (rows, key) => {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return counts;
};
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);

// Execute the complete production loader (not a test-only reconstruction of its
// merge). Supply the exact public assets through a local fetch adapter.
const requests = [];
const state = {};
const assets = {
  "/user_groups.csv": "public/user_groups.csv",
  "/Until_June26.csv": "public/Until_June26.csv",
  "/MERLIN all observations for Zohar.csv": "public/MERLIN all observations for Zohar.csv",
  "/inaturalist-september-2026-additions.json": dataPath,
};
const loader = evaluate(
  `${["CATEGORY_MAP", "ODONATA_FAMILIES", "REA_SHAISH_NAME"]
    .map((name) => `const ${variable(storeAst, name).getText(storeAst)};`)
    .join("\n")}
  ${["getSupergroup", "parseObservedOn", "parseObservedTime", "parseMerlinRow"]
    .map((name) => functionText(storeAst, name))
    .join("\n")}
  return ${variable(storeAst, "loadData").initializer.getText(storeAst)};`,
  {
    ...enrichment,
    appendInaturalistAdditions,
    Papa,
    console: { log() {}, error: (...args) => assert.fail(args.join(" ")) },
    fetch: async (url) => {
      requests.push(url);
      assert.ok(assets[url], `Unexpected fetch ${url}`);
      return {
        ok: true,
        text: async () => read(assets[url]),
        json: async () => JSON.parse(read(assets[url])),
      };
    },
    setObservations: (rows) => {
      state.observations = rows;
    },
    setUserObservationCounts: (counts) => {
      state.counts = counts;
    },
    setObserverStats: (stats) => {
      state.stats = stats;
    },
    setDatasetBounds: (bounds) => {
      state.bounds = bounds;
    },
    setFilters: (update) => {
      state.filters = update({ qualityGrades: quality.createDefaultQualitySelection() });
    },
  },
);
await loader();
const observations = state.observations;
const additions = observations.slice(historical.length);
observations.forEach(Object.freeze);
Object.freeze(observations);
const monitoringAreas = JSON.parse(read("public/monitoring-areas.geojson"));
const index = areas.buildObservationMonitoringAreaIndex(observations, monitoringAreas);
const bindings = { ...store, ...quality, ...areas, observationMonitoringAreaIndex: index };
const defaults = () => ({
  dateRange: null,
  time: new Map(),
  taxa: new Set(store.TAXA_GROUP_KEYS),
  speciesTypes: new Set(["invasive", "rare", "other_species"]),
  qualityGrades: quality.createDefaultQualitySelection(),
  groups: new Set(["expert", "local_communities", "online_communities"]),
  localCommunitySubgroups: new Set(["student", "mechnistim", "zevulun", "yizrael"]),
  areas: new Set(survey.SURVEY_AREA_KEYS),
  monitoringAreas: new Set(monitoringAreas.features.map((f) => f.properties.id)),
});
const consumers = [
  ["dashboard.tsx", "filtered"],
  ["dashboard.tsx", "chartData"],
  ["dashboard.tsx", "metricsData"],
  ["people-dashboard.tsx", "globallyFilteredObservations"],
  ["species-deep-dive.tsx", "globallyFilteredObservations"],
].map(([file, name]) => {
  const ast = tree(read(`src/components/${file}`));
  return {
    name: `${file}/${name}`,
    run: evaluate(
      `${functionText(ast, "parseObsTimestamp")} return (observations, filters) => (${memo(ast, name)})();`,
      bindings,
    ),
  };
});

test("production loader adds exactly 979 original IDs and retains all 12,674 historical objects", () => {
  assert.deepEqual(requests, Object.keys(assets));
  assert.equal(observations.length, 13653);
  assert.equal(additions.length, 979);
  assert.equal(new Set(ids(observations)).size, 13653);
  assert.deepEqual(observations.slice(0, historical.length), historical);
  assert.equal(
    createHash("sha256").update(JSON.stringify(historical)).digest("hex"),
    "b32476e2cd6ee766678b58d583314f2ea802dab368e7fa95587a027ae87d421a",
  );
  assert.deepEqual(countBy(observations, "source"), { inaturalist: 11296, merlin: 2357 });
  assert.deepEqual(append(), observations);
});

test("the separate batch is the exact source-verified snapshot and contains all 22 original fields", () => {
  assert.equal(
    createHash("sha256").update(read(dataPath)).digest("hex"),
    "faeae6099f82360b517a9acdddc3aea859cccced8268aabb27e52b35fd527f4d",
  );
  // Keep the approved CRLF source hash; normalize only LF/CRLF in memory.
  // Do not trim content or normalize lone CR characters.
  const historicalSource = read(batch.source.historicalFile);
  const historicalHash = (csv) =>
    createHash("sha256").update(csv.replace(/\r?\n/g, "\r\n")).digest("hex");
  const lfSource = historicalSource.replace(/\r\n/g, "\n");
  for (const csv of [historicalSource, lfSource, lfSource.replace(/\n/g, "\r\n")]) {
    assert.equal(historicalHash(csv), batch.source.historicalSha256);
  }
  // A changed ID, removed content, whitespace or lone CR must still fail integrity.
  for (const changedSource of [
    historicalSource.replace(inat[0].id, `${inat[0].id}0`),
    historicalSource.slice(0, -100),
    `${historicalSource} `,
    `${historicalSource}\r`,
  ]) {
    assert.notEqual(historicalHash(changedSource), batch.source.historicalSha256);
  }
  assert.equal(batch.source.idColumn, "originalRecordId");
  assert.equal(new Set(batch.records.map((r) => r.values.originalRecordId)).size, 979);
  for (const row of batch.records) assert.equal(Object.keys(row.values).length, 22);
  assert.deepEqual(
    ids(additions),
    batch.records.map((r) => `inat_${r.values.originalRecordId}`).sort(),
  );
  assert.ok(additions.every((r) => !historical.some((h) => h.composite_id === r.composite_id)));
});

test("repeated loading is idempotent; repeated IDs in the batch are rejected atomically", () => {
  const repeated = append(observations);
  assert.deepEqual(repeated, observations);
  observations.forEach((row, i) => assert.equal(repeated[i], row));
  const duplicate = structuredClone(batch);
  duplicate.records.push(duplicate.records[0]);
  assert.throws(() => append(historical, duplicate), /duplicate originalRecordId/);
  assert.equal(historical.length, 12674);
});

test("a later conflicting version of an already loaded ID cannot overwrite its quality or groups", () => {
  const changed = structuredClone(batch);
  changed.records[0].values.quality_grade = "casual";
  changed.records[0].values.user_category = "students";
  changed.records[0].values.user_subcategory = "students";
  assert.deepEqual(append(observations, changed), observations);
});

test("invalid IDs, dates, times, coordinates, grades and group combinations fail without partial mutation", () => {
  for (const modify of [
    (r) => {
      r.values.originalRecordId = "NULL";
    },
    (r) => {
      r.observed_date = "31/02/2026";
    },
    (r) => {
      r.observed_time = "25:00:00";
    },
    (r) => {
      r.values.latitude = "";
    },
    (r) => {
      r.values.longitude = "181";
    },
    (r) => {
      r.values.quality_grade = "unknown";
    },
    (r) => {
      r.values.user_category = "unknown";
    },
  ]) {
    const invalid = structuredClone(batch);
    modify(invalid.records[0]);
    assert.throws(() => append(historical, invalid), /Invalid/);
  }
  assert.equal(historical.length, 12674);
});

test("new dates and clock times agree with raw Excel serials across host timezones", () => {
  const timezone = process.env.TZ;
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    for (const zone of ["UTC", "Asia/Jerusalem", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      const loaded = append();
      batch.records.forEach((row, i) => {
        const calendar = new Date(
          Date.UTC(1899, 11, 30) + Math.round(Number(row.values.observed_on) * 86400) * 1000,
        );
        const iso = calendar.toISOString();
        const expectedDate = `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
        assert.equal(loaded[12674 + i].observed_on, expectedDate);
        assert.equal(loaded[12674 + i].observed_time, iso.slice(11, 19));
      });
    }
  } finally {
    // On Windows deleting TZ alone leaves Node in the last selected timezone.
    // Restore the original clock behavior before restoring the environment.
    process.env.TZ = timezone ?? systemTimezone;
    if (timezone === undefined) delete process.env.TZ;
  }
});

test("all supported source values and original platform metadata survive; missing names stay missing", () => {
  additions.forEach((observation, i) => {
    const row = batch.records[i],
      raw = row.values;
    assert.deepEqual(observation.source_metadata.values, raw);
    assert.equal(observation.source_metadata.excel_row, row.excel_row);
    assert.equal(observation.source_metadata.file_sha256, batch.source.sha256);
    assert.equal(observation.latitude, Number(raw.latitude));
    assert.equal(observation.longitude, Number(raw.longitude));
    assert.equal(observation.scientific_name, raw.scientific_name.trim());
    assert.equal(
      observation.common_name,
      raw.hebrew_name === "NULL" ? undefined : raw.hebrew_name.trim() || undefined,
    );
    assert.equal(observation.user_login, raw.user_login.trim());
    assert.equal(
      observation.source_url,
      `https://www.inaturalist.org/observations/${raw.originalRecordId}`,
    );
    assert.equal(observation.iconic_taxon_name, "");
    assert.equal(observation.taxon_order_name, "");
  });
  assert.equal(additions.filter((row) => !row.common_name).length, 157);
});

test("quality totals are exact; historical grades and the 512 enriched names remain untouched", () => {
  assert.deepEqual(countBy(additions, "quality_grade"), {
    research: 518,
    casual: 30,
    needs_id: 431,
  });
  assert.deepEqual(countBy(observations, "quality_grade"), {
    research: 8317,
    needs_id: 5306,
    casual: 30,
  });
  const { inaturalistCommonNames: names } = loadProductionModule(
    "src/lib/inaturalist-common-name-enrichment-data.ts",
  );
  assert.equal(Object.keys(names).length, 512);
  for (const [id, name] of Object.entries(names)) {
    assert.equal(observations.find((r) => r.composite_id === `inat_${id}`).common_name, name);
  }
  assert.deepEqual(
    observations.filter((r) => r.source === "merlin"),
    historical.filter((r) => r.source === "merlin"),
  );
});

test("Excel group policy applies to all 979 additions, including 62 conflicts, without changing 477 historical rows", () => {
  const subgroup = {
    "online communities": "community",
    zevulun: "zevulun",
    yizrael: "yizrael",
    students: "student",
    mechinistim: "mechnistim",
  };
  const conflicts = [];
  additions.forEach((row, i) => {
    const expected = subgroup[batch.records[i].values.user_subcategory];
    assert.equal(row.user_subcategory, expected);
    assert.equal(
      row.user_category,
      expected === "community" ? "online_communities" : "local_communities",
    );
    if (expected !== (users.get(row.user_login) ?? "community")) conflicts.push(row);
  });
  assert.equal(conflicts.length, 62);
  const logins = new Set(conflicts.map((r) => r.user_login));
  assert.equal(logins.size, 11);
  const affectedHistory = historical.filter((r) => logins.has(r.user_login));
  assert.equal(affectedHistory.length, 477);
  const currentById = new Map(observations.map((r) => [r.composite_id, r]));
  for (const row of affectedHistory) assert.deepEqual(currentById.get(row.composite_id), row);
  assert.deepEqual(countBy(additions, "user_category"), {
    local_communities: 339,
    online_communities: 640,
  });
  assert.deepEqual(countBy(additions, "user_subcategory"), {
    zevulun: 279,
    community: 640,
    student: 12,
    yizrael: 44,
    mechnistim: 4,
  });
});

test("all three distinct source observations are retained despite possible repeated encounters", () => {
  for (const id of ["264804474", "401017628", "401017800"]) {
    assert.equal(additions.filter((r) => r.composite_id === `inat_${id}`).length, 1);
  }
});

test("all eight quality combinations agree across maps, counters, charts, People and Species inputs", () => {
  const grades = ["research", "needs_id", "casual"];
  assert.deepEqual([...quality.createDefaultQualitySelection()], grades);
  assert.deepEqual([...state.filters.qualityGrades], grades);
  for (let mask = 0; mask < 8; mask++) {
    const filters = defaults();
    filters.qualityGrades = new Set(grades.filter((_, bit) => mask & (1 << bit)));
    const expected = observations.filter((r) => filters.qualityGrades.has(r.quality_grade));
    for (const { name, run } of consumers)
      assert.deepEqual(ids(run(observations, filters)), ids(expected), name);
  }
  // Reset uses the same existing factory, including an actual Casual population.
  const cleared = quality.createDefaultQualitySelection();
  cleared.clear();
  assert.equal(
    observations.filter((r) =>
      quality.matchesQualitySelection(r, quality.createDefaultQualitySelection()),
    ).length,
    13653,
  );
});

test("People badges, subgroup selections and main group filters include the approved additions", () => {
  const ast = tree(read("src/components/people-dashboard.tsx"));
  const run = evaluate(`const ${variable(ast, "GROUPS").getText(ast)};
    return (globallyFilteredObservations, selectedGroup) => {
      const groupObservations = (${memo(ast, "groupObservations")})();
      const displayObservations = groupObservations;
      return { rows: groupObservations, counts: (${memo(ast, "groupCounts")})(), summary: (${memo(ast, "summary")})() };
    };`);
  const expected = {
    expert: 2357,
    zevulun: 1625,
    yizrael: 339,
    mechnistim: 355,
    student: 1109,
    public: 7868,
  };
  assert.deepEqual(Object.fromEntries(run(observations, null).counts), expected);
  for (const [key, count] of Object.entries(expected)) {
    const result = run(observations, key);
    assert.equal(result.summary.rows, count);
    assert.equal(result.rows.length, count);
    const filters = defaults();
    filters.groups = new Set([
      key === "public" ? "online_communities" : key === "expert" ? "expert" : "local_communities",
    ]);
    filters.localCommunitySubgroups = new Set([key]);
    assert.deepEqual(ids(consumers[0].run(observations, filters)), ids(result.rows));
  }
});

test("the actual reset action restores all 13,653 observations, including 30 Casual and 1,109 Students", () => {
  const ast = tree(read("src/routes/index.tsx"));
  let resetFilters;
  let resetCount = 0;
  const reset = evaluate(`return ${variable(ast, "reset").initializer.getText(ast)};`, {
    ...quality,
    ...survey,
    observations,
    uniqueYears: [...new Set(observations.map((row) => row.observed_on.slice(6)))],
    datasetBounds: state.bounds,
    monitoringAreas,
    deepDiveActions: { setDeepDiveCategory: (value) => assert.equal(value, null) },
    setFilters: (value) => {
      resetFilters = value;
    },
    bumpResetVersion: () => {
      resetCount++;
    },
  });
  reset();
  assert.equal(resetCount, 1);
  assert.deepEqual([...resetFilters.qualityGrades], ["research", "needs_id", "casual"]);
  const rows = consumers[0].run(observations, resetFilters);
  assert.equal(rows.length, 13653);
  assert.equal(rows.filter((row) => row.quality_grade === "casual").length, 30);
  assert.equal(rows.filter((row) => row.user_subcategory === "student").length, 1109);
});

test("month/date-range filters, chart counts and seasonal classifications use raw source dates", () => {
  const months = new Set(additions.map((r) => r.observed_on.slice(3)));
  const ast = tree(read("src/components/time-series-chart.tsx"));
  const chart = evaluate(
    `return (data) => (${memo(ast, "{ rawCounts, allSortKeys, allGroups }")})();`,
    {
      lang: "en",
      translateMonth: String,
      PROFESSIONAL_MONITORING_KEY: "expert",
    },
  )(observations).rawCounts;
  for (const key of months) {
    const [month, year] = key.split("/");
    const expected = observations.filter((r) => r.observed_on.slice(3) === key);
    const filters = defaults();
    filters.time = new Map([[year, new Set([month])]]);
    for (const { name, run } of consumers)
      assert.deepEqual(ids(run(observations, filters)), ids(expected), name);
    filters.time = new Map();
    filters.dateRange = {
      start: new Date(Number(year), Number(month) - 1, 1).getTime(),
      end: new Date(Number(year), Number(month), 0, 23, 59, 59, 999).getTime(),
    };
    for (const { name, run } of consumers)
      assert.deepEqual(ids(run(observations, filters)), ids(expected), name);
    assert.equal(
      [...chart.get(Number(year + month)).counts.values()].reduce((a, b) => a + b, 0),
      expected.length,
    );
  }
  const seasons = [
    "חורף",
    "חורף",
    "אביב",
    "אביב",
    "אביב",
    "קיץ",
    "קיץ",
    "קיץ",
    "סתיו",
    "סתיו",
    "סתיו",
    "חורף",
  ];
  for (const [file, name] of [
    ["species-insights-table.tsx", "getSeasonalStatus"],
    ["user-analytics-table.tsx", "getPreferredSeason"],
  ]) {
    const ast = tree(read(`src/components/${file}`));
    const run = evaluate(`${functionText(ast, name)}; return ${name};`);
    for (const row of additions)
      assert.equal(run([row]), seasons[Number(row.observed_on.slice(3, 5)) - 1]);
  }
});

test("map bubbles and details include every new ID; historical monitoring memberships are unchanged", () => {
  const ast = tree(read("src/components/observation-map.tsx"));
  const bubbles = evaluate(`return (data) => (${memo(ast, "bubbles")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
  })(observations);
  assert.equal(
    bubbles.reduce((total, b) => total + b.count, 0),
    13653,
  );
  assert.deepEqual(bubbles.flatMap((b) => b.observation_ids).sort(), ids(observations));
  const details = evaluate(`return (allObservations) => (${memo(ast, "observationsMap")})();`)(
    observations,
  );
  for (const row of additions) assert.equal(details.get(row.composite_id), row);
  const originalIndex = areas.buildObservationMonitoringAreaIndex(historical, monitoringAreas);
  historical.forEach((row, i) =>
    assert.deepEqual(index.get(observations[i]), originalIndex.get(row)),
  );
  additions.forEach((row, i) => {
    const raw = batch.records[i].values;
    const expected = monitoringAreas.features
      .filter((feature) =>
        booleanPointInPolygon([Number(raw.longitude), Number(raw.latitude)], feature),
      )
      .map((feature) => feature.properties.id);
    assert.deepEqual([...index.get(row)], expected);
  });
  for (const feature of monitoringAreas.features) {
    const filters = {
      ...defaults(),
      areas: new Set(),
      monitoringAreas: new Set([feature.properties.id]),
    };
    const expected = observations.filter((r) => index.get(r)?.has(feature.properties.id));
    assert.deepEqual(ids(consumers[0].run(observations, filters)), ids(expected));
  }
});

test("species insights and per-user counts include new records without rewriting historical classifications", () => {
  assert.equal(
    [...state.counts.values()].reduce((a, b) => a + b, 0),
    13653,
  );
  assert.equal(
    state.stats.reduce((n, r) => n + r.totalObservations, 0),
    13653,
  );
  for (const login of new Set(additions.map((r) => r.user_login))) {
    assert.equal(
      state.counts.get(login),
      observations.filter((r) => r.user_login === login).length,
    );
  }
  const { getTopSpecies } = loadProductionModule("src/components/species-insights-table.tsx");
  let checked = 0;
  for (const scientificName of new Set(additions.map((r) => r.scientific_name))) {
    const entry = getTopSpecies(observations, new Set([scientificName]), null).find(
      (r) => r.scientificName === scientificName,
    );
    if (entry) {
      const expected = observations.filter((r) => r.scientific_name === scientificName);
      assert.equal(entry.observations, expected.length);
      assert.equal(
        entry.researchPct,
        100 * (expected.filter((r) => r.quality_grade === "research").length / expected.length),
      );
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test("Hebrew/English exports retain every record and new dates, clocks, IDs, groups, coordinates and grades", async () => {
  const ast = tree(read("src/lib/export-observations.ts"));
  let blob;
  const exportRows = evaluate(
    `const ${variable(ast, "ENGLISH_HEADERS").getText(ast)};
    ${functionText(ast, "exportObservations")}; return exportObservations;`,
    {
      ...store,
      ...dictionary,
      ...areas,
      ...survey,
      ...i18n,
      Papa,
      Blob,
      URL: {
        createObjectURL(value) {
          blob = value;
          return "blob:test";
        },
        revokeObjectURL() {},
      },
      document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
      setTimeout: (fn) => fn(),
    },
  );
  for (const lang of ["he", "en"]) {
    exportRows(observations, monitoringAreas, index, lang);
    const parsed = Papa.parse(await blob.text(), { header: true, skipEmptyLines: true });
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.data.length, 13653);
    const field = (he, en) => (lang === "he" ? he : en);
    const qualityLabels = { research: "researchOnly", needs_id: "needsId", casual: "casual" };
    additions.forEach((row, i) => {
      const exported = parsed.data[12674 + i];
      assert.equal(exported[field("מזהה תצפית", "Observation ID")], row.composite_id);
      assert.equal(
        exported[field("תאריך תצפית", "Observation Date")],
        row.observed_on.split("/").reverse().join("-"),
      );
      assert.equal(exported[field("שעת תצפית", "Observation Time")], row.observed_time);
      assert.equal(
        exported[field("קבוצת צופה", "Observer Group")],
        store.translateGroupName(row.user_category, lang),
      );
      assert.equal(
        exported[field("דרגת איכות", "Quality Grade")],
        i18n.getLabel(qualityLabels[row.quality_grade], lang),
      );
      assert.equal(Number(exported[field("קו רוחב", "Latitude")]), row.latitude);
      assert.equal(Number(exported[field("קו אורך", "Longitude")]), row.longitude);
      assert.equal(exported[field("קישור למקור", "Source URL")], row.source_url);
    });
  }
});
