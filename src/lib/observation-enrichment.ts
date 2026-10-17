import { inaturalistCommonNames } from "./inaturalist-common-name-enrichment-data";

/** Fill only approved, empty iNaturalist names; preserve every populated value. */
export function getInaturalistCommonName(
  originalId: string,
  existingName: string | null | undefined,
): string | undefined {
  if (existingName?.trim()) return existingName;
  const id = originalId.trim();
  return Object.hasOwn(inaturalistCommonNames, id) ? inaturalistCommonNames[id] : undefined;
}
