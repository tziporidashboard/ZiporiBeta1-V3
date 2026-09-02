/**
 * UserActivityChart — People-dashboard line chart plotting monthly
 * observation counts for a fixed set of `users` (typically the current
 * top 5 contributors), one colored line per user.
 *
 * What it does:
 *   - Filters `observations` down to the given `users` list, buckets by
 *     `(year*100+month)` sort key, and zero-fills each user at every
 *     timestamp.
 *   - Assigns a stable color per user from `USER_PALETTE` (cycled by
 *     index) and renders an empty-state message when there is no data.
 *
 * Depends on: `recharts`, `@/lib/i18n`, `@/lib/observations-store`
 *   (`translateMonth`, `Observation`).
 * Called by: `@/components/people-dashboard.tsx` (fed `topUserLogins`).
 */
import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useI18n } from "@/lib/i18n";
import type { Observation } from "@/lib/observations-store";
import { translateMonth } from "@/lib/observations-store";

const USER_PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be185d",
  "#4f46e5",
];

function parseSortKey(dateStr: string): { sortKey: number; label: string } | null {
  if (!dateStr || dateStr.length < 10) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) return null;
  return {
    sortKey: year * 100 + month,
    label: `${translateMonth(month, "he")}-${String(year).slice(-2)}`,
  };
}

interface Props {
  observations: Observation[];
  users: string[];
}

export function UserActivityChart({ observations, users }: Props) {
  const { lang } = useI18n();

  const { chartData, seriesKeys, seriesColors } = useMemo(() => {
    const countsMap = new Map<number, { label: string; counts: Map<string, number> }>();

    for (const o of observations) {
      if (!users.includes(o.user_login)) continue;
      const parsed = parseSortKey(o.observed_on);
      if (!parsed) continue;
      const { sortKey, label } = parsed;

      if (!countsMap.has(sortKey)) {
        countsMap.set(sortKey, { label, counts: new Map() });
      }
      const entry = countsMap.get(sortKey)!;
      entry.counts.set(o.user_login, (entry.counts.get(o.user_login) ?? 0) + 1);
    }

    const allSortKeys = Array.from(countsMap.keys()).sort((a, b) => a - b);
    const chartData = allSortKeys.map((sk) => {
      const entry = countsMap.get(sk)!;
      const point: Record<string, number | string> = { monthYear: entry.label };
      for (const user of users) {
        point[user] = entry.counts.get(user) ?? 0;
      }
      return point;
    });

    const seriesColors: Record<string, string> = {};
    users.forEach((user, i) => {
      seriesColors[user] = USER_PALETTE[i % USER_PALETTE.length];
    });

    return { chartData, seriesKeys: users, seriesColors };
  }, [observations, users]);

  if (chartData.length === 0 || users.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground rounded-lg border bg-card">
        {lang === "he" ? "אין נתוני פעילות לחמשת המובילים" : "No activity data for top users"}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card h-full flex flex-col">
      <div className="px-2 pt-2 pb-1 flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="monthYear"
              minTickGap={70}
              interval="preserveStartEnd"
              tick={{ fontSize: 10, dy: 8 }}
              height={48}
            />
            <YAxis tick={{ fontSize: 10 }} width={44} tickCount={7} />
            <Tooltip
              formatter={(value: number, key: string) => [value, key]}
            />
            <Legend
              content={() => (
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs mt-1">
                  {seriesKeys.map((key) => (
                    <span key={key} className="inline-flex items-center gap-1">
                      <span
                        className="inline-block w-3 h-0.5 rounded"
                        style={{ backgroundColor: seriesColors[key] }}
                      />
                      <span className="text-gray-700 truncate max-w-[120px]">{key}</span>
                    </span>
                  ))}
                </div>
              )}
            />
            {seriesKeys.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={seriesColors[key]}
                strokeWidth={2}
                connectNulls
                dot={false}
                activeDot={{ r: 4, stroke: seriesColors[key], fill: seriesColors[key] }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
