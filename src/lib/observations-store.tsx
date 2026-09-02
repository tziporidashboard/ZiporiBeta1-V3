/**
 * observations-store.tsx — global React context holding the entire
 * observation dataset, all dashboard filter state, and the "Species Deep
 * Dive" sub-state. This is the single source of truth consumed by every
 * view/component in `@/components/`.
 *
 * Data loading (client-only, runs once on mount inside `useEffect`,
 * skipped during SSR):
 *   1. Fetches `/user_groups.csv` — maps `user_login` -> raw group name.
 *   2. Fetches `/Until_June26.csv` — the main iNaturalist export; each
 *      row is parsed and joined with the user-group map to produce an
 *      `Observation` (see the `Observation` type below for the required
 *      columns: `observed_on`, `latitude`, `longitude`, `user_login`,
 *      `quality_grade`, `iconic_taxon_name`, `scientific_name`,
 *      `taxon_order_name`, `id`, `establishment_means`, `url`, etc.).
 *      Rows with unparseable dates or coordinates are dropped.
 *   3. Fetches `/MERLIN all observations for Zohar.csv` — expert-recorded
 *      observations (parsed via `parseMerlinRow`), merged with the
 *      iNaturalist rows into one combined `observations` array.
 *   4. Fetches `/monitoring-areas.geojson` (via
 *      `@/lib/monitoring-areas.ts`) and builds a per-observation
 *      monitoring-area membership index.
 *   5. Computes dataset-wide date bounds and initializes default filters
 *      (all years selected, all detected user groups selected, plus
 *      "expert" always included).
 *
 * Filter state (`Filters` type) covers: `dateRange`, `time`
 *   (year -> selected months), `taxa`, `groups`, `areas`,
 *   `monitoringAreas`, `speciesTypes`, `researchOnly`.
 *
 * Exports: `ObservationsProvider`, `useObservations()`, the `Observation`
 *   type, and taxa/species/group classification + translation helpers
 *   (`getTaxaGroup`, `getSpeciesClassification`, `translateGroupName`,
 *   `translateMonth`, `translateSpeciesName`, `translateTaxa`,
 *   `TAXA_GROUP_KEYS`, `TaxaGroupKey`, `REA_SHAISH_NAME`).
 *
 * Depends on: `papaparse`, `@/lib/survey-polygons`,
 *   `@/lib/species-dictionary`, `@/lib/taxonomy-engine`,
 *   `@/lib/monitoring-areas`.
 * Called by: `@/src/routes/__root.tsx` (wraps the app in
 *   `ObservationsProvider`), and every component that calls
 *   `useObservations()`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import Papa from "papaparse";
import type { SurveyAreaKey } from "./survey-polygons";
import { SURVEY_AREA_KEYS } from "./survey-polygons";
import { getSpeciesHebrewName } from "./species-dictionary";
import { getTaxonCategory, getTaxonStatus } from "./taxonomy-engine";
import {
  buildObservationMonitoringAreaIndex,
  loadMonitoringAreas,
  type MonitoringAreasGeoJson,
  type ObservationMonitoringAreaIndex,
} from "./monitoring-areas";
export type { SurveyAreaKey };

export type Observation = {
  observed_on: string; // YYYY-MM-DD
  latitude: number;
  longitude: number;
  user_login: string;
  quality_grade: string;
  iconic_taxon_name: string;
  scientific_name: string;
  common_name?: string;
  taxon_order_name: string;
  user_category: string; // supergroup used by global metrics/charts/filters
  user_subcategory: string; // raw/original group used by the People view
  establishment_means?: string;
  composite_id?: string;
  source?: "merlin" | "inaturalist";
  source_url?: string;
};

// Group name translations (Hebrew -> English for language toggle)
const GROUP_TRANSLATIONS: Record<string, { he: string; en: string }> = {
  online_communities: { he: "קהילות מקוונות", en: "Online Communities" },
  local_communities: { he: "קהילות מקומיות", en: "Local Communities" },
  תלמידים: { he: "תלמידים", en: "Students" },
  סטודנטים: { he: "תלמידים", en: "Students" },
  student: { he: "תלמידים", en: "Students" },
  expert: { he: "ניטור מקצועי", en: "Professional Monitoring" },
  professional: { he: "אנשי מקצוע", en: "Professionals" },
  mechnistim: { he: "מכניסטים", en: "Mechnistim" },
  zevulun: { he: "זבולון", en: "Zevulun" },
  yizrael: { he: "יזרעאל", en: "Yizrael" },
};

// Maps raw CSV group values to the four UI category keys
const CATEGORY_MAP: Record<string, string> = {
  expert: "expert",
  student: "local_communities",
  mechnistim: "local_communities",
  zevulun: "local_communities",
  yizrael: "local_communities",
  community: "online_communities",
  "קהילות מקוונות": "online_communities",
};

const ODONATA_FAMILIES = new Set([
  "Libellulidae",
  "Coenagrionidae",
  "Platycnemididae",
  "Aeshnidae",
  "Calopterygidae",
  "Lestidae",
]);

export const REA_SHAISH_NAME = "רע שיש";

function getSupergroup(rawGroup: string): string {
  return CATEGORY_MAP[rawGroup] || rawGroup;
}

// Species name translations (Scientific names -> Hebrew common names)
const SPECIES_TRANSLATIONS: Record<string, string> = {
  // Add common species translations as needed
  "Passer domesticus": "דרור הבית",
  "Columba livia": "יונת הבית",
  "Hirundo rustica": "סנונית הרפתות",
  "Mus musculus": "עכבר הבית",
  "Rattus norvegicus": "חולד חום",
  "Papilio machaon": "פרפר הזנב הנץ",
  "Vanessa cardui": "פרפר הצלע",
  "Pieris rapae": "פרפר הכרוב",
  "Danaus plexippus": "מלך הפרפרים",
};

// Taxa translations (Hebrew -> English for language toggle)
const TAXA_TRANSLATIONS: Record<string, { he: string; en: string }> = {
  יונקים: { he: "יונקים", en: "Mammals" },
  עופות: { he: "עופות", en: "Birds" },
  פרפרים: { he: "פרפרים", en: "Butterflies" },
  שפיראים: { he: "שפיראים", en: "Dragonflies" },
  "פרוקי רגליים": { he: "פרוקי רגליים", en: "Arthropods" },
  צמחים: { he: "צמחים", en: "Plants" },
  "שאר המינים": { he: "שאר המינים", en: "Other Species" },
};

// Month translations (1-12 -> Hebrew/English)
const MONTH_TRANSLATIONS: Record<number, { he: string; en: string }> = {
  1: { he: "ינואר", en: "Jan" },
  2: { he: "פברואר", en: "Feb" },
  3: { he: "מרץ", en: "Mar" },
  4: { he: "אפריל", en: "Apr" },
  5: { he: "מאי", en: "May" },
  6: { he: "יוני", en: "Jun" },
  7: { he: "יולי", en: "Jul" },
  8: { he: "אוגוסט", en: "Aug" },
  9: { he: "ספטמבר", en: "Sep" },
  10: { he: "אוקטובר", en: "Oct" },
  11: { he: "נובמבר", en: "Nov" },
  12: { he: "דצמבר", en: "Dec" },
};

export function translateGroupName(group: string, lang: "he" | "en" = "he"): string {
  const translation = GROUP_TRANSLATIONS[group];
  if (translation) {
    return translation[lang];
  }
  // If no translation found, return original
  return group;
}

export function translateSpeciesName(scientificName: string): string {
  return (
    SPECIES_TRANSLATIONS[scientificName] || getSpeciesHebrewName(scientificName) || scientificName
  );
}

export function translateTaxa(taxa: string, lang: "he" | "en" = "he"): string {
  const translation = TAXA_TRANSLATIONS[taxa];
  if (translation) {
    return translation[lang];
  }
  return taxa;
}

export function translateMonth(monthNum: number, lang: "he" | "en" = "he"): string {
  const translation = MONTH_TRANSLATIONS[monthNum];
  if (translation) {
    return translation[lang];
  }
  return monthNum.toString();
}

/**
 * Parse observation dates from either:
 * - Tzipori format: DD/MM/YYYY or DD/MM/YYYY HH:mm
 * - Merlin format: M/D/YYYY or M/D/YYYY H:mm
 * Normalizes to DD/MM/YYYY (the internal format used by the rest of the app).
 * Returns empty string if unparseable.
 */
function parseObservedOn(value: string): string {
  const raw = (value || "").trim();
  if (!raw) return "";

  // Strip time portion if present
  const datePart = raw.split(/\s+/)[0];
  const isoMatch = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }

  const parts = datePart.split("/");
  if (parts.length !== 3) return "";

  const first = parseInt(parts[0], 10);
  const second = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(first) || isNaN(second) || isNaN(year)) return "";

  let day: number;
  let month: number;

  if (second > 12) {
    // Second component cannot be a month: must be Merlin M/D/YYYY
    month = first;
    day = second;
  } else if (first > 12) {
    // First component cannot be a month: must be Tzipori DD/MM/YYYY
    day = first;
    month = second;
  } else if (parts[1].length === 2 && parts[1].startsWith("0")) {
    // Zero-padded month in second position: Tzipori DD/MM/YYYY
    day = first;
    month = second;
  } else {
    // Both components could be month/day. Merlin does not zero-pad months,
    // so a non-padded second part is most likely Merlin's M/D/YYYY.
    month = first;
    day = second;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return "";

  const d = String(day).padStart(2, "0");
  const m = String(month).padStart(2, "0");
  return `${d}/${m}/${year}`;
}

function parseMerlinRow(row: Record<string, string>, index: number): Observation | null {
  const lat = parseFloat((row.decimalLatitudeStart || "").trim());
  const lon = parseFloat((row.decimalLongitudeStart || "").trim());
  const observedOn = parseObservedOn(row.timeStamp || "");

  if (!observedOn || isNaN(lat) || isNaN(lon)) return null;

  const family = (row.family || "").trim();
  const isOdonata = ODONATA_FAMILIES.has(family);
  const userLogin = isOdonata
    ? REA_SHAISH_NAME
    : (row.personName || row.recordedBy || row.eMail || "").trim();
  if (!userLogin) return null;
  const birdFamilies = [
    "Columbidae",
    "Ardeidae",
    "Corvidae",
    "Cisticolidae",
    "Charadriidae",
    "Alcedinidae",
    "Hirundinidae",
    "Paridae",
    "Pycnonotidae",
    "Sylviidae",
    "Fringillidae",
    "Acrocephalidae",
    "Phasianidae",
    "Turdidae",
    "Accipitridae",
    "Cuculidae",
    "Laniidae",
    "Motacillidae",
    "Meropidae",
    "Nectariniidae",
  ];
  let iconicTaxon = "";
  if (["Hesperiidae", "Pieridae", "Lycaenidae", "Papilionidae", "Nymphalidae"].includes(family)) {
    iconicTaxon = "Insecta";
  } else if (
    ["Canidae", "Mustelidae", "Hystricidae", "Herpestidae", "Leporidae", "Suidae"].includes(family)
  ) {
    iconicTaxon = "Mammalia";
  } else if (birdFamilies.includes(family)) {
    iconicTaxon = "Aves";
  }

  const observationId = (row.observationID || "").trim();
  const compositeId = observationId ? `expert_${observationId}` : `expert_${index}`;

  return {
    observed_on: observedOn,
    latitude: lat,
    longitude: lon,
    user_login: userLogin,
    quality_grade: "research",
    iconic_taxon_name: iconicTaxon,
    scientific_name: (row.scientificName || "").trim(),
    common_name: (row.vernacularName || "").trim() || undefined,
    taxon_order_name: family,
    user_category: "expert",
    user_subcategory: "expert",
    composite_id: compositeId,
    source: "merlin",
  };
}

export const TAXA_GROUP_KEYS = [
  "mammals",
  "birds",
  "butterflies",
  "dragonflies",
  "arthropods",
  "plants",
  "other",
] as const;
export type TaxaGroupKey = (typeof TAXA_GROUP_KEYS)[number];

/** Maps the Hebrew tab label used in special-species lists to the internal TaxaGroupKey. */
const TAB_LABEL_TO_GROUP: Record<string, TaxaGroupKey> = {
  יונקים: "mammals",
  עופות: "birds",
  פרפרים: "butterflies",
  שפיראים: "dragonflies",
  "פרוקי רגליים": "arthropods",
  צמחים: "plants",
  "שאר המינים": "other",
};

/** Map an observation to one of our high-level dashboard groups.
 *  1. Look up the scientific_name via the taxonomy engine (unified dictionary).
 *  2. If not found, fall back to iconic_taxon_name (Aves/Mammalia → birds/mammals).
 *  3. Default → "other".
 */
export function getTaxaGroup(o: Observation): TaxaGroupKey {
  const sci = o.scientific_name;

  // 1. Taxonomy engine lookup (uses iconic_taxon_name + common_name for fallbacks)
  if (sci) {
    const category = getTaxonCategory(sci, o.iconic_taxon_name, o.common_name);
    if (category !== "שאר המינים") {
      return TAB_LABEL_TO_GROUP[category] ?? "other";
    }
  }

  // 2. Fallback taxonomy — strict elimination order to prevent double-counting.
  //    Butterflies and dragonflies are checked via dictionary lookup (step 1) first;
  //    Insecta/Arachnida only catches remaining arthropods after those are eliminated.
  if (ODONATA_FAMILIES.has(o.taxon_order_name)) return "dragonflies";
  const iconic = o.iconic_taxon_name;
  if (iconic === "Insecta" || iconic === "Arachnida") return "arthropods";
  if (iconic === "Plantae") return "plants";
  if (iconic === "Mammalia") return "mammals";
  if (iconic === "Aves") return "birds";

  // 3. Default
  return "other";
}

/** Classify an observation as invasive, rare, or other_species using the taxonomy engine.
 *  Any species not listed in the registry defaults to other_species.
 */
export function getSpeciesClassification(o: Observation): string {
  const status = getTaxonStatus(o.scientific_name);
  return status === "other" ? "other_species" : status;
}

/** time: year -> set of months. Empty set means "all months of that year". */
export type Filters = {
  time: Map<string, Set<string>>;
  taxa: Set<TaxaGroupKey>;
  groups: Set<string>;
  localCommunitySubgroups: Set<string>;
  researchOnly: boolean;
  /** Empty set = no area filter (show all). Non-empty = only show observations inside selected areas. */
  areas: Set<SurveyAreaKey>;
  /** Empty set = no species type filter. Non-empty = only show observations matching selected species types. */
  speciesTypes: Set<string>;
  monitoringAreas: Set<string>;
  /** Date range filter: timestamps (ms). null = not initialised yet. */
  dateRange: { start: number; end: number } | null;
};

export type DeepDiveState = {
  category: string | null;
  species: Set<string>;
  search: string;
};

type DeepDiveActions = {
  setDeepDiveCategory: (category: string | null) => void;
  toggleDeepDiveSpecies: (scientificName: string) => void;
  clearDeepDiveSpecies: () => void;
  setDeepDiveSearch: (query: string) => void;
};

type ObserverStats = {
  user_login: string;
  totalObservations: number;
  user_category: string; // supergroup
  user_subcategory: string; // raw group
};

type Ctx = {
  observations: Observation[];
  setObservations: (o: Observation[]) => void;
  filters: Filters;
  setFilters: (f: Filters | ((prev: Filters) => Filters)) => void;
  toggleSpeciesType: (type: string) => void;
  setDateRange: (start: number, end: number) => void;
  /** Absolute bounds of the loaded dataset (min/max timestamps). null until data loads. */
  datasetBounds: { start: number; end: number } | null;
  deepDive: DeepDiveState;
  deepDiveActions: DeepDiveActions;
  /** Incremented by the global Reset button; components can watch this to reset local state. */
  resetVersion: number;
  bumpResetVersion: () => void;
  /** Total observations per user_login, calculated from the loaded dataset. */
  userObservationCounts: Map<string, number>;
  /** Per-user stats sorted by totalObservations descending (handy for leaderboards). */
  observerStats: ObserverStats[];
  monitoringAreas: MonitoringAreasGeoJson | null;
  observationMonitoringAreaIndex: ObservationMonitoringAreaIndex;
};

const ObservationsCtx = createContext<Ctx | null>(null);

export function ObservationsProvider({ children }: { children: ReactNode }) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [filters, setFilters] = useState<Filters>({
    time: new Map(),
    taxa: new Set([
      "mammals",
      "birds",
      "butterflies",
      "dragonflies",
      "arthropods",
      "plants",
      "other",
    ]),
    groups: new Set(),
    localCommunitySubgroups: new Set(["yizrael", "zevulun", "student", "mechnistim"]),
    researchOnly: false,
    areas: new Set<SurveyAreaKey>(SURVEY_AREA_KEYS),
    speciesTypes: new Set(["invasive", "rare", "other_species"]),
    monitoringAreas: new Set(),
    dateRange: null,
  });
  const [monitoringAreas, setMonitoringAreas] = useState<MonitoringAreasGeoJson | null>(null);

  /** Absolute min/max timestamps of the whole dataset. Set once on data load. */
  const [datasetBounds, setDatasetBounds] = useState<{ start: number; end: number } | null>(null);

  /** Total observations per user_login. Set once on data load. */
  const [userObservationCounts, setUserObservationCounts] = useState<Map<string, number>>(
    new Map(),
  );
  /** Per-user stats sorted by activity. Set once on data load. */
  const [observerStats, setObserverStats] = useState<ObserverStats[]>([]);
  const observationMonitoringAreaIndex = useMemo(
    () => buildObservationMonitoringAreaIndex(observations, monitoringAreas),
    [observations, monitoringAreas],
  );

  // Shared reset signal used by the global Reset button
  const [resetVersion, setResetVersion] = useState(0);
  const bumpResetVersion = useCallback(() => setResetVersion((v) => v + 1), []);

  // Deep Dive isolated state
  const [deepDive, setDeepDive] = useState<DeepDiveState>({
    category: null,
    species: new Set(),
    search: "",
  });

  const toggleSpeciesType = useCallback((type: string) => {
    setFilters((prev) => {
      const next = new Set(prev.speciesTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, speciesTypes: next };
    });
  }, []);

  /** Slider moved → update dateRange AND sync year checkboxes. */
  const setDateRange = useCallback((start: number, end: number) => {
    setFilters((prev) => {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const nextTime = new Map<string, Set<string>>();
      for (let y = startYear; y <= endYear; y++) {
        nextTime.set(String(y), new Set());
      }
      return { ...prev, dateRange: { start, end }, time: nextTime };
    });
  }, []);

  const deepDiveActions = useMemo<DeepDiveActions>(
    () => ({
      setDeepDiveCategory: (category) => setDeepDive({ category, species: new Set(), search: "" }),
      toggleDeepDiveSpecies: (scientificName) =>
        setDeepDive((prev) => {
          const next = new Set(prev.species);
          if (next.has(scientificName)) next.delete(scientificName);
          else next.add(scientificName);
          return { ...prev, species: next };
        }),
      clearDeepDiveSpecies: () => setDeepDive((prev) => ({ ...prev, species: new Set() })),
      setDeepDiveSearch: (query) => setDeepDive((prev) => ({ ...prev, search: query })),
    }),
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    loadMonitoringAreas()
      .then((areas) => {
        setMonitoringAreas(areas);
        setFilters((prev) => ({
          ...prev,
          monitoringAreas: new Set(areas.features.map((feature) => feature.properties.id)),
        }));
      })
      .catch((error) => {
        console.error("Error loading monitoring areas:", error);
      });
  }, []);

  useEffect(() => {
    // Skip data loading during SSR
    if (typeof window === "undefined") return;

    const loadData = async () => {
      try {
        // Load user groups CSV
        const userGroupsResponse = await fetch("/user_groups.csv");
        const userGroupsText = await userGroupsResponse.text();
        const userGroupsData = Papa.parse<Record<string, string>>(userGroupsText, {
          header: true,
          skipEmptyLines: true,
        }).data;

        const userGroupMap = new Map<string, string>(
          userGroupsData.map((row) => [row.user_login, row.group]),
        );

        // Load main observations CSV
        const observationsResponse = await fetch("/Until_June26.csv");
        const observationsText = await observationsResponse.text();
        const observationsData = Papa.parse<Record<string, string>>(observationsText, {
          header: true,
          skipEmptyLines: true,
        }).data;

        // Join data: add user_category to each observation
        const tziporiObservations: Observation[] = observationsData
          .map((row) => {
            const lat = parseFloat((row.latitude || "").trim());
            const lon = parseFloat((row.longitude || "").trim());
            const observedOn = parseObservedOn(row.observed_on || "");

            if (!observedOn || isNaN(lat) || isNaN(lon)) return null;

            const userLogin = (row.user_login || "").trim();
            const rawCategory = userGroupMap.get(userLogin) || "קהילות מקוונות";
            const userCategory = getSupergroup(rawCategory);
            const userSubcategory = rawCategory;

            const inatId = (row.id || "").trim();

            const observation: Observation = {
              observed_on: observedOn,
              latitude: lat,
              longitude: lon,
              user_login: userLogin,
              quality_grade: (row.quality_grade || "").trim().toLowerCase(),
              iconic_taxon_name: (row.iconic_taxon_name || "").trim(),
              scientific_name: (row.scientific_name || "").trim(),
              common_name: (row.common_name || "").trim() || undefined,
              taxon_order_name: (row.taxon_order_name || "").trim(),
              user_category: userCategory,
              user_subcategory: userSubcategory,
              establishment_means:
                (row.establishment_means || "").trim().toLowerCase() || undefined,
              composite_id: inatId ? `inat_${inatId}` : undefined,
              source: "inaturalist",
              source_url: row.url,
            };
            return observation;
          })
          .filter((obs): obs is Observation => obs !== null);

        // Load Merlin expert observations CSV
        const merlinResponse = await fetch("/MERLIN all observations for Zohar.csv");
        const merlinText = await merlinResponse.text();
        const merlinData = Papa.parse<Record<string, string>>(merlinText, {
          header: true,
          skipEmptyLines: true,
        }).data;

        const merlinObservations: Observation[] = merlinData
          .map((row, index) => parseMerlinRow(row, index))
          .filter((obs): obs is Observation => obs !== null);
        console.log("Loaded MERLIN observations:", merlinObservations.length);

        const joinedObservations = [...tziporiObservations, ...merlinObservations];
        setObservations(joinedObservations);

        // Build per-user observation counts and metadata for leaderboards
        const counts = new Map<string, number>();
        const userMeta = new Map<string, { user_category: string; user_subcategory: string }>();
        for (const obs of joinedObservations) {
          const u = obs.user_login;
          counts.set(u, (counts.get(u) || 0) + 1);
          if (!userMeta.has(u)) {
            userMeta.set(u, {
              user_category: obs.user_category,
              user_subcategory: obs.user_subcategory,
            });
          }
        }
        const stats = Array.from(counts.entries())
          .map(([user_login, totalObservations]) => ({
            user_login,
            totalObservations,
            ...userMeta.get(user_login)!,
          }))
          .sort((a, b) => b.totalObservations - a.totalObservations);
        setUserObservationCounts(counts);
        setObserverStats(stats);

        // Compute absolute dataset date bounds and initialise default filters
        let minTs = Infinity;
        let maxTs = -Infinity;
        const yearsInData = new Set<string>();
        const groupsInData = new Set<string>();
        for (const obs of joinedObservations) {
          const d = obs.observed_on;
          if (!d || d.length < 10) continue;
          const parts = d.split("/");
          if (parts.length !== 3) continue;
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1; // JS months 0-indexed
          const year = parseInt(parts[2], 10);
          if (isNaN(day) || isNaN(month) || isNaN(year)) continue;
          const ts = new Date(year, month, day).getTime();
          if (ts < minTs) minTs = ts;
          if (ts > maxTs) maxTs = ts;
          yearsInData.add(parts[2]);
          if (obs.user_category) groupsInData.add(obs.user_category);
        }

        if (minTs !== Infinity) {
          const startYear = new Date(minTs).getFullYear();
          const endYear = new Date(maxTs).getFullYear();
          const boundsStart = new Date(startYear, 0, 1).getTime();
          const boundsEnd = new Date(endYear, 11, 31, 23, 59, 59, 999).getTime();
          setDatasetBounds({ start: boundsStart, end: boundsEnd });

          // Default: all years checked, dateRange spans full dataset
          const defaultTime = new Map<string, Set<string>>();
          for (const y of yearsInData) {
            defaultTime.set(y, new Set());
          }
          groupsInData.add("expert"); // Always include Professional Monitoring
          setFilters((prev) => ({
            ...prev,
            time: defaultTime,
            dateRange: { start: boundsStart, end: boundsEnd },
            groups: new Set(groupsInData),
          }));
        }
      } catch (error) {
        console.error("Error loading data:", error);
      }
    };

    loadData();
  }, []);

  const value = useMemo(
    () => ({
      observations,
      setObservations,
      filters,
      setFilters,
      toggleSpeciesType,
      setDateRange,
      datasetBounds,
      deepDive,
      deepDiveActions,
      resetVersion,
      bumpResetVersion,
      userObservationCounts,
      observerStats,
      monitoringAreas,
      observationMonitoringAreaIndex,
    }),
    [
      observations,
      filters,
      toggleSpeciesType,
      setDateRange,
      datasetBounds,
      deepDive,
      deepDiveActions,
      resetVersion,
      bumpResetVersion,
      userObservationCounts,
      observerStats,
      monitoringAreas,
      observationMonitoringAreaIndex,
    ],
  );
  return <ObservationsCtx.Provider value={value}>{children}</ObservationsCtx.Provider>;
}

export function useObservations() {
  const c = useContext(ObservationsCtx);
  if (!c) throw new Error("useObservations must be used within ObservationsProvider");
  return c;
}
