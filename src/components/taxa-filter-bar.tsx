/**
 * TaxaFilterBar — horizontal row of pill-style toggle buttons for the
 * 7 taxa groups (mammals, birds, butterflies, dragonflies, arthropods,
 * plants, other), used to filter the main Dashboard.
 *
 * What it does:
 *   - Toggles membership of a `TaxaGroupKey` in the shared
 *     `filters.taxa` set via `useObservations()`'s `setFilters`.
 *   - Renders each button with a fixed active/inactive color pair and a
 *     localized label via `translateTaxa`.
 *
 * Depends on: `@/lib/observations-store`, `@/lib/i18n`.
 * Called by: `@/components/dashboard.tsx`.
 */
import { useObservations, type TaxaGroupKey, translateTaxa } from "@/lib/observations-store";
import { useI18n } from "@/lib/i18n";

export function TaxaFilterBar() {
  const { filters, setFilters } = useObservations();
  const { lang } = useI18n();

  const toggleTaxa = (key: TaxaGroupKey) => {
    setFilters((prev) => {
      const next = new Set(prev.taxa);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, taxa: next };
    });
  };

  const taxaButtons = [
    { key: "mammals" as TaxaGroupKey, label: "יונקים", activeColor: "bg-purple-300 text-purple-900 border-purple-500 border-2 font-semibold", inactiveColor: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
    { key: "birds" as TaxaGroupKey, label: "עופות", activeColor: "bg-sky-300 text-sky-900 border-sky-500 border-2 font-semibold", inactiveColor: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
    { key: "butterflies" as TaxaGroupKey, label: "פרפרים", activeColor: "bg-orange-300 text-orange-900 border-orange-500 border-2 font-semibold", inactiveColor: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
    { key: "dragonflies" as TaxaGroupKey, label: "שפיראים", activeColor: "bg-teal-300 text-teal-900 border-teal-500 border-2 font-semibold", inactiveColor: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
    { key: "arthropods" as TaxaGroupKey, label: "פרוקי רגליים", activeColor: "bg-red-300 text-red-900 border-red-500 border-2 font-semibold", inactiveColor: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
    { key: "plants" as TaxaGroupKey, label: "צמחים", activeColor: "bg-lime-300 text-lime-900 border-lime-500 border-2 font-semibold", inactiveColor: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
    { key: "other" as TaxaGroupKey, label: "שאר המינים", activeColor: "bg-gray-300 text-gray-900 border-gray-500 border-2 font-semibold", inactiveColor: "bg-gray-50 text-gray-500 border-gray-300 font-normal hover:bg-gray-100" },
  ];

  return (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-hide">
      {taxaButtons.map(({ key, label, activeColor, inactiveColor }) => (
        <button
          key={key}
          type="button"
          onClick={() => toggleTaxa(key)}
          className={`shrink-0 inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-sm font-medium transition-all duration-200 ${
            filters.taxa.has(key) ? activeColor : inactiveColor
          }`}
        >
          {translateTaxa(label, lang)}
        </button>
      ))}
    </div>
  );
}
