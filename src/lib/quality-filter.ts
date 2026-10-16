/** Only confirmed quality values are selectable. Add future values here after
 * their data assignment and business definition have been agreed. */
export const QUALITY_OPTIONS = [
  { value: "research", labelKey: "researchOnly" },
  { value: "needs_id", labelKey: "needsId" },
  { value: "casual", labelKey: "casual" },
] as const;

export type QualityGrade = (typeof QUALITY_OPTIONS)[number]["value"];

export function createDefaultQualitySelection(): Set<QualityGrade> {
  return new Set(QUALITY_OPTIONS.map((option) => option.value));
}

/** An empty selection deliberately matches nothing. Unknown grades are excluded. */
export function matchesQualitySelection(
  observation: { quality_grade: string },
  selected: ReadonlySet<QualityGrade>,
): boolean {
  return QUALITY_OPTIONS.some(
    ({ value }) => value === observation.quality_grade && selected.has(value),
  );
}
