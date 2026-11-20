import assert from "node:assert/strict";
import test from "node:test";
import Papa from "papaparse";
import { loadDirectDashboard } from "./helpers/merlin-direct-source.mjs";
import {
  evaluate,
  functionText,
  loadProductionModule,
  read,
  tree,
} from "./helpers/observation-source.mjs";

const module = loadProductionModule("src/lib/unified-observations.ts");
const {
  getTaxaGroup,
  getSpeciesClassification,
  getObservationTaxonDetails,
  getObservationSpeciesKey,
} = loadProductionModule("src/lib/observations-store.tsx");
const overrides = loadProductionModule("src/lib/observation-taxonomy-overrides.ts");
const completions = loadProductionModule("src/lib/observation-species-completions.ts");
const geo = loadProductionModule("src/lib/drawn-polygon.ts");
const monitoring = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const ast = tree(read("src/lib/observations-store.tsx"));
const [parseDate, parseTime] = evaluate(
  ["parseObservedOn", "parseObservedTime"].map((n) => functionText(ast, n)).join("\n") +
    "\nreturn [parseObservedOn, parseObservedTime];",
);
const parse = (text, metadata) =>
  module.parseUnifiedObservations(text, metadata, parseDate, parseTime);
const csv = read("dashboard-public" + module.UNIFIED_CSV);
const metadata = JSON.parse(read("dashboard-public" + module.UNIFIED_METADATA));
const raw = Papa.parse(csv, { header: true, skipEmptyLines: true });
const active = parse(csv, metadata);
const byId = new Map(active.map((row) => [row.composite_id, row]));

test("the observation payload contains exactly the approved UUIDs and source rows with unchanged date precision", () => {
  assert.deepEqual(raw.errors, []);
  assert.equal(active.length, 16107);
  assert.equal(byId.size, 16107);
  assert.equal(active.filter((row) => row.source === "inaturalist").length, 12014);
  assert.equal(active.filter((row) => row.source === "merlin").length, 4093);
  let dateOnly = 0;
  for (const row of raw.data) {
    const obs =
      row.user_verified === "expert"
        ? byId.get("expert_" + row.composite_id)
        : byId.get("inat_" + metadata.inaturalist[row.originalRecordId].id);
    const [day, clock] = row.observed_on.split(" ");
    assert.equal(obs.observed_on.split("/").reverse().join("-"), day);
    assert.equal(obs.observed_time, clock);
    assert.equal(obs.quality_grade, row.quality_grade);
    if (obs.source === "inaturalist") {
      assert.match(obs.source_url, /^https:\/\/www\.inaturalist\.org\/observations\/[1-9]\d*$/);
      assert.equal(obs.source_url.split("/").at(-1), obs.composite_id.slice(5));
      if (clock === undefined) dateOnly++;
    } else {
      assert.deepEqual(obs.professional_metadata.values, row);
    }
  }
  assert.equal(dateOnly, 46);
});

test("the previous display decisions remain active for every retained observation and 80 legacy IDs are absent", async () => {
  const old = await loadDirectDashboard();
  assert.deepEqual(old.errors, []);
  const retained = old.observations.filter((row) => byId.has(row.composite_id));
  assert.equal(old.observations.length - retained.length, 80);
  assert.deepEqual(
    active.map((row) => row.composite_id),
    retained.map((row) => row.composite_id),
  );
  let scopedOverrides = 0;
  let scopedCompletions = 0;
  for (const [index, row] of active.entries()) {
    const base = retained[index];
    for (const field of ["scientific_name", "common_name", "user_category", "user_subcategory"]) {
      assert.equal(row[field], base[field], row.composite_id + " " + field);
    }
    assert.equal(getTaxaGroup(row), getTaxaGroup(base));
    assert.equal(getSpeciesClassification(row), getSpeciesClassification(base));
    assert.equal(getObservationSpeciesKey(row), getObservationSpeciesKey(base));
    assert.deepEqual(getObservationTaxonDetails(row), getObservationTaxonDetails(base));
    assert.equal(
      overrides.getObservationTaxonomyOverride(row),
      overrides.getObservationTaxonomyOverride(base),
    );
    assert.equal(
      completions.getObservationSpeciesCompletion(row),
      completions.getObservationSpeciesCompletion(base),
    );
    scopedOverrides += Number(overrides.getObservationTaxonomyOverride(row) !== null);
    scopedCompletions += Number(Boolean(completions.getObservationSpeciesCompletion(row)));
  }
  assert.equal(scopedOverrides, 44);
  assert.equal(scopedCompletions, 348);
});

test("withheld locations stay in global counts and are excluded from drawn or reduced regions", () => {
  const hiddenIds = Object.values(metadata.inaturalist)
    .filter((r) => r.locationWithheld)
    .map((r) => "inat_" + r.id);
  const hidden = active.filter((row) => !geo.hasValidCoordinates(row));
  assert.equal(hidden.length, 53);
  assert.deepEqual(new Set(hidden.map((row) => row.composite_id)), new Set(hiddenIds));
  const all = new Set(survey.SURVEY_AREA_KEYS);
  const polygon = {
    type: "Polygon",
    coordinates: [
      [
        [35, 32],
        [36, 32],
        [36, 34],
        [35, 34],
        [35, 32],
      ],
    ],
  };
  for (const row of hidden) {
    assert.equal(row.latitude, null);
    assert.equal(row.longitude, null);
    assert.equal(
      monitoring.observationMatchesSelectedAreas(row, all, new Set(), new WeakMap()),
      true,
    );
    assert.equal(
      monitoring.observationMatchesSelectedAreas(
        row,
        new Set(["other_areas"]),
        new Set(),
        new WeakMap(),
      ),
      false,
    );
    assert.equal(geo.observationMatchesDrawnPolygon(row, polygon), false);
  }
});

test("an incomplete identity map or a protected coordinate pair fails atomically", () => {
  const broken = structuredClone(metadata);
  const uuid = Object.keys(broken.inaturalist).find(
    (key) => broken.inaturalist[key].locationWithheld,
  );
  delete broken.inaturalist[uuid];
  assert.throws(() => parse(csv, broken), /unified observation snapshot/);
  const leaked = raw.data.map((row) =>
    row.originalRecordId === uuid ? { ...row, latitude: "32.1", longitude: "35.1" } : row,
  );
  assert.throws(
    () => parse(Papa.unparse(leaked, { columns: raw.meta.fields }), metadata),
    /Protected location/,
  );
});
