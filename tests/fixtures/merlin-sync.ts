import type { Observation } from "../../src/lib/observations-store";
import { CANONICAL_CATEGORIES, getLegacyTaxonDetails as getTaxonDetails, type CanonicalCategory } from "../../src/lib/taxonomy-engine";
import { legacySpeciesMap as speciesMap } from "../../src/lib/species-map";

/** Disable this layer to restore the unchanged historical MERLIN source. */
export const MERLIN_SYNC_ENABLED = true;
// Append future snapshots in chronological order. Do not replace earlier
// entries: replaying the chain preserves records missing from a later export.
export const MERLIN_SYNC_SOURCES = [
  {
    file_name: "merlin-experts-2026-11-05.csv",
    original_file_name: "experts export from DB before Rea.csv",
    file_sha256: "3deb438394ea85a0296995c4ca6caad605f554bc7565d37ced2f965bffca8e43",
  },
] as const;
export const MERLIN_SYNC_SOURCE = MERLIN_SYNC_SOURCES[MERLIN_SYNC_SOURCES.length - 1];

export type MerlinException = {
  observation_id: string;
  csv_row: number | null;
  type: string;
  old_value: unknown;
  new_value: unknown;
  reason: string;
  action: string;
  requires_clarification: boolean;
};

type DateParser = (value: string, source: "inaturalist" | "merlin") => string;
type TimeParser = (value: string) => string | undefined;
type Source = { file_name: string; file_sha256: string };
const names = new Set(speciesMap.map((s) => s.Scientific_Name.trim().toLowerCase()));
const englishCategories: Record<string, string> = {
  יונקים: "Mammals",
  עופות: "Birds",
  פרפרים: "Butterflies",
  שפיראים: "Dragonflies",
  "פרוקי רגליים": "Arthropods",
  צמחים: "Plants",
  "שאר המינים": "Other Species",
};
const value = (raw: string | undefined) => (!raw || raw.trim() === "NULL" ? "" : raw.trim());
const coordinatesValid = (lat: number, lon: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180 &&
  !(lat === 0 && lon === 0);

/**
 * Upsert MERLIN only, by the complete source ID. No event/name/location dedupe.
 * Absent or rejected source rows retain the previous observation. iNaturalist
 * objects are returned unchanged. Reapplying a snapshot is idempotent.
 */
export function synchronizeMerlin(
  historical: Observation[],
  rows: Record<string, string>[],
  parseDate: DateParser,
  parseTime: TimeParser,
  source: Source = MERLIN_SYNC_SOURCE,
) {
  const exceptions: MerlinException[] = [];
  const prior = new Map<string, Observation>();
  for (const o of historical) {
    if (o.source !== "merlin") continue;
    if (!o.composite_id?.startsWith("expert_") || prior.has(o.composite_id.slice(7))) {
      throw new Error("Missing or duplicate historical MERLIN identifier");
    }
    prior.set(o.composite_id.slice(7), o);
  }
  const addException = (
    id: string,
    row: number | null,
    type: string,
    oldValue: unknown,
    newValue: unknown,
    reason: string,
    action: string,
    review = false,
  ) => {
    exceptions.push({
      observation_id: id,
      csv_row: row,
      type,
      old_value: oldValue,
      new_value: newValue,
      reason,
      action,
      requires_clarification: review,
    });
  };
  const batches = new Map<string, { row: Record<string, string>; line: number }[]>();
  rows.forEach((row, index) => {
    const id = value(row.composite_id);
    const batch = batches.get(id) ?? [];
    batch.push({ row, line: index + 2 });
    batches.set(id, batch);
  });
  const replacements = new Map<string, Observation>();
  let added = 0;
  let matched = 0;
  let rejected = 0;
  for (const [id, entries] of batches) {
    const { row, line } = entries[0];
    const old = prior.get(id);
    if (!/^ai4biodiversity\.haifa\.ac\.il_[1-9]\d*$/.test(id)) {
      addException(
        id,
        line,
        "invalid_id",
        null,
        id,
        "אין מזהה מקור מקצועי יציב",
        "הרשומה לא יובאה",
        true,
      );
      rejected += entries.length;
      continue;
    }
    if (entries.length > 1) {
      const same = entries.every((e) => JSON.stringify(e.row) === JSON.stringify(row));
      addException(
        id,
        line,
        same ? "duplicate_id_identical" : "duplicate_id_conflict",
        old ?? null,
        entries.map((e) => e.row),
        "המזהה מופיע יותר מפעם אחת בקלט",
        same ? "עותק אחד בלבד עובד" : "כל גרסאות המזהה נדחו; נשמרה הרשומה הקודמת אם קיימת",
        !same,
      );
      if (!same) {
        rejected += entries.length;
        continue;
      }
    }
    const observed_on = parseDate(value(row.observed_on), "merlin");
    const observed_time = parseTime(value(row.observed_on));
    const scientific_name = value(row.scientific_name);
    const user_login = value(row.user_name) || value(row.user_login);
    const category = value(row.taxa_category_he) as CanonicalCategory;
    const flags = [row.is_invasive, row.is_rare, row.is_generic];
    if (
      !observed_on ||
      !observed_time ||
      !scientific_name ||
      !user_login ||
      !["research", "needs_id", "casual"].includes(value(row.quality_grade)) ||
      value(row.user_verified) !== "expert" ||
      value(row.user_category) !== "Professional Monitoring" ||
      value(row.user_subcategory) !== "Professional Monitoring" ||
      !CANONICAL_CATEGORIES.includes(category) ||
      englishCategories[category] !== value(row.taxa_category_en) ||
      flags.some((f) => f !== "0" && f !== "1") ||
      (row.is_invasive === "1" && row.is_rare === "1")
    ) {
      addException(
        id,
        line,
        "invalid_record",
        old ?? null,
        row,
        "שדה חובה או סיווג אינם תקינים או שסמני הנדירות והפולשנות סותרים",
        "הרשומה הקודמת נשמרה; רשומה חדשה לא יובאה",
        true,
      );
      rejected++;
      continue;
    }
    let latitude = value(row.latitude) ? Number(row.latitude) : NaN;
    let longitude = value(row.longitude) ? Number(row.longitude) : NaN;
    if (!coordinatesValid(latitude, longitude)) {
      const retain = old && coordinatesValid(old.latitude, old.longitude);
      addException(
        id,
        line,
        "invalid_coordinates",
        old ? [old.latitude, old.longitude] : null,
        [row.latitude, row.longitude],
        "מיקום חסר, מחוץ לטווח או 0,0",
        retain ? "נשמר המיקום התקין הקודם; יתר השדות עודכנו" : "הרשומה החדשה לא יובאה",
        true,
      );
      if (!retain) {
        rejected++;
        continue;
      }
      latitude = old.latitude;
      longitude = old.longitude;
    }
    const dictionary = getTaxonDetails(scientific_name);
    const known = names.has(scientific_name.toLowerCase());
    const status = row.is_invasive === "1" ? "invasive" : row.is_rare === "1" ? "rare" : "other";
    // An explicit genus-only identification must not inflate identified-species
    // metrics. Keep the supplied scientific name and raw flag for review.
    const genusOnly = /^[A-Z][a-z]+$/.test(scientific_name);
    const isGeneric = row.is_generic === "1" || genusOnly || (known && dictionary.isGeneric);
    if (!known)
      addException(
        id,
        line,
        "dictionary_missing",
        null,
        scientific_name,
        "השם המדעי אינו במילון המשותף",
        "נוספו שמות וסיווג מרשומת המקור ל-MERLIN בלבד",
      );
    if (known && dictionary.category !== category)
      addException(
        id,
        line,
        "category_conflict",
        dictionary.category,
        category,
        "קבוצת המקור שונה מהמילון המשותף",
        "הוחל סיווג המקור על MERLIN בלבד; המילון לא שונה",
      );
    if (dictionary.status !== status)
      addException(
        id,
        line,
        "status_conflict",
        dictionary.status,
        status,
        "סיווג הנדירות או הפולשנות שונה מהרשימה המשותפת",
        "הוחל סיווג המקור העדכני על MERLIN בלבד; נדרש אישור מקצועי ליישוב הסתירה",
        true,
      );
    if (isGeneric !== (row.is_generic === "1"))
      addException(
        id,
        line,
        "generic_conflict",
        old ? getTaxonDetails(old.scientific_name).isGeneric : null,
        row.is_generic,
        "שם ברמת סוג או זיהוי כללי מסומן במקור כמין מזוהה",
        "נשמרת התצפית; הזיהוי נשאר כללי ואינו נספר כמין מזוהה",
        true,
      );
    if (
      known &&
      (dictionary.name !== value(row.hebrew_name) ||
        dictionary.englishName !== value(row.english_name))
    ) {
      addException(
        id,
        line,
        "display_names_difference",
        [dictionary.name, dictionary.englishName],
        [row.hebrew_name, row.english_name],
        "תוויות המקור שונות או חסרות במילון",
        "נשמרו תוויות המקור עבור תצפית MERLIN בלבד",
      );
    }
    if (
      old?.scientific_name === "Pseudophilotes baton" &&
      scientific_name === "Pseudophilotes vicrama"
    ) {
      addException(
        id,
        line,
        "scientific_identity_review",
        old.scientific_name,
        scientific_name,
        "שינוי זהות אפשרי שאינו תיקון כתיב בלבד",
        "נשמר השם העדכני שנשלח; לא נוצר איחוד שמות נרדפים או שינוי במילון",
        true,
      );
    }
    const observation: Observation = {
      ...old,
      composite_id: old?.composite_id ?? `expert_${id}`,
      source: "merlin",
      observed_on,
      observed_time,
      latitude,
      longitude,
      user_login,
      scientific_name,
      common_name: value(row.hebrew_name) || undefined,
      quality_grade: value(row.quality_grade),
      user_category: "expert",
      user_subcategory: "expert",
      iconic_taxon_name: old?.iconic_taxon_name ?? "",
      taxon_order_name: old?.taxon_order_name ?? "",
      source_url: value(row.source_url) || undefined,
      professional_metadata: {
        file_name: source.file_name,
        file_sha256: source.file_sha256,
        csv_row: line,
        values: { ...row },
        taxonomy: {
          name: value(row.hebrew_name) || scientific_name,
          englishName: value(row.english_name),
          category,
          status,
          isGeneric,
        },
      },
    };
    replacements.set(id, observation);
    if (old) matched++;
    else added++;
  }
  for (const [id, old] of prior) {
    if (!batches.has(id))
      addException(
        id,
        null,
        "missing_from_latest",
        old,
        null,
        "מזהה היסטורי אינו מופיע בייצוא הנוכחי",
        "נשמרה הרשומה ההיסטורית ללא שינוי",
        true,
      );
  }
  const observations = historical.map((o) =>
    o.source === "merlin" ? (replacements.get(o.composite_id!.slice(7)) ?? o) : o,
  );
  for (const [id, o] of replacements) if (!prior.has(id)) observations.push(o);
  return {
    observations,
    exceptions,
    summary: {
      source_rows: rows.length,
      matched,
      added,
      rejected,
      retained_missing: [...prior.keys()].filter((id) => !batches.has(id)).length,
    },
  };
}
