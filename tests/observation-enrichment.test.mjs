import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import Papa from "papaparse";
import {
  evaluate,
  functionText,
  loadPipeline,
  loadProductionModule,
  read,
  root,
  tree,
  variable,
} from "./helpers/observation-source.mjs";

// Immutable approved baseline: source-aware date fix, before name enrichment.
const baselineCommit = "a1327925b80a3b728f435d85fee9dc249112bad0";
const storePath = "src/lib/observations-store.tsx";
const { inaturalistCommonNames: names, commonNameEnrichmentProvenance: provenance } =
  loadProductionModule("src/lib/inaturalist-common-name-enrichment-data.ts");
const { getInaturalistCommonName } = loadProductionModule("src/lib/observation-enrichment.ts");
const store = loadProductionModule(storePath);
const quality = loadProductionModule("src/lib/quality-filter.ts");
const dictionary = loadProductionModule("src/lib/species-dictionary.ts");
const areas = loadProductionModule("src/lib/monitoring-areas.ts");

function csv(file) {
  const parsed = Papa.parse(read(file), { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.errors, [], file);
  return parsed.data;
}

const inat = csv("public/Until_June26.csv");
const merlin = csv("public/MERLIN all observations for Zohar.csv");
const users = new Map(csv("public/user_groups.csv").map((row) => [row.user_login, row.group]));
const before = loadPipeline(
  execFileSync("git", ["show", `${baselineCommit}:${storePath}`], {
    cwd: root,
    encoding: "utf8",
  }),
).load(inat, merlin, users);
const after = loadPipeline(read(storePath)).load(inat, merlin, users);
const changed = after.filter((row, index) => row.common_name !== before[index].common_name);
const missing = (rows) => rows.filter((row) => !row.common_name?.trim()).length;
const ids = (rows) => rows.map((row) => row.composite_id);
const memoText = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);
const monitoringAreas = JSON.parse(read("public/monitoring-areas.geojson"));
const beforeIndex = areas.buildObservationMonitoringAreaIndex(before, monitoringAreas);
const afterIndex = areas.buildObservationMonitoringAreaIndex(after, monitoringAreas);

test("all 512 approved entries target unique historical IDs with empty names and retain provenance", () => {
  const entries = Object.entries(names);
  assert.equal(entries.length, 512);
  assert.equal(provenance.validatedEntries, 512);
  assert.equal(provenance.sourceIdColumn, "originalRecordId");
  assert.equal(provenance.sourceNameColumn, "hebrew_name");
  // Keep the approved CRLF source hash; normalize only LF/CRLF in memory.
  // Do not trim content or normalize lone CR characters.
  const historicalSource = read(provenance.historicalSourceFile);
  const historicalHash = (csv) =>
    createHash("sha256").update(csv.replace(/\r?\n/g, "\r\n")).digest("hex");
  const lfSource = historicalSource.replace(/\r\n/g, "\n");
  for (const csv of [historicalSource, lfSource, lfSource.replace(/\n/g, "\r\n")]) {
    assert.equal(historicalHash(csv), provenance.historicalSourceSha256);
  }
  // A changed ID, removed content, whitespace or lone CR must still fail integrity.
  for (const changedSource of [
    historicalSource.replace(inat[0].id, `${inat[0].id}0`),
    historicalSource.slice(0, -100),
    `${historicalSource} `,
    `${historicalSource}\r`,
  ]) {
    assert.notEqual(historicalHash(changedSource), provenance.historicalSourceSha256);
  }
  // Snapshot derived independently from the 512 revalidated Excel/audit matches.
  // The private Excel workbook is deliberately not required to run repository tests.
  const approvedValues = entries
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, name]) => `${id}\t${name}\n`)
    .join("");
  assert.equal(
    createHash("sha256").update(approvedValues).digest("hex"),
    "a9c3913ae817331a0e08b7c9665d0a1e55cd3656980249144ad49770664adb3e",
  );
  for (const [id, name] of entries) {
    assert.match(id, /^\d+$/);
    assert.match(name, /^[א-ת]+(?: [א-ת]+)*$/);
    const matches = inat.filter((row) => row.id.trim() === id);
    assert.equal(matches.length, 1, id);
    assert.equal(matches[0].common_name.trim(), "", id);
  }
});

test("exactly 512 names are filled: missing names fall from 2,250 to 1,738, with all 12,674 IDs preserved", (t) => {
  assert.equal(inat.length, 10317);
  assert.equal(merlin.length, 2357);
  assert.equal(before.length, 12674);
  assert.equal(after.length, 12674);
  assert.deepEqual(ids(after), ids(before));
  assert.equal(new Set(ids(after)).size, 12674);
  assert.equal(changed.length, 512);
  assert.equal(missing(before), 2250);
  assert.equal(missing(after), 1738);
  assert.deepEqual(new Set(ids(changed)), new Set(Object.keys(names).map((id) => `inat_${id}`)));
  for (const row of changed) assert.equal(row.common_name, names[row.composite_id.slice(5)]);
  t.diagnostic(
    "12,674 observations retained; 512 approved names filled; 2,250 → 1,738 missing names.",
  );
});

test("populated names, every other metadata field, and all MERLIN records remain unchanged", () => {
  after.forEach((row, index) => {
    const { common_name: previousName, ...previousMetadata } = before[index];
    const { common_name: currentName, ...currentMetadata } = row;
    assert.deepEqual(currentMetadata, previousMetadata, row.composite_id);
    if (previousName?.trim()) assert.equal(currentName, previousName, row.composite_id);
  });
  assert.deepEqual(
    after.filter((row) => row.source === "merlin"),
    before.filter((row) => row.source === "merlin"),
  );
});

test("only missing values and exact original IDs qualify; populated values and unrelated IDs are safe", () => {
  const [id, name] = Object.entries(names)[0];
  for (const empty of [undefined, null, "", " ", "\t\n"]) {
    assert.equal(getInaturalistCommonName(id, empty), name);
  }
  for (const populated of ["שם קיים", "Existing name", "  Existing name  ", "NULL", "N/A"]) {
    assert.equal(getInaturalistCommonName(id, populated), populated);
  }
  for (const unknown of [
    "",
    `inat_${id}`,
    `expert_${id}`,
    "__proto__",
    "constructor",
    "toString",
    "999999999999999",
  ]) {
    assert.equal(getInaturalistCommonName(unknown, undefined), undefined);
  }
  assert.equal(getInaturalistCommonName(` ${id} `, undefined), name);
});

test("repeated enrichment and repeated pipeline loading are idempotent", () => {
  const repeat = (rows) =>
    rows.map((row) =>
      row.source === "inaturalist"
        ? {
            ...row,
            common_name: getInaturalistCommonName(row.composite_id.slice(5), row.common_name),
          }
        : row,
    );
  assert.deepEqual(repeat(after), after);
  assert.deepEqual(repeat(repeat(after)), after);
  assert.deepEqual(loadPipeline(read(storePath)).load(inat, merlin, users), after);
});

test("taxonomy, species classification and Hebrew/English dictionary labels are unchanged", () => {
  after.forEach((row, index) => {
    assert.equal(store.getTaxaGroup(row), store.getTaxaGroup(before[index]));
    assert.equal(
      store.getSpeciesClassification(row),
      store.getSpeciesClassification(before[index]),
    );
    assert.equal(
      store.translateSpeciesName(row.scientific_name),
      store.translateSpeciesName(before[index].scientific_name),
    );
    assert.equal(
      dictionary.getSpeciesEnglishName(row.scientific_name),
      dictionary.getSpeciesEnglishName(before[index].scientific_name),
    );
  });
});

test("all eight quality selections retain exactly the same records, including Casual and reset defaults", () => {
  const grades = ["research", "needs_id", "casual"];
  assert.deepEqual(quality.createDefaultQualitySelection(), new Set(grades));
  for (let mask = 0; mask < 8; mask++) {
    const selection = new Set(grades.filter((_, bit) => mask & (1 << bit)));
    const matches = (rows) => rows.filter((row) => quality.matchesQualitySelection(row, selection));
    assert.deepEqual(ids(matches(after)), ids(matches(before)));
  }
  assert.equal(
    after.filter((row) =>
      quality.matchesQualitySelection(row, quality.createDefaultQualitySelection()),
    ).length,
    12674,
  );
});

test("map groups, observation-detail index and monitoring memberships retain records and enriched names", () => {
  const ast = tree(read("src/components/observation-map.tsx"));
  const group = evaluate(`return (data) => (${memoText(ast, "bubbles")})();`, {
    ...store,
    ...loadProductionModule("src/lib/observation-taxonomy-overrides.ts"),
  });
  assert.deepEqual(group(after), group(before));
  const buildDetails = evaluate(
    `return (allObservations) => (${memoText(ast, "observationsMap")})();`,
  );
  const details = buildDetails(after);
  assert.equal(details.size, 12674);
  for (const row of changed) assert.equal(details.get(row.composite_id), row);
  after.forEach((row, index) =>
    assert.deepEqual(afterIndex.get(row), beforeIndex.get(before[index])),
  );
});

test("species tables preserve dictionary labels, counts, quality percentages and seasonal trends", () => {
  const { getTopSpecies } = loadProductionModule("src/components/species-insights-table.tsx");
  for (const category of [null, ...store.TAXA_GROUP_KEYS]) {
    assert.deepEqual(
      getTopSpecies(after, new Set(), category),
      getTopSpecies(before, new Set(), category),
    );
  }
  for (const species of new Set(changed.map((row) => row.scientific_name))) {
    assert.deepEqual(
      getTopSpecies(after, new Set([species]), null),
      getTopSpecies(before, new Set([species]), null),
    );
  }
});

test("Hebrew and English CSV exports use enriched names with the existing English fallback and no other changes", async () => {
  const ast = tree(read("src/lib/export-observations.ts"));
  let blob;
  const exportRows = evaluate(
    `const ${variable(ast, "ENGLISH_HEADERS").getText(ast)};
    ${functionText(ast, "exportObservations")}; return exportObservations;`,
    {
      ...store,
      ...dictionary,
      ...areas,
      ...loadProductionModule("src/lib/survey-polygons.ts"),
      ...loadProductionModule("src/lib/i18n.tsx"),
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
  const exported = async (rows, index, lang) => {
    exportRows(rows, monitoringAreas, index, lang);
    const result = Papa.parse(await blob.text(), { header: true, skipEmptyLines: true });
    assert.deepEqual(result.errors, []);
    return result.data;
  };
  for (const lang of ["he", "en"]) {
    const oldRows = await exported(before, beforeIndex, lang);
    const newRows = await exported(after, afterIndex, lang);
    const key = lang === "he" ? "שם נפוץ" : "Common Name";
    assert.equal(newRows.length, 12674);
    newRows.forEach((row, index) => {
      const english =
        lang === "en"
          ? dictionary.getSpeciesEnglishName(after[index].scientific_name)?.trim()
          : undefined;
      assert.equal(
        row[key],
        english && english !== "N/A" ? english : (after[index].common_name ?? ""),
      );
      const { [key]: oldName, ...oldMetadata } = oldRows[index];
      const { [key]: newName, ...newMetadata } = row;
      assert.deepEqual(newMetadata, oldMetadata);
      if (before[index].common_name?.trim()) assert.equal(newName, oldName);
    });
  }
});
