import Papa from "papaparse";
import type { Observation } from "./observations-store";
import { CANONICAL_CATEGORIES, getTaxonDetails, type CanonicalCategory } from "./taxonomy-engine";
import { speciesMap } from "./species-map";

/** Replace only after an offline comparison and review of missing source IDs. */
export const MERLIN_SOURCE = {
  // Shalom's 2026-11-07 correction: names for observation 137747 only.
  file_name: "merlin-experts-2026-11-06.csv",
  file_sha256: "b706693f023d5bc233b6bea758ea7994fbcf86e405d9c0ed51e9be48b7220684",
  expected_rows: 3664,
  // Presentation order only: preserve the published CSV row order around the
  // separate iNaturalist additions. No values/records are read from the archive.
  previous_source_id_max: 114909,
} as const;

export const MERLIN_COLUMNS = [
  "composite_id",
  "originalRecordId",
  "source_url",
  "observed_on",
  "latitude",
  "longitude",
  "quality_grade",
  "user_login",
  "user_name",
  "user_verified",
  "user_category",
  "user_category_he",
  "user_subcategory",
  "user_subcategory_he",
  "scientific_name",
  "hebrew_name",
  "english_name",
  "taxa_category_he",
  "taxa_category_en",
  "is_invasive",
  "is_rare",
  "is_generic",
] as const;

type DateParser = (value: string, source: "inaturalist" | "merlin") => string;
type TimeParser = (value: string) => string | undefined;
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
const validCoordinates = (lat: number, lon: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180 &&
  !(lat === 0 && lon === 0);

/** Pure conversion: no historical rows, no upsert and no position-based dedupe. */
export function parseMerlinRows(
  rows: Record<string, string>[],
  parseDate: DateParser,
  parseTime: TimeParser,
): Observation[] {
  const ids = new Set<string>();
  return rows.map((row, index) => {
    const id = value(row.composite_id);
    const fail = (reason: string): never => {
      throw new Error(`Invalid MERLIN row ${index + 2} (${id || "missing ID"}): ${reason}`);
    };
    if (!/^ai4biodiversity\.haifa\.ac\.il_[1-9]\d*$/.test(id)) fail("invalid source ID");
    if (ids.has(id)) fail("duplicate source ID");
    ids.add(id);

    const observed_on = parseDate(value(row.observed_on), "merlin");
    const observed_time = parseTime(value(row.observed_on));
    const scientific_name = value(row.scientific_name);
    const user_login = value(row.user_name) || value(row.user_login);
    const category = value(row.taxa_category_he) as CanonicalCategory;
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
      [row.is_invasive, row.is_rare, row.is_generic].some((flag) => flag !== "0" && flag !== "1") ||
      (row.is_invasive === "1" && row.is_rare === "1")
    )
      fail("invalid required field or classification");

    const latitude = value(row.latitude) ? Number(row.latitude) : NaN;
    const longitude = value(row.longitude) ? Number(row.longitude) : NaN;
    if (!validCoordinates(latitude, longitude)) fail("invalid coordinates");

    // Keep the reviewed source-scoped policy; do not modify the shared dictionary.
    const dictionary = getTaxonDetails(scientific_name);
    const known = names.has(scientific_name.toLowerCase());
    const isGeneric =
      row.is_generic === "1" ||
      /^[A-Z][a-z]+$/.test(scientific_name) ||
      (known && dictionary.isGeneric);
    const status = row.is_invasive === "1" ? "invasive" : row.is_rare === "1" ? "rare" : "other";
    return {
      composite_id: `expert_${id}`,
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
      // Not supplied by this source. MERLIN always uses professional_metadata.taxonomy.
      iconic_taxon_name: "",
      taxon_order_name: "",
      source_url: value(row.source_url) || undefined,
      professional_metadata: {
        file_name: MERLIN_SOURCE.file_name,
        file_sha256: MERLIN_SOURCE.file_sha256,
        csv_row: index + 2,
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
  });
}

/** Reject incomplete/malformed snapshots atomically instead of silently dropping rows. */
export function parseMerlinSnapshot(csv: string, parseDate: DateParser, parseTime: TimeParser) {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  if (
    parsed.errors.length ||
    parsed.meta.fields?.length !== MERLIN_COLUMNS.length ||
    !MERLIN_COLUMNS.every((field) => parsed.meta.fields?.includes(field)) ||
    parsed.data.length !== MERLIN_SOURCE.expected_rows
  )
    throw new Error("Invalid or unreviewed professional monitoring snapshot");
  return parseMerlinRows(parsed.data, parseDate, parseTime);
}
