/**
 * survey-polygons.ts — hard-coded, static survey-area polygon definitions
 * derived from surveyPolys.shp (Israel TM Grid → WGS84).
 *
 * What it does:
 *   - Defines the 4 fixed survey areas ("תעלה"/Canal, "פשט קטן"/Small
 *     Floodplain, "נחל"/Stream, "פשט גדול"/Large Floodplain) plus a
 *     synthetic `"other_areas"` bucket for points outside all of them.
 *   - `SURVEY_POLYGONS` — each polygon as an array of [longitude,
 *     latitude] rings (GeoJSON coordinate order).
 *   - `pointInRing`/`getObservationArea` — ray-casting point-in-polygon
 *     test used to classify a lat/lon into one of the `SurveyAreaKey`s.
 *   - `translateArea` — Hebrew/English label lookup for UI display.
 *
 * Contrast with `@/lib/monitoring-areas.ts`, which handles
 * dynamically-loaded (GeoJSON file) monitoring-area polygons.
 *
 * Called by: `@/lib/monitoring-areas.ts` (`observationMatchesSelectedAreas`),
 *   `@/components/observation-map.tsx`, `@/components/filter-sidebar.tsx`.
 */

export type SurveyAreaKey = "תעלה" | "פשט קטן" | "נחל" | "פשט גדול" | "other_areas";

export const SURVEY_AREA_KEYS: SurveyAreaKey[] = ["תעלה", "פשט קטן", "נחל", "פשט גדול", "other_areas"];

export const AREA_TRANSLATIONS: Record<SurveyAreaKey, { he: string; en: string }> = {
  "תעלה":    { he: "תעלה",    en: "Canal" },
  "פשט קטן": { he: "פשט קטן", en: "Small Floodplain" },
  "נחל":     { he: "נחל",     en: "Stream" },
  "פשט גדול":{ he: "פשט גדול",en: "Large Floodplain" },
  "other_areas": { he: "שאר האזורים", en: "Other Areas" },
};

export const AREA_COLORS: Record<SurveyAreaKey, string> = {
  "תעלה":    "#0ea5e9",
  "פשט קטן": "#22c55e",
  "נחל":     "#eab308",
  "פשט גדול":"#ec4899",
  "other_areas": "#9ca3af",
};

export function translateArea(key: SurveyAreaKey, lang: "he" | "en"): string {
  return AREA_TRANSLATIONS[key][lang];
}

/** [longitude, latitude][] rings per polygon (WGS84) */
export const SURVEY_POLYGONS: Partial<Record<SurveyAreaKey, number[][][]>> = {
  "תעלה": [
    [
      [35.1198506, 32.7772126],
      [35.1193008, 32.7777847],
      [35.1192978, 32.7777878],
      [35.1193004, 32.7777884],
      [35.1193384, 32.7777976],
      [35.1214673, 32.7783094],
      [35.1223868, 32.7786406],
      [35.1226808, 32.7782606],
      [35.1198551, 32.7772079],
      [35.1198506, 32.7772126],
    ],
  ],
  "פשט קטן": [
    [
      [35.1193175, 32.777771 ],
      [35.1198311, 32.7772296],
      [35.1189496, 32.7768498],
      [35.1183488, 32.7765176],
      [35.1182763, 32.7768629],
      [35.1184281, 32.7773844],
      [35.1187164, 32.7776826],
      [35.1193175, 32.777771 ],
    ],
  ],
  "נחל": [
    [
      [35.1182442, 32.7768764],
      [35.1183888, 32.7765244],
      [35.1171792, 32.7757312],
      [35.1153845, 32.7748225],
      [35.1139664, 32.7740698],
      [35.1129246, 32.7738659],
      [35.1129242, 32.7741774],
      [35.1136775, 32.7743811],
      [35.1146469, 32.7749777],
      [35.1157685, 32.7755338],
      [35.1166419, 32.7759543],
      [35.1182442, 32.7768764],
    ],
  ],
  "פשט גדול": [
    [
      [35.1128922, 32.7742045],
      [35.1129486, 32.7738998],
      [35.1120043, 32.7736756],
      [35.1106008, 32.7730515],
      [35.1093268, 32.7725562],
      [35.1087982, 32.7721224],
      [35.1087970, 32.7733210],
      [35.1087468, 32.7752172],
      [35.1098771, 32.7752248],
      [35.1112158, 32.7751987],
      [35.1123943, 32.7750641],
      [35.1125548, 32.7748408],
      [35.1126676, 32.7742856],
      [35.1128922, 32.7742045],
    ],
  ],
};

/**
 * Ray-casting point-in-polygon test.
 * @param lon longitude (x)
 * @param lat latitude (y)
 * @param ring array of [lon, lat] pairs forming a closed ring
 */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Returns the SurveyAreaKey of the first polygon that contains the point,
 * or null if the point falls outside all polygons.
 */
export function getObservationArea(lat: number, lon: number): SurveyAreaKey | null {
  for (const key of SURVEY_AREA_KEYS) {
    const rings = SURVEY_POLYGONS[key];
    if (!rings) continue;
    if (rings.some((ring) => pointInRing(lon, lat, ring))) {
      return key;
    }
  }
  return null;
}
