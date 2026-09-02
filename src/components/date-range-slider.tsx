/**
 * DateRangeSlider — dual-thumb date range slider built on Radix's Slider
 * primitive.
 *
 * What it does:
 *   - Renders a draggable min/max range (in epoch-ms) with monthly tick
 *     labels formatted via `Intl.DateTimeFormat` (locale-aware, he/en).
 *   - Optionally paints grey "gap masks" over the yellow selected-range
 *     track for any year that exists within the thumb range but is NOT
 *     present in `selectedYears` (used to visually reflect sparse year
 *     selections from the filter sidebar).
 *
 * Main pieces:
 *   - `gapMasks` (useMemo) — computes left%/width% overlays per excluded year.
 *   - `ticks` (useMemo)    — computes Jan/Jul tick positions per year in range.
 *
 * Depends on: `@radix-ui/react-slider`, `@/lib/i18n`.
 * Called by: `src/components/filter-sidebar.tsx` (or wherever a precise
 *   date-range control is needed alongside the year/month checkboxes).
 */
import { useCallback, useMemo } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { useI18n } from "@/lib/i18n";

type Props = {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** Selected year strings (e.g. "2023"). Years between the two thumbs but absent here get a grey mask painted over the yellow Range. */
  selectedYears?: Set<string>;
};

export function DateRangeSlider({ min, max, value, onChange, selectedYears }: Props) {
  const { lang } = useI18n();
  const locale = lang === "he" ? "he-IL" : "en-US";

  const tickFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );

  const handleChange = useCallback(
    (v: number[]) => {
      onChange([v[0], v[1]]);
    },
    [onChange],
  );

  // Compute mask overlays for deselected years strictly between the two slider thumbs
  const gapMasks = useMemo(() => {
    if (!selectedYears) return [];
    const [thumbStart, thumbEnd] = value;
    const totalRange = max - min;
    if (totalRange <= 0 || thumbStart >= thumbEnd) return [];
    const startYear = new Date(thumbStart).getFullYear();
    const endYear = new Date(thumbEnd).getFullYear();
    const masks: { left: number; width: number }[] = [];
    for (let y = startYear; y <= endYear; y++) {
      if (selectedYears.has(String(y))) continue;
      // Clamp to [thumbStart, thumbEnd] so mask never bleeds outside active range
      const maskStart = Math.max(new Date(y, 0, 1).getTime(), thumbStart);
      const maskEnd = Math.min(new Date(y, 11, 31, 23, 59, 59, 999).getTime(), thumbEnd);
      if (maskStart >= maskEnd) continue;
      const left = ((maskStart - min) / totalRange) * 100;
      const width = ((maskEnd - maskStart) / totalRange) * 100;
      masks.push({ left, width });
    }
    return masks;
  }, [min, max, value, selectedYears]);

  // Generate 6-month tick marks (Jan & Jul of each year in range)
  const ticks = useMemo(() => {
    const startYear = new Date(min).getFullYear();
    const endYear = new Date(max).getFullYear();
    const result: { label: string; pct: number }[] = [];
    const totalRange = max - min;
    if (totalRange <= 0) return result;
    for (let y = startYear; y <= endYear; y++) {
      for (const m of [0, 6]) {
        const ts = new Date(y, m, 1).getTime();
        if (ts < min || ts > max) continue;
        const pct = ((ts - min) / totalRange) * 100;
        result.push({ label: tickFormatter.format(new Date(ts)), pct });
      }
    }
    return result;
  }, [min, max, tickFormatter]);

  return (
    <div className="relative flex flex-col w-full px-8">
      <SliderPrimitive.Root
        dir="ltr"
        className="relative flex w-full touch-none select-none items-center"
        min={min}
        max={max}
        step={86400000}
        value={value}
        onValueChange={handleChange}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-gray-200">
          <SliderPrimitive.Range className="absolute h-full bg-yellow-400" />
          {gapMasks.map((mask, i) => (
            <div
              key={i}
              className="absolute h-full bg-gray-200 pointer-events-none"
              style={{ left: `${mask.left}%`, width: `${mask.width}%`, zIndex: 20 }}
            />
          ))}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-yellow-500 bg-white shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing" />
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-yellow-500 bg-white shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing" />
      </SliderPrimitive.Root>

      {/* Static 6-month tick labels */}
      <div className="relative w-full h-5 mt-1" dir="ltr">
        {ticks.map((tick) => (
          <span
            key={tick.pct}
            className="absolute text-xs font-semibold text-slate-700 -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${tick.pct}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
