import type { Observation } from "./observations-store";
import {
  OBSERVED_DISPLAY_DATES,
  OBSERVED_DISPLAY_REVIEW_SHA256,
  OBSERVED_DISPLAY_SOURCE_SHA256,
} from "./observed-display-review";

export type ObservationSourceMetadata = {
  file_name: string;
  file_sha256: string;
  sheet_name: string;
  excel_row: number;
  /** All 22 literal source fields, including platform ID, photo URL and raw groups. */
  values: Record<string, string>;
  /** Present only for CSV additions verified against the public iNaturalist API. */
  verification?: InaturalistVerification;
  date_audit_sha256?: string;
};

type InaturalistVerification = {
  inaturalist_id: string;
  uuid: string;
  retrieved_at: string;
  response_sha256: string;
  observed_on: string;
  observed_on_string: string;
  time_observed_at: string | null;
  observed_time_zone: string;
  date_status: "verified_datetime" | "verified_date_conflicting_time" | "verified_observed_display";
  observed_display?: {
    inaturalist_id: string;
    observation_url: string;
    screenshot_sha256: string;
    field_label: string;
    displayed_date: string;
    displayed_time: string;
    time_zone_label: string;
    precision: "minute";
    displayed_observer: string;
  };
  taxon_id: number;
  taxon_rank: string;
  scientific_name: string;
  iconic_taxon_name: string;
  quality_grade: string;
  user_login: string;
  latitude: number;
  longitude: number;
  geoprivacy: string | null;
  taxon_geoprivacy: string | null;
  obscured: boolean;
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

/** Explicitly reviewed six-record exception; never a general preference for API timestamps. */
function matchesObservedDisplayReview(
  id: string,
  isoDay: string,
  time: string,
  sourceObservedOn: string,
  fileHash: string,
  auditHash: string,
  verification: Record<string, unknown>,
): boolean {
  const reviewed = OBSERVED_DISPLAY_DATES[id];
  const display = object(verification.observed_display);
  return Boolean(
    reviewed &&
    fileHash === OBSERVED_DISPLAY_SOURCE_SHA256 &&
    auditHash === OBSERVED_DISPLAY_REVIEW_SHA256 &&
    verification.uuid === reviewed.uuid &&
    sourceObservedOn === reviewed.sourceObservedOn &&
    isoDay === reviewed.date &&
    time === reviewed.time &&
    verification.time_observed_at === `${isoDay}T${time}:00+03:00` &&
    display.inaturalist_id === id &&
    display.observation_url === `https://www.inaturalist.org/observations/${id}` &&
    display.screenshot_sha256 === reviewed.screenshotSha256 &&
    display.field_label === "נצפה" &&
    display.displayed_date === isoDay &&
    display.displayed_time === time &&
    display.time_zone_label === "IDT" &&
    display.precision === "minute" &&
    display.displayed_observer === verification.user_login,
  );
}

/** Append by original source ID. Existing objects always win and are never mutated. */
export function appendInaturalistAdditions(
  historical: Observation[],
  payload: unknown,
  parseDate: (value: string, source: "inaturalist" | "merlin") => string,
  parseTime: (value: string) => string | undefined,
): Observation[] {
  const batch = object(payload);
  if (
    typeof batch.schemaVersion !== "number" ||
    ![1, 2, 3].includes(batch.schemaVersion) ||
    !Array.isArray(batch.records)
  ) {
    throw new Error("Unsupported iNaturalist additions schema");
  }
  const source = object(batch.source);
  const fileName = text(source.fileName);
  const fileHash = text(source.sha256);
  const sheetName = text(source.sheetName);
  const verifiedDisplay = batch.schemaVersion === 3;
  const verifiedCsv = batch.schemaVersion === 2 || verifiedDisplay;
  const dateAuditHash = verifiedCsv ? text(source.dateAuditSha256) : undefined;
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
    const id = verifiedCsv ? text(row.inaturalist_id) : value("originalRecordId");
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
    let verification: InaturalistVerification | undefined;
    if (verifiedCsv) {
      const v = object(row.verification);
      const isoDay = date.split("/").reverse().join("-");
      const dateOnly = v.date_status === "verified_date_conflicting_time";
      const dateVerified = verifiedDisplay
        ? v.date_status === "verified_observed_display" &&
          matchesObservedDisplayReview(
            id,
            isoDay,
            time,
            value("observed_on"),
            fileHash,
            dateAuditHash!,
            v,
          )
        : ["verified_datetime", "verified_date_conflicting_time"].includes(text(v.date_status)) &&
          value("observed_on") === `${isoDay}${dateOnly ? "" : ` ${time}`}`;
      if (
        v.inaturalist_id !== id ||
        v.uuid !== value("originalRecordId") ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(text(v.uuid)) ||
        !dateVerified ||
        v.observed_on !== isoDay ||
        (dateOnly ? time !== "" : !observedTime) ||
        v.observed_time_zone !== "Asia/Jerusalem" ||
        !Number.isFinite(Date.parse(text(v.retrieved_at))) ||
        !/^[a-f0-9]{64}$/.test(text(v.response_sha256)) ||
        !/^[a-f0-9]{64}$/.test(dateAuditHash!) ||
        !Number.isInteger(v.taxon_id) ||
        Number(v.taxon_id) <= 0 ||
        !text(v.taxon_rank) ||
        !text(v.scientific_name) ||
        v.quality_grade !== grade ||
        v.user_login !== value("user_login") ||
        typeof v.latitude !== "number" ||
        typeof v.longitude !== "number" ||
        Math.abs(v.latitude - lat) > 1e-8 ||
        Math.abs(v.longitude - lon) > 1e-8 ||
        v.obscured !== false ||
        ![null, "open"].includes(v.geoprivacy as string | null) ||
        ![null, "open"].includes(v.taxon_geoprivacy as string | null)
      ) {
        throw new Error(`Unverified iNaturalist addition: ${id}`);
      }
      // Schema 3 retains the conflicting CSV/API fields and applies only the
      // six screenshot-reviewed dates. Other batches keep their existing policy.
      verification = v as InaturalistVerification;
    }
    if (
      !observedOn ||
      observedOn !== date ||
      ((!verifiedCsv || time !== "") && (!observedTime || observedTime !== time)) ||
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
      scientific_name: verification?.scientific_name ?? value("scientific_name"),
      common_name: value("hebrew_name") || undefined,
      // September retains its original absence. The verified CSV supplies the
      // public API's iconic taxon to the existing taxonomy fallback only.
      iconic_taxon_name: verification?.iconic_taxon_name ?? "",
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
        ...(verification ? { verification, date_audit_sha256: dateAuditHash } : {}),
      },
    });
  }
  return [...historical, ...additions];
}
