import type { Observation } from "./observations-store";
import { speciesCompletions } from "./species-completions-data";

const SOURCE_SHA256 = "458236338a35c2a8ae43a5724e5b031bcf720d02a66bed6a96d717d9ea4edf14";
const byName = new Map(speciesCompletions.map((entry) => [entry.Scientific_Name, entry]));
const aliases = new Map(
  speciesCompletions
    .filter((e) => e.existingScientificName)
    .map((e) => [e.existingScientificName!, e.Scientific_Name]),
);

/** Applies only to the reviewed October batch and its exact verified taxon ID. */
export function getObservationSpeciesCompletion(o: Observation) {
  const metadata = o.source_metadata;
  const v = metadata?.verification;
  const entry = byName.get(o.scientific_name);
  if (
    !entry ||
    o.source !== "inaturalist" ||
    metadata?.file_sha256 !== SOURCE_SHA256 ||
    !v ||
    o.composite_id !== `inat_${v.inaturalist_id}` ||
    metadata.values.originalRecordId !== v.uuid ||
    v.scientific_name !== o.scientific_name ||
    v.taxon_id !== entry.inaturalistTaxonId
  )
    return undefined;
  return entry;
}

/** Canonical choice/count key; never rewrites scientific_name on an observation. */
export function getObservationSpeciesKey(o: Observation): string {
  return (
    getObservationSpeciesCompletion(o)?.existingScientificName ??
    getProfessionalAlias(o) ??
    o.scientific_name
  );
}

// MERLIN already offers Lycaena thersamon as an identified species. Reuse that
// same choice/count identity, without changing any professional classification.
function getProfessionalAlias(o: Observation): string | undefined {
  const m = o.professional_metadata;
  if (
    o.source !== "merlin" ||
    !m ||
    m.taxonomy.isGeneric ||
    o.composite_id !== `expert_${m.values.composite_id.trim()}` ||
    o.scientific_name !== m.values.scientific_name.trim()
  )
    return undefined;
  return byName.get(o.scientific_name)?.existingScientificName;
}

export function matchesSpeciesSelection(o: Observation, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  const completion = getObservationSpeciesCompletion(o);
  if (completion) return !completion.isGeneric && selected.has(getObservationSpeciesKey(o));
  const professionalAlias = getProfessionalAlias(o);
  if (professionalAlias) return selected.has(professionalAlias);
  // Newly offered choices must not re-identify unreviewed historical records.
  if (byName.has(o.scientific_name)) return false;
  return selected.has(o.scientific_name);
}

/** One catalog choice can be found by either verified scientific synonym. */
export function getSpeciesSearchAlias(scientificName: string): string {
  return aliases.get(scientificName) ?? "";
}
