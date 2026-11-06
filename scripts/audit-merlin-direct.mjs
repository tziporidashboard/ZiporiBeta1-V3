import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import { loadProductionModule, read } from "../tests/helpers/observation-source.mjs";
import { runSync, incoming as previousRaw, store } from "../tests/helpers/merlin-source.mjs";
import { direct, loadDirectDashboard } from "../tests/helpers/merlin-direct-source.mjs";
import { readMerlinHistory, readPreviousMerlinSnapshot } from "../tests/helpers/merlin-history.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const count = (data, fn) =>
  Object.fromEntries([...Map.groupBy(data, fn)].map(([k, v]) => [k, v.length]));
const omitted = new Set(
  ["114696", "114697", "114782"].map((id) => `expert_ai4biodiversity.haifa.ac.il_${id}`),
);
const fixedId = "expert_ai4biodiversity.haifa.ac.il_113424";
const synchronized = runSync();
const before = synchronized.observations.filter((o) => !omitted.has(o.composite_id));
const after = await loadDirectDashboard();
assert.deepEqual(after.errors, []);
const rows = after.observations,
  byId = new Map(rows.map((o) => [o.composite_id, o]));
const oldIds = new Set(before.map((o) => o.composite_id));
const added = rows.filter((o) => !oldIds.has(o.composite_id));
const incoming = Papa.parse(read(`public/${direct.MERLIN_SOURCE.file_name}`), {
  header: true,
  skipEmptyLines: true,
}).data;
const rawById = new Map(incoming.map((r) => [r.composite_id, r]));
const changes = previousRaw.flatMap((old) => {
  const current = rawById.get(old.composite_id);
  assert.ok(current, `Missing historical ID ${old.composite_id}`);
  const fields = Object.keys(old).filter((k) => old[k] !== current[k]);
  return fields.length
    ? [
        {
          id: old.composite_id,
          changes: fields.map((field) => ({ field, old: old[field], new: current[field] })),
        },
      ]
    : [];
});
assert.deepEqual(changes, [
  {
    id: "ai4biodiversity.haifa.ac.il_113424",
    changes: [
      { field: "latitude", old: "0", new: "32.745815" },
      { field: "longitude", old: "0", new: "35.221931" },
    ],
  },
]);
const visible = (o) => {
  if (o.source !== "merlin") return o;
  const { iconic_taxon_name, taxon_order_name, professional_metadata, ...rest } = o;
  return { ...rest, taxonomy: professional_metadata.taxonomy, raw: professional_metadata.values };
};
for (const old of before)
  if (old.composite_id !== fixedId)
    assert.deepEqual(visible(byId.get(old.composite_id)), visible(old));
const inat = rows.filter((o) => o.source === "inaturalist"),
  experts = rows.filter((o) => o.source === "merlin");
assert.deepEqual(
  inat,
  before.filter((o) => o.source === "inaturalist"),
);
assert.equal(rows.length, 14960);
assert.equal(byId.size, 14960);
assert.equal(added.length, 1020);
const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const areas = loadProductionModule("src/lib/monitoring-areas.ts"),
  survey = loadProductionModule("src/lib/survey-polygons.ts");
const index = areas.buildObservationMonitoringAreaIndex(rows, geo),
  oldIndex = areas.buildObservationMonitoringAreaIndex(before, geo);
const oldFixed = before.find((o) => o.composite_id === fixedId),
  newFixed = byId.get(fixedId);
let blob;
globalThis.URL = { createObjectURL: (b) => ((blob = b), "blob:audit"), revokeObjectURL() {} };
globalThis.document = {
  createElement: () => ({ click() {}, remove() {} }),
  body: { appendChild() {} },
};
const exportRows = loadProductionModule("src/lib/export-observations.ts").exportObservations;
const csvChecks = {};
for (const lang of ["he", "en"]) {
  exportRows(before, geo, oldIndex, lang);
  const prior = Papa.parse(await blob.text(), { header: true }).data;
  exportRows(rows, geo, index, lang);
  const text = await blob.text(),
    current = Papa.parse(text, { header: true }).data;
  const id = lang === "he" ? "מזהה תצפית" : "Observation ID";
  assert.deepEqual(
    current.filter((r) => oldIds.has(r[id]) && r[id] !== fixedId),
    prior.filter((r) => r[id] !== fixedId),
  );
  assert.equal(current.length, 14960);
  csvChecks[lang] = {
    rows: current.length,
    columns: Object.keys(current[0]).length,
    unchanged_prior_rows: prior.length - 1,
    sha256: hash(text),
  };
}
const pending = [
  ...new Set(
    synchronized.exceptions
      .filter(
        (e) =>
          e.requires_clarification &&
          byId.has(`expert_${e.observation_id}`) &&
          `expert_${e.observation_id}` !== fixedId,
      )
      .map((e) => e.observation_id),
  ),
];
const report = {
  source: {
    ...direct.MERLIN_SOURCE,
    received_at: "2026-11-06T18:48:09+02:00",
    bytes: fs.statSync(`public/${direct.MERLIN_SOURCE.file_name}`).size,
  },
  before: { total: before.length, merlin: previousRaw.length, inaturalist: 11296 },
  after: {
    total: rows.length,
    unique_ids: byId.size,
    merlin: experts.length,
    inaturalist: inat.length,
  },
  comparison: {
    added: added.length,
    unchanged_prior_merlin: previousRaw.length - changes.length,
    updated_prior_merlin: changes.length,
    missing: 0,
    changes,
  },
  previous_same_day_export: {
    sha256: "69f58e6da8a883b5002b93e9cc28d691ef6a36f3431098f6446c5a785c4b1d21",
    rows: 3664,
    only_difference: changes,
  },
  requested_urls: after.requests,
  years: count(experts, (o) => o.observed_on.slice(6)),
  monitors: count(experts, (o) => o.user_login),
  categories: count(experts, store.getTaxaGroup),
  statuses: count(experts, store.getSpeciesClassification),
  coordinate_113424: {
    old_temporary: [oldFixed.latitude, oldFixed.longitude],
    current_source: [newFixed.latitude, newFixed.longitude],
    temporary_override_removed: true,
    survey_before: survey.getObservationArea(oldFixed.latitude, oldFixed.longitude),
    survey_after: survey.getObservationArea(newFixed.latitude, newFixed.longitude),
    monitoring_before: [...oldIndex.get(oldFixed)],
    monitoring_after: [...index.get(newFixed)],
  },
  empty_sessions_absent: [...omitted].every((id) => !byId.has(id)),
  inaturalist_sha256: hash(JSON.stringify(inat)),
  csv_checks: csvChecks,
  previous_professional_review_remaining: pending,
  previous_snapshot_backup: {
    path: "data-archive/merlin/2026-11-06-before-rea/merlin-experts-2026-11-05.csv",
    sha256: hash(readPreviousMerlinSnapshot()),
  },
  full_88_column_history_sha256: hash(readMerlinHistory()),
};
assert.equal(
  hash(fs.readFileSync(`public/${direct.MERLIN_SOURCE.file_name}`)),
  direct.MERLIN_SOURCE.file_sha256,
);
const output = "docs/merlin-rea-2026-11-06";
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(`${output}/comparison.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
