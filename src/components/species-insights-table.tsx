/**
 * SpeciesInsightsTable — top-5 species insight table (used in the Species
 * Deep Dive view) ranking species by observation count, with an annual
 * trend arrow, research-grade %, and dominant season.
 *
 * What it does:
 *   - `getTopSpecies` (exported, also used directly by
 *     `@/components/species-deep-dive.tsx` for the chart's default
 *     highlighted-species set) groups observations by scientific name
 *     (restricted to named entries in `@/lib/species-map`), computes
 *     per-species stats, then orders results as: selected
 *     `prioritySpecies` first, then the rest of `priorityCategory`, then
 *     everything else — capped to the top 5.
 *   - `getSeasonalStatus` — buckets a species' observations by month and
 *     labels the dominant season (or "יציב שנתית" if no season dominates).
 *   - `TrendIcon` — renders an up/down/stable arrow (RTL-aware) comparing
 *     a species' first vs. last year of observations.
 *
 * Depends on: `@/lib/observations-store`, `@/lib/species-dictionary`
 *   (`SPECIES_MAP`), `@/lib/species-map`, `@/lib/i18n`, `lucide-react`.
 * Called by: `@/components/species-deep-dive.tsx`.
 */
import { useMemo } from "react";
import { getTaxaGroup, type Observation, type TaxaGroupKey } from "@/lib/observations-store";
import { SPECIES_MAP } from "@/lib/species-dictionary";
import { speciesMap } from "@/lib/species-map";
import { useI18n } from "@/lib/i18n";
import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, Minus } from "lucide-react";

const CHIP_SPECIES_NAMES = new Set(
  speciesMap.filter((entry) => !entry.isGeneric).map((entry) => entry.Scientific_Name)
);

type SpeciesInsight = {
  scientificName: string;
  hebrewName: string;
  englishName: string;
  observations: number;
  researchPct: number;
  trend: "up" | "down" | "stable";
  annualBreakdown: string;
  seasonalStatus: string;
};

function getSeasonalStatus(records: Observation[]): string {
  const months = new Map<number, number>();
  for (const record of records) {
    const month = Number(record.observed_on.split("/")[1]);
    if (month >= 1 && month <= 12) months.set(month, (months.get(month) ?? 0) + 1);
  }
  const peak = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!peak || peak[1] / records.length < 0.3) return "יציב שנתית";
  if ([12, 1, 2].includes(peak[0])) return "חורף";
  if ([3, 4, 5].includes(peak[0])) return "אביב";
  if ([6, 7, 8].includes(peak[0])) return "קיץ";
  return "סתיו";
}

export function getTopSpecies(data: Observation[], prioritySpecies: Set<string>, priorityCategory: TaxaGroupKey | null): SpeciesInsight[] {
  const bySpecies = new Map<string, Observation[]>();
  for (const observation of data) {
    if (!observation.scientific_name || !CHIP_SPECIES_NAMES.has(observation.scientific_name)) continue;
    const records = bySpecies.get(observation.scientific_name) ?? [];
    records.push(observation);
    bySpecies.set(observation.scientific_name, records);
  }

  const insights: SpeciesInsight[] = [...bySpecies.entries()].map(([scientificName, records]) => {
    const annual = new Map<number, number>();
    let research = 0;
    for (const record of records) {
      const year = Number(record.observed_on.split("/")[2]);
      if (!Number.isNaN(year)) annual.set(year, (annual.get(year) ?? 0) + 1);
      if (record.quality_grade === "research") research += 1;
    }
    const annualEntries = [...annual.entries()].sort((a, b) => a[0] - b[0]);
    const firstCount = annualEntries[0]?.[1] ?? 0;
    const lastCount = annualEntries.at(-1)?.[1] ?? 0;
    const trend = lastCount > firstCount ? "up" : lastCount < firstCount ? "down" : "stable";
    const metadata = SPECIES_MAP.get(scientificName);
    return {
      scientificName,
      hebrewName: metadata?.Hebrew_Name && metadata.Hebrew_Name !== "N/A" ? metadata.Hebrew_Name : scientificName,
      englishName: metadata?.English_Name && metadata.English_Name !== "N/A" ? metadata.English_Name : scientificName,
      observations: records.length,
      researchPct: (research / records.length) * 100,
      trend,
      annualBreakdown: annualEntries.map(([year, count]) => `${year}: ${count}`).join(", "),
      seasonalStatus: getSeasonalStatus(records),
    };
  });

  const byCount = (a: SpeciesInsight, b: SpeciesInsight) => b.observations - a.observations || a.hebrewName.localeCompare(b.hebrewName, "he");
  const selected = insights.filter((insight) => prioritySpecies.has(insight.scientificName)).sort(byCount);
  const category = priorityCategory
    ? insights.filter((insight) => !prioritySpecies.has(insight.scientificName) && getTaxaGroup(bySpecies.get(insight.scientificName)![0]) === priorityCategory).sort(byCount)
    : [];
  const remaining = insights.filter((insight) => !prioritySpecies.has(insight.scientificName) && !category.includes(insight)).sort(byCount);
  return [...selected, ...category, ...remaining].slice(0, 5);
}

function TrendIcon({ trend, rtl, title }: { trend: SpeciesInsight["trend"]; rtl: boolean; title: string }) {
  const icon = trend === "stable"
    ? <Minus className="h-4 w-4 text-orange-500" strokeWidth={2.5} />
    : trend === "up"
      ? rtl ? <ArrowUpLeft className="h-4 w-4 text-emerald-600" strokeWidth={2.5} /> : <ArrowUpRight className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
      : rtl ? <ArrowDownLeft className="h-4 w-4 text-rose-600" strokeWidth={2.5} /> : <ArrowDownRight className="h-4 w-4 text-rose-600" strokeWidth={2.5} />;
  return <span title={title}>{icon}</span>;
}

export function SpeciesInsightsTable({
  data,
  prioritySpecies,
  priorityCategory,
}: {
  data: Observation[];
  prioritySpecies: Set<string>;
  priorityCategory: TaxaGroupKey | null;
}) {
  const { lang } = useI18n();
  const rows = useMemo(
    () => getTopSpecies(data, prioritySpecies, priorityCategory),
    [data, prioritySpecies, priorityCategory]
  );

  return (
    <div className="h-full rounded-lg border bg-card shadow-sm">
      <table className="h-full w-full table-fixed text-xs">
        <thead className="h-8">
          <tr className="border-b bg-secondary/60 text-[10px] font-semibold text-muted-foreground">
            <th className="w-[30%] px-3 py-1 text-start">שם המין</th>
            <th className="w-[15%] px-2 py-1 text-center">מספר תצפיות</th>
            <th className="w-[20%] px-2 py-1 text-center">מגמה שנתית</th>
            <th className="w-[17%] px-2 py-1 text-center">דרגת מחקר</th>
            <th className="w-[18%] px-2 py-1 text-center">עונה פעילה</th>
          </tr>
        </thead>
        <tbody className="h-[calc(100%-2rem)]">
          {rows.map((row) => (
            <tr key={row.scientificName} className="h-1/5 border-b border-border/60 last:border-0 hover:bg-secondary/30">
              <td className="truncate px-3 py-1 align-middle text-start font-medium">{lang === "he" ? row.hebrewName : row.englishName}</td>
              <td className="px-2 py-1 text-center align-middle tabular-nums">{row.observations.toLocaleString()}</td>
              <td className="px-2 py-1 text-center align-middle"><span className="inline-flex items-center justify-center"><TrendIcon trend={row.trend} rtl={lang === "he"} title={row.annualBreakdown} /></span></td>
              <td className="px-2 py-1 text-center align-middle tabular-nums">{row.researchPct.toFixed(1)}%</td>
              <td className="px-2 py-1 text-center align-middle">{row.seasonalStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
