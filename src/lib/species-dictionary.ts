/**
 * species-dictionary.ts \u2014 thin O(1)-lookup wrapper over the raw
 * `speciesMap` array from `@/lib/species-map`.
 *
 * What it does:
 *   - Pre-builds `Map<scientific_name, SpeciesInfo>` lookups
 *     (`SPECIES_MAP`, `speciesDictionaryByScientificName`,
 *     `speciesInfoByScientificName` \u2014 all equivalent) so components
 *     don't re-scan the ~2,000-entry species array on every render.
 *   - Exposes convenience getters: `lookupSpecies`,
 *     `getSpeciesHebrewName`, `getSpeciesEnglishName`,
 *     `getSpeciesCategory`.
 *
 * Depends on: `@/lib/species-map`.
 * Called by: `@/components/deep-dive-time-series-chart.tsx`,
 *   `@/components/species-insights-table.tsx`, and other components
 *   needing a fast scientific-name -> display-name lookup.
 */
import { speciesMap, type SpeciesInfo } from "./species-map";

export type SpeciesDictionaryEntry = SpeciesInfo;

/**
 * O(1) lookup maps pre-populated from the unified speciesMap dictionary.
 */
export const speciesDictionaryByScientificName = new Map<string, SpeciesDictionaryEntry>(
  speciesMap.map((entry) => [entry.Scientific_Name, entry])
);

export const SPECIES_MAP = new Map<string, SpeciesInfo>(
  speciesMap.map((entry) => [entry.Scientific_Name, entry])
);

/**
 * Pre-built O(1) Map for species metadata lookups.
 */
export const speciesInfoByScientificName = new Map<string, SpeciesInfo>(SPECIES_MAP);

export function lookupSpecies(scientificName: string): SpeciesDictionaryEntry | undefined {
  return speciesInfoByScientificName.get(scientificName);
}

export function getSpeciesHebrewName(scientificName: string): string | undefined {
  return lookupSpecies(scientificName)?.Hebrew_Name;
}

export function getSpeciesEnglishName(scientificName: string): string | undefined {
  return lookupSpecies(scientificName)?.English_Name;
}

export function getSpeciesCategory(scientificName: string): string | undefined {
  return lookupSpecies(scientificName)?.Category;
}
