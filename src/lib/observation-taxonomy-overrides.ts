import type { Observation, TaxaGroupKey } from "./observations-store";

// Reviewed original IDs from the September 2026 additions only. Evidence and
// source rows: docs/observation-taxonomy-corrections.md. Never match by name alone.
const SOURCE_SHA256 = "f261a8c4abeed8909fee64a1947c76b7535e00177ee3381c258c5d56582df16d";
const reviewedTaxa = [
  {
    scientificName: "Ardea cinerea",
    group: "birds",
    ids: [
      "206446233",
      "233784595",
      "258717192",
      "258719777",
      "323250669",
      "326765189",
      "329804796",
      "331764857",
      "332709705",
      "333412856",
      "338042618",
      "338562405",
      "338680479",
      "338682227",
      "376451053",
      "378367967",
      "384470349",
    ],
  },
  {
    scientificName: "Milvus migrans",
    group: "birds",
    ids: [
      "248718564",
      "253732202",
      "253734539",
      "258225986",
      "259227022",
      "259314503",
      "259623222",
      "259623741",
      "259623802",
      "268881345",
      "316792764",
      "316792767",
      "316792768",
      "323969770",
      "324852267",
      "327481722",
      "327816580",
      "329889226",
      "334698926",
      "335228371",
      "335855393",
    ],
  },
  {
    scientificName: "Circus aeruginosus",
    group: "birds",
    ids: ["253734909", "259636780", "274066600"],
  },
  { scientificName: "Alectoris chukar", group: "birds", ids: ["389990426"] },
  { scientificName: "Motacilla cinerea", group: "birds", ids: ["395846621"] },
  // Vertebrata is a higher-level animal identification. Do not infer a class
  // (birds/mammals/etc.) or change its existing isGeneric flag/scientific name.
  { scientificName: "Vertebrata", group: "other", ids: ["401166224"] },
] as const;

const corrections: ReadonlyMap<string, { scientificName: string; group: TaxaGroupKey }> = new Map(
  reviewedTaxa.flatMap(({ scientificName, group, ids }) =>
    ids.map((id) => [`inat_${id}`, { scientificName, group }] as const),
  ),
);

/** Derived classification only; does not mutate observations or source metadata. */
export function getObservationTaxonomyOverride(observation: Observation): TaxaGroupKey | null {
  const metadata = observation.source_metadata;
  if (
    observation.source !== "inaturalist" ||
    !observation.composite_id ||
    metadata?.file_sha256 !== SOURCE_SHA256 ||
    observation.composite_id !== `inat_${metadata.values.originalRecordId}`
  ) {
    return null;
  }

  const correction = corrections.get(observation.composite_id);
  if (
    !correction ||
    observation.scientific_name !== correction.scientificName ||
    metadata.values.scientific_name !== correction.scientificName
  ) {
    return null;
  }
  return correction.group;
}
