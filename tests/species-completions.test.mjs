import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  evaluate,
  functionText,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";
import { loadDirectDashboard } from "./helpers/merlin-direct-source.mjs";

const store = loadProductionModule("src/lib/observations-store.tsx");
const { speciesMap, legacySpeciesMap } = loadProductionModule("src/lib/species-map.ts");
const { speciesCompletions } = loadProductionModule("src/lib/species-completions-data.ts");
const { getSpeciesHebrewName, getSpeciesEnglishName } = loadProductionModule(
  "src/lib/species-dictionary.ts",
);
const state = await loadDirectDashboard();
assert.deepEqual(state.errors, []);
// Original dictionary-completion cohort. The six later additions have a
// separate full-loader preservation and taxonomy regression suite.
const all = state.observations.slice(0, 16181);
const old = all.slice(0, 15389),
  added = all.slice(15389);
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const speciesAst = tree(read("src/components/species-deep-dive.tsx"));
const mapAst = tree(read("src/components/observation-map.tsx"));
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);
const groupedFor = evaluate(`return(observations)=>(${memo(speciesAst, "groupedSpecies")})();`, {
  ...store,
  ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
  speciesMap,
  categories: store.TAXA_GROUP_KEYS,
});
const searchFor = evaluate(
  `return(groupedSpecies,activeCategory,search)=>(${memo(speciesAst, "speciesList")})();`,
  store,
);
const selectFor = evaluate(
  `return(globallyFilteredObservations,category,species)=>(${memo(speciesAst, "deepDiveFiltered")})();`,
  store,
);
const summaryFor = evaluate(`return(deepDiveFiltered)=>(${memo(speciesAst, "summary")})();`, store);
const groups = groupedFor(all);
const categoryKeys = {
  פרפרים: "butterflies",
  שפיראים: "dragonflies",
  "פרוקי רגליים": "arthropods",
  עופות: "birds",
  יונקים: "mammals",
  צמחים: "plants",
  "שאר המינים": "other",
};

test("all 16,181 source records and all historical derived classifications remain exactly unchanged", () => {
  assert.equal(hash(all), "41c467d06891e15619c837d1533f1ac7e6230fb9fc329782717338d075df5eb8");
  assert.equal(added.length, 792);
  assert.equal(new Set(all.map((o) => o.composite_id)).size, 16181);
  const derived = old.map((o) => ({
    id: o.composite_id,
    taxa: store.getTaxaGroup(o),
    details: store.getObservationTaxonDetails(o),
    status: store.getSpeciesClassification(o),
  }));
  assert.equal(hash(derived), "6aab909cb1c864ed58bebc3639bf95381eb69e9a466ef58348f031da49987dec");
  const registry = loadProductionModule("src/lib/species-registry.ts");
  for (const o of added)
    assert.equal(
      store.getSpeciesClassification(o),
      registry.classifySpecies(o.scientific_name) === "other"
        ? "other_species"
        : registry.classifySpecies(o.scientific_name),
    );
});

test("176 additions preserve every original dictionary entry and its existing duplicates; one synonym reuses an entry", () => {
  assert.equal(
    hash(legacySpeciesMap),
    "1e19929ee349e96d18a1291a2460a325ef255a16577b25f0a73c5fae0572285e",
  );
  assert.equal(legacySpeciesMap.length, 1287);
  assert.equal(speciesMap.length, 1463);
  assert.deepEqual(speciesMap.slice(0, 1287), legacySpeciesMap);
  const unique = (rows) => new Set(rows.map((r) => r.Scientific_Name.trim().toLowerCase()));
  assert.equal(unique(legacySpeciesMap).size, 1269);
  assert.equal(unique(speciesMap).size, 1445);
  assert.equal(new Set(speciesMap.slice(1287).map((r) => r.inaturalistTaxonId)).size, 176);
  assert.ok(
    speciesMap
      .slice(1287)
      .every((r) => !unique(legacySpeciesMap).has(r.Scientific_Name.toLowerCase())),
  );
  assert.equal(speciesMap.filter((r) => r.Scientific_Name === "Lycaena thersamon").length, 0);
  assert.equal(speciesCompletions.filter((r) => r.existingScientificName).length, 1);
});

test("all 177 verified identities preserve their ranks; 52 higher taxa remain intentionally unavailable for selection", () => {
  assert.equal(speciesCompletions.length, 177);
  assert.equal(new Set(speciesCompletions.map((r) => r.inaturalistTaxonId)).size, 177);
  assert.equal(speciesCompletions.filter((r) => r.taxonRank === "species").length, 124);
  assert.equal(speciesCompletions.filter((r) => r.taxonRank === "subspecies").length, 1);
  assert.equal(speciesCompletions.filter((r) => r.isGeneric).length, 52);
  const choices = Object.values(groups).flat();
  for (const entry of speciesCompletions) {
    const key = entry.existingScientificName ?? entry.Scientific_Name;
    const hits = choices.filter((r) => r.Scientific_Name === key);
    assert.equal(hits.length, entry.isGeneric ? 0 : 1, entry.Scientific_Name);
    if (!entry.isGeneric) assert.equal(hits[0].parentCategory, categoryKeys[entry.Category]);
  }
  const sub = speciesCompletions.find((r) => r.taxonRank === "subspecies");
  assert.equal(sub.Scientific_Name, "Rhynchium oculatum hebraeum");
  assert.equal(
    speciesMap.find((r) => r.Scientific_Name === sub.Scientific_Name).taxonRank,
    "subspecies",
  );
});

test("125 eligible taxa are searchable by scientific and verified common names; synonyms return one choice", () => {
  for (const entry of speciesCompletions.filter((r) => !r.isGeneric)) {
    const key = entry.existingScientificName ?? entry.Scientific_Name;
    assert.ok(
      searchFor(groups, null, entry.Scientific_Name).some((r) => r.Scientific_Name === key),
      entry.Scientific_Name,
    );
    // The existing synonym entry keeps its already curated common names.
    if (!entry.existingScientificName)
      for (const name of [entry.Hebrew_Name, entry.English_Name].filter(Boolean))
        assert.ok(
          searchFor(groups, null, name).some((r) => r.Scientific_Name === key),
          name,
        );
  }
  const alias = searchFor(groups, null, "Lycaena thersamon");
  assert.equal(alias.length, 1);
  assert.equal(alias[0].Scientific_Name, "Thersamonia thersamon");
  assert.deepEqual(searchFor(groups, null, "Thersamonia thersamon"), alias);
});

test("every eligible completion selects precisely its scoped observations in the correct category", () => {
  for (const entry of speciesCompletions.filter((r) => !r.isGeneric)) {
    const key = entry.existingScientificName ?? entry.Scientific_Name;
    const expected = all.filter(
      (o) =>
        o.source_metadata?.verification?.taxon_id === entry.inaturalistTaxonId ||
        (entry.existingScientificName &&
          o.source === "merlin" &&
          o.scientific_name === entry.Scientific_Name),
    );
    const selected = selectFor(all, categoryKeys[entry.Category], new Set([key]));
    assert.deepEqual(
      selected.map((o) => o.composite_id),
      expected.map((o) => o.composite_id),
      entry.Scientific_Name,
    );
    assert.equal(summaryFor(selected).species, 1);
    assert.equal(summaryFor(selected).unidentified, 0);
    assert.ok(selected.every((o) => store.getTaxaGroup(o) === categoryKeys[entry.Category]));
  }
  for (const entry of speciesCompletions.filter((r) => r.isGeneric))
    assert.equal(selectFor(all, null, new Set([entry.Scientific_Name])).length, 0);
});

test("a forged source, UUID, observation ID or taxon ID cannot apply completion to an unreviewed record", () => {
  const sample = added.find((o) => store.getObservationSpeciesCompletion(o));
  assert.ok(sample);
  for (const patch of [
    (o) => (o.source = "merlin"),
    (o) => (o.composite_id = "inat_1"),
    (o) => (o.source_metadata.file_sha256 = "wrong"),
    (o) => (o.source_metadata.values.originalRecordId = "wrong"),
    (o) => (o.source_metadata.verification.taxon_id = -1),
    (o) => (o.source_metadata.verification.scientific_name = "wrong"),
  ]) {
    const fake = structuredClone(sample);
    patch(fake);
    assert.equal(store.getObservationSpeciesCompletion(fake), undefined);
  }
  assert.ok(old.every((o) => store.getObservationSpeciesCompletion(o) === undefined));
  assert.equal(all.filter(store.getObservationSpeciesCompletion).length, 345);
});

test("species totals, map bubbles, table and series agree without double-counting the known synonym", () => {
  assert.equal(summaryFor(all).species, 1018);
  const metricsAst = tree(read("src/components/metrics-table.tsx"));
  const compute = evaluate(`${functionText(metricsAst, "computeRow")}return computeRow;`, store);
  assert.equal(compute(all).distinctSpecies, 1018);
  const mapFor = evaluate(`return(data)=>(${memo(mapAst, "bubbles")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
  });
  const { getTopSpecies } = loadProductionModule("src/components/species-insights-table.tsx");
  const chartAst = tree(read("src/components/deep-dive-time-series-chart.tsx"));
  const chart = evaluate(
    `const ${variable(chartAst, "SPECIES_PALETTE").getText(chartAst)};const ${variable(chartAst, "BACKGROUND_COLOR").getText(chartAst)};${functionText(chartAst, "getSpeciesLabel")}return(allObservations,category,selectedSpecies)=>(${memo(chartAst, "{ chartData, seriesKeys, seriesColors, seriesLabels }")})();`,
    {
      ...store,
      ...loadProductionModule("src/lib/species-dictionary.ts"),
      ...loadProductionModule("src/lib/i18n.tsx"),
      HEBREW_LETTER_REGEX: /[א-ת]/,
      categoryColor: "blue",
      lang: "he",
    },
  );
  for (const name of [
    "Alkanna galilaea",
    "Idaea inquinata",
    "Rhynchium oculatum hebraeum",
    "Lycaena thersamon",
  ]) {
    const entry = speciesCompletions.find((r) => r.Scientific_Name === name),
      key = entry.existingScientificName ?? name;
    const selected = selectFor(all, categoryKeys[entry.Category], new Set([key]));
    assert.ok(selected.length > 0);
    assert.equal(
      mapFor(selected).reduce((n, b) => n + b.count, 0),
      selected.length,
    );
    assert.deepEqual(
      new Set(mapFor(selected).flatMap((b) => b.observation_ids)),
      new Set(selected.map((o) => o.composite_id)),
    );
    assert.equal(
      getTopSpecies(selected, new Set([key]), categoryKeys[entry.Category])[0].observations,
      selected.length,
    );
    const series = chart(all, categoryKeys[entry.Category], new Set([key]));
    assert.equal(
      series.chartData.reduce((n, p) => n + (p[key] ?? 0), 0),
      selected.length,
    );
  }
});

test("missing Hebrew names use scientific names; unscoped legacy display-name lookups do not change", () => {
  assert.equal(speciesCompletions.filter((r) => r.Hebrew_Name === r.Scientific_Name).length, 78);
  for (const entry of speciesCompletions) {
    assert.equal(getSpeciesHebrewName(entry.Scientific_Name), undefined);
    assert.equal(getSpeciesEnglishName(entry.Scientific_Name), undefined);
    for (const o of added.filter((o) => o.scientific_name === entry.Scientific_Name)) {
      assert.equal(store.getObservationTaxonDetails(o).name, entry.Hebrew_Name);
      assert.equal(store.getObservationTaxonDetails(o).englishName, entry.English_Name);
    }
  }
});
