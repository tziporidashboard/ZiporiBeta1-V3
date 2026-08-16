/**
 * monitoring-areas.ts \u2014 dynamic (admin-drawn) monitoring-area polygons,
 * loaded from GeoJSON at runtime, as opposed to the hard-coded
 * `@/lib/survey-polygons.ts` shapes.
 *
 * What it does:
 *   - `loadMonitoringAreas()` fetches and validates
 *     `/monitoring-areas.geojson` (a `FeatureCollection` of
 *     Polygon/MultiPolygon features, each with `id`/`name`/`color`
 *     properties).
 *   - `buildObservationMonitoringAreaIndex()` precomputes, for every
 *     observation, the set of monitoring-area IDs whose polygon contains
 *     it (bounding-box pre-filter + `@turf/boolean-point-in-polygon` for
 *     the precise test), stored in a `WeakMap<Observation, Set<string>>`
 *     for O(1) lookups during filtering.
 *   - `observationMatchesSelectedAreas()` \u2014 combines the static
 *     survey-area check (`getObservationArea`) with the dynamic
 *     monitoring-area index to decide if an observation passes the
 *     active area filters.
 *
 * Depends on: `@turf/boolean-point-in-polygon`, `geojson` types,
 *   `@/lib/survey-polygons`, `@/lib/observations-store` (`Observation`).
 * Called by: `@/lib/observations-store.tsx` (builds the index once per
 *   dataset load) and every top-level view/`ObservationMap` that filters
 *   by area.
 */
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Observation } from "./observations-store";
import { getObservationArea, type SurveyAreaKey } from "./survey-polygons";

export type MonitoringAreaProperties = {
  id: string;
  name: string;
  color: string;
};

export type MonitoringAreaFeature = Feature<Polygon | MultiPolygon, MonitoringAreaProperties>;
export type MonitoringAreasGeoJson = FeatureCollection<
  Polygon | MultiPolygon,
  MonitoringAreaProperties
>;

export type ObservationMonitoringAreaIndex = WeakMap<Observation, ReadonlySet<string>>;

type IndexedMonitoringArea = {
  feature: MonitoringAreaFeature;
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
};

function isMonitoringAreasGeoJson(value: unknown): value is MonitoringAreasGeoJson {
  if (!value || typeof value !== "object") return false;
  const collection = value as Partial<MonitoringAreasGeoJson>;
  return (
    collection.type === "FeatureCollection" &&
    Array.isArray(collection.features) &&
    collection.features.every(
      (feature) =>
        feature?.type === "Feature" &&
        (feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon") &&
        typeof feature.properties?.id === "string" &&
        typeof feature.properties?.name === "string" &&
        typeof feature.properties?.color === "string",
    )
  );
}

export async function loadMonitoringAreas(): Promise<MonitoringAreasGeoJson> {
  const response = await fetch("/monitoring-areas.geojson");
  if (!response.ok) {
    throw new Error(`Failed to load monitoring areas (${response.status})`);
  }
  const data: unknown = await response.json();
  if (!isMonitoringAreasGeoJson(data)) {
    throw new Error("Invalid monitoring areas GeoJSON");
  }
  return data;
}

function getIndexedArea(feature: MonitoringAreaFeature): IndexedMonitoringArea {
  let minLongitude = Infinity;
  let minLatitude = Infinity;
  let maxLongitude = -Infinity;
  let maxLatitude = -Infinity;
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [longitude, latitude] of ring) {
        minLongitude = Math.min(minLongitude, longitude);
        minLatitude = Math.min(minLatitude, latitude);
        maxLongitude = Math.max(maxLongitude, longitude);
        maxLatitude = Math.max(maxLatitude, latitude);
      }
    }
  }

  return { feature, minLongitude, minLatitude, maxLongitude, maxLatitude };
}

export function buildObservationMonitoringAreaIndex(
  observations: Observation[],
  monitoringAreas: MonitoringAreasGeoJson | null,
): ObservationMonitoringAreaIndex {
  const index: ObservationMonitoringAreaIndex = new WeakMap();
  if (!monitoringAreas) return index;
  const indexedAreas = monitoringAreas.features.map(getIndexedArea);

  for (const observation of observations) {
    const matches = new Set<string>();
    for (const area of indexedAreas) {
      if (
        observation.longitude < area.minLongitude ||
        observation.longitude > area.maxLongitude ||
        observation.latitude < area.minLatitude ||
        observation.latitude > area.maxLatitude
      ) {
        continue;
      }
      if (booleanPointInPolygon([observation.longitude, observation.latitude], area.feature)) {
        matches.add(area.feature.properties.id);
      }
    }
    index.set(observation, matches);
  }

  return index;
}

export function observationMatchesSelectedAreas(
  observation: Observation,
  selectedSurveyAreas: ReadonlySet<SurveyAreaKey>,
  selectedMonitoringAreaIds: ReadonlySet<string>,
  index: ObservationMonitoringAreaIndex,
): boolean {
  const surveyArea = getObservationArea(observation.latitude, observation.longitude);
  if (
    (surveyArea === null && selectedSurveyAreas.has("other_areas")) ||
    (surveyArea !== null && selectedSurveyAreas.has(surveyArea))
  ) {
    return true;
  }

  const monitoringAreaIds = index.get(observation);
  if (!monitoringAreaIds) return false;
  for (const areaId of selectedMonitoringAreaIds) {
    if (monitoringAreaIds.has(areaId)) return true;
  }
  return false;
}
