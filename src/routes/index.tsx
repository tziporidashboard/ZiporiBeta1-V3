/**
 * index.tsx — the `/` route: top-level app shell for the dashboard,
 * hosting the 3 main tabs (Overview / Deep Dive / People) plus the
 * persistent filter sidebar and global date-range bar.
 *
 * What it does:
 *   - Wraps everything in `ObservationsProvider` (`@/lib/observations-store`)
 *     so all descendant tabs share one dataset + filter state.
 *   - Renders `FilterSidebar` as a slide-in drawer (`sidebarOpen` state),
 *     a `Tabs` bar (overview/deep-dive/people, each lazy-loaded via
 *     `React.lazy` + `Suspense`), a language toggle, and
 *     `GlobalDateRangeBar` (the persistent `DateRangeSlider`, synced to
 *     `filters.dateRange`/`filters.time`).
 *   - `ResetFiltersButton` — restores all filters to their
 *     dataset-derived defaults (all years/taxa/areas/species-types
 *     selected, all detected groups + "expert") and bumps
 *     `resetVersion` so per-tab local selection state (e.g. People's
 *     selected user) also resets.
 *   - `ssr: false` on this route — the dashboard is client-rendered only
 *     (data loading depends on `window`/`fetch` of local CSV files).
 *
 * Depends on: `@/lib/observations-store`, `@/lib/survey-polygons`,
 *   `@/lib/i18n`, `@/components/ui/tabs`, `@/components/filter-sidebar`,
 *   `@/components/date-range-slider`, and the lazy-loaded `Dashboard`,
 *   `SpeciesDeepDive`, `PeopleDashboard` components.
 * Called by: the router, as the component for path `/`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { ObservationsProvider, useObservations } from "@/lib/observations-store";
import { SURVEY_AREA_KEYS } from "@/lib/survey-polygons";
import { useI18n } from "@/lib/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterSidebar } from "@/components/filter-sidebar";
import { DateRangeSlider } from "@/components/date-range-slider";
import { Languages, RotateCcw, SlidersHorizontal } from "lucide-react";

const Dashboard = lazy(() =>
  import("@/components/dashboard").then((m) => ({ default: m.Dashboard })),
);
const SpeciesDeepDive = lazy(() =>
  import("@/components/species-deep-dive").then((m) => ({ default: m.SpeciesDeepDive })),
);
const PeopleDashboard = lazy(() =>
  import("@/components/people-dashboard").then((m) => ({ default: m.PeopleDashboard })),
);

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ecological Monitoring Dashboard" },
      {
        name: "description",
        content: "Interactive analytics dashboard for iNaturalist ecological observations.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { t, lang, setLang, dir } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <ObservationsProvider>
      <Tabs
        defaultValue="overview"
        dir={dir}
        className="relative flex h-full w-full overflow-hidden"
      >
        {/* Backdrop */}
        {sidebarOpen && (
          <div
            className="pointer-events-none fixed inset-0 z-[9998] bg-black/20 transition-opacity"
          />
        )}

        {/* Sliding sidebar drawer */}
        <div
          className={`fixed top-0 z-[9999] h-full shadow-lg transition-transform duration-300 ease-in-out ${
            dir === "rtl"
              ? `right-0 ${sidebarOpen ? "translate-x-0" : "translate-x-full"}`
              : `left-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`
          }`}
        >
          <FilterSidebar onClose={() => setSidebarOpen(false)} />
          {/* Side handle tab */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className={`absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-20 bg-card border shadow-md rounded-md cursor-pointer hover:bg-secondary transition-colors ${
              dir === "rtl"
                ? "-left-5 rounded-r-none border-r-0"
                : "-right-5 rounded-l-none border-l-0"
            }`}
          >
            <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>

        {/* Main content area */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Global top bar: centred nav tabs + language toggle */}
          <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-b">
            <ResetFiltersButton />
            <TabsList className="inline-flex h-9 items-center rounded-full bg-muted p-1 gap-0.5">
              <TabsTrigger
                value="overview"
                className="rounded-full px-4 h-7 text-sm font-semibold transition-colors data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground"
              >
                {t("overview")}
              </TabsTrigger>
              <TabsTrigger
                value="deep-dive"
                className="rounded-full px-4 h-7 text-sm font-semibold transition-colors data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground"
              >
                {t("deepDive")}
              </TabsTrigger>
              <TabsTrigger
                value="people"
                className="rounded-full px-4 h-7 text-sm font-semibold transition-colors data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground"
              >
                {t("people")}
              </TabsTrigger>
            </TabsList>
            <button
              onClick={() => setLang(lang === "he" ? "en" : "he")}
              className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
            >
              <Languages className="h-3.5 w-3.5" />
              {t("language")}
            </button>
          </div>

          {/* Global Date Range Slider — persistent across all tabs */}
          <GlobalDateRangeBar />

          <TabsContent value="overview" className="flex-1 min-h-0 h-full mt-0">
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
              <Dashboard />
            </Suspense>
          </TabsContent>
          <TabsContent value="deep-dive" className="flex-1 min-h-0 h-full mt-0">
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
              <SpeciesDeepDive />
            </Suspense>
          </TabsContent>
          <TabsContent value="people" className="flex-1 min-h-0 h-full mt-0">
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
              <PeopleDashboard />
            </Suspense>
          </TabsContent>
        </div>
      </Tabs>
    </ObservationsProvider>
  );
}

function ResetFiltersButton() {
  const { t } = useI18n();
  const {
    observations,
    filters,
    setFilters,
    datasetBounds,
    deepDiveActions,
    bumpResetVersion,
    monitoringAreas,
  } = useObservations();

  const uniqueYears = useMemo(() => {
    const years = new Set<string>();
    for (const o of observations) {
      const d = o.observed_on;
      if (!d || d.length < 10) continue;
      const parts = d.split("/");
      if (parts.length === 3 && parts[2]?.length === 4) years.add(parts[2]);
    }
    return Array.from(years).sort();
  }, [observations]);

  const reset = () => {
    const defaultTime = new Map<string, Set<string>>();
    for (const y of uniqueYears) defaultTime.set(y, new Set());
    const groupsInData = new Set<string>(observations.map((o) => o.user_category).filter(Boolean));
    groupsInData.add("expert");
    deepDiveActions.setDeepDiveCategory(null);
    setFilters({
      time: defaultTime,
      taxa: new Set([
        "mammals",
        "birds",
        "butterflies",
        "dragonflies",
        "arthropods",
        "plants",
        "other",
      ] as const),
      groups: groupsInData,
      researchOnly: false,
      areas: new Set(SURVEY_AREA_KEYS),
      speciesTypes: new Set(["invasive", "rare", "other_species"]),
      monitoringAreas: new Set(
        monitoringAreas?.features.map((feature) => feature.properties.id) ?? [],
      ),
      dateRange: datasetBounds,
    });
    bumpResetVersion();
  };

  return (
    <button
      onClick={reset}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary hover:border-primary/50 transition-colors"
    >
      <RotateCcw className="h-3 w-3" />
      {t("resetFilters")}
    </button>
  );
}

function GlobalDateRangeBar() {
  const { filters, setDateRange, datasetBounds } = useObservations();

  if (!datasetBounds || !filters.dateRange) return null;

  return (
    <div className="w-full bg-white border-b px-6 pt-3 pb-1 shadow-sm z-10 shrink-0">
      <DateRangeSlider
        min={datasetBounds.start}
        max={datasetBounds.end}
        value={[filters.dateRange.start, filters.dateRange.end]}
        onChange={([start, end]) => setDateRange(start, end)}
        selectedYears={new Set(filters.time.keys())}
      />
    </div>
  );
}
