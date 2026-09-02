/**
 * UserAnalyticsTable — People-dashboard table ranking the top `topN`
 * contributors (by observation count) with year-over-year trend,
 * research-grade %, and preferred season.
 *
 * What it does:
 *   - Groups `observations` by `user_login`, computing per-user total
 *     count, research-grade %, latest vs. previous year counts (for the
 *     trend arrow), and `isExpert` flag (from `user_subcategory`).
 *   - `getPreferredSeason` — same seasonal-bucketing logic pattern as
 *     `@/components/species-insights-table.tsx`, applied per user.
 *   - Sorts by total observations descending and slices to `topN`
 *     (default 5).
 *
 * Depends on: `@/lib/observations-store` (`Observation`), `@/lib/i18n`,
 *   `lucide-react`.
 * Called by: `@/components/people-dashboard.tsx`.
 */
import { useMemo } from "react";
import type { Observation } from "@/lib/observations-store";
import { useI18n } from "@/lib/i18n";
import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, Minus } from "lucide-react";

type UserRow = {
  user_login: string;
  total: number;
  latestYear: number;
  latestYearCount: number;
  previousYearCount: number;
  researchGradePct: number;
  isExpert: boolean;
  season: string;
};

function parseDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.length < 10) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if ([year, month, day].some((n) => Number.isNaN(n))) return null;
  return new Date(year, month - 1, day);
}

function formatObservations(count: number, lang: "he" | "en"): string {
  if (lang === "he") return count.toLocaleString("he-IL");
  return count.toLocaleString();
}

function getPreferredSeason(records: Observation[]): string {
  const months = new Map<number, number>();
  for (const record of records) {
    const month = Number(record.observed_on.split("/")[1]);
    if (month >= 1 && month <= 12) {
      months.set(month, (months.get(month) ?? 0) + 1);
    }
  }
  const total = records.length;
  const peak = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!peak || total === 0) return "-";
  if (peak[1] / total < 0.3) return "יציב שנתית";
  if ([12, 1, 2].includes(peak[0])) return "חורף";
  if ([3, 4, 5].includes(peak[0])) return "אביב";
  if ([6, 7, 8].includes(peak[0])) return "קיץ";
  return "סתיו";
}

function TrendIcon({
  trend,
  rtl,
  title,
}: {
  trend: "up" | "down" | "stable";
  rtl: boolean;
  title: string;
}) {
  const icon =
    trend === "stable" ? (
      <Minus className="h-4 w-4 text-amber-500" strokeWidth={2.5} />
    ) : trend === "up" ? (
      rtl ? (
        <ArrowUpLeft className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
      ) : (
        <ArrowUpRight className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
      )
    ) : rtl ? (
      <ArrowDownLeft className="h-4 w-4 text-rose-600" strokeWidth={2.5} />
    ) : (
      <ArrowDownRight className="h-4 w-4 text-rose-600" strokeWidth={2.5} />
    );
  return <span title={title}>{icon}</span>;
}

export function UserAnalyticsTable({
  observations,
  topN = 5,
}: {
  observations: Observation[];
  topN?: number;
}) {
  const { lang } = useI18n();

  const rows = useMemo<UserRow[]>(() => {
    if (observations.length === 0) return [];

    const byUser = new Map<string, Observation[]>();
    for (const o of observations) {
      const list = byUser.get(o.user_login) ?? [];
      list.push(o);
      byUser.set(o.user_login, list);
    }

    const userMetrics = Array.from(byUser.entries()).map(([user_login, obs]) => {
      const total = obs.length;
      const isExpert = obs[0]?.user_subcategory === "expert";

      const research = obs.filter((o) => o.quality_grade === "research").length;
      const researchGradePct = total > 0 ? (research / total) * 100 : 0;

      const yearCounts = new Map<number, number>();
      for (const o of obs) {
        const d = parseDate(o.observed_on);
        if (!d) continue;
        const y = d.getFullYear();
        yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
      }
      const years = Array.from(yearCounts.keys()).sort((a, b) => a - b);
      const latestYear = years[years.length - 1] ?? 0;
      const previousYear = years[years.length - 2] ?? latestYear - 1;
      const latestYearCount = yearCounts.get(latestYear) || 0;
      const previousYearCount = yearCounts.get(previousYear) || 0;

      return {
        user_login,
        total,
        latestYear,
        latestYearCount,
        previousYearCount,
        researchGradePct,
        isExpert,
        season: getPreferredSeason(obs),
      };
    });

    return userMetrics.sort((a, b) => b.total - a.total).slice(0, topN);
  }, [observations, topN]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {lang === "he" ? "אין נתונים לבחירה זו" : "No data for the current selection"}
      </div>
    );
  }

  const labels = {
    userName: { he: "שם משתמש", en: "User Name" },
    observations: { he: "מספר תצפיות", en: "Observations" },
    annualTrend: { he: "מגמה שנתית", en: "Annual Trend" },
    seasonalStatus: { he: "עונה פעילה", en: "Seasonal Status" },
    researchGrade: { he: "דירוג מחקרי", en: "Research Grade" },
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <table className="w-full table-fixed text-xs">
        <thead className="h-8">
          <tr className="border-b bg-secondary/60 text-[10px] font-semibold text-muted-foreground">
            <th className="w-[30%] px-3 py-1 text-start">{labels.userName[lang]}</th>
            <th className="w-[15%] px-2 py-1 text-center">{labels.observations[lang]}</th>
            <th className="w-[20%] px-2 py-1 text-center">{labels.annualTrend[lang]}</th>
            <th className="w-[17%] px-2 py-1 text-center">{labels.researchGrade[lang]}</th>
            <th className="w-[18%] px-2 py-1 text-center">{labels.seasonalStatus[lang]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const trend: "up" | "down" | "stable" =
              row.latestYearCount > row.previousYearCount
                ? "up"
                : row.latestYearCount < row.previousYearCount
                  ? "down"
                  : "stable";
            const previousYear = row.latestYear - 1;
            const trendTitle = `${row.latestYear}: ${formatObservations(row.latestYearCount, lang)} | ${previousYear}: ${formatObservations(row.previousYearCount, lang)}`;
            return (
              <tr
                key={row.user_login}
                className="border-b border-border/60 last:border-0 hover:bg-secondary/30"
              >
                <td
                  className="truncate px-3 py-1 align-middle text-start font-medium"
                  title={row.user_login}
                >
                  {row.user_login}
                </td>
                <td className="px-2 py-1 text-center align-middle tabular-nums">
                  {formatObservations(row.total, lang)}
                </td>
                <td className="px-2 py-1 text-center align-middle">
                  <span className="inline-flex items-center justify-center">
                    <TrendIcon trend={trend} rtl={lang === "he"} title={trendTitle} />
                  </span>
                </td>
                <td className="px-2 py-1 text-center align-middle tabular-nums">
                  {row.isExpert ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    `${Math.round(row.researchGradePct)}%`
                  )}
                </td>
                <td className="px-2 py-1 text-center align-middle">{row.season}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
