import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import Papa from "papaparse";
import { root, read, loadProductionModule } from "../tests/helpers/observation-source.mjs";
import {
  historical,
  incoming,
  merlin,
  runSync,
  store,
  sync,
} from "../tests/helpers/merlin-source.mjs";

const output = path.join(root, "docs/merlin-sync-2026-11-05");
const result = runSync();
const observations = result.observations;
const hash = (v) => createHash("sha256").update(v).digest("hex");
const baseline = JSON.parse(read("docs/merlin-sync-2026-11-05/baseline.json"));
const sourceBytes = fs.readFileSync(path.join(root, "public", sync.MERLIN_SYNC_SOURCE.file_name));
assert.equal(hash(sourceBytes), sync.MERLIN_SYNC_SOURCE.file_sha256, "Source snapshot changed");
const prior = new Map(historical.map((o) => [o.composite_id, o]));
const rawPrior = new Map(merlin.map((o) => [o.observationID, o]));
const newRows = new Map(incoming.map((o, i) => [o.composite_id, { row: o, line: i + 2 }]));
const inat = observations.filter((o) => o.source === "inaturalist");
assert.equal(hash(JSON.stringify(inat)), baseline.inatSha256, "iNaturalist changed");
const fields = [
  "observed_on",
  "observed_time",
  "latitude",
  "longitude",
  "user_login",
  "scientific_name",
  "common_name",
  "quality_grade",
  "user_category",
  "user_subcategory",
  "source_url",
];
const sourcePairs = [
  ["timeStamp", "observed_on"],
  ["scientificName", "scientific_name"],
  ["personName", "user_name"],
  ["vernacularName", "hebrew_name"],
  ["isInvasive", "is_invasive"],
  ["isRare", "is_rare"],
];
const changes = observations
  .filter((o) => o.source === "merlin")
  .map((o) => {
    const old = prior.get(o.composite_id);
    const id = o.composite_id.slice(7);
    const next = newRows.get(id);
    const original = rawPrior.get(id);
    const sourceChanges =
      original && next
        ? [
            ...sourcePairs
              .filter(([a, b]) => original[a].trim() !== next.row[b].trim())
              .map(([, b]) => b),
            ...(+original.decimalLatitudeStart !== +next.row.latitude ? ["latitude"] : []),
            ...(+original.decimalLongitudeStart !== +next.row.longitude ? ["longitude"] : []),
          ]
        : [];
    const applied = old ? fields.filter((k) => old[k] !== o[k]) : [];
    return {
      observation_id: o.composite_id,
      csv_row: next?.line ?? null,
      state: !old
        ? "added"
        : !next
          ? "retained_missing"
          : sourceChanges.length
            ? "source_updated"
            : "source_unchanged",
      source_changed_fields: sourceChanges,
      applied_changed_fields: applied,
      old_values: old ? Object.fromEntries(fields.map((k) => [k, old[k] ?? null])) : null,
      new_values: Object.fromEntries(fields.map((k) => [k, o[k] ?? null])),
      old_classification: old
        ? { group: store.getTaxaGroup(old), ...store.getObservationTaxonDetails(old) }
        : null,
      new_classification: { group: store.getTaxaGroup(o), ...store.getObservationTaxonDetails(o) },
    };
  });
const exceptions = [...result.exceptions];
// Equal event fields are candidates only. Original count/session evidence is
// kept in the report; never discard observations based on a fuzzy event key.
const events = Map.groupBy(incoming, (r) =>
  JSON.stringify([r.observed_on, +r.latitude, +r.longitude, r.scientific_name, r.user_name]),
);
for (const group of events.values()) {
  if (group.length < 2) continue;
  for (const r of group)
    exceptions.push({
      observation_id: r.composite_id,
      csv_row: newRows.get(r.composite_id).line,
      type: "similar_event_distinct_ids",
      old_value: group.map((g) => ({
        id: g.composite_id,
        count: rawPrior.get(g.composite_id)?.count,
        session: rawPrior.get(g.composite_id)?.sessionId,
        comment: rawPrior.get(g.composite_id)?.observationComments,
      })),
      new_value: group.map((g) => g.composite_id),
      reason:
        "שדות אירוע זהים אך מזהים נפרדים; כמויות המקור 2 ו-1 ושעת תחילת סשן אינן מוכיחות כפילות",
      action: "כל המזהים נשמרו; לא בוצע איחוד",
      requires_clarification: false,
    });
}
const area = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const geo = JSON.parse(read("public/monitoring-areas.geojson"));
const oldIndex = area.buildObservationMonitoringAreaIndex(historical, geo);
const newIndex = area.buildObservationMonitoringAreaIndex(observations, geo);
const experts = observations.filter((o) => o.source === "merlin");
const memberships = experts.map((o) => ({
  observation_id: o.composite_id,
  old_survey: prior.has(o.composite_id)
    ? survey.getObservationArea(
        prior.get(o.composite_id).latitude,
        prior.get(o.composite_id).longitude,
      )
    : null,
  new_survey: survey.getObservationArea(o.latitude, o.longitude),
  old_monitoring: [...(oldIndex.get(prior.get(o.composite_id)) ?? [])],
  new_monitoring: [...newIndex.get(o)],
}));
const outside = experts.filter(
  (o) => !survey.getObservationArea(o.latitude, o.longitude) && !newIndex.get(o).size,
);
// Polygon coverage is not a study boundary. These are advisory spatial checks.
for (const o of outside)
  exceptions.push({
    observation_id: o.composite_id.slice(7),
    csv_row: newRows.get(o.composite_id.slice(7))?.line ?? null,
    type: "outside_defined_polygons",
    old_value: prior.has(o.composite_id)
      ? [prior.get(o.composite_id).latitude, prior.get(o.composite_id).longitude]
      : null,
    new_value: [o.latitude, o.longitude],
    reason: "מחוץ לפוליגוני הסקר והניטור המוגדרים; אין בכך הוכחה לחריגה מגבול המחקר",
    action: "נשמרה הרשומה ומסווגת בשאר האזורים",
    requires_clarification: false,
  });

const countBy = (rows, fn) =>
  Object.fromEntries([...Map.groupBy(rows, fn)].map(([k, v]) => [k, v.length]));
const labels = {
  invalid_coordinates: "קואורדינטות לא תקינות",
  missing_from_latest: "סשנים חסרים בייצוא החדש",
  dictionary_missing: "שם שאינו במילון",
  category_conflict: "פער קבוצה טקסונומית מול המילון",
  status_conflict: "פער נדירות/פולשנות מול הרשימה המשותפת",
  generic_conflict: "סתירה ברמת הזיהוי",
  scientific_identity_review: "שינוי זהות מין לבירור",
  display_names_difference: "פערי תוויות בעברית או באנגלית",
  similar_event_distinct_ids: "אירועים דומים עם מזהים שונים",
  outside_defined_polygons: "מחוץ לפוליגונים המוגדרים — מידע בלבד",
};
const summary = [...Map.groupBy(exceptions, (e) => e.type)].map(([type, rows]) => ({
  type,
  label: labels[type] ?? type,
  observations: new Set(rows.map((r) => r.observation_id)).size,
  handled: new Set(rows.map((r) => r.observation_id)).size,
  needs_clarification: new Set(
    rows.filter((r) => r.requires_clarification).map((r) => r.observation_id),
  ).size,
  recommendation: rows[0].action,
}));
const metrics = {
  source: sync.MERLIN_SYNC_SOURCE,
  sync: result.summary,
  total: observations.length,
  by_source: countBy(observations, (o) => o.source),
  expert_by_observer: countBy(experts, (o) => o.user_login),
  expert_by_year: countBy(experts, (o) => o.observed_on.slice(6)),
  expert_by_taxa: countBy(experts, store.getTaxaGroup),
  expert_by_status: countBy(experts, store.getSpeciesClassification),
  source_comparison: countBy(changes, (c) => c.state),
  existing_with_material_changes: changes.filter(
    (c) => c.old_values && c.state !== "retained_missing" &&
      (c.applied_changed_fields.length || ["group", "status", "isGeneric"].some(
        (field) => c.old_classification[field] !== c.new_classification[field],
      )),
  ).length,
  existing_with_classification_changes: changes.filter(
    (c) => c.old_values && ["group", "status", "isGeneric"].some(
      (field) => c.old_classification[field] !== c.new_classification[field],
    ),
  ).length,
  existing_with_applied_field_changes: changes.filter(
    (c) => c.old_values && c.applied_changed_fields.length,
  ).length,
  applied_changed_fields: countBy(
    changes.filter((c) => c.old_values).flatMap((c) => c.applied_changed_fields),
    (f) => f,
  ),
  invalid_coordinates_retained: exceptions.filter((e) => e.type === "invalid_coordinates").length,
  generic_observations: experts.filter((o) => store.getObservationTaxonDetails(o).isGeneric).length,
  exception_entries: exceptions.length,
  distinct_observations_with_exceptions: new Set(exceptions.map((e) => e.observation_id)).size,
  distinct_observations_needing_clarification: new Set(
    exceptions.filter((e) => e.requires_clarification).map((e) => e.observation_id),
  ).size,
  inaturalist_sha256: hash(JSON.stringify(inat)),
  exception_summary: summary,
  survey_membership_changes: memberships.filter(
    (m) => prior.has(m.observation_id) && m.old_survey !== m.new_survey,
  ).length,
  monitoring_membership_changes: memberships.filter(
    (m) =>
      prior.has(m.observation_id) &&
      JSON.stringify(m.old_monitoring) !== JSON.stringify(m.new_monitoring),
  ).length,
};
fs.mkdirSync(output, { recursive: true });
const json = (file, data) =>
  fs.writeFileSync(path.join(output, file), JSON.stringify(data, null, 2) + "\n");
json("summary.json", metrics);
json("exceptions.json", exceptions);
json("reconciliation.json", changes);
json("area-memberships.json", memberships);
fs.writeFileSync(
  path.join(output, "exceptions.csv"),
  "\uFEFF" +
    Papa.unparse(
      exceptions.map((e) => ({
        "מזהה תצפית": e.observation_id,
        "שורה בקובץ": e.csv_row,
        "סוג חריגה": labels[e.type] ?? e.type,
        "ערך ישן": JSON.stringify(e.old_value),
        "ערך חדש": JSON.stringify(e.new_value),
        סיבה: e.reason,
        "פעולה שבוצעה": e.action,
        "נדרש בירור מול שלום": e.requires_clarification ? "כן" : "לא",
      })),
      { escapeFormulae: true },
    ),
);
const table = summary
  .map(
    (s) =>
      `| ${s.label} | ${s.observations} | ${s.handled} | ${s.needs_clarification} | ${s.recommendation} |`,
  )
  .join("\n");
fs.writeFileSync(
  path.join(output, "report.md"),
  `# דוח סנכרון MERLIN — 5.11.2026\n\nבוצע מקומית בלבד. לא בוצעו Commit, Push או פריסה.\n\n` +
    `## תוצאות\n\n- תצפיות: **${metrics.total}**, מהן ${inat.length} iNaturalist ו-${experts.length} MERLIN.\n` +
    `- נוספו ${result.summary.added} תצפיות; ${result.summary.matched} תצפיות עודכנו/רועננו ממקור עדכני; נשמרו ${result.summary.retained_missing} חסרות.\n` +
    `- ${metrics.existing_with_material_changes} רשומות משותפות שינו שדות תצפית או סיווג בפועל; ${result.summary.matched - metrics.existing_with_material_changes} נשארו ללא שינוי מהותי לפי הגדרה זו. תוויות תצוגה ומטא-נתוני מקור נבדקו בנפרד.\n` +
    `- בתוך קבוצה זו: ${metrics.existing_with_applied_field_changes} רשומות שינו שדות תצפית, ו-${metrics.existing_with_classification_changes} שינו קבוצה/נדירות/רמת זיהוי; הקבוצות חופפות.\n` +
    `- בהשוואת השדות המקבילים בקובצי המקור: 423 משותפות שונות ו-1,931 זהות. ההבדל מול ספירת השינויים בדשבורד נובע מסיווגים שחושבו בעבר באמצעות המילון ומהשדות הנוספים בייצוא.\n` +
    `- קואורדינטות 113424 נשמרו מהמקור הישן. לא נטען 0,0.\n- חתימת כל אובייקטי iNaturalist לפני ואחרי זהה: ${metrics.inaturalist_sha256}.\n\n` +
    `## חריגות\n\n${metrics.exception_entries} אירועי חריגה/מידע ב-${metrics.distinct_observations_with_exceptions} תצפיות. ` +
    `${metrics.distinct_observations_needing_clarification} תצפיות ייחודיות דורשות בירור. סוגי חריגה יכולים לחפוף. ` +
    `עמודת ״טופלו״ פירושה שיושמה פעולה מבוקרת, לא שהשאלה המקצועית נפתרה.\n\n` +
    `| סוג | תצפיות | טופלו | דורשות בירור | המלצה / פעולה |\n|---|---:|---:|---:|---|\n${table}\n\n` +
    `## קבצים נלווים\n\n- [חריגות מפורטות — CSV](exceptions.csv) ו-[JSON](exceptions.json).\n` +
    `- [השוואה לכל תצפית](reconciliation.json), [שיוכי שטח](area-memberships.json), [סיכום מספרי](summary.json).\n` +
    `- [חתימות מצב קודם](baseline.json). המקורות ההיסטוריים והמילון המשותף לא שונו.\n` +
    `- [תיעוד המימוש, בדיקות ותוכנית המשך](implementation-and-validation.md).\n\n` +
    `## החלטות מקצועיות שנותרו\n\nהמיקום התקין של 113424; הטיפול בשלושת סשני האפס; ` +
    `39 סיווגי נדירות השונים מהרשימה המשותפת; שמונה זיהויים ברמת סוג; שינוי Pseudophilotes baton ל-vicrama. ` +
    `לנדירות ולשם המדעי הוחלו ערכי המקור העדכני רק על MERLIN; לא הוסק ששמות הם נרדפים.\n\n` +
    `## ארכיון ושחזור\n\nזהו דוח שחזור של מנגנון הסנכרון הקודם. קובץ 88 העמודות נשמר ב-data-archive/merlin/2026-11-05/ ואינו מקור פעיל. מנגנון הסנכרון הקודם נשמר ב-tests/fixtures לצורך בדיקות והשוואה בלבד. ראו data-archive/merlin/2026-11-05/README.md להוראות שחזור, ו-docs/merlin-direct-2026-11-06 לתיעוד הטעינה הישירה. אין למחוק רשומות חסרות מעדכון עתידי ללא בדיקה.\n`,
);
