import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Papa from "papaparse";
import {
  evaluate,
  functionText,
  loadPipeline,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";

const store = loadProductionModule("src/lib/observations-store.tsx");
const overrides = loadProductionModule("src/lib/observation-taxonomy-overrides.ts");
const taxonomy = loadProductionModule("src/lib/taxonomy-engine.ts");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const dictionary = loadProductionModule("src/lib/species-dictionary.ts");
const { speciesMap } = loadProductionModule("src/lib/species-map.ts");
const i18n = loadProductionModule("src/lib/i18n.tsx");
const { appendInaturalistAdditions } = loadProductionModule("src/lib/inaturalist-additions.ts");
const { getTopSpecies } = loadProductionModule("src/components/species-insights-table.tsx");
const pipeline = loadPipeline(read("src/lib/observations-store.tsx"));
const csv = (path) => Papa.parse(read(path), { header: true, skipEmptyLines: true }).data;
const historical = pipeline.load(
  csv("public/Until_June26.csv"),
  csv("public/MERLIN all observations for Zohar.csv"),
  new Map(csv("public/user_groups.csv").map((r) => [r.user_login, r.group])),
);
const batch = JSON.parse(read("public/inaturalist-september-2026-additions.json"));
const append = (rows) =>
  appendInaturalistAdditions(rows, batch, pipeline.parseObservedOn, pipeline.parseObservedTime);
const observations = append(historical);
const additions = observations.slice(historical.length);
const byId = new Map(observations.map((o) => [o.composite_id, o]));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ids = (rows) => rows.map((o) => o.composite_id).sort();
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(observations);

// Independent reviewed audit fixture: original IDs, not taxonomy names used to
// select records at runtime. Keep this list separate from the production override.
const reviewed = {
  "Ardea cinerea":
    "206446233 233784595 258717192 258719777 323250669 326765189 329804796 331764857 332709705 333412856 338042618 338562405 338680479 338682227 376451053 378367967 384470349",
  "Milvus migrans":
    "248718564 253732202 253734539 258225986 259227022 259314503 259623222 259623741 259623802 268881345 316792764 316792767 316792768 323969770 324852267 327481722 327816580 329889226 334698926 335228371 335855393",
  "Circus aeruginosus": "253734909 259636780 274066600",
  "Alectoris chukar": "389990426",
  "Motacilla cinerea": "395846621",
  Vertebrata: "401166224",
};
const expected = new Map(
  Object.entries(reviewed).flatMap(([name, list]) =>
    list
      .split(" ")
      .map((id) => [`inat_${id}`, { name, group: name === "Vertebrata" ? "other" : "birds" }]),
  ),
);
const corrected = additions.filter((o) => expected.has(o.composite_id));
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);
const speciesAst = tree(read("src/components/species-deep-dive.tsx"));
const mapAst = tree(read("src/components/observation-map.tsx"));
const bubblesFor = evaluate(`return (data) => (${memo(mapAst, "bubbles")})();`, {
  ...store,
  ...overrides,
});
const groupedFor = evaluate(`return (observations) => (${memo(speciesAst, "groupedSpecies")})();`, {
  ...store,
  ...overrides,
  speciesMap,
  categories: store.TAXA_GROUP_KEYS,
});
const listFor = evaluate(
  `return (groupedSpecies, activeCategory, search) => (${memo(speciesAst, "speciesList")})();`,
);
const countGroups = (rows) =>
  Object.fromEntries(
    store.TAXA_GROUP_KEYS.map((group) => [
      group,
      rows.filter((o) => store.getTaxaGroup(o) === group).length,
    ]),
  );

test("the exact 44 audited IDs receive evidence-backed existing categories; original Excel taxonomy survives", () => {
  assert.equal(expected.size, 44);
  assert.deepEqual(
    ids(observations.filter((o) => overrides.getObservationTaxonomyOverride(o))),
    [...expected.keys()].sort(),
  );
  for (const [id, { name, group }] of expected) {
    const o = byId.get(id);
    assert.equal(o.scientific_name, name, id);
    assert.equal(store.getTaxaGroup(o), group, id);
    assert.ok(store.TAXA_GROUP_KEYS.includes(group));
    assert.equal(
      o.source_metadata.values.taxa_category_en,
      group === "birds" ? "Birds" : "Other Species",
    );
    assert.equal(
      o.source_metadata.values.taxa_category_he,
      group === "birds" ? "עופות" : "שאר המינים",
    );
    const raw = batch.records.find((r) => r.values.originalRecordId === id.slice(5));
    assert.deepEqual(o.source_metadata.values, raw.values);
    assert.equal(o.source_metadata.excel_row, raw.excel_row);
  }
});

test("scope guards reject historical, foreign-source, different-batch, mismatched-ID/name and unreviewed records", () => {
  for (const o of corrected) {
    const variants = [
      { ...o, source_metadata: undefined },
      { ...o, source: "merlin" },
      { ...o, composite_id: undefined },
      { ...o, composite_id: "inat_999999999" },
      { ...o, scientific_name: "Aves" },
      { ...o, source_metadata: { ...o.source_metadata, file_sha256: "different-batch" } },
      {
        ...o,
        source_metadata: {
          ...o.source_metadata,
          values: { ...o.source_metadata.values, originalRecordId: "999999999" },
        },
      },
      {
        ...o,
        source_metadata: {
          ...o.source_metadata,
          values: { ...o.source_metadata.values, scientific_name: "Aves" },
        },
      },
    ];
    for (const variant of variants)
      assert.equal(overrides.getObservationTaxonomyOverride(variant), null);
  }
});

test("all 12,674 historical classifications and 272 historical same-name records remain exactly unchanged", () => {
  // Captured before the override was implemented, using the production classifier.
  assert.equal(
    hash(historical.map((o) => [o.composite_id, store.getTaxaGroup(o)])),
    "fff48b2210879586542afe19f19c565f027f8c7ed79044c2f30b9979934efeb9",
  );
  const sameNames = historical.filter((o) => Object.hasOwn(reviewed, o.scientific_name));
  assert.equal(sameNames.length, 272);
  for (const o of sameNames) {
    assert.equal(overrides.getObservationTaxonomyOverride(o), null);
    assert.equal(
      store.getTaxaGroup(o),
      o.scientific_name === "Vertebrata" ? "plants" : "arthropods",
    );
  }
});

test("the other 935 additions retain their classifications, including all 374 deferred discrepancies", () => {
  const untouched = additions.filter((o) => !expected.has(o.composite_id));
  assert.equal(untouched.length, 935);
  // Independent pre-change audit snapshot, in original Excel row order.
  assert.equal(
    hash(untouched.map((o) => [o.composite_id, store.getTaxaGroup(o)])),
    "024e19d3c40941f6b17763762a9eabca0978ec811e50fe8e52434ba24c898fb3",
  );
  const excelGroups = {
    Birds: "birds",
    Mammals: "mammals",
    Butterflies: "butterflies",
    Dragonflies: "dragonflies",
    Arthropods: "arthropods",
    Plants: "plants",
    "Other Species": "other",
  };
  const mismatches = additions.filter(
    (o) => excelGroups[o.source_metadata.values.taxa_category_en] !== store.getTaxaGroup(o),
  );
  assert.equal(mismatches.length, 374);
});

test("13,653 immutable observations, raw fields, grades, groups and idempotence are preserved", () => {
  assert.equal(historical.length, 12674);
  assert.equal(additions.length, 979);
  assert.equal(observations.length, 13653);
  assert.equal(new Set(ids(observations)).size, 13653);
  observations.forEach((o) => {
    store.getTaxaGroup(o);
    store.getSpeciesClassification(o);
  });
  assert.equal(
    hash(observations),
    "23a82f76d697c7e79a9c54bbf1a489b4d94767d0fd49394a510e5fe379b2a7f2",
  );
  assert.deepEqual(append(observations), observations);
  assert.deepEqual(
    Object.fromEntries(
      ["research", "needs_id", "casual"].map((grade) => [
        grade,
        observations.filter((o) => o.quality_grade === grade).length,
      ]),
    ),
    { research: 8317, needs_id: 5306, casual: 30 },
  );
  assert.deepEqual(countGroups(additions), {
    mammals: 19,
    birds: 102,
    butterflies: 58,
    dragonflies: 134,
    arthropods: 53,
    plants: 82,
    other: 531,
  });
  assert.deepEqual(countGroups(observations), {
    mammals: 771,
    birds: 1705,
    butterflies: 1187,
    dragonflies: 1176,
    arthropods: 4226,
    plants: 3402,
    other: 1186,
  });
});

test("all taxonomy and quality combinations agree across Dashboard, People, Species, chart and counter inputs", () => {
  const monitoringAreas = JSON.parse(read("public/monitoring-areas.geojson"));
  const index = areas.buildObservationMonitoringAreaIndex(observations, monitoringAreas);
  const bindings = { ...store, ...quality, ...areas, observationMonitoringAreaIndex: index };
  const consumers = [
    ["dashboard.tsx", "filtered"],
    ["dashboard.tsx", "chartData"],
    ["dashboard.tsx", "metricsData"],
    ["people-dashboard.tsx", "globallyFilteredObservations"],
    ["species-deep-dive.tsx", "globallyFilteredObservations"],
  ].map(([file, name]) => {
    const ast = tree(read(`src/components/${file}`));
    return evaluate(
      `${functionText(ast, "parseObsTimestamp")} return (observations, filters) => (${memo(ast, name)})();`,
      bindings,
    );
  });
  const grades = ["research", "needs_id", "casual"];
  for (const group of store.TAXA_GROUP_KEYS) {
    for (let mask = 0; mask < 8; mask++) {
      const selected = new Set(grades.filter((_, bit) => mask & (1 << bit)));
      const filters = {
        dateRange: null,
        time: new Map(),
        taxa: new Set([group]),
        speciesTypes: new Set(["invasive", "rare", "other_species"]),
        qualityGrades: selected,
        groups: new Set(["expert", "local_communities", "online_communities"]),
        localCommunitySubgroups: new Set(["student", "mechnistim", "zevulun", "yizrael"]),
        areas: new Set(survey.SURVEY_AREA_KEYS),
        monitoringAreas: new Set(monitoringAreas.features.map((f) => f.properties.id)),
      };
      const wanted = observations.filter(
        (o) => store.getTaxaGroup(o) === group && selected.has(o.quality_grade),
      );
      for (const run of consumers) assert.deepEqual(ids(run(observations, filters)), ids(wanted));
    }
  }
});

test("species choices expose corrected birds and retain historical choices without duplicate all-species entries", () => {
  const grouped = groupedFor(observations);
  const historicalGrouped = groupedFor(historical);
  for (const [name] of Object.entries(reviewed).filter(([name]) => name !== "Vertebrata")) {
    for (const group of ["birds", "arthropods"]) {
      assert.equal(listFor(grouped, group, "").filter((e) => e.Scientific_Name === name).length, 1);
    }
    assert.equal(listFor(grouped, null, name).filter((e) => e.Scientific_Name === name).length, 1);
  }
  assert.equal(listFor(grouped, null, "Vertebrata").length, 0);
  for (const group of store.TAXA_GROUP_KEYS) {
    if (group !== "birds") assert.deepEqual(grouped[group], historicalGrouped[group]);
  }
  assert.equal(grouped.birds.length, historicalGrouped.birds.length + 5);
  const all = listFor(grouped, null, "");
  assert.equal(all.length, new Set(all.map((e) => e.Scientific_Name)).size);
});

test("species table filters individual observations before grouping mixed historical/new scientific names", () => {
  for (const [name, idList] of Object.entries(reviewed).filter(([name]) => name !== "Vertebrata")) {
    const selected = new Set([name]);
    const oldCount = historical.filter((o) => o.scientific_name === name).length;
    for (const [category, expectedCount] of [
      ["birds", idList.split(" ").length],
      ["arthropods", oldCount],
      [null, oldCount + idList.split(" ").length],
    ]) {
      const row = getTopSpecies(observations, selected, category).find(
        (r) => r.scientificName === name,
      );
      assert.equal(row.observations, expectedCount, `${name}/${category}`);
      const records = observations.filter(
        (o) => o.scientific_name === name && (!category || store.getTaxaGroup(o) === category),
      );
      assert.equal(
        row.researchPct,
        (records.filter((o) => o.quality_grade === "research").length / records.length) * 100,
      );
      // The pre-existing seasonal tie-break uses input order. Check category
      // membership/counts independently without changing that separate policy.
      const countsOnly = (rows) =>
        rows.map(({ scientificName, observations, researchPct, annualBreakdown }) => ({
          scientificName,
          observations,
          researchPct,
          annualBreakdown,
        }));
      assert.deepEqual(
        countsOnly(getTopSpecies([...observations].reverse(), selected, category)),
        countsOnly(getTopSpecies(observations, selected, category)),
      );
    }
  }
});

test("corrected map bubbles never mix categories; all IDs and detail records remain accessible", () => {
  // Pre-change production map snapshot: the 13,609 unreviewed observations
  // retain their exact existing bubble grouping, including deferred issues.
  const untouched = observations.filter((o) => !expected.has(o.composite_id));
  assert.equal(untouched.length, 13609);
  assert.equal(
    hash(bubblesFor(untouched)),
    "b5430e096ca803b8655bd3bb0f5b65cb6b589fa93f4ceb7b99e9e9e88be1c71f",
  );
  const bubbles = bubblesFor(observations);
  assert.deepEqual(bubbles.flatMap((b) => b.observation_ids).sort(), ids(observations));
  assert.equal(
    bubbles.reduce((sum, b) => sum + b.count, 0),
    13653,
  );
  for (const bubble of bubbles.filter((b) => b.observation_ids.some((id) => expected.has(id))))
    for (const id of bubble.observation_ids) {
      assert.ok(expected.has(id));
      assert.equal(bubble.category, expected.get(id).group);
    }
  const details = evaluate(`return (allObservations) => (${memo(mapAst, "observationsMap")})();`)(
    observations,
  );
  const select = evaluate(
    `return (selectedBubbleIds, observationsMap) => (${memo(mapAst, "selectedObservations")})();`,
  );
  for (const bubble of bubbles)
    assert.deepEqual(
      select(bubble.observation_ids, details),
      bubble.observation_ids.map((id) => byId.get(id)),
    );
  // In-memory collision fixture only: same name/date/location, distinct source IDs
  // with intentionally different classifications. Never written to any dataset.
  const newer = corrected.find((o) => o.scientific_name === "Ardea cinerea");
  const older = historical.find((o) => o.scientific_name === newer.scientific_name);
  const samePoint = {
    ...older,
    observed_on: newer.observed_on,
    latitude: newer.latitude,
    longitude: newer.longitude,
  };
  assert.deepEqual(
    bubblesFor([samePoint, newer]).map((b) => [b.category, b.count]),
    [
      ["arthropods", 1],
      ["birds", 1],
    ],
  );
});

test("Vertebrata remains a generic higher-level identification in the existing Other category", () => {
  const o = byId.get("inat_401166224");
  assert.equal(o.scientific_name, "Vertebrata");
  assert.equal(taxonomy.getTaxonDetails(o.scientific_name).isGeneric, true);
  const summarize = evaluate(
    `return (deepDiveFiltered) => (${memo(speciesAst, "summary")})();`,
    taxonomy,
  );
  assert.deepEqual(summarize([o]), { rows: 1, observers: 1, species: 0, unidentified: 1 });
  assert.equal(store.getTaxaGroup(o), "other");
  assert.equal(getTopSpecies([o], new Set(), "other").length, 0);
});

test("category counters, species counters and time-series points agree with observation-level classifications", () => {
  const counts = evaluate(
    `return (globallyFilteredObservations) => (${memo(speciesAst, "categoryObservationCounts")})();`,
    store,
  )(observations);
  assert.deepEqual(counts, countGroups(observations));
  const perSpecies = evaluate(
    `return (globallyFilteredObservations, activeCategory) => (${memo(speciesAst, "speciesObservationCounts")})();`,
    store,
  );
  const ast = tree(read("src/components/deep-dive-time-series-chart.tsx"));
  const chart = evaluate(
    `${["SPECIES_PALETTE", "BACKGROUND_COLOR", "HEBREW_LETTER_REGEX"].map((n) => `const ${variable(ast, n).getText(ast)};`).join("\n")}
    ${functionText(ast, "getSpeciesLabel")}
    return (allObservations, category, selectedSpecies) => (${memo(ast, "{ chartData, seriesKeys, seriesColors, seriesLabels }")})();`,
    { ...store, ...dictionary, ...i18n, lang: "en", categoryColor: "#0ea5e9" },
  );
  for (const group of store.TAXA_GROUP_KEYS) {
    const rows = observations.filter((o) => store.getTaxaGroup(o) === group);
    const output = chart(observations, group, new Set()).chartData;
    assert.equal(
      output.reduce((n, r) => n + r.focus, 0),
      rows.length,
    );
    assert.equal(
      output.reduce((n, r) => n + r.background, 0),
      observations.length - rows.length,
    );
    const speciesCounts = perSpecies(observations, group);
    for (const name of Object.keys(reviewed)) {
      const selected = chart(observations, group, new Set([name])).chartData;
      const matching = rows.filter((o) => o.scientific_name === name);
      assert.equal(
        selected.reduce((n, r) => n + r[name], 0),
        matching.length,
      );
      assert.equal(speciesCounts.get(name) ?? 0, matching.length);
      for (const point of selected) {
        assert.equal(
          point[name],
          matching.filter(
            (o) =>
              `${store.translateMonth(Number(o.observed_on.slice(3, 5)), "en")}-${o.observed_on.slice(-2)}` ===
              point.monthYear,
          ).length,
        );
      }
    }
  }
});

test("Hebrew and English CSV exports classify every ID consistently, including historical same-name records", async () => {
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
    exportRows(observations, null, new Map(), lang);
    const rows = Papa.parse(await blob.text(), { header: true, skipEmptyLines: true }).data;
    assert.equal(rows.length, 13653);
    for (let i = 0; i < rows.length; i++) {
      assert.equal(
        rows[i][lang === "he" ? "מזהה תצפית" : "Observation ID"],
        observations[i].composite_id,
      );
      assert.equal(
        rows[i][lang === "he" ? "קבוצה טקסונומית" : "Taxonomic Group"],
        i18n.getLabel(`tg_${store.getTaxaGroup(observations[i])}`, lang),
      );
    }
  }
});
