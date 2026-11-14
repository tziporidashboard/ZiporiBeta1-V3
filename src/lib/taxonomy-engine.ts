/**
 * taxonomy-engine.ts — Single Source of Truth for species taxonomy.
 *
 * Reads from:
 *   - species-map.ts (curated 1,977-entry dictionary)
 *   - species-registry.ts    (invasive | rare | other classification)
 *
 * Public API:
 *   getTaxonDetails(scientificName) → TaxonDetails
 *   getTaxonCategory(scientificName) → canonical Hebrew category string
 *   getTaxonStatus(scientificName)   → SpeciesStatus
 */

import { speciesMap, legacySpeciesMap, type SpeciesInfo } from "./species-map";
import { classifySpecies, type SpeciesStatus } from "./species-registry";

// ─── Canonical category keys (Hebrew labels used throughout the app) ──────────
export const CANONICAL_CATEGORIES = [
  "יונקים",
  "עופות",
  "פרפרים",
  "שפיראים",
  "פרוקי רגליים",
  "צמחים",
  "שאר המינים",
] as const;

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

// ─── Canonical result type ────────────────────────────────────────────────────
export type TaxonDetails = {
  /** Display name: Hebrew common name if available, else scientific name. */
  name: string;
  /** English display name for language toggle. */
  englishName: string;
  /** Canonical Hebrew category (e.g. "פרפרים", "עופות"). */
  category: CanonicalCategory;
  /** Invasive / rare / other classification. */
  status: SpeciesStatus;
  /** True if this observation is not identified to species level. */
  isGeneric: boolean;
};

export type { SpeciesInfo };

// ─── Build fast lookup map from unified species map ─────────────────────────
const _byScientificName = new Map<string, SpeciesInfo>(
  speciesMap.map((e) => [e.Scientific_Name.trim().toLowerCase(), e])
);
const legacyByName = new Map(legacySpeciesMap.map((e) => [e.Scientific_Name.trim().toLowerCase(), e]));

function normalizeCategory(raw: string | undefined): CanonicalCategory {
  if (!raw) return "שאר המינים";
  const trimmed = raw.trim();
  if ((CANONICAL_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed as CanonicalCategory;
  }
  return "שאר המינים";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the full canonical details for a species by scientific name.
 * Only the master species map is consulted; unknown species are returned as
 * "לא מזוהה" / "שאר המינים" / isGeneric=true.
 */
export function getTaxonDetails(
  scientificName: string,
  _iconicTaxon?: string,
  _commonName?: string,
  legacy = false,
): TaxonDetails {
  const key = (scientificName ?? "").trim().toLowerCase();
  const entry = (legacy ? legacyByName : _byScientificName).get(key);
  const status = classifySpecies(scientificName);

  if (!entry) {
    return {
      name: scientificName || "לא מזוהה",
      englishName: "",
      category: "שאר המינים",
      status,
      isGeneric: true,
    };
  }

  return {
    name: entry.Hebrew_Name && entry.Hebrew_Name !== "N/A" ? entry.Hebrew_Name : entry.Scientific_Name,
    englishName: entry.English_Name && entry.English_Name !== "N/A" ? entry.English_Name : "",
    category: normalizeCategory(entry.Category),
    status,
    isGeneric: entry.isGeneric ?? false,
  };
}

/**
 * Returns the canonical Hebrew category for a species.
 * Convenience wrapper around getTaxonDetails.
 */
export function getTaxonCategory(
  scientificName: string,
  _iconicTaxon?: string,
  _commonName?: string
): CanonicalCategory {
  return getTaxonDetails(scientificName).category;
}

/**
 * Returns the invasive/rare/other status for a scientific name.
 * Convenience wrapper — delegates directly to classifySpecies.
 */
export function getTaxonStatus(scientificName: string): SpeciesStatus {
  return classifySpecies(scientificName);
}

/** Preserve the classifications published before the scoped dictionary supplement. */
export function getLegacyTaxonDetails(scientificName: string): TaxonDetails {
  return getTaxonDetails(scientificName, undefined, undefined, true);
}

export function getLegacyTaxonCategory(scientificName: string, _iconicTaxon?: string, _commonName?: string): CanonicalCategory {
  return getLegacyTaxonDetails(scientificName).category;
}
