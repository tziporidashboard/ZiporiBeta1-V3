/**
 * Dashboard — main analytics view for the "Eyes for Nahal Tzippori" app.
 *
 * What it does:
 *   - Reads the global observation dataset + active filter state from
 *     `useObservations()` (see `@/lib/observations-store`).
 *   - Runs three separate client-side filter pipelines over the raw
 *     observations array (memoized with `useMemo`):
 *       1. `filtered`    — full filter set (date, quality, time, taxa,
 *                          user group, area, species type) → feeds the map.
 *       2. `chartData`   — same as `filtered` but ignores the user-group
 *                          filter, so the time-series chart can compare
 *                          all contributor groups regardless of sidebar
 *                          selection.
 *       3. `metricsData` — same idea, ignores user-group filter so the
 *                          Metrics table's invasive/rare counts stay
 *                          consistent with the selected taxa tabs.
 *   - Renders the KPI strip (rows/observers/species), the taxa tab bar,
 *     the Leaflet map, the metrics table, and the time-series chart.
 *
 * Key helpers:
 *   - `parseObsTimestamp` — parses `DD/MM/YYYY` observation dates to epoch ms.
 *   - `areaMatches`       — polygon-area inclusion logic (handles the
 *                          special "other_areas" bucket for points outside
 *                          all monitoring polygons).
 *
 * Depends on: `@/lib/observations-store`, `@/lib/taxonomy-engine`,
 *   `@/lib/survey-polygons`, `@/lib/monitoring-areas`, `@/lib/i18n`,
 *   `TaxaFilterBar`, `ObservationMap`, `MetricsTable`, `TimeSeriesChart`.
 * Called by: `src/routes/index.tsx` (the `/` route).
 */
import { useMemo } from "react";
import { useObservations, getTaxaGroup, getSpeciesClassification } from "@/lib/observations-store";
import { getTaxonDetails } from "@/lib/taxonomy-engine";
import { getObservationArea, type SurveyAreaKey } from "@/lib/survey-polygons";
import { observationMatchesSelectedAreas } from "@/lib/monitoring-areas";
import { useI18n } from "@/lib/i18n";
import { TaxaFilterBar } from "@/components/taxa-filter-bar";
import { ObservationMap } from "@/components/observation-map";
import { MetricsTable } from "@/components/metrics-table";
import { TimeSeriesChart } from "@/components/time-series-chart";

/** Parse DD/MM/YYYY to timestamp. Returns NaN for invalid dates. */
function parseObsTimestamp(dateStr: string): number {
  if (!dateStr || dateStr.length < 10) return NaN;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return NaN;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return NaN;
  return new Date(year, month, day).getTime();
}

/** Area filter logic: selected polygon areas pass if they match; selecting "other_areas" includes observations outside all polygons. */
function areaMatches(selectedAreas: Set<SurveyAreaKey>, area: SurveyAreaKey | null): boolean {
  if (selectedAreas.size === 0) return true;
  if (area === null) return selectedAreas.has("other_areas");
  return selectedAreas.has(area);
}

export function Dashboard() {
  const { t, lang } = useI18n();
  const { observations, filters, observationMonitoringAreaIndex } = useObservations();

  const filtered = useMemo(() => {
    return observations.filter((o) => {
      // Strict AND logic: ALL active filters must match

      // Date range filter (precise slider)
      if (filters.dateRange) {
        const ts = parseObsTimestamp(o.observed_on);
        if (isNaN(ts) || ts < filters.dateRange.start || ts > filters.dateRange.end) {
          return false;
        }
      }

      // Research grade filter
      if (filters.researchOnly) {
        if (!o.quality_grade || o.quality_grade !== "research") {
          return false;
        }
      }

      // Time filter (year/month) - DD/MM/YYYY format
      if (filters.time.size > 0) {
        if (!o.observed_on || o.observed_on.length < 10) {
          return false;
        }
        const parts = o.observed_on.split("/");
        if (parts.length !== 3) {
          return false;
        }
        const year = parts[2];
        const month = parts[1];
        const entry = filters.time.get(year);
        if (!entry) {
          return false;
        }
        // If specific months are selected, observation must match one of them
        if (entry.size > 0 && !entry.has(month)) {
          return false;
        }
      }

      // Taxa filter
      if (filters.taxa.size > 0) {
        const tg = getTaxaGroup(o);
        if (!filters.taxa.has(tg)) {
          return false;
        }
      }

      // User group filter
      if (!o.user_category || !filters.groups.has(o.user_category)) {
        return false;
      }

      if (
        o.user_category === "local_communities" &&
        !filters.localCommunitySubgroups.has(o.user_subcategory)
      ) {
        return false;
      }

      // Area filter
      if (
        !observationMatchesSelectedAreas(
          o,
          filters.areas,
          filters.monitoringAreas,
          observationMonitoringAreaIndex,
        )
      ) {
        return false;
      }

      // Species type filter
      if (filters.speciesTypes.size > 0) {
        const type = getSpeciesClassification(o);
        if (!filters.speciesTypes.has(type)) {
          return false;
        }
      }

      // All filters passed (AND logic)
      return true;
    });
  }, [observations, filters, observationMonitoringAreaIndex]);

  const summary = useMemo(() => {
    const observers = new Set<string>();
    const species = new Set<string>();
    for (const o of filtered) {
      if (o.user_login) observers.add(o.user_login);
      if (o.scientific_name && !getTaxonDetails(o.scientific_name).isGeneric) {
        species.add(o.scientific_name);
      }
    }
    return { rows: filtered.length, observers: observers.size, species: species.size };
  }, [filtered]);

  // Separate data pipeline for chart: Filter by Taxa and Years, but IGNORE User Groups
  const chartData = useMemo(() => {
    return observations.filter((o) => {
      // Date range filter (precise slider)
      if (filters.dateRange) {
        const ts = parseObsTimestamp(o.observed_on);
        if (isNaN(ts) || ts < filters.dateRange.start || ts > filters.dateRange.end) {
          return false;
        }
      }

      // Research grade filter
      if (filters.researchOnly) {
        if (!o.quality_grade || o.quality_grade !== "research") {
          return false;
        }
      }

      // Time filter (year/month) - DD/MM/YYYY format
      if (filters.time.size > 0) {
        if (!o.observed_on || o.observed_on.length < 10) {
          return false;
        }
        const parts = o.observed_on.split("/");
        if (parts.length !== 3) {
          return false;
        }
        const year = parts[2];
        const month = parts[1];
        const entry = filters.time.get(year);
        if (!entry) {
          return false;
        }
        // If specific months are selected, observation must match one of them
        if (entry.size > 0 && !entry.has(month)) {
          return false;
        }
      }

      // Taxa filter
      if (filters.taxa.size > 0) {
        const tg = getTaxaGroup(o);
        if (!filters.taxa.has(tg)) {
          return false;
        }
      }

      // NOTE: User group filter is intentionally IGNORED for the chart
      // This allows comparing all groups regardless of sidebar selection

      // Area filter
      if (
        !observationMatchesSelectedAreas(
          o,
          filters.areas,
          filters.monitoringAreas,
          observationMonitoringAreaIndex,
        )
      ) {
        return false;
      }

      // Species type filter
      if (filters.speciesTypes.size > 0) {
        const type = getSpeciesClassification(o);
        if (!filters.speciesTypes.has(type)) {
          return false;
        }
      }

      return true;
    });
  }, [observations, filters, observationMonitoringAreaIndex]);

  // Separate data pipeline for MetricsTable: Filter by Taxa, Time, Research, but IGNORE User Groups
  // This ensures invasive/rare species counts respect the selected taxa tabs
  const metricsData = useMemo(() => {
    return observations.filter((o) => {
      // Date range filter (precise slider)
      if (filters.dateRange) {
        const ts = parseObsTimestamp(o.observed_on);
        if (isNaN(ts) || ts < filters.dateRange.start || ts > filters.dateRange.end) {
          return false;
        }
      }

      // Research grade filter
      if (filters.researchOnly) {
        if (!o.quality_grade || o.quality_grade !== "research") {
          return false;
        }
      }

      // Time filter (year/month) - DD/MM/YYYY format
      if (filters.time.size > 0) {
        if (!o.observed_on || o.observed_on.length < 10) {
          return false;
        }
        const parts = o.observed_on.split("/");
        if (parts.length !== 3) {
          return false;
        }
        const year = parts[2];
        const month = parts[1];
        const entry = filters.time.get(year);
        if (!entry) {
          return false;
        }
        // If specific months are selected, observation must match one of them
        if (entry.size > 0 && !entry.has(month)) {
          return false;
        }
      }

      // Taxa filter - CRITICAL: This ensures invasive/rare counts respect selected tabs
      if (filters.taxa.size > 0) {
        const tg = getTaxaGroup(o);
        if (!filters.taxa.has(tg)) {
          return false;
        }
      }

      // NOTE: User group filter is intentionally IGNORED for the metrics table
      // This allows showing all groups regardless of sidebar selection

      // Area filter
      if (
        !observationMatchesSelectedAreas(
          o,
          filters.areas,
          filters.monitoringAreas,
          observationMonitoringAreaIndex,
        )
      ) {
        return false;
      }

      // Species type filter
      if (filters.speciesTypes.size > 0) {
        const type = getSpeciesClassification(o);
        if (!filters.speciesTypes.has(type)) {
          return false;
        }
      }

      return true;
    });
  }, [observations, filters, observationMonitoringAreaIndex]);

  return (
    <main className="flex h-full w-full flex-col overflow-hidden">
      {/* Top Row: KPIs on edge + Taxa toggles perfectly centered via 3-col grid */}
      <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center min-h-[3.5rem] w-full px-4 py-0.5">
        <div className="flex justify-start">
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <span className="text-lg font-semibold tabular-nums leading-none">
                {summary.rows.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                {t("totalRows")}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg font-semibold tabular-nums leading-none">
                {summary.observers.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                {t("uniqueObservers")}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg font-semibold tabular-nums leading-none">
                {summary.species.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                {t("uniqueSpecies")}
              </span>
            </div>
          </div>
        </div>
        <div className="flex justify-center max-w-full overflow-x-auto scrollbar-hide">
          <TaxaFilterBar />
        </div>
        <div />
      </div>

      {/* Map Container */}
      <div className="h-[58%] shrink-0 px-2 pt-1">
        <div className="h-full w-full rounded-lg shadow-sm overflow-hidden">
          <ObservationMap data={filtered} />
        </div>
      </div>

      {/* Bottom Section (Table & Chart) */}
      <div className="flex-1 min-h-0 px-2 pt-2 pb-1 grid grid-cols-1 lg:grid-cols-2 gap-2">
        <MetricsTable data={filtered} />
        <TimeSeriesChart data={filtered} />
      </div>
    </main>
  );
}
