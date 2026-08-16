/**
 * ObservationMap — Leaflet-based map that plots aggregated observation
 * "bubbles" (CircleMarkers) over OpenStreetMap tiles, with survey-area /
 * monitoring-area polygon overlays and a detail sidebar for a clicked
 * bubble.
 *
 * What it does:
 *   - Aggregates raw `data` (already filtered by the caller) into
 *     `bubbles`: one entry per unique
 *     `scientific_name|observed_on|rounded-lat|rounded-lng` combination,
 *     merging duplicate points and tracking their `composite_id`s.
 *   - Uses a single shared Leaflet canvas `renderer` for all vector
 *     layers so overlapping polygons/circles/geojson hit-test correctly
 *     (Leaflet gives each canvas pane its own hit-testing otherwise).
 *   - Implements manual click resolution (`MapClickHandler`) instead of
 *     per-marker interactivity, for performance with many bubbles:
 *     listens to the map's own click event, only active at zoom >= 12,
 *     and resolves the nearest bubble within `CLICK_PIXEL_THRESHOLD` px.
 *   - Renders `FitBounds` (auto-fits viewport to `data`) and
 *     `ZoomTracker` (tracks current zoom level for the click threshold).
 *   - Shows a slide-in detail sidebar listing every observation merged
 *     into the selected bubble (species, observer, date, source link).
 *
 * Depends on: `react-leaflet`, `leaflet`, `@/lib/observations-store`,
 *   `@/lib/i18n`, `@/lib/survey-polygons`.
 * Called by: `@/components/dashboard.tsx`, `@/components/people-dashboard.tsx`,
 *   `@/components/species-deep-dive.tsx`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polygon,
  GeoJSON,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { Observation } from "@/lib/observations-store";
import { useObservations, getTaxaGroup, translateSpeciesName } from "@/lib/observations-store";
import { useI18n } from "@/lib/i18n";
import { SURVEY_POLYGONS, SURVEY_AREA_KEYS, type SurveyAreaKey } from "@/lib/survey-polygons";

function FitBounds({ obs }: { obs: Observation[] }) {
  const map = useMap();
  useEffect(() => {
    if (obs.length === 0) return;
    const bounds = L.latLngBounds(obs.map((o) => [o.latitude, o.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14, animate: true });
  }, [obs, map]);
  return null;
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: (e) => {
      console.log("🔍 ZOOM LEVEL CHANGED TO:", map.getZoom());
      onZoom(e.target.getZoom());
    },
  });
  return null;
}

// Decoupled clickable overlay: the underlying CircleMarker bubbles stay fully
// static/non-interactive (max canvas render speed, no per-layer hit-testing).
// Instead we listen to the Map's own bubbled `click` event and resolve the
// nearest bubble via a cheap pixel-distance scan, only when zoomed in enough
// that the on-screen bubble count is small.
const CLICK_PIXEL_THRESHOLD = 20;

function MapClickHandler({
  bubbles,
  zoom,
  onSelect,
  onClose,
}: {
  bubbles: Bubble[];
  zoom: number;
  onSelect: (ids: string[]) => void;
  onClose: () => void;
}) {
  useMapEvents({
    click: (e) => {
      if (zoom < 12) {
        onClose();
        return;
      }
      const map = e.target;
      const clickPoint = map.latLngToContainerPoint(e.latlng);

      let closestBubble: Bubble | null = null;
      let closestDist = Infinity;
      for (const bubble of bubbles) {
        const bubblePoint = map.latLngToContainerPoint([bubble.lat, bubble.lng]);
        const dist = clickPoint.distanceTo(bubblePoint);
        if (dist <= CLICK_PIXEL_THRESHOLD && dist < closestDist) {
          closestDist = dist;
          closestBubble = bubble;
        }
      }

      if (closestBubble) {
        onSelect(closestBubble.observation_ids);
      } else {
        onClose();
      }
    },
  });
  return null;
}

type Bubble = {
  lat: number;
  lng: number;
  count: number;
  category: string;
  raw_observations: Array<{ species: string; date: string; originalLat: number; originalLng: number }>;
  observation_ids: string[];
};

export function ObservationMap({ data, selectedSpecies = new Set<string>() }: { data: Observation[]; selectedSpecies?: Set<string> }) {
  const { filters, monitoringAreas, observations: allObservations } = useObservations();
  const { lang } = useI18n();
  const selectedAreas = new Set(filters.areas) as Set<SurveyAreaKey>;
  const baseAreaKeys = SURVEY_AREA_KEYS.filter((k) => k !== "other_areas");
  const [zoom, setZoom] = useState<number>(7);
  const [selectedBubbleIds, setSelectedBubbleIds] = useState<string[] | null>(null);
  const [activeObservationId, setActiveObservationId] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  // Shared canvas renderer: without this, GeoJSON/Polygon/CircleMarker layers each
  // get their own full-map <canvas> per pane, and the topmost one swallows ALL
  // clicks regardless of whether a shape was actually drawn there. Sharing one
  // renderer lets Leaflet's own per-layer hit-testing resolve overlaps correctly.
  const canvasRenderer = useMemo(() => L.canvas(), []);
  // O(1) dictionary lookup: composite_id -> full Observation, built once per dataset change.
  const observationsMap = useMemo(
    () => new Map(allObservations.filter((o) => o.composite_id).map((o) => [o.composite_id as string, o])),
    [allObservations],
  );
  const visibleMonitoringAreas = useMemo(
    () =>
      monitoringAreas
        ? {
            ...monitoringAreas,
            features: monitoringAreas.features.filter((feature) =>
              filters.monitoringAreas.has(feature.properties.id),
            ),
          }
        : null,
    [monitoringAreas, filters.monitoringAreas],
  );

  const center: [number, number] = data[0]
    ? [data[0].latitude, data[0].longitude]
    : [31.5, 34.9]; // default Israel

  // Data aggregation: group observations by species, date, and rounded coordinates
  const bubbles = useMemo(() => {
    const groups = new Map<string, Bubble>();

    for (const obs of data) {
      const key = `${obs.scientific_name}|${obs.observed_on}|${obs.latitude.toFixed(3)}|${obs.longitude.toFixed(3)}`;
      const category = getTaxaGroup(obs) || "other";

      if (groups.has(key)) {
        const existing = groups.get(key)!;
        existing.count++;
        existing.raw_observations.push({
          species: obs.scientific_name,
          date: obs.observed_on,
          originalLat: obs.latitude,
          originalLng: obs.longitude,
        });
        if (obs.composite_id) existing.observation_ids.push(obs.composite_id);
      } else {
        groups.set(key, {
          lat: obs.latitude,
          lng: obs.longitude,
          count: 1,
          category,
          raw_observations: [{
            species: obs.scientific_name,
            date: obs.observed_on,
            originalLat: obs.latitude,
            originalLng: obs.longitude,
          }],
          observation_ids: obs.composite_id ? [obs.composite_id] : [],
        });
      }
    }

    return Array.from(groups.values());
  }, [data]);

  // Click candidates must respect the active species filter/highlight: a dimmed
  // (unselected) bubble should never resolve to the sidebar, even if it's
  // spatially closer to the click point than the highlighted species' bubble.
  const clickableBubbles = useMemo(
    () =>
      bubbles.filter(
        (b) => selectedSpecies.size === 0 || selectedSpecies.has(b.raw_observations[0]?.species),
      ),
    [bubbles, selectedSpecies],
  );

  const mergedBubbles = bubbles.filter(b => b.count > 1);
  let totalMergedObservations = 0;

  console.group('--- FULL AGGREGATION AUDIT REPORT ---');
  console.log(`Total Bubbles on Map (All): ${bubbles.length}`);
  console.log(`Bubbles containing MULTIPLE observations: ${mergedBubbles.length}`);

  mergedBubbles.forEach((bubble, index) => {
    totalMergedObservations += bubble.count;
    console.groupCollapsed(`Merged Bubble #${index + 1}: ${bubble.raw_observations[0]?.species} | Date: ${bubble.raw_observations[0]?.date} | Count: ${bubble.count}`);
    console.log(`Rounded Anchor: Lat=${bubble.lat}, Lng=${bubble.lng}`);
    console.table(bubble.raw_observations);
    console.groupEnd();
  });

  console.log('--- SUMMARY ---');
  console.log(`Total original observations hidden inside merged bubbles: ${totalMergedObservations}`);
  console.log(`Total points saved from rendering on map: ${totalMergedObservations - mergedBubbles.length}`);
  console.groupEnd();

  // Color palette matching taxa tabs (soft/pastel colors)
  const categoryColors: Record<string, { color: string; fillColor: string }> = {
    birds: { color: "#0ea5e9", fillColor: "#7dd3fc" },        // sky-500, sky-300
    butterflies: { color: "#f97316", fillColor: "#fdba74" },  // orange-500, orange-300
    dragonflies: { color: "#14b8a6", fillColor: "#5eead4" },  // teal-500, teal-300
    arthropods: { color: "#dc2626", fillColor: "#fca5a5" },   // red-600, red-300
    mammals: { color: "#a855f7", fillColor: "#d8b4fe" },      // purple-500, purple-300
    plants: { color: "#65a30d", fillColor: "#bef264" },       // lime-600, lime-300
    other: { color: "#6b7280", fillColor: "#d4d4d8" },        // gray-500, gray-300
  };

  const getCategoryColor = (category: string) => {
    return categoryColors[category] || categoryColors.other;
  };

  /** Convert GeoJSON [lon, lat] ring to Leaflet [lat, lng] positions. */
  const ringToLatLng = (ring: number[][]): [number, number][] =>
    ring.map(([lon, lat]) => [lat, lon] as [number, number]);

  const selectedObservations: Observation[] = useMemo(() => {
    if (!selectedBubbleIds) return [];
    return selectedBubbleIds
      .map((id) => observationsMap.get(id))
      .filter((obs): obs is Observation => Boolean(obs));
  }, [selectedBubbleIds, observationsMap]);

  useEffect(() => {
    if (selectedObservations.length > 0) {
      setActiveObservationId(selectedObservations[0].composite_id ?? null);
    } else {
      setActiveObservationId(null);
    }
  }, [selectedObservations]);

  useEffect(() => {
    if (!selectedBubbleIds) return;
    const handleClickOutside = (e: MouseEvent) => {
      const sidebar = sidebarRef.current;
      const mapContainer = mapContainerRef.current;
      if (!sidebar || !mapContainer) return;
      if (sidebar.contains(e.target as Node)) return;
      if (mapContainer.contains(e.target as Node)) return;
      setSelectedBubbleIds(null);
      setActiveObservationId(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedBubbleIds]);

  return (
    <div ref={mapContainerRef} className="relative h-full w-full overflow-hidden rounded-lg border bg-card">
      <MapContainer
        center={center}
        zoom={7}
        scrollWheelZoom
        preferCanvas={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds obs={data} />
        <ZoomTracker onZoom={setZoom} />
        <MapClickHandler
          bubbles={clickableBubbles}
          zoom={zoom}
          onSelect={setSelectedBubbleIds}
          onClose={() => {
            setSelectedBubbleIds(null);
            setActiveObservationId(null);
          }}
        />
        {visibleMonitoringAreas && (
          <GeoJSON
            key={Array.from(filters.monitoringAreas).sort().join("|")}
            data={visibleMonitoringAreas}
            style={() => ({
              color: "#4b5563",
              fillColor: "#9ca3af",
              fillOpacity: 0.35,
              opacity: 1,
              weight: 3,
              interactive: true,
              renderer: canvasRenderer,
            })}
            onEachFeature={(feature, layer) => {
              layer.bindTooltip(String(feature.properties?.name ?? "אזור ניטור"), {
                sticky: true,
                direction: "top",
                opacity: 0.95,
              });
            }}
          />
        )}
        {baseAreaKeys.map((areaKey) => {
          const rings = SURVEY_POLYGONS[areaKey];
          if (!rings) return null;
          const isSelected = selectedAreas.has(areaKey);
          if (!isSelected) return null;
          const pathOptions = {
            color: "#4b5563",
            fillColor: "#9ca3af",
            fillOpacity: 0.35,
            weight: 3,
            opacity: 1,
            interactive: true,
          };
          return (
            <Polygon
              key={areaKey}
              positions={rings.map(ringToLatLng)}
              pathOptions={pathOptions}
              renderer={canvasRenderer}
            >
              <Tooltip sticky direction="top" opacity={0.95}>
                {areaKey}
              </Tooltip>
            </Polygon>
          );
        })}
        {bubbles.map((bubble, i) => {
          const colors = getCategoryColor(bubble.category);
          const isSelected = selectedSpecies.size === 0 || selectedSpecies.has(bubble.raw_observations[0]?.species);
          const isBubbleSelected = selectedBubbleIds !== null && bubble.observation_ids.some((id) => selectedBubbleIds.includes(id));
          const baseRadius = Math.min(5 + bubble.count * 2, 40);
          return (
            <CircleMarker
              key={i}
              center={[bubble.lat, bubble.lng]}
              radius={isBubbleSelected ? baseRadius + 4 : baseRadius}
              pathOptions={{
                color: isBubbleSelected ? "black" : colors.color,
                fillColor: isBubbleSelected ? "white" : colors.fillColor,
                fillOpacity: isBubbleSelected ? 1 : (isSelected ? 0.6 : 0.15),
                weight: isBubbleSelected ? 2 : (isSelected ? 2 : 1),
                opacity: isBubbleSelected ? 1 : (isSelected ? 1 : 0.3),
              }}
              interactive={false}
              renderer={canvasRenderer}
            />
          );
        })}
      </MapContainer>
      {selectedBubbleIds && (
        <div ref={sidebarRef} className="absolute top-0 right-0 h-full w-80 bg-white shadow-2xl z-[1000] p-4 overflow-y-auto flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              פרטי תצפית ({selectedObservations.length})
            </h3>
            <button
              type="button"
              onClick={() => setSelectedBubbleIds(null)}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
            >
              ✕ סגור
            </button>
          </div>
          {selectedObservations.length === 0 && (
            <p className="text-sm text-muted-foreground">לא נמצאו פרטים עבור תצפית זו.</p>
          )}
          {selectedObservations.map((obs, idx) => (
            <div
              key={obs.composite_id ?? idx}
              onClick={() => setActiveObservationId(obs.composite_id ?? null)}
              className={`flex flex-col gap-1 rounded-lg border p-3 text-sm shadow-sm cursor-pointer transition-colors ${
                activeObservationId === obs.composite_id ? "bg-blue-50 ring-1 ring-blue-200" : ""
              }`}
            >
              <div className="text-center font-medium italic">
                {lang === "he" ? translateSpeciesName(obs.scientific_name) : obs.scientific_name}
              </div>
              <div>
                <span className="font-medium">שם משתמש: </span>
                {obs.user_login}
              </div>
              <div>
                <span className="font-medium">תאריך: </span>
                {obs.observed_on}
              </div>
              <div>
                <span
                  className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                    obs.source === "inaturalist"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {obs.source === "inaturalist" ? "iNaturalist" : "מנטר מקצועי"}
                </span>
              </div>
              {obs.source === "inaturalist" && obs.source_url && (
                <a
                  href={obs.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block rounded-md bg-emerald-600 px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-emerald-700"
                >
                  צפה ב-iNaturalist
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
