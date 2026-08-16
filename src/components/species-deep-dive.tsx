/**
 * SpeciesDeepDive — "Species Deep Dive" analytics view, allowing users
 * to drill into a single taxa category and/or one or more specific
 * species (by scientific name) across the map, insights table, and
 * time-series chart.
 *
 * What it does:
 *   - Reads/writes deep-dive-specific state (`deepDive`/`deepDiveActions`)
 *     from `useObservations()`, separate from the main dashboard filters:
 *     `category` (active taxa tab), `species` (selected scientific
 *     names), `search` (species search box text).
 *   - Builds `groupedSpecies`: every distinct, non-generic species from
 *     `@/lib/species-map` bucketed into dashboard `TaxaGroupKey`
 *     categories via a Hebrew category-name mapping.
 *   - Applies the shared dashboard filters (`globallyFilteredObservations`)
 *     then narrows further by the active deep-dive `category`/`species`
 *     selection (`deepDiveFiltered`) for the KPI summary.
 *   - Computes per-category and per-species observation counts to badge
 *     the category tabs and the species dropdown checkboxes.
 *   - Renders KPI strip, category tabs, species search dropdown, the
 *     `ObservationMap` (highlighting selected species),
 *     `SpeciesInsightsTable`, and `DeepDiveTimeSeriesChart`.
 *
 * Key helpers:
 *   - `parseObsTimestamp` / `areaMatches` — same filter-pipeline helpers
 *     as `@/components/dashboard.tsx`.
 *   - `getSpeciesGroup` — maps a scientific name + iconic taxon to a
 *     `TaxaGroupKey` via the shared `getTaxaGroup` classifier.
 *   - `getSpeciesLabel` — resolves a species map entry to its localized
 *     display name (Hebrew common name, falling back to scientific name).
 *
 * Depends on: `@/lib/observations-store`, `@/lib/species-map`,
 *   `@/lib/taxonomy-engine`, `@/lib/survey-polygons`,
 *   `@/lib/monitoring-areas`, `@/lib/i18n`, `ObservationMap`,
 *   `SpeciesInsightsTable`, `DeepDiveTimeSeriesChart`,
 *   `@/components/ui/input`.
 * Called by: the "Species Deep Dive" route/tab in the app shell.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useObservations, getSpeciesClassification, getTaxaGroup, TAXA_GROUP_KEYS, type TaxaGroupKey } from "@/lib/observations-store";
import { useI18n } from "@/lib/i18n";
import { speciesMap, type SpeciesInfo } from "@/lib/species-map";
import { getTaxonDetails } from "@/lib/taxonomy-engine";
import { Search, ListFilter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ObservationMap } from "@/components/observation-map";
import { getTopSpecies, SpeciesInsightsTable } from "@/components/species-insights-table";
import { DeepDiveTimeSeriesChart } from "@/components/deep-dive-time-series-chart";
import { getObservationArea, type SurveyAreaKey } from "@/lib/survey-polygons";
import { observationMatchesSelectedAreas } from "@/lib/monitoring-areas";

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

function areaMatches(selectedAreas: Set<SurveyAreaKey>, area: SurveyAreaKey | null): boolean {
  if (selectedAreas.size === 0) return true;
  if (area === null) return selectedAreas.has("other_areas");
  return selectedAreas.has(area);
}

const CATEGORY_COLORS: Record<TaxaGroupKey, { active: string; inactive: string }> = {
  mammals: { active: "bg-purple-300 text-purple-900 border-purple-500 border-2 font-semibold", inactive: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
  birds: { active: "bg-sky-300 text-sky-900 border-sky-500 border-2 font-semibold", inactive: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
  butterflies: { active: "bg-orange-300 text-orange-900 border-orange-500 border-2 font-semibold", inactive: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
  dragonflies: { active: "bg-teal-300 text-teal-900 border-teal-500 border-2 font-semibold", inactive: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
  arthropods: { active: "bg-red-300 text-red-900 border-red-500 border-2 font-semibold", inactive: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
  plants: { active: "bg-lime-300 text-lime-900 border-lime-500 border-2 font-semibold", inactive: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
  other: { active: "bg-gray-300 text-gray-900 border-gray-500 border-2 font-semibold", inactive: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
};

const DEFAULT_COLOR = { active: "bg-slate-300 text-slate-900 border-slate-500 border-2 font-semibold", inactive: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" };

// Hex colors for chart lines per category
const CATEGORY_HEX: Record<TaxaGroupKey, string> = {
  mammals: "#a855f7",
  birds: "#0ea5e9",
  butterflies: "#f97316",
  dragonflies: "#14b8a6",
  arthropods: "#dc2626",
  plants: "#65a30d",
  other: "#6b7280",
};

const categories = TAXA_GROUP_KEYS;

/** Map a scientific name to the same high-level group used by the Dashboard. */
function getSpeciesGroup(scientific_name: string, iconicTaxon: string): TaxaGroupKey {
  return getTaxaGroup({
    observed_on: "",
    latitude: 0,
    longitude: 0,
    user_login: "",
    quality_grade: "",
    iconic_taxon_name: iconicTaxon,
    scientific_name,
    taxon_order_name: "",
    user_category: "",
    user_subcategory: "",
  });
}

const HEBREW_LETTER_REGEX = /[א-ת]/;

type SpeciesChip = SpeciesInfo & { parentCategory: TaxaGroupKey };

function getSpeciesLabel(entry: SpeciesChip, lang: "he" | "en"): string {
  if (lang === "he") {
    if (entry.Hebrew_Name && entry.Hebrew_Name !== "N/A" && HEBREW_LETTER_REGEX.test(entry.Hebrew_Name)) {
      return entry.Hebrew_Name;
    }
    return entry.Scientific_Name;
  }
  if (entry.English_Name && entry.English_Name !== "N/A") return entry.English_Name;
  return entry.Scientific_Name;
}

export function SpeciesDeepDive() {
  const { t, lang } = useI18n();
  const {
    observations,
    filters,
    deepDive,
    deepDiveActions,
    observationMonitoringAreaIndex,
  } = useObservations();
  const { category, species, search } = deepDive;
  const activeCategory = category as TaxaGroupKey | null;
  const { setDeepDiveCategory, toggleDeepDiveSpecies, clearDeepDiveSpecies, setDeepDiveSearch } = deepDiveActions;
  const [isSpeciesDropdownOpen, setIsSpeciesDropdownOpen] = useState(true);
  const speciesDropdownRef = useRef<HTMLDivElement>(null);

  // Group every identified (non-generic) species entry into dashboard categories
  const groupedSpecies = useMemo(() => {
    const grouped: Record<TaxaGroupKey, SpeciesChip[]> = {
      mammals: [],
      birds: [],
      butterflies: [],
      dragonflies: [],
      arthropods: [],
      plants: [],
      other: [],
    };

    // Map canonical categories to Dashboard TaxaGroupKeys
    const categoryMapping: Record<string, TaxaGroupKey> = {
      "יונקים": "mammals",
      "עופות": "birds",
      "פרפרים": "butterflies",
      "שפיראים": "dragonflies",
      "פרוקי רגליים": "arthropods",
      "צמחים": "plants",
      "שאר המינים": "other"
    };

    const uniqueSpecies = new Map(speciesMap.map((entry) => [entry.Scientific_Name, entry]));
    for (const entry of uniqueSpecies.values()) {
      if (entry.isGeneric) continue;
      const group = categoryMapping[entry.Category] || "other";
      grouped[group].push({ ...entry, parentCategory: group });
    }

    for (const group of categories) {
      grouped[group].sort((a, b) => a.Scientific_Name.localeCompare(b.Scientific_Name));
    }
    return grouped;
  }, []);

  // Species list for the active category, filtered by search
  const speciesList = useMemo(() => {
    const all = Object.values(groupedSpecies).flat();
    const associated = activeCategory
      ? all.filter((sp) => sp.parentCategory === activeCategory)
      : all;
    if (!search.trim()) return associated;
    const q = search.trim().toLowerCase();
    return associated.filter(
      (sp) =>
        sp.Scientific_Name.toLowerCase().includes(q) ||
        (sp.Hebrew_Name && sp.Hebrew_Name !== "N/A" && sp.Hebrew_Name.toLowerCase().includes(q)) ||
        (sp.English_Name && sp.English_Name !== "N/A" && sp.English_Name.toLowerCase().includes(q))
    );
  }, [activeCategory, search, groupedSpecies]);

  const globallyFilteredObservations = useMemo(() => {
    return observations.filter((o) => {
      if (filters.dateRange) {
        const ts = parseObsTimestamp(o.observed_on);
        if (isNaN(ts) || ts < filters.dateRange.start || ts > filters.dateRange.end) return false;
      }
      if (filters.researchOnly && o.quality_grade !== "research") return false;
      if (filters.time.size > 0) {
        if (!o.observed_on || o.observed_on.length < 10) return false;
        const parts = o.observed_on.split("/");
        if (parts.length !== 3) return false;
        const entry = filters.time.get(parts[2]);
        if (!entry || (entry.size > 0 && !entry.has(parts[1]))) return false;
      }
      if (filters.taxa.size > 0 && !filters.taxa.has(getTaxaGroup(o))) return false;
      if (filters.groups.size > 0 && (!o.user_category || !filters.groups.has(o.user_category))) return false;
      if (!observationMatchesSelectedAreas(o, filters.areas, filters.monitoringAreas, observationMonitoringAreaIndex)) return false;
      if (filters.speciesTypes.size > 0 && !filters.speciesTypes.has(getSpeciesClassification(o))) return false;
      return true;
    });
  }, [observations, filters, observationMonitoringAreaIndex]);

  // Data pipeline: filter observations by deep dive selections
  const deepDiveFiltered = useMemo(() => {
    return globallyFilteredObservations.filter((o) => {
      if (category && getTaxaGroup(o) !== category) return false;
      if (species.size > 0 && !species.has(o.scientific_name)) return false;
      return true;
    });
  }, [globallyFilteredObservations, category, species]);

  // Summary stats
  const summary = useMemo(() => {
    const observers = new Set<string>();
    const speciesSet = new Set<string>();
    let unidentified = 0;
    for (const o of deepDiveFiltered) {
      if (o.user_login) observers.add(o.user_login);
      const details = getTaxonDetails(o.scientific_name, o.iconic_taxon_name, o.common_name);
      if (details.isGeneric) {
        unidentified++;
      } else if (o.scientific_name) {
        speciesSet.add(o.scientific_name);
      }
    }
    return { rows: deepDiveFiltered.length, observers: observers.size, species: speciesSet.size, unidentified };
  }, [deepDiveFiltered]);

  const categoryObservationCounts = useMemo(() => {
    const counts: Record<TaxaGroupKey, number> = {
      mammals: 0,
      birds: 0,
      butterflies: 0,
      dragonflies: 0,
      arthropods: 0,
      plants: 0,
      other: 0,
    };
    for (const o of globallyFilteredObservations) {
      const group = getTaxaGroup(o);
      counts[group] += 1;
    }
    return counts;
  }, [globallyFilteredObservations]);

  const speciesObservationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of globallyFilteredObservations) {
      if ((activeCategory && getTaxaGroup(o) !== activeCategory) || !o.scientific_name) continue;
      counts.set(o.scientific_name, (counts.get(o.scientific_name) ?? 0) + 1);
    }
    return counts;
  }, [globallyFilteredObservations, activeCategory]);

  const tableSpecies = useMemo(
    () => new Set(getTopSpecies(globallyFilteredObservations, species, activeCategory).map((entry) => entry.scientificName)),
    [globallyFilteredObservations, species, activeCategory]
  );
  const activeColors = activeCategory ? (CATEGORY_COLORS[activeCategory] || DEFAULT_COLOR) : DEFAULT_COLOR;

  useEffect(() => {
    if (!isSpeciesDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (speciesDropdownRef.current && !speciesDropdownRef.current.contains(e.target as Node)) {
        setIsSpeciesDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSpeciesDropdownOpen]);

  return (
    <main className="flex h-full w-full flex-col overflow-hidden">
      {/* Top Row: KPIs on side + Category tabs centered */}
      <div className="shrink-0 flex items-center min-h-[3.5rem] w-full px-4 py-0.5 gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-center">
            <span className="text-lg font-semibold tabular-nums leading-none">{summary.rows.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{t("totalRows")}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg font-semibold tabular-nums leading-none">{summary.observers.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{t("uniqueObservers")}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg font-semibold tabular-nums leading-none">{summary.species.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{t("uniqueSpecies")}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg font-semibold tabular-nums leading-none">{summary.unidentified.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{t("unidentified")}</span>
          </div>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
          {categories.map((cat) => {
            const colors = CATEGORY_COLORS[cat] || DEFAULT_COLOR;
            const isActive = category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setDeepDiveCategory(category === cat ? null : cat)}
                className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition-all duration-200 ${
                  isActive ? colors.active : colors.inactive
                }`}
              >
                {t(`tg_${cat}`)}
                <span className="opacity-60 text-[10px]">({categoryObservationCounts[cat].toLocaleString()})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Species sub-filter row - 8% height */}
      <div className="h-[8%] shrink-0 flex items-center gap-3 px-4 py-1.5 border-b">
          <div ref={speciesDropdownRef} className="relative shrink-0 flex items-center gap-1">
            <div className="relative w-44">
              <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setDeepDiveSearch(e.target.value)}
                placeholder={t("searchSpecies")}
                className="ps-7 h-7 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsSpeciesDropdownOpen((o) => !o)}
              title={t("searchSpecies")}
              className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                isSpeciesDropdownOpen ? "bg-muted border-foreground/30" : "border-input hover:bg-muted"
              }`}
            >
              <ListFilter className="h-3.5 w-3.5" />
            </button>

            {isSpeciesDropdownOpen && (
              <div className="absolute top-full start-0 mt-1 z-[9999] w-64 max-h-64 overflow-y-auto rounded-md border bg-white shadow-lg" style={{ zIndex: 9999 }}>
                <div className="sticky top-0 flex items-center justify-between border-b bg-white px-2 py-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("searchSpecies")}</span>
                  <button
                    type="button"
                    onClick={() => setIsSpeciesDropdownOpen(false)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    מזער
                  </button>
                </div>
                <div className="p-1">
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={species.size === 0}
                      onChange={() => clearDeepDiveSpecies()}
                    />
                    {t("all")}
                  </label>
                  {speciesList
                    .filter((sp) => !activeCategory || (speciesObservationCounts.get(sp.Scientific_Name) ?? 0) > 0)
                    .sort((a, b) => (speciesObservationCounts.get(b.Scientific_Name) ?? 0) - (speciesObservationCounts.get(a.Scientific_Name) ?? 0))
                    .map((sp) => {
                      const count = speciesObservationCounts.get(sp.Scientific_Name) ?? 0;
                      const isSelected = species.has(sp.Scientific_Name);
                      return (
                        <label
                          key={sp.Scientific_Name}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleDeepDiveSpecies(sp.Scientific_Name)}
                          />
                          <span className="truncate">
                            {getSpeciesLabel(sp, lang)} ({count.toLocaleString()})
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1" />
        </div>

      {/* Map Container */}
      <div className="h-[50%] shrink-0 px-2 pt-1">
        <div className="h-full w-full rounded-lg shadow-sm overflow-hidden">
          <ObservationMap
            data={globallyFilteredObservations.filter((o) => !category || getTaxaGroup(o) === category)}
            selectedSpecies={species}
          />
        </div>
      </div>

      {/* Bottom Section (Table & Chart) */}
      <div className="flex-1 min-h-0 px-2 pt-2 pb-1 grid grid-cols-1 lg:grid-cols-2 gap-2">
        <SpeciesInsightsTable
          data={globallyFilteredObservations}
          prioritySpecies={species}
          priorityCategory={activeCategory}
        />
        <DeepDiveTimeSeriesChart
          allObservations={globallyFilteredObservations}
          category={activeCategory}
          selectedSpecies={tableSpecies}
          categoryColor={activeCategory ? CATEGORY_HEX[activeCategory] : "#64748b"}
        />
      </div>
    </main>
  );
}