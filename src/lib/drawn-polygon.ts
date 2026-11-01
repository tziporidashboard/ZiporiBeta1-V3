import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Polygon } from "geojson";

type Coordinates = { latitude: number; longitude: number };

export function hasValidCoordinates(point: Coordinates): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

/** Geoman prevents self-intersections; reject empty/collinear rings as well. */
export function isValidDrawnPolygon(polygon: Polygon): boolean {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return false;
  if (ring.some(([longitude, latitude]) => !hasValidCoordinates({ longitude, latitude })))
    return false;
  const [first, ...rest] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return false;
  // Translate to the first vertex to avoid cancellation for small local areas.
  const area = rest.reduce((sum, point, i) => {
    const previous = ring[i];
    return (
      sum +
      (previous[0] - first[0]) * (point[1] - first[1]) -
      (point[0] - first[0]) * (previous[1] - first[1])
    );
  }, 0);
  return Math.abs(area) > Number.EPSILON;
}

// Each completed drawing is immutable. Share its bounds across all existing
// filter pipelines; replaced drawings can be garbage-collected.
const polygonBounds = new WeakMap<Polygon, [number, number, number, number]>();

export function observationMatchesDrawnPolygon(
  observation: Coordinates,
  polygon: Polygon | null | undefined,
): boolean {
  if (!polygon) return true;
  if (!hasValidCoordinates(observation)) return false;
  let bounds = polygonBounds.get(polygon);
  if (!bounds) {
    bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [longitude, latitude] of polygon.coordinates[0]) {
      bounds[0] = Math.min(bounds[0], longitude);
      bounds[1] = Math.min(bounds[1], latitude);
      bounds[2] = Math.max(bounds[2], longitude);
      bounds[3] = Math.max(bounds[3], latitude);
    }
    polygonBounds.set(polygon, bounds);
  }
  const { longitude, latitude } = observation;
  if (
    longitude < bounds[0] ||
    latitude < bounds[1] ||
    longitude > bounds[2] ||
    latitude > bounds[3]
  )
    return false;
  // GeoJSON/Turf use [longitude, latitude], unlike Leaflet's [latitude, longitude].
  return booleanPointInPolygon([longitude, latitude], polygon, { ignoreBoundary: false });
}
