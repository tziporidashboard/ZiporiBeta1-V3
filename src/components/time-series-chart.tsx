/**
 * TimeSeriesChart — main Dashboard line chart plotting monthly
 * observation counts per contributor group (expert / local_communities /
 * student / online_communities), rendered in a fixed grayscale-plus-accent
 * palette with distinct marker shapes per group (for print/colorblind
 * friendliness).
 *
 * What it does:
 *   - Groups `data` by `(year*100+month)` sort key and `user_category`
 *     ("online_communities" fallback when unset), producing raw counts.
 *   - Zero-fills every group at every timestamp so all lines span the
 *     full x-axis even where a group had no observations that month.
 *   - Always includes the "expert" (Professional Monitoring) group/line
 *     even with zero data, per `GROUP_CONFIG`.
 *   - Renders custom dot shapes (`CircleDot`, `CrossDot`, `TriangleDot`,
 *     `DiamondDot`) at a sparse, even interval (`shouldShowDot`) instead
 *     of one dot per data point, and a matching `CustomLegend`.
 *
 * Depends on: `recharts`, `@/lib/i18n`, `@/lib/observations-store`
 *   (`translateMonth`, `translateGroupName`, `Observation`).
 * Called by: `@/components/dashboard.tsx` (fed the `chartData` pipeline,
 *   which ignores the user-group filter).
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
import { translateMonth, translateGroupName } from "@/lib/observations-store";
import type { Observation } from "@/lib/observations-store";

// ─── Grayscale palette & marker config ────────────────────────────────────────
const PROFESSIONAL_MONITORING_KEY = "expert";

const GROUP_CONFIG = [
  { key: PROFESSIONAL_MONITORING_KEY, color: "#6366F1", shape: "diamond" as const },
  { key: "local_communities", color: "#000000", shape: "circle" as const },
  { key: "student", color: "#4A4A4A", shape: "cross" as const },
  { key: "online_communities", color: "#B0B0B0", shape: "triangle" as const },
] as const;

// Canonical raw-key order for deterministic slot assignment
const GROUP_ORDER = GROUP_CONFIG.map((g) => g.key);

function getGroupSlot(rawKey: string): number {
  const idx = GROUP_ORDER.indexOf(rawKey as (typeof GROUP_ORDER)[number]);
  return idx === -1 ? GROUP_CONFIG.length - 1 : idx;
}

// ─── Custom dot renderers ──────────────────────────────────────────────────────
function CircleDot(props: {
  cx?: number;
  cy?: number;
  stroke?: string;
  fill?: string;
  r?: number;
}) {
  const { cx = 0, cy = 0, stroke, r = 4 } = props;
  return <circle cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={2} fill={stroke} />;
}

function CrossDot(props: { cx?: number; cy?: number; stroke?: string }) {
  const { cx = 0, cy = 0, stroke } = props;
  const s = 4;
  return (
    <g>
      <line x1={cx - s} y1={cy - s} x2={cx + s} y2={cy + s} stroke={stroke} strokeWidth={2.5} />
      <line x1={cx + s} y1={cy - s} x2={cx - s} y2={cy + s} stroke={stroke} strokeWidth={2.5} />
    </g>
  );
}

function TriangleDot(props: { cx?: number; cy?: number; stroke?: string }) {
  const { cx = 0, cy = 0, stroke } = props;
  const s = 5;
  const points = `${cx},${cy - s} ${cx - s},${cy + s} ${cx + s},${cy + s}`;
  return <polygon points={points} stroke={stroke} strokeWidth={1.5} fill={stroke} />;
}

function DiamondDot(props: { cx?: number; cy?: number; stroke?: string }) {
  const { cx = 0, cy = 0, stroke } = props;
  const s = 5;
  const points = `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`;
  return <polygon points={points} stroke={stroke} strokeWidth={1.5} fill={stroke} />;
}

const DOT_RENDERERS = [CircleDot, CrossDot, TriangleDot, DiamondDot] as const;

// ─── Custom legend renderer ────────────────────────────────────────────────────
const LEGEND_SYMBOLS = ["●", "×", "▲", "◆"] as const;

function CustomLegend({ groups, lang }: { groups: string[]; lang: "he" | "en" }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs mt-1">
      {groups.map((rawKey) => {
        const slot = getGroupSlot(rawKey);
        const cfg = GROUP_CONFIG[slot] ?? GROUP_CONFIG[GROUP_CONFIG.length - 1];
        const symbol = LEGEND_SYMBOLS[slot] ?? LEGEND_SYMBOLS[LEGEND_SYMBOLS.length - 1];
        const label = translateGroupName(rawKey, lang);
        return (
          <span
            key={rawKey}
            className="inline-flex items-center gap-1"
            style={{ color: cfg.color }}
          >
            <span style={{ fontWeight: 700 }}>{symbol}</span>
            <span style={{ color: "#374151" }}>{label}</span>
          </span>
        );
      })}
    </div>
  );
}

// ─── Dot interval helper ──────────────────────────────────────────────────────
// Returns true only for indices that should render a visible marker.
function shouldShowDot(index: number, total: number): boolean {
  if (total === 0) return false;
  // Show ~6–8 markers across the full series regardless of length.
  const interval = Math.max(1, Math.round(total / 7));
  return index % interval === 0;
}

// ─── Main component ────────────────────────────────────────────────────────────
export function TimeSeriesChart({ data }: { data: Observation[] }) {
  const { lang } = useI18n();

  // Step 1 — collect raw counts per (sortKey, group)
  const { rawCounts, allSortKeys, allGroups } = useMemo(() => {
    const rawCounts = new Map<number, { label: string; counts: Map<string, number> }>();
    const allGroups = new Set<string>();

    for (const o of data) {
      const d = o.observed_on;
      if (!d || d.length < 10) continue;
      const parts = d.split("/");
      if (parts.length !== 3) continue;

      const monthNum = parseInt(parts[1], 10);
      const yearFull = parseInt(parts[2], 10);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12 || isNaN(yearFull)) continue;

      const sortKey = yearFull * 100 + monthNum;
      const yearShort = parts[2].slice(-2);
      const label = `${translateMonth(monthNum, lang)}-${yearShort}`;
      const group = o.user_category || "online_communities";

      allGroups.add(group);

      if (!rawCounts.has(sortKey)) {
        rawCounts.set(sortKey, { label, counts: new Map() });
      }
      const entry = rawCounts.get(sortKey)!;
      entry.counts.set(group, (entry.counts.get(group) ?? 0) + 1);
    }

    // Always include Professional Monitoring so it renders even with no data
    allGroups.add(PROFESSIONAL_MONITORING_KEY);

    const allSortKeys = Array.from(rawCounts.keys()).sort((a, b) => a - b);
    return { rawCounts, allSortKeys, allGroups: Array.from(allGroups) };
  }, [data, lang]);

  // Step 2 — zero-fill: every group has a value at every timestamp
  const chartData = useMemo(() => {
    return allSortKeys.map((sortKey) => {
      const entry = rawCounts.get(sortKey)!;
      const point: Record<string, number | string> = { monthYear: entry.label, sortKey };
      for (const group of allGroups) {
        point[group] = entry.counts.get(group) ?? 0;
      }
      return point;
    });
  }, [rawCounts, allSortKeys, allGroups]);

  // Step 3 — sort groups by canonical slot order for consistent color/shape assignment
  const sortedGroups = useMemo(
    () => [...allGroups].sort((a, b) => getGroupSlot(a) - getGroupSlot(b)),
    [allGroups],
  );

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
              formatter={(value: number, rawKey: string) => [
                value,
                translateGroupName(rawKey, lang),
              ]}
            />
            <Legend content={() => <CustomLegend groups={sortedGroups} lang={lang} />} />
            {sortedGroups.map((rawKey) => {
              const slot = getGroupSlot(rawKey);
              const cfg = GROUP_CONFIG[slot] ?? GROUP_CONFIG[GROUP_CONFIG.length - 1];
              const DotRenderer = DOT_RENDERERS[slot] ?? DOT_RENDERERS[DOT_RENDERERS.length - 1];
              const total = chartData.length;
              return (
                <Line
                  key={rawKey}
                  type="monotone"
                  dataKey={rawKey}
                  stroke={cfg.color}
                  strokeWidth={1.5}
                  connectNulls
                  dot={(props: { index?: number; cx?: number; cy?: number; stroke?: string }) => {
                    if (!shouldShowDot(props.index ?? 0, total)) return <g key={props.index} />;
                    return <DotRenderer {...props} stroke={cfg.color} />;
                  }}
                  activeDot={{ r: 6, stroke: cfg.color, fill: cfg.color }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
