import Papa from "papaparse";
import { MERLIN_COLUMNS, MERLIN_SOURCE, parseMerlinRows } from "./merlin-source";
import type { Observation } from "./observations-store";

export const UNIFIED_CSV = "/zipori-observations-2026-11-20.csv";
export const UNIFIED_METADATA = "/zipori-observation-metadata-2026-11-20.json";

const APPROVED_SHA256 = "5d2561d898ab62a5e846cd8ad649801db308d295785480452059581f6e69c52c";
const INAT_COUNT = 12014;
const GROUP_SUBGROUPS: Record<string, readonly string[]> = {
  online_communities: ["community", "קהילות מקוונות"],
  local_communities: ["student", "mechnistim", "zevulun", "yizrael"],
};

export type RetainedTaxonomyEvidence =
  { kind: "september" } | { kind: "verified-csv"; taxonId: number };

type DisplayMetadata = {
  id: string;
  userCategory: string;
  userSubcategory: string;
  scientificName: string;
  commonName: string;
  iconicTaxonName: string;
  taxonOrderName: string;
  establishmentMeans?: string;
  locationWithheld?: true;
  taxonomyEvidence?: RetainedTaxonomyEvidence;
};

type Metadata = {
  version: 1;
  approvedSha256: string;
  locationsWithheld: number;
  inaturalist: Record<string, DisplayMetadata>;
  displayOrder: string[];
};

type ParseDate = (value: string, source: "unified" | "inaturalist" | "merlin") => string;
type ParseTime = (value: string) => string | undefined;

function hasValidDisplayMetadata(value: DisplayMetadata | undefined): value is DisplayMetadata {
  if (
    !value ||
    typeof value.id !== "string" ||
    !/^[1-9]\d*$/.test(value.id) ||
    !Object.hasOwn(GROUP_SUBGROUPS, value.userCategory) ||
    !GROUP_SUBGROUPS[value.userCategory].includes(value.userSubcategory) ||
    [value.scientificName, value.commonName, value.iconicTaxonName, value.taxonOrderName].some(
      (field) => typeof field !== "string",
    ) ||
    (value.establishmentMeans !== undefined && typeof value.establishmentMeans !== "string") ||
    (value.locationWithheld !== undefined && value.locationWithheld !== true)
  ) {
    return false;
  }
  const evidence = value.taxonomyEvidence;
  return (
    !evidence ||
    evidence.kind === "september" ||
    (evidence.kind === "verified-csv" &&
      Number.isSafeInteger(evidence.taxonId) &&
      evidence.taxonId > 0)
  );
}

/** Membership and observation data come from the approved CSV projection.
 * UUID-keyed metadata carries only the existing dashboard display decisions. */
export function parseUnifiedObservations(
  csv: string,
  metadata: unknown,
  parseDate: ParseDate,
  parseTime: ParseTime,
): Observation[] {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const snapshot = metadata as Metadata | null;
  const merlinCount = MERLIN_SOURCE.expected_rows;
  if (
    parsed.errors.length ||
    parsed.meta.fields?.length !== MERLIN_COLUMNS.length ||
    !MERLIN_COLUMNS.every((name, index) => parsed.meta.fields?.[index] === name) ||
    parsed.data.length !== INAT_COUNT + merlinCount ||
    snapshot?.version !== 1 ||
    snapshot.approvedSha256 !== APPROVED_SHA256 ||
    !snapshot.inaturalist ||
    Object.keys(snapshot.inaturalist).length !== INAT_COUNT ||
    !Array.isArray(snapshot.displayOrder) ||
    snapshot.displayOrder.length !== parsed.data.length ||
    new Set(snapshot.displayOrder).size !== parsed.data.length
  ) {
    throw new Error("Invalid unified observation snapshot");
  }

  const keys = new Set<string>();
  const uuids = new Set<string>();
  const ids = new Set<string>();
  const merlin = [];
  const inaturalist = [];
  let locationsWithheld = 0;
  for (const row of parsed.data) {
    if (!row.composite_id || keys.has(row.composite_id)) {
      throw new Error("Invalid or duplicate platform observation ID");
    }
    keys.add(row.composite_id);
    if (row.user_verified === "expert") {
      merlin.push(row);
      continue;
    }

    const uuid = row.originalRecordId;
    const display = Object.hasOwn(snapshot.inaturalist, uuid)
      ? snapshot.inaturalist[uuid]
      : undefined;
    const date = parseDate(row.observed_on, "unified");
    const time = parseTime(row.observed_on);
    const localDay = date.split("/").reverse().join("-");
    const lat = row.latitude === "" ? null : Number(row.latitude);
    const lon = row.longitude === "" ? null : Number(row.longitude);
    if (
      row.user_verified !== "contributor" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(uuid) ||
      !hasValidDisplayMetadata(display) ||
      uuids.has(uuid) ||
      ids.has(display.id) ||
      !date ||
      row.observed_on !== (time ? localDay + " " + time : localDay) ||
      !row.user_login.trim() ||
      !["research", "needs_id", "casual"].includes(row.quality_grade)
    ) {
      throw new Error("Invalid unified iNaturalist record");
    }
    if (display.locationWithheld) {
      if (lat !== null || lon !== null) throw new Error("Protected location present in snapshot");
      locationsWithheld++;
    } else if (
      lat === null ||
      lon === null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      (lat === 0 && lon === 0)
    ) {
      throw new Error("Unverified unified observation location");
    }

    uuids.add(uuid);
    ids.add(display.id);
    inaturalist.push({
      composite_id: "inat_" + display.id,
      source: "inaturalist" as const,
      observed_on: date,
      observed_time: time,
      latitude: lat,
      longitude: lon,
      user_login: row.user_login,
      quality_grade: row.quality_grade,
      scientific_name: display.scientificName,
      common_name: display.commonName || undefined,
      iconic_taxon_name: display.iconicTaxonName,
      taxon_order_name: display.taxonOrderName,
      user_category: display.userCategory,
      user_subcategory: display.userSubcategory,
      establishment_means: display.establishmentMeans,
      source_url: "https://www.inaturalist.org/observations/" + display.id,
      retainedTaxonomyEvidence: display.taxonomyEvidence,
    });
  }

  if (
    inaturalist.length !== INAT_COUNT ||
    merlin.length !== merlinCount ||
    locationsWithheld !== snapshot.locationsWithheld
  ) {
    throw new Error("Incomplete unified observation snapshot");
  }
  // The original display order preserves the first recorded group for observers
  // who contributed in more than one community.
  const rows = [...inaturalist, ...parseMerlinRows(merlin, parseDate, parseTime)];
  const byId = new Map(rows.map((row) => [row.composite_id, row]));
  return snapshot.displayOrder.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error("Unexpected observation in display order");
    return row;
  });
}

export async function loadUnifiedObservations(parseDate: ParseDate, parseTime: ParseTime) {
  const [csv, metadata] = await Promise.all([fetch(UNIFIED_CSV), fetch(UNIFIED_METADATA)]);
  if (!csv.ok || !metadata.ok) throw new Error("Unable to load the unified observation snapshot");
  return parseUnifiedObservations(await csv.text(), await metadata.json(), parseDate, parseTime);
}
