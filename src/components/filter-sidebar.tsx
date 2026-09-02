/**
 * FilterSidebar — the collapsible right-hand panel exposing all dashboard
 * filter controls (years/months, quality grade, species type, target
 * population/user group, and monitoring/survey areas).
 *
 * What it does:
 *   - Reads/writes the shared `filters` state from
 *     `useObservations()` (see `@/lib/observations-store`), so every
 *     change here is immediately reflected across `Dashboard`,
 *     `ObservationMap`, `MetricsTable`, and `TimeSeriesChart`.
 *   - Derives the list of `uniqueYears` present in the dataset from the
 *     `DD/MM/YYYY`-formatted `observed_on` field.
 *   - Keeps the precise `dateRange` (epoch ms) in sync whenever whole
 *     years are toggled (snaps to Jan 1 – Dec 31 of the selected span).
 *
 * Local subcomponents:
 *   - `Section` — labeled checkbox group wrapper.
 *   - `Check`   — custom checkbox supporting an `indeterminate` state.
 *
 * Toggle handlers: `toggleYear`, `toggleMonth`, `toggleTaxa`,
 *   `toggleGroup`, `toggleArea`, `toggleMonitoringArea`.
 *
 * Depends on: `@/lib/observations-store`, `@/lib/survey-polygons`,
 *   `@/lib/i18n`, `lucide-react`.
 * Called by: `@/components/dashboard.tsx` (or the route that toggles the
 *   filter panel open/closed via `onClose`).
 */
import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  useObservations,
  type TaxaGroupKey,
  type SurveyAreaKey,
  translateGroupName,
  translateMonth,
} from "@/lib/observations-store";
import { SURVEY_AREA_KEYS, translateArea } from "@/lib/survey-polygons";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  indeterminate,
  color,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
  indeterminate?: boolean;
  color?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-xs font-normal hover:bg-secondary">
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked;
        }}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3 w-3 shrink-0 rounded border-border accent-[color:var(--primary)]"
      />
      <span className="min-w-0 flex-1 whitespace-normal leading-snug">{label}</span>
      {color && (
        <span
          className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${checked ? "opacity-100" : "opacity-35"}`}
          style={{ backgroundColor: color }}
        />
      )}
    </label>
  );
}

export function FilterSidebar({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const [localCommunitiesOpen, setLocalCommunitiesOpen] = useState(false);
  const { observations, filters, setFilters, toggleSpeciesType, datasetBounds, monitoringAreas } =
    useObservations();

  // Fixed Target Population options, mapped to their user_category keys
  const targetPopulationOptions = useMemo(
    () => [
      { key: "expert", label: translateGroupName("expert", lang) },
      { key: "local_communities", label: translateGroupName("local_communities", lang) },
      { key: "online_communities", label: translateGroupName("online_communities", lang) },
    ],
    [lang],
  );

  // Fixed Local Community subgroup options used by the nested filter
  const localCommunityOptions = useMemo(
    () => [
      { key: "yizrael", label: translateGroupName("yizrael", lang) },
      { key: "zevulun", label: translateGroupName("zevulun", lang) },
      { key: "student", label: translateGroupName("student", lang) },
      { key: "mechnistim", label: translateGroupName("mechnistim", lang) },
    ],
    [lang],
  );

  // Extract unique years from observations (DD/MM/YYYY format)
  const uniqueYears = useMemo(() => {
    const years = new Set<string>();
    for (const o of observations) {
      const d = o.observed_on;
      if (!d || d.length < 10) continue;
      const parts = d.split("/");
      if (parts.length === 3) {
        const year = parts[2];
        if (year && year.length === 4) {
          years.add(year);
        }
      }
    }
    return Array.from(years).sort();
  }, [observations]);

  const toggleYear = (year: string) => {
    setFilters((prev) => {
      const next = new Map(prev.time);
      if (next.has(year)) next.delete(year);
      else next.set(year, new Set()); // empty = all months of year

      // Sync dateRange to span Jan 1 of earliest selected year – Dec 31 of latest
      let dateRange: { start: number; end: number } | null = prev.dateRange;
      if (next.size > 0) {
        const selectedYears = Array.from(next.keys())
          .map(Number)
          .sort((a, b) => a - b);
        const earliest = selectedYears[0];
        const latest = selectedYears[selectedYears.length - 1];
        dateRange = {
          start: new Date(earliest, 0, 1).getTime(),
          end: new Date(latest, 11, 31, 23, 59, 59, 999).getTime(),
        };
      } else if (datasetBounds) {
        dateRange = datasetBounds;
      }
      return { ...prev, time: next, dateRange };
    });
  };

  const toggleMonth = (month: string) => {
    setFilters((prev) => {
      const next = new Map(prev.time);
      // If month is selected, add it to all selected years
      // If month is deselected, remove it from all selected years
      const monthNum = month.padStart(2, "0");

      if (next.size === 0) {
        // No years selected, can't toggle months
        return prev;
      }

      let monthSelectedInAnyYear = false;
      for (const [year, months] of next.entries()) {
        if (months.has(monthNum)) {
          monthSelectedInAnyYear = true;
          break;
        }
      }

      if (monthSelectedInAnyYear) {
        // Remove month from all years
        for (const [year, months] of next.entries()) {
          months.delete(monthNum);
          if (months.size === 0) next.delete(year);
        }
      } else {
        // Add month to all selected years
        for (const year of next.keys()) {
          const months = new Set(next.get(year) ?? []);
          months.add(monthNum);
          next.set(year, months);
        }
      }

      return { ...prev, time: next };
    });
  };

  const toggleTaxa = (key: TaxaGroupKey) => {
    setFilters((prev) => {
      const next = new Set(prev.taxa);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, taxa: next };
    });
  };

  const toggleGroup = (g: string) => {
    setFilters((prev) => {
      const next = new Set(prev.groups);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return { ...prev, groups: next };
    });
  };

  const toggleLocalCommunitySubgroup = (subgroup: string) => {
    setFilters((prev) => {
      const next = new Set(prev.localCommunitySubgroups);
      const groups = new Set(prev.groups);

      if (next.has(subgroup)) {
        next.delete(subgroup);
      } else {
        next.add(subgroup);
      }

      if (next.size > 0) {
        groups.add("local_communities");
      } else {
        groups.delete("local_communities");
      }

      return {
        ...prev,
        groups,
        localCommunitySubgroups: next,
      };
    });
  };

  const toggleAllLocalCommunitySubgroups = (checked: boolean) => {
    setFilters((prev) => {
      const groups = new Set(prev.groups);

      if (checked) {
        groups.add("local_communities");
      } else {
        groups.delete("local_communities");
      }

      return {
        ...prev,
        groups,
        localCommunitySubgroups: checked
          ? new Set(localCommunityOptions.map((subgroup) => subgroup.key))
          : new Set(),
      };
    });
  };

  const allLocalCommunitySubgroupsSelected = localCommunityOptions.every((subgroup) =>
    filters.localCommunitySubgroups.has(subgroup.key),
  );

  const someLocalCommunitySubgroupsSelected = localCommunityOptions.some((subgroup) =>
    filters.localCommunitySubgroups.has(subgroup.key),
  );

  const toggleArea = (key: SurveyAreaKey) => {
    setFilters((prev) => {
      const next = new Set(prev.areas);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return { ...prev, areas: next };
    });
  };

  const toggleMonitoringArea = (id: string) => {
    setFilters((prev) => {
      const next = new Set(prev.monitoringAreas);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return { ...prev, monitoringAreas: next };
    });
  };

  const monthName = (m: string) => {
    const monthNum = parseInt(m, 10);

    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return m;
    }

    return translateMonth(monthNum, lang);
  };

  return (
    <aside className="flex h-full w-96 max-w-[calc(100vw-1.25rem)] shrink-0 flex-col gap-3 overflow-y-auto bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold">{t("filters")}</h2>

        <button
          type="button"
          onClick={onClose}
          aria-label={lang === "he" ? "סגירת חלונית המסננים" : "Close filters"}
          title={lang === "he" ? "סגירה" : "Close"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="rounded-md border border-primary/15 bg-muted/60 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
        💡 טיפ: ניתן לסגור את חלונית המסננים ולפתוח אותה שוב בעת הצורך באמצעות התפריט.
      </div>

      <Section title={t("years")}>
        {uniqueYears.length === 0 && <p className="px-1 text-xs text-muted-foreground">—</p>}
        {uniqueYears.map((year) => {
          const yearEntry = filters.time.get(year);
          const yearActive = yearEntry !== undefined;
          const hasSpecific = !!yearEntry && yearEntry.size > 0;
          return (
            <Check
              key={year}
              checked={yearActive && !hasSpecific}
              indeterminate={hasSpecific}
              onChange={() => toggleYear(year)}
              label={year}
            />
          );
        })}
      </Section>

      <Section title={t("quality")}>
        <Check
          checked={filters.researchOnly}
          onChange={(b) => setFilters((p) => ({ ...p, researchOnly: b }))}
          label={t("researchOnly")}
        />
      </Section>

      <Section title={t("speciesType")}>
        <Check
          checked={filters.speciesTypes.has("invasive")}
          onChange={() => toggleSpeciesType("invasive")}
          label={t("invasiveSpecies")}
        />
        <Check
          checked={filters.speciesTypes.has("rare")}
          onChange={() => toggleSpeciesType("rare")}
          label={t("rareSpecies")}
        />
        <Check
          checked={filters.speciesTypes.has("other_species")}
          onChange={() => toggleSpeciesType("other_species")}
          label={t("otherSpecies")}
        />
      </Section>

      <Section title={t("targetPop")}>
        {targetPopulationOptions.map((option) => {
          if (option.key === "local_communities") {
            return (
              <div key={option.key}>
                <div className="flex items-center gap-1">
                  <Check
                    checked={allLocalCommunitySubgroupsSelected}
                    indeterminate={
                      someLocalCommunitySubgroupsSelected && !allLocalCommunitySubgroupsSelected
                    }
                    onChange={(checked) => toggleAllLocalCommunitySubgroups(checked)}
                    label={option.label}
                  />

                  <button
                    type="button"
                    onClick={() => setLocalCommunitiesOpen((prev) => !prev)}
                    aria-label="Toggle local communities"
                    aria-expanded={localCommunitiesOpen}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-secondary"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        localCommunitiesOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </div>

                {localCommunitiesOpen && (
                  <div className="space-y-1 ps-6">
                    {localCommunityOptions.map((subgroup) => (
                      <Check
                        key={subgroup.key}
                        checked={filters.localCommunitySubgroups.has(subgroup.key)}
                        onChange={() => toggleLocalCommunitySubgroup(subgroup.key)}
                        label={subgroup.label}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Check
              key={option.key}
              checked={filters.groups.has(option.key)}
              onChange={() => toggleGroup(option.key)}
              label={option.label}
            />
          );
        })}
      </Section>

      <Section title={t("monitoringAreas")}>
        <p className="mb-2 px-1 text-sm font-medium text-gray-500">בשיקום</p>
        {SURVEY_AREA_KEYS.filter((key) => key !== "other_areas").map((key) => (
          <Check
            key={key}
            checked={filters.areas.has(key)}
            onChange={() => toggleArea(key)}
            label={translateArea(key, lang)}
          />
        ))}
        {!monitoringAreas && <p className="px-1 text-xs text-muted-foreground">—</p>}
        {monitoringAreas?.features.map((feature) => (
          <Check
            key={feature.properties.id}
            checked={filters.monitoringAreas.has(feature.properties.id)}
            onChange={() => toggleMonitoringArea(feature.properties.id)}
            label={feature.properties.name}
          />
        ))}
        <hr className="my-2 border-gray-200" />
        <Check
          checked={filters.areas.has("other_areas")}
          onChange={() => toggleArea("other_areas")}
          label={translateArea("other_areas", lang)}
        />
      </Section>
    </aside>
  );
}
