/**
 * DeepDiveTimeSeriesChart — Recharts line chart used inside the
 * "Species Deep Dive" view (`@/components/species-deep-dive.tsx`).
 *
 * What it does, in two mutually-exclusive scenarios:
 *   A) No species selected (`selectedSpecies` empty): plots the selected
 *      taxa `category` ("focus" line) against all other categories
 *      combined ("background" line), one point per month/year.
 *   B) One or more species selected: plots one line per selected
 *      scientific name (restricted to observations within `category`),
 *      colored via `SPECIES_PALETTE` and labeled via `getSpeciesLabel`
 *      (Hebrew/English common name lookup against `SPECIES_MAP`).
 *
 * Main pieces:
 *   - `parseSortKey` (local) — parses `DD/MM/YYYY` into a sortable
 *     `YYYYMM` integer plus a display label like "Jan-24".
 *   - `getSpeciesLabel` — resolves scientific name -> localized common name.
 *
 * Depends on: `recharts`, `@/lib/i18n`, `@/lib/observations-store`
 *   (`translateMonth`, `getTaxaGroup`, `Observation`, `TaxaGroupKey`),
 *   `@/lib/species-dictionary` (`SPECIES_MAP`).
 * Called by: `@/components/species-deep-dive.tsx`.
 */
import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { useI18n } from "@/lib/i18n";
import { translateMonth, getTaxaGroup } from "@/lib/observations-store";
import type { Observation, TaxaGroupKey } from "@/lib/observations-store";
import { SPECIES_MAP } from "@/lib/species-dictionary";

// Color palette for individual species lines
const SPECIES_PALETTE = [
  "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c",
  "#0891b2", "#be185d", "#4f46e5", "#ca8a04", "#059669",
];

const BACKGROUND_COLOR = "#737373";

const HEBREW_CATEGORY_LABELS: Record<TaxaGroupKey, string> = {
  mammals: "יונקים",
  birds: "עופות",
  butterflies: "פרפרים",
  dragonflies: "שפיראים",
  arthropods: "פרוקי רגליים",
  plants: "צמחים",
  other: "שאר המינים",
};

interface Props {
  /** All observations (unfiltered by deep dive) */
  allObservations: Observation[];
  /** The selected dashboard category */
  category: TaxaGroupKey | null;
  /** Set of selected species scientific names. Empty = "All" in category */
  selectedSpecies: Set<string>;
  /** Primary color of the category tab */
  categoryColor: string;
}

const HEBREW_LETTER_REGEX = /[א-ת]/;

function getSpeciesLabel(scientific_name: string, lang: "he" | "en"): string {
  const entry = SPECIES_MAP.get(scientific_name);
  if (!entry) return scientific_name;
  if (lang === "he") {
    if (entry.Hebrew_Name && entry.Hebrew_Name !== "N/A" && HEBREW_LETTER_REGEX.test(entry.Hebrew_Name)) {
      return entry.Hebrew_Name;
    }
    return scientific_name;
  }
  if (entry.English_Name && entry.English_Name !== "N/A") return entry.English_Name;
  return scientific_name;
}

export function DeepDiveTimeSeriesChart({ allObservations, category, selectedSpecies, categoryColor }: Props) {
  const { lang } = useI18n();

  const { chartData, seriesKeys, seriesColors, seriesLabels } = useMemo<{
    chartData: Record<string, number | string>[];
    seriesKeys: string[];
    seriesColors: Record<string, string>;
    seriesLabels: Record<string, string>;
  }>(() => {
    // Parse date to sortKey
    function parseSortKey(dateStr: string): { sortKey: number; label: string } | null {
      if (!dateStr || dateStr.length < 10) return null;
      const parts = dateStr.split("/");
      if (parts.length !== 3) return null;
      const monthNum = parseInt(parts[1], 10);
      const yearFull = parseInt(parts[2], 10);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12 || isNaN(yearFull)) return null;
      const sortKey = yearFull * 100 + monthNum;
      const yearShort = parts[2].slice(-2);
      const label = `${translateMonth(monthNum, lang)}-${yearShort}`;
      return { sortKey, label };
    }

    const isAllSpecies = selectedSpecies.size === 0;

    // Collect counts per sortKey per series
    const countsMap = new Map<number, { label: string; counts: Map<string, number> }>();

    const FOCUS_KEY = "focus";
    const BG_KEY = "background";

    if (isAllSpecies) {
      // SCENARIO A: Category vs All Others
      for (const o of allObservations) {
        const parsed = parseSortKey(o.observed_on);
        if (!parsed) continue;
        const { sortKey, label } = parsed;

        const isFocus = !category || getTaxaGroup(o) === category;
        const seriesKey = isFocus ? FOCUS_KEY : BG_KEY;

        if (!countsMap.has(sortKey)) {
          countsMap.set(sortKey, { label, counts: new Map() });
        }
        const entry = countsMap.get(sortKey)!;
        entry.counts.set(seriesKey, (entry.counts.get(seriesKey) ?? 0) + 1);
      }

      const allSortKeys = Array.from(countsMap.keys()).sort((a, b) => a - b);
      const chartData = allSortKeys.map((sk) => {
        const entry = countsMap.get(sk)!;
        return {
          monthYear: entry.label,
          [FOCUS_KEY]: entry.counts.get(FOCUS_KEY) ?? 0,
          [BG_KEY]: entry.counts.get(BG_KEY) ?? 0,
        };
      });

      const focusLabel = category ? HEBREW_CATEGORY_LABELS[category] : "כל הקטגוריות";
      const bgLabel = "שאר הקטגוריות";

      return {
        chartData,
        seriesKeys: [FOCUS_KEY, BG_KEY],
        seriesColors: { [FOCUS_KEY]: categoryColor, [BG_KEY]: BACKGROUND_COLOR },
        seriesLabels: { [FOCUS_KEY]: focusLabel, [BG_KEY]: bgLabel },
      };
    } else {
      // SCENARIO B: Individual species + rest of category
      const selectedSet = selectedSpecies;

      const categoryObs = category ? allObservations.filter((o) => getTaxaGroup(o) === category) : allObservations;

      for (const o of categoryObs) {
        const parsed = parseSortKey(o.observed_on);
        if (!parsed) continue;
        const { sortKey, label } = parsed;

        if (!selectedSet.has(o.scientific_name)) continue;
        const seriesKey = o.scientific_name;

        if (!countsMap.has(sortKey)) {
          countsMap.set(sortKey, { label, counts: new Map() });
        }
        const entry = countsMap.get(sortKey)!;
        entry.counts.set(seriesKey, (entry.counts.get(seriesKey) ?? 0) + 1);
      }

      const speciesKeys = Array.from(selectedSet);
      const allKeys = speciesKeys;

      const allSortKeys = Array.from(countsMap.keys()).sort((a, b) => a - b);
      const chartData = allSortKeys.map((sk) => {
        const entry = countsMap.get(sk)!;
        const point: Record<string, number | string> = { monthYear: entry.label };
        for (const key of allKeys) {
          point[key] = entry.counts.get(key) ?? 0;
        }
        return point;
      });

      const seriesColors: Record<string, string> = {};
      const seriesLabels: Record<string, string> = {};

      speciesKeys.forEach((sci, i) => {
        seriesColors[sci] = SPECIES_PALETTE[i % SPECIES_PALETTE.length];
        seriesLabels[sci] = getSpeciesLabel(sci, lang);
      });

      return {
        chartData,
        seriesKeys: allKeys,
        seriesColors,
        seriesLabels,
      };
    }
  }, [allObservations, category, selectedSpecies, categoryColor, lang]);

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
              formatter={(value: number, key: string) => [
                value,
                seriesLabels[key] || key,
              ]}
            />
            <Legend
              content={() => (
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs mt-1">
                  {[...new Set(seriesKeys)].map((key) => (
                    <span key={key} className="inline-flex items-center gap-1">
                      <span
                        className="inline-block w-3 h-0.5 rounded"
                        style={{ backgroundColor: seriesColors[key] }}
                      />
                      <span className="text-gray-700">{seriesLabels[key] || key}</span>
                    </span>
                  ))}
                </div>
              )}
            />
            {[...new Set(seriesKeys)].map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={seriesColors[key]}
                strokeWidth={key === "background" ? 3 : 2}
                strokeDasharray={key === "background" ? "4 3" : undefined}
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
