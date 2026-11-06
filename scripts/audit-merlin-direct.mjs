import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadProductionModule, read } from "../tests/helpers/observation-source.mjs";
import { runSync, merlin, store } from "../tests/helpers/merlin-source.mjs";
import { loadDirectDashboard } from "../tests/helpers/merlin-direct-source.mjs";
import { readMerlinHistory } from "../tests/helpers/merlin-history.mjs";

const before = runSync();
const after = await loadDirectDashboard();
assert.deepEqual(after.errors, []);
const rows = after.observations;
const ids = new Set(rows.map((o) => o.composite_id));
const removed = before.observations.filter((o) => !ids.has(o.composite_id));
assert.deepEqual(removed.map((o) => o.composite_id.split("_").at(-1)).sort(), [
  "114696",
  "114697",
  "114782",
]);
const expected = before.observations.filter((o) => ids.has(o.composite_id));
const visible = (o) => {
  if (o.source !== "merlin") return o;
  const { iconic_taxon_name, taxon_order_name, ...retained } = o;
  return retained;
};
assert.deepEqual(rows.map(visible), expected.map(visible));
const count = (data, f) =>
  Object.fromEntries([...Map.groupBy(data, f)].map(([k, v]) => [k, v.length]));
const hash = (b) => createHash("sha256").update(b).digest("hex");
const experts = rows.filter((o) => o.source === "merlin");
const inat = rows.filter((o) => o.source === "inaturalist");
assert.deepEqual(
  inat,
  before.observations.filter((o) => o.source === "inaturalist"),
);
const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
let blob;
globalThis.URL = {
  createObjectURL: (b) => {
    blob = b;
    return "blob:audit";
  },
  revokeObjectURL() {},
};
globalThis.document = {
  createElement: () => ({ click() {}, remove() {} }),
  body: { appendChild() {} },
};
const exportRows = loadProductionModule("src/lib/export-observations.ts").exportObservations;
const exportHashes = {};
for (const lang of ["he", "en"]) {
  exportRows(expected, geo, areas.buildObservationMonitoringAreaIndex(expected, geo), lang);
  const prior = await blob.text();
  exportRows(rows, geo, areas.buildObservationMonitoringAreaIndex(rows, geo), lang);
  assert.equal(await blob.text(), prior);
  exportHashes[lang] = hash(prior);
}
const archivePath = "data-archive/merlin/2026-11-05/MERLIN all observations for Zohar.csv";
const report = {
  before: { total: before.observations.length, merlin: 2647, inaturalist: 11296 },
  after: {
    total: rows.length,
    unique_ids: ids.size,
    merlin: experts.length,
    inaturalist: inat.length,
  },
  requested_urls: after.requests,
  removed: removed.map((o) => ({
    id: o.composite_id,
    date: o.observed_on,
    observer: o.user_login,
    historical_count: merlin.find((r) => `expert_${r.observationID}` === o.composite_id).count,
    reason: "Explicitly approved removal of the three empty sessions; retained in full archive",
  })),
  unchanged_visible_rows: expected.length,
  identical_csv_including_row_order: exportHashes,
  inaturalist_sha256: hash(JSON.stringify(inat)),
  professional_years: count(experts, (o) => o.observed_on.slice(6)),
  professional_monitors: count(experts, (o) => o.user_login),
  professional_categories: count(experts, store.getTaxaGroup),
  professional_status: count(experts, store.getSpeciesClassification),
  historical_fields_no_longer_in_active_merlin: ["iconic_taxon_name", "taxon_order_name"],
  historical_fields_required_by_active_merlin_views: [],
  coordinate_correction: {
    id: "113424",
    source: [0, 0],
    active: [32.74648, 35.218938],
    pending_shalom: true,
  },
  pending_source_ids: [
    ...new Set(
      before.exceptions
        .filter((e) => e.requires_clarification && ids.has(`expert_${e.observation_id}`))
        .map((e) => e.observation_id),
    ),
  ],
  archive: {
    path: archivePath,
    rows: merlin.length,
    columns: Object.keys(merlin[0]).length,
    bytes: readMerlinHistory().length,
    sha256: hash(readMerlinHistory()),
    served_from_public: false,
  },
};
assert.equal(
  report.archive.sha256,
  "42438b9a029b8ba81ff8625e7a28b8863adde48a70c69b5d30d3823981de8b75",
);
const output = "docs/merlin-direct-2026-11-06";
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(`${output}/comparison.json`, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    before: report.before,
    after: report.after,
    years: report.professional_years,
    monitors: report.professional_monitors,
    pending_clarification: report.pending_source_ids.length,
    identical_csv_including_row_order: true,
    archive_sha256: report.archive.sha256,
  }),
);
