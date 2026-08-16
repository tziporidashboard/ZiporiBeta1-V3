/**
 * MetricsTable — summary statistics table broken down by contributor
 * group (expert / local_communities / student / online_communities).
 *
 * What it does:
 *   - `computeRow` aggregates a list of observations into: days
 *     monitoring (unique `observed_on` dates), total observations,
 *     research-grade quality %, distinct (non-generic) species count,
 *     invasive species count, rare species count, and monitoring rate
 *     (observations per monitoring day).
 *   - Groups the incoming `data` prop by `user_category` into the four
 *     canonical groups (falling back to `online_communities` when
 *     unset) and renders one row per group, always in a fixed order.
 *
 * Depends on: `@/lib/observations-store` (`Observation`,
 *   `translateGroupName`), `@/lib/species-registry` (`classifySpecies`),
 *   `@/lib/taxonomy-engine` (`getTaxonDetails`), `@/lib/i18n`.
 * Called by: `@/components/dashboard.tsx` (fed with the `metricsData`
 *   pipeline, which ignores the user-group filter).
 */
import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import type { Observation } from "@/lib/observations-store";
import { translateGroupName } from "@/lib/observations-store";
import { classifySpecies } from "@/lib/species-registry";
import { getTaxonDetails } from "@/lib/taxonomy-engine";

function computeRow(records: Observation[]) {
  const observations = records.length;
  if (observations === 0) {
    return {
      daysMonitoring: 0,
      observations: 0,
      qualityPct: 0,
      distinctSpecies: 0,
      invasiveSpecies: 0,
      rareSpecies: 0,
      monitoringRate: 0,
    };
  }
  // days monitoring: count unique observed_on dates
  const uniqueDates = new Set<string>();
  const species = new Set<string>();
  const invasiveSpeciesSet = new Set<string>();
  const rareSpeciesSet = new Set<string>();
  let research = 0;

  for (const r of records) {
    uniqueDates.add(r.observed_on);
    if (r.scientific_name) {
      if (!getTaxonDetails(r.scientific_name).isGeneric) {
        species.add(r.scientific_name);
      }
      const status = classifySpecies(r.scientific_name);
      if (status === "invasive") {
        invasiveSpeciesSet.add(r.scientific_name);
      }
      if (status === "rare") {
        rareSpeciesSet.add(r.scientific_name);
      }
    }
    if (r.quality_grade === "research") research++;
  }
  const daysMonitoring = uniqueDates.size;
  return {
    daysMonitoring,
    observations,
    qualityPct: (research / observations) * 100,
    distinctSpecies: species.size,
    invasiveSpecies: invasiveSpeciesSet.size,
    rareSpecies: rareSpeciesSet.size,
    monitoringRate: daysMonitoring > 0 ? observations / daysMonitoring : 0,
  };
}

export function MetricsTable({ data }: { data: Observation[] }) {
  const { t, lang } = useI18n();

  const rows = useMemo(() => {
    // Build a lookup of observations per user_category key from filtered data
    const grouped = new Map<string, Observation[]>();
    for (const o of data) {
      const category = o.user_category || "online_communities";
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category)!.push(o);
    }

    // Fixed canonical group list — rows always present regardless of data
    const CANONICAL_GROUPS: { raw: string; matchKeys: string[] }[] = [
      { raw: "expert", matchKeys: ["expert"] },
      { raw: "local_communities", matchKeys: ["local_communities"] },
      { raw: "student", matchKeys: ["student"] },
      { raw: "online_communities", matchKeys: ["online_communities"] },
    ];

    return CANONICAL_GROUPS.map(({ raw, matchKeys }) => {
      // Collect observations for all matching raw keys
      const obs: Observation[] = [];
      for (const key of matchKeys) {
        const bucket = grouped.get(key);
        if (bucket) obs.push(...bucket);
      }
      return {
        group: translateGroupName(raw, lang),
        rawGroup: raw,
        ...computeRow(obs),
      };
    });
  }, [data, lang]);

  return (
    <div className="overflow-hidden rounded border bg-card h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <table className="w-full h-full text-xs">
          <thead>
            <tr className="bg-secondary/50 text-[11px] uppercase tracking-wide text-muted-foreground border-b-2 border-gray-200">
              <th className="px-2 py-1 text-center font-semibold">{t("group")}</th>
              <th className="px-2 py-1 text-center font-semibold">{t("daysMonitoring")}</th>
              <th className="px-2 py-1 text-center font-semibold">{t("observations")}</th>
              <th className="px-2 py-1 text-center font-semibold">{t("monitoringRate")}</th>
              <th className="px-2 py-1 text-center font-semibold">{t("qualityPct")}</th>
              <th className="px-2 py-1 text-center font-semibold">{t("distinctSpecies")}</th>
              <th className="px-2 py-1 text-center font-semibold">{t("invasiveSpecies")}</th>
              <th className="px-2 py-1 text-center font-semibold">{t("rareSpecies")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group} className="border-b border-gray-100 hover:bg-secondary/30">
                <td className="px-2 py-1 font-medium text-xs text-center">{r.group}</td>
                <td className="px-2 py-1 text-center tabular-nums text-xs">
                  {r.daysMonitoring.toLocaleString()}
                </td>
                <td className="px-2 py-1 text-center tabular-nums text-xs">
                  {r.observations.toLocaleString()}
                </td>
                <td className="px-2 py-1 text-center tabular-nums text-xs">
                  {r.monitoringRate.toFixed(1)}
                </td>
                <td className="px-2 py-1 text-center tabular-nums text-xs">
                  {r.rawGroup === "expert" ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <span className="rounded bg-emerald-soft px-1.5 py-0.5 text-[color:var(--accent-foreground)] text-[10px]">
                      {r.qualityPct.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-center tabular-nums text-xs">
                  {r.distinctSpecies.toLocaleString()}
                </td>
                <td className="px-2 py-1 text-center tabular-nums text-xs">
                  {r.invasiveSpecies.toLocaleString()}
                </td>
                <td className="px-2 py-1 text-center tabular-nums text-xs">
                  {r.rareSpecies.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
