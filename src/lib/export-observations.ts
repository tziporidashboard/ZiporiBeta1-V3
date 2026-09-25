import Papa from "papaparse";
import {
  getSpeciesClassification,
  getTaxaGroup,
  translateGroupName,
  type Observation,
} from "./observations-store";
import { getObservationArea, translateArea } from "./survey-polygons";
import { getHebrewLabel } from "./i18n";
import type { MonitoringAreasGeoJson, ObservationMonitoringAreaIndex } from "./monitoring-areas";

export function exportObservations(
  observations: Observation[],
  monitoringAreas: MonitoringAreasGeoJson | null,
  observationMonitoringAreaIndex: ObservationMonitoringAreaIndex,
): void {
  const speciesLabels: Record<string, string> = {
    invasive: getHebrewLabel("invasiveSpecies"),
    rare: getHebrewLabel("rareSpecies"),
    other_species: getHebrewLabel("otherSpecies"),
  };
  const qualityLabels: Record<string, string> = {
    research: getHebrewLabel("researchOnly"),
    needs_id: "דורש זיהוי",
    casual: "מזדמן",
  };
  const areaNames = new Map(
    monitoringAreas?.features.map((feature) => [feature.properties.id, feature.properties.name]),
  );
  const rows = observations.map((o) => {
    const membership = observationMonitoringAreaIndex.get(o);
    const areaIds = membership ? Array.from(membership) : null;
    const dateParts = o.observed_on.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const observedOn = dateParts
      ? `${dateParts[3]}-${dateParts[2].padStart(2, "0")}-${dateParts[1].padStart(2, "0")}`
      : o.observed_on.slice(0, 10);

    return {
      "מזהה תצפית": o.composite_id ?? "",
      "מקור": o.source === "inaturalist" ? "iNaturalist" : o.source === "merlin" ? "MERLIN" : "",
      "קישור למקור": o.source_url ?? "",
      "תאריך תצפית": observedOn,
      "שעת תצפית": o.observed_time ?? "",
      "צופה": o.user_login,
      "קבוצת צופה": translateGroupName(o.user_category, "he"),
      "תת-קבוצה": translateGroupName(o.user_subcategory, "he"),
      "שם מדעי": o.scientific_name,
      "שם נפוץ": o.common_name ?? "",
      "קבוצה טקסונומית": getHebrewLabel(`tg_${getTaxaGroup(o)}`),
      "סיווג מין": speciesLabels[getSpeciesClassification(o)] ?? "",
      "דרגת איכות": qualityLabels[o.quality_grade] ?? o.quality_grade,
      "קו רוחב": o.latitude,
      "קו אורך": o.longitude,
      "אזור סקר": translateArea(getObservationArea(o.latitude, o.longitude) ?? "other_areas", "he"),
      "מזהי אזורי ניטור": areaIds ? areaIds.join(" | ") : "לא זמין",
      "אזורי ניטור": areaIds
        ? areaIds.map((id) => areaNames.get(id) ?? "").join(" | ")
        : "לא זמין",
    };
  });
  const csv = Papa.unparse(rows);
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  link.href = url;
  link.download = `zipori-observations-${date}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
