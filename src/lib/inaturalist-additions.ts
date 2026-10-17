import type { Observation } from "./observations-store";

export type ObservationSourceMetadata = {
  file_name: string;
  file_sha256: string;
  sheet_name: string;
  excel_row: number;
  /** All 22 literal Excel fields, including platform ID, photo URL and raw groups. */
  values: Record<string, string>;
};

const GROUPS: Record<string, [string, string]> = {
  "online communities|online communities": ["online_communities", "community"],
  "local communities|zevulun": ["local_communities", "zevulun"],
  "local communities|yizrael": ["local_communities", "yizrael"],
  "local communities|mechinistim": ["local_communities", "mechnistim"],
  "students|students": ["local_communities", "student"],
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid iNaturalist additions object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid iNaturalist additions field");
  return value;
}

/** Append by original source ID. Existing objects always win and are never mutated. */
export function appendInaturalistAdditions(
  historical: Observation[],
  payload: unknown,
  parseDate: (value: string, source: "inaturalist" | "merlin") => string,
  parseTime: (value: string) => string | undefined,
): Observation[] {
  const batch = object(payload);
  if (batch.schemaVersion !== 1 || !Array.isArray(batch.records)) {
    throw new Error("Unsupported iNaturalist additions schema");
  }
  const source = object(batch.source);
  const fileName = text(source.fileName);
  const fileHash = text(source.sha256);
  const sheetName = text(source.sheetName);
  const existingIds = new Set(historical.map((row) => row.composite_id).filter(Boolean));
  const batchIds = new Set<string>();
  const additions: Observation[] = [];

  for (const entry of batch.records) {
    const row = object(entry);
    const raw = object(row.values);
    const values = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, text(value)]),
    );
    const value = (key: string) => {
      const field = text(values[key]).trim();
      return field === "NULL" ? "" : field;
    };
    const id = value("originalRecordId");
    if (!/^[1-9]\d*$/.test(id) || batchIds.has(id)) {
      throw new Error(`Invalid or duplicate originalRecordId: ${id}`);
    }
    batchIds.add(id);
    const compositeId = `inat_${id}`;
    // A later repeat of this batch cannot update any historical/current record.
    if (existingIds.has(compositeId)) continue;

    const date = text(row.observed_date);
    const time = text(row.observed_time);
    const observedOn = parseDate(date, "inaturalist");
    const observedTime = parseTime(time);
    const lat = Number(value("latitude"));
    const lon = Number(value("longitude"));
    const grade = value("quality_grade");
    const group = GROUPS[`${value("user_category")}|${value("user_subcategory")}`];
    if (
      !observedOn ||
      observedOn !== date ||
      !observedTime ||
      observedTime !== time ||
      !value("latitude") ||
      !value("longitude") ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      !["research", "needs_id", "casual"].includes(grade) ||
      !group ||
      !value("user_login") ||
      !Number.isInteger(row.excel_row) ||
      Number(row.excel_row) < 2
    ) {
      throw new Error(`Invalid iNaturalist addition: ${id}`);
    }

    additions.push({
      composite_id: compositeId,
      observed_on: observedOn,
      observed_time: observedTime,
      latitude: lat,
      longitude: lon,
      user_login: value("user_login"),
      quality_grade: grade,
      scientific_name: value("scientific_name"),
      common_name: value("hebrew_name") || undefined,
      // Excel has no original iconic_taxon_name or taxon_order_name. Preserve
      // absence; the existing taxonomy engine still classifies scientific names.
      iconic_taxon_name: "",
      taxon_order_name: "",
      user_category: group[0],
      user_subcategory: group[1],
      source: "inaturalist",
      // Excel's source_url is often a photo. Retain it verbatim in metadata;
      // the dashboard's observation link is derived from the authoritative ID.
      source_url: `https://www.inaturalist.org/observations/${id}`,
      source_metadata: {
        file_name: fileName,
        file_sha256: fileHash,
        sheet_name: sheetName,
        excel_row: Number(row.excel_row),
        values,
      },
    });
  }
  return [...historical, ...additions];
}
