import type { Observation } from "./observations-store";
import { getTaxonDetails, type TaxonDetails } from "./taxonomy-engine";

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
  return getProfessionalTaxonomy(o) ?? getTaxonDetails(o.scientific_name);
}
