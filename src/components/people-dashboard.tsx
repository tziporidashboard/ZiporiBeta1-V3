/**
 * PeopleDashboard — "People" analytics view, grouping observations by
 * contributor group/subgroup (expert, zevulun/yizrael/mechnistim
 * monitoring subgroups, students, and online-community "public" users)
 * with a per-user drill-down.
 *
 * What it does:
 *   - Applies the shared dashboard `filters` (date/quality/time/taxa/
 *     area/species-type) but deliberately IGNORES the global user-group
 *     filter, since this page has its own `GROUPS` chip selector
 *     (`selectedGroup`) plus a searchable per-user dropdown
 *     (`selectedUser`).
 *   - Computes `groupCounts` (observations per group, for chip badges)
 *     and `userChipList`/`userDropdownList` (per-user counts within the
 *     active group, searchable via `userSearch`).
 *   - Resets `selectedGroup`/`selectedUser` whenever `resetVersion`
 *     changes (global filter reset from `useObservations()`).
 *   - Renders the KPI strip, group chips, user search dropdown, the
 *     `ObservationMap`, `UserAnalyticsTable`, and `UserActivityChart`.
 *
 * Key helpers:
 *   - `parseObsTimestamp` — parses `DD/MM/YYYY` to epoch ms (duplicated
 *     from `@/components/dashboard.tsx`).
 *   - `GROUPS` — static list of contributor group/subgroup definitions.
 *
 * Depends on: `@/lib/observations-store`, `@/lib/survey-polygons`,
 *   `@/lib/monitoring-areas`, `@/lib/i18n`, `ObservationMap`,
 *   `UserAnalyticsTable`, `UserActivityChart`, `@/components/ui/input`.
 * Called by: the "People" route/tab in the app shell.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ListFilter } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import {
  useObservations,
  getTaxaGroup,
  getSpeciesClassification,
  type Observation,
  REA_SHAISH_NAME,
} from "@/lib/observations-store";
import { ObservationMap } from "@/components/observation-map";
import { UserAnalyticsTable } from "@/components/user-analytics-table";
import { UserActivityChart } from "@/components/user-activity-chart";
import { getObservationArea, type SurveyAreaKey } from "@/lib/survey-polygons";
import { observationMatchesSelectedAreas } from "@/lib/monitoring-areas";

function parseObsTimestamp(dateStr: string): number {
  if (!dateStr || dateStr.length < 10) return NaN;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return NaN;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return NaN;
  return new Date(year, month, day).getTime();
}

function areaMatches(selectedAreas: Set<SurveyAreaKey>, area: SurveyAreaKey | null): boolean {
  if (selectedAreas.size === 0) return true;
  if (area === null) return selectedAreas.has("other_areas");
  return selectedAreas.has(area);
}

type GroupDef = {
  key: string;
  label: string;
  match: (o: Observation) => boolean;
};

const GROUPS: GroupDef[] = [
  { key: "expert", label: "ניטור מקצועי", match: (o) => o.user_category === "expert" },
  { key: "zevulun", label: "זבולון", match: (o) => o.user_subcategory === "zevulun" },
  { key: "yizrael", label: "יזרעאל", match: (o) => o.user_subcategory === "yizrael" },
  { key: "mechnistim", label: "מכניסטים", match: (o) => o.user_subcategory === "mechnistim" },
  { key: "student", label: "תלמידים", match: (o) => o.user_category === "student" },
  {
    key: "public",
    label: "קהילות מקוונות",
    match: (o) => o.user_category === "online_communities" && o.user_subcategory === "community",
  },
];

const ACTIVE_CHIP = "bg-sky-300 text-sky-900 border-sky-500 border-2 font-semibold";
const INACTIVE_CHIP = "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100";
const USER_ACTIVE_CHIP = "bg-sky-200 text-sky-900 border-sky-400 border-2 font-semibold";
const REA_SHAISH_ACTIVE_CHIP = "bg-violet-200 text-violet-900 border-violet-400 border-2 font-semibold";
const USER_INACTIVE_CHIP = "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100";

export function PeopleDashboard() {
  const { t } = useI18n();
  const { observations, filters, resetVersion, observationMonitoringAreaIndex } =
    useObservations();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(true);
  const [userSearch, setUserSearch] = useState("");
  const userDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isUserDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isUserDropdownOpen]);

  // Apply global filters except the group filter; this page has its own group selector.
  const globallyFilteredObservations = useMemo(() => {
    return observations.filter((o) => {
      if (filters.dateRange) {
        const ts = parseObsTimestamp(o.observed_on);
        if (Number.isNaN(ts) || ts < filters.dateRange.start || ts > filters.dateRange.end)
          return false;
      }
      if (filters.researchOnly && o.quality_grade !== "research") return false;
      if (filters.time.size > 0) {
        if (!o.observed_on || o.observed_on.length < 10) return false;
        const parts = o.observed_on.split("/");
        if (parts.length !== 3) return false;
        const entry = filters.time.get(parts[2]);
        if (!entry) return false;
        if (entry.size > 0 && !entry.has(parts[1])) return false;
      }
      if (filters.taxa.size > 0 && !filters.taxa.has(getTaxaGroup(o))) return false;
      if (
        !observationMatchesSelectedAreas(
          o,
          filters.areas,
          filters.monitoringAreas,
          observationMonitoringAreaIndex,
        )
      )
        return false;
      if (filters.speciesTypes.size > 0 && !filters.speciesTypes.has(getSpeciesClassification(o)))
        return false;
      return true;
    });
  }, [observations, filters, observationMonitoringAreaIndex]);

  const groupObservations = useMemo(() => {
    const selectedGroupDef = GROUPS.find((g) => g.key === selectedGroup);
    if (!selectedGroupDef) return globallyFilteredObservations;
    return globallyFilteredObservations.filter(selectedGroupDef.match);
  }, [globallyFilteredObservations, selectedGroup]);

  const displayObservations = useMemo(() => {
    if (!selectedUser) return groupObservations;
    return groupObservations.filter((o) => o.user_login === selectedUser);
  }, [groupObservations, selectedUser]);

  const summary = useMemo(() => {
    const observers = new Set<string>();
    for (const o of displayObservations) {
      if (o.user_login) observers.add(o.user_login);
    }
    return { rows: displayObservations.length, observers: observers.size };
  }, [displayObservations]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of GROUPS) {
      let count = 0;
      for (const o of globallyFilteredObservations) {
        if (group.match(o)) count++;
      }
      counts.set(group.key, count);
    }
    return counts;
  }, [globallyFilteredObservations]);

  const userChipList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of groupObservations) {
      counts.set(o.user_login, (counts.get(o.user_login) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([user, count]) => ({ user, count }));
  }, [groupObservations]);

  const userDropdownList = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return userChipList;
    return userChipList.filter(({ user }) => user.toLowerCase().includes(q));
  }, [userChipList, userSearch]);

  const topUserLogins = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of displayObservations) {
      counts.set(o.user_login, (counts.get(o.user_login) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([user]) => user);
  }, [displayObservations]);

  const handleGroupClick = (key: string) => {
    if (selectedGroup === key) {
      setSelectedGroup(null);
    } else {
      setSelectedGroup(key);
    }
    setSelectedUser(null);
  };

  const handleUserClick = (user: string) => {
    if (selectedUser === user) {
      setSelectedUser(null);
    } else {
      setSelectedUser(user);
    }
  };

  useEffect(() => {
    setSelectedGroup(null);
    setSelectedUser(null);
  }, [resetVersion]);

  return (
    <main className="flex h-full w-full flex-col overflow-hidden">
      {/* Top Row: KPIs on side + Group tabs centered */}
      <div className="shrink-0 flex items-center min-h-[3.5rem] w-full px-4 py-0.5 gap-3">
        <div className="flex items-center gap-3 shrink-0">
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
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
          {GROUPS.map((group) => {
            const isActive = selectedGroup === group.key;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => handleGroupClick(group.key)}
                className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition-all duration-200 ${
                  isActive ? ACTIVE_CHIP : INACTIVE_CHIP
                }`}
              >
                {group.label}
                <span className="opacity-60 text-[10px]">
                  ({(groupCounts.get(group.key) ?? 0).toLocaleString()})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* User filter row - 8% height */}
      <div className="h-[8%] shrink-0 flex items-center gap-3 px-4 py-1.5 border-b">
        <div ref={userDropdownRef} className="relative shrink-0 flex items-center gap-1">
          <div className="relative w-44">
            <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="חיפוש אנשים..."
              className="ps-7 h-7 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => setIsUserDropdownOpen((o) => !o)}
            title="חיפוש אנשים..."
            className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
              isUserDropdownOpen ? "bg-muted border-foreground/30" : "border-input hover:bg-muted"
            }`}
          >
            <ListFilter className="h-3.5 w-3.5" />
          </button>

          {isUserDropdownOpen && (
            <div
              className="absolute top-full start-0 mt-1 z-[9999] w-64 max-h-64 overflow-y-auto rounded-md border bg-white shadow-lg"
              style={{ zIndex: 9999 }}
            >
              <div className="sticky top-0 flex items-center justify-between border-b bg-white px-2 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">חיפוש אנשים...</span>
                <button
                  type="button"
                  onClick={() => setIsUserDropdownOpen(false)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  מזער
                </button>
              </div>
              <div className="p-1">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selectedUser === null}
                    onChange={() => setSelectedUser(null)}
                  />
                  {t("all")}
                </label>
                {userDropdownList.map(({ user, count }) => {
                  const isSelected = selectedUser === user;
                  return (
                    <label
                      key={user}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleUserClick(user)}
                      />
                      <span className="truncate">
                        {user} ({count.toLocaleString()})
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
          <ObservationMap data={displayObservations} />
        </div>
      </div>

      {/* Bottom Section (Table & Chart) */}
      <div className="flex-1 min-h-0 px-2 pt-2 pb-1 grid grid-cols-1 lg:grid-cols-2 gap-2">
        <UserAnalyticsTable observations={displayObservations} topN={5} />
        <UserActivityChart observations={displayObservations} users={topUserLogins} />
      </div>
    </main>
  );
}
