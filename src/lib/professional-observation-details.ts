import type { Observation } from "./observations-store";
import {
  getLegacyTaxonDetails,
  type TaxonDetails,
  type CanonicalCategory,
} from "./taxonomy-engine";
import { getObservationSpeciesCompletion } from "./observation-species-completions";

export type ProfessionalObservationMetadata = {
  file_name: string;
  file_sha256: string;
  csv_row: number;
  /** Literal export fields, including NULL and original whitespace. */
  values: Record<string, string>;
  taxonomy: TaxonDetails;
};

/** Source-scoped metadata must never override an iNaturalist observation. */
export function getProfessionalTaxonomy(o: Observation): TaxonDetails | undefined {
  const metadata = o.professional_metadata;
  if (
    o.source !== "merlin" ||
    !metadata ||
    o.composite_id !== `expert_${metadata.values.composite_id.trim()}` ||
    o.scientific_name !== metadata.values.scientific_name.trim()
  )
    return undefined;
  return metadata.taxonomy;
}

export function getObservationTaxonDetails(o: Observation): TaxonDetails {
  const professional = getProfessionalTaxonomy(o);
  if (professional) return professional;
  const legacy = getLegacyTaxonDetails(o.scientific_name);
  const completion = getObservationSpeciesCompletion(o);
  if (!completion) return legacy;
  return {
    name: completion.Hebrew_Name || completion.Scientific_Name,
    englishName: completion.English_Name,
    category: completion.Category as CanonicalCategory,
    isGeneric: completion.isGeneric,
    // The existing rare/invasive registry continues to decide status.
    status: legacy.status,
  };
}
