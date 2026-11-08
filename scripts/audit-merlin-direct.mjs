import fs from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import { loadProductionModule, read } from "../tests/helpers/observation-source.mjs";
import { direct, loadDirectDashboard } from "../tests/helpers/merlin-direct-source.mjs";

// Offline audit only: historical Git blobs are never loaded by the dashboard.
const hash = (b) => createHash("sha256").update(b).digest("hex");
const count = (data, fn) =>
  Object.fromEntries([...Map.groupBy(data, fn)].map(([k, v]) => [k, v.length]));
const previous = execFileSync(
  "git",
  ["cat-file", "blob", "e0d6def0ff1506c13e885b3107e8f89239277aa1"],
  { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
);
const bytes = fs.readFileSync("public/" + direct.MERLIN_SOURCE.file_name);
assert.equal(hash(previous), "b706693f023d5bc233b6bea758ea7994fbcf86e405d9c0ed51e9be48b7220684");
assert.equal(hash(bytes), direct.MERLIN_SOURCE.file_sha256);
assert.deepEqual(bytes.subarray(0, previous.length), previous);
const batch = Buffer.concat([
  bytes.subarray(0, bytes.indexOf(10) + 1),
  bytes.subarray(previous.length),
]);
assert.equal(hash(batch), "4551e10ec146b3cadd748654737b3c0db7744389028020484406069d320d3001");
const parsed = Papa.parse(batch.toString("utf8"), { header: true, skipEmptyLines: true });
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.data.length, 429);
assert.ok(parsed.data.every((r) => r.observed_on.slice(0, 10) <= "2026-11-08"));

// Execute the same production loader for both snapshots in this audit process.
const approvedSource = { ...direct.MERLIN_SOURCE };
direct.MERLIN_SOURCE.expected_rows = 3664;
direct.MERLIN_SOURCE.file_sha256 = hash(previous);
const prior = await loadDirectDashboard({ text: previous.toString("utf8") });
Object.assign(direct.MERLIN_SOURCE, approvedSource);
const current = await loadDirectDashboard();
assert.deepEqual(prior.errors, []);
assert.deepEqual(current.errors, []);
const before = prior.observations,
  rows = current.observations;
const oldIds = new Set(before.map((o) => o.composite_id));
const byId = new Map(rows.map((o) => [o.composite_id, o]));
assert.equal(before.length, 14960);
assert.equal(rows.length, 15389);
assert.equal(byId.size, 15389);
for (const old of before) {
  const expected =
    old.source === "merlin"
      ? {
          ...old,
          professional_metadata: {
            ...old.professional_metadata,
            file_sha256: approvedSource.file_sha256,
          },
        }
      : old;
  assert.deepEqual(byId.get(old.composite_id), expected, old.composite_id);
}
const store = loadProductionModule("src/lib/observations-store.tsx");
const experts = rows.filter((o) => o.source === "merlin");
const inat = rows.filter((o) => o.source === "inaturalist");
const added = rows.filter((o) => !oldIds.has(o.composite_id));
assert.deepEqual(
  count(rows, (o) => o.source),
  { inaturalist: 11296, merlin: 4093 },
);
assert.equal(added.length, 429);
assert.deepEqual(count(added, store.getTaxaGroup), { butterflies: 429 });
assert.deepEqual(
  count(experts, (o) => o.observed_on.slice(6)),
  { 2024: 600, 2025: 1754, 2026: 1739 },
);
assert.deepEqual(
  count(experts, (o) => o.user_login),
  { "רחלי שוורץ-צחור": 1200, "אסף בן-דוד": 455, "רע שיש": 2438 },
);
for (const id of [114696, 114697, 114782])
  assert.ok(!byId.has("expert_ai4biodiversity.haifa.ac.il_" + id));
const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const index = areas.buildObservationMonitoringAreaIndex(rows, geo);
const oldIndex = areas.buildObservationMonitoringAreaIndex(before, geo);
for (const old of before)
  assert.deepEqual(index.get(byId.get(old.composite_id)), oldIndex.get(old));
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
  const priorRows = Papa.parse(await blob.text(), { header: true }).data;
  exportRows(rows, geo, index, lang);
  const text = await blob.text(),
    currentRows = Papa.parse(text, { header: true }).data;
  const id = lang === "he" ? "מזהה תצפית" : "Observation ID";
  assert.deepEqual(
    currentRows.filter((r) => oldIds.has(r[id])),
    priorRows,
  );
  assert.equal(currentRows.length, 15389);
  csvChecks[lang] = {
    rows: currentRows.length,
    columns: Object.keys(currentRows[0]).length,
    unchanged_prior_rows: priorRows.length,
    sha256: hash(text),
  };
}
const report = {
  source: { ...approvedSource, bytes: bytes.length, approved_as_of: "2026-11-08" },
  previous_source_sha256: hash(previous),
  incoming_fixed_dates_sha256: hash(batch),
  before: { total: 14960, merlin: 3664, inaturalist: 11296 },
  after: {
    total: rows.length,
    unique_ids: byId.size,
    merlin: experts.length,
    inaturalist: inat.length,
  },
  comparison: { added: 429, unchanged_prior_merlin: 3664, updated_prior_merlin: 0, missing: 0 },
  butterfly_dates: count(parsed.data, (r) => r.observed_on.slice(0, 10)),
  years: count(experts, (o) => o.observed_on.slice(6)),
  monitors: count(experts, (o) => o.user_login),
  categories: count(experts, store.getTaxaGroup),
  statuses: count(experts, store.getSpeciesClassification),
  protected_corrections_preserved: true,
  empty_sessions_absent: true,
  future_dates_as_of_approval: 0,
  inaturalist_sha256: hash(JSON.stringify(inat)),
  requested_urls: current.requests,
  csv_checks: csvChecks,
};
// Detailed reports and backups stay ignored and outside public.
const output = "data-archive/merlin/2026-11-08-butterflies-release";
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(output + "/verification.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
