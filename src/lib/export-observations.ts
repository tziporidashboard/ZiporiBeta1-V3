import Papa from "papaparse";
import {
  getSpeciesClassification,
  getTaxaGroup,
  translateGroupName,
  type Observation,
} from "./observations-store";
import { getObservationArea, translateArea } from "./survey-polygons";
import { getLabel, type Lang } from "./i18n";
import { getSpeciesEnglishName } from "./species-dictionary";
import {
  translateMonitoringAreaName,
  type MonitoringAreasGeoJson,
  type ObservationMonitoringAreaIndex,
} from "./monitoring-areas";

const ENGLISH_HEADERS: Record<string, string> = {
  "מזהה תצפית": "Observation ID",
  מקור: "Source",
  "קישור למקור": "Source URL",
  "תאריך תצפית": "Observation Date",
  "שעת תצפית": "Observation Time",
  צופה: "Observer",
  "קבוצת צופה": "Observer Group",
  "תת-קבוצה": "Subgroup",
  "שם מדעי": "Scientific Name",
  "שם נפוץ": "Common Name",
  "קבוצה טקסונומית": "Taxonomic Group",
  "סיווג מין": "Species Classification",
  "דרגת איכות": "Quality Grade",
  "קו רוחב": "Latitude",
  "קו אורך": "Longitude",
  "אזור סקר": "Survey Area",
  "מזהי אזורי ניטור": "Monitoring Area IDs",
  "אזורי ניטור": "Monitoring Areas",
};

export function exportObservations(
  observations: Observation[],
  monitoringAreas: MonitoringAreasGeoJson | null,
  observationMonitoringAreaIndex: ObservationMonitoringAreaIndex,
  lang: Lang,
): void {
  const header = (hebrew: string) => (lang === "en" ? ENGLISH_HEADERS[hebrew] : hebrew);
  const groupLabel = (group: string) =>
    lang === "en" && group === "community"
      ? getLabel("community", lang)
      : translateGroupName(group, lang);
  const unavailable = lang === "en" ? "Not available" : "לא זמין";
  const speciesLabels: Record<string, string> = {
    invasive: getLabel("invasiveSpecies", lang),
    rare: getLabel("rareSpecies", lang),
    other_species: getLabel("otherSpecies", lang),
  };
  const qualityLabels: Record<string, string> = {
    research: getLabel("researchOnly", lang),
    needs_id: getLabel("needsId", lang),
    casual: lang === "en" ? "Casual" : "מזדמן",
  };
  const areaNames = new Map(
    monitoringAreas?.features.map((feature) => [
      feature.properties.id,
      translateMonitoringAreaName(feature.properties, lang),
    ]),
  );
  const rows = observations.map((o) => {
    const englishName =
      lang === "en" ? getSpeciesEnglishName(o.scientific_name)?.trim() : undefined;
    const commonName = englishName && englishName !== "N/A" ? englishName : (o.common_name ?? "");
    const membership = observationMonitoringAreaIndex.get(o);
    const areaIds = membership ? Array.from(membership) : null;
    const dateParts = o.observed_on.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const observedOn = dateParts
      ? `${dateParts[3]}-${dateParts[2].padStart(2, "0")}-${dateParts[1].padStart(2, "0")}`
      : o.observed_on.slice(0, 10);

    return {
      [header("מזהה תצפית")]: o.composite_id ?? "",
      [header("מקור")]:
        o.source === "inaturalist" ? "iNaturalist" : o.source === "merlin" ? "MERLIN" : "",
      [header("קישור למקור")]: o.source_url ?? "",
      [header("תאריך תצפית")]: observedOn,
      [header("שעת תצפית")]: o.observed_time ?? "",
      [header("צופה")]: o.user_login,
      [header("קבוצת צופה")]: groupLabel(o.user_category),
      [header("תת-קבוצה")]: groupLabel(o.user_subcategory),
      [header("שם מדעי")]: o.scientific_name,
      [header("שם נפוץ")]: commonName,
      [header("קבוצה טקסונומית")]: getLabel(`tg_${getTaxaGroup(o)}`, lang),
      [header("סיווג מין")]: speciesLabels[getSpeciesClassification(o)] ?? "",
      [header("דרגת איכות")]: qualityLabels[o.quality_grade] ?? o.quality_grade,
      [header("קו רוחב")]: o.latitude,
      [header("קו אורך")]: o.longitude,
      [header("אזור סקר")]: translateArea(
        getObservationArea(o.latitude, o.longitude) ?? "other_areas",
        lang,
      ),
      [header("מזהי אזורי ניטור")]: areaIds ? areaIds.join(" | ") : unavailable,
      [header("אזורי ניטור")]: areaIds
        ? areaIds.map((id) => areaNames.get(id) ?? "").join(" | ")
        : unavailable,
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
