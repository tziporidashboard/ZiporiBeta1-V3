/**
 * i18n.tsx — lightweight Hebrew/English translation context (no external
 * i18n library).
 *
 * What it does:
 *   - `dict` — a flat `key -> { he, en }` translation table for all UI
 *     copy in the app.
 *   - `I18nProvider` — provides `{ t, lang, setLang }` via context;
 *     persists the selected `lang` (see implementation below for storage
 *     mechanism) and defaults to Hebrew, which also drives `dir="rtl"`.
 *   - `useI18n()` — hook consumed by nearly every component to read
 *     `t(key)` translations and the active `lang`.
 *
 * Called by: `@/src/routes/__root.tsx` (provider), and essentially every
 *   component under `@/src/components/` (consumer via `useI18n()`).
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "he" | "en";

type Dict = Record<string, { he: string; en: string }>;

const dict: Dict = {
  appTitle: { he: "מערכת ניטור אקולוגי", en: "Ecological Monitoring Platform" },
  dashboard: { he: "לוח בקרה", en: "Dashboard" },
  admin: { he: "ניהול", en: "Admin Panel" },
  language: { he: "English", en: "עברית" },
  uploadCsv: { he: "העלאת קובץ CSV", en: "Upload iNaturalist CSV" },
  dropOrClick: { he: "גרור קובץ או לחץ לבחירה", en: "Drag a file or click to select" },
  parsed: { he: "תצפיות נטענו", en: "observations loaded" },
  filters: { he: "מסננים", en: "Filters" },
  time: { he: "זמן", en: "Time" },
  years: { he: "שנים", en: "Years" },
  months: { he: "חודשים", en: "Months" },
  taxa: { he: "טקסונים", en: "Taxa" },
  quality: { he: "איכות", en: "Quality" },
  tg_mammals: { he: "יונקים", en: "Mammals" },
  tg_birds: { he: "עופות", en: "Birds" },
  tg_butterflies: { he: "פרפרים", en: "Butterflies" },
  tg_dragonflies: { he: "שפיראים", en: "Dragonflies" },
  tg_arthropods: { he: "פרוקי רגליים", en: "Arthropods" },
  tg_plants: { he: "צמחים", en: "Plants" },
  tg_other: { he: "שאר המינים", en: "Other Species" },
  researchOnly: { he: "דרגת מחקר", en: "Research Grade" },
  targetPop: { he: "מנטרים", en: "Target Population" },
  resetFilters: { he: "איפוס מסננים", en: "Reset Filters" },
  map: { he: "מפת תצפיות", en: "Observation Map" },
  metrics: { he: "מדדים מצרפיים", en: "Aggregation Metrics" },
  group: { he: "קבוצה", en: "Group" },
  daysMonitoring: { he: "ימי ניטור", en: "Days Monitoring" },
  observations: { he: "מס׳ תצפיות", en: "# Observations" },
  qualityPct: { he: "דרגת מחקר", en: "Research Grade" },
  distinctSpecies: { he: "סה״כ מינים", en: "Total Species" },
  invasiveSpecies: { he: "מינים פולשים", en: "Invasive Species" },
  rareSpecies: { he: "מינים נדירים", en: "Rare Species" },
  monitoringRate: { he: "קצב ניטור", en: "Monitoring Rate" },
  noData: { he: "אין נתונים. העלה קובץ CSV.", en: "No data yet. Upload a CSV file." },
  userGroups: { he: "קבוצות משתמשים", en: "User Groups" },
  rareDirectory: { he: "מינים נדירים", en: "Rare Species Directory" },
  taxonomicGroups: { he: "קבוצות טקסונומיות", en: "Taxonomic Groups" },
  userLogin: { he: "שם משתמש", en: "User Login" },
  groupName: { he: "קבוצה", en: "Group" },
  add: { he: "הוסף", en: "Add" },
  save: { he: "שמור", en: "Save" },
  cancel: { he: "ביטול", en: "Cancel" },
  edit: { he: "עריכה", en: "Edit" },
  delete: { he: "מחק", en: "Delete" },
  scientificName: { he: "שם מדעי", en: "Scientific Name" },
  notes: { he: "הערות", en: "Notes" },
  iconicTaxon: { he: "Iconic Taxon", en: "Iconic Taxon" },
  hebrewLabel: { he: "תווית עברית", en: "Hebrew Label" },
  englishLabel: { he: "תווית אנגלית", en: "English Label" },
  actions: { he: "פעולות", en: "Actions" },
  species: { he: "מין", en: "Species" },
  observer: { he: "מתצפת", en: "Observer" },
  date: { he: "תאריך", en: "Date" },
  qualityGrade: { he: "דרגת איכות", en: "Quality Grade" },
  general_public: { he: "קהל רחב", en: "General Public" },
  community: { he: "קהילה", en: "Community" },
  expert: { he: "ניטור מקצועי", en: "Professional Monitoring" },
  students: { he: "תלמידים", en: "Students" },
  professionals: { he: "אנשי מקצוע", en: "Professionals" },
  loading: { he: "טוען…", en: "Loading…" },
  confirmDelete: { he: "למחוק?", en: "Delete?" },
  totalRows: { he: "סך תצפיות מסוננות", en: "Filtered observations" },
  uniqueObservers: { he: "סה״כ מנטרים", en: "Total Monitors" },
  uniqueSpecies: { he: "סה״כ מינים", en: "Total Species" },
  unidentified: { he: "לא מזוהה", en: "Unidentified" },
  speciesType: { he: "סוג מין", en: "Species Type" },
  otherSpecies: { he: "שאר המינים", en: "Other Species" },
  areas: { he: "אזורים", en: "Areas" },
  monitoringAreas: { he: "אזורי ניטור", en: "Monitoring Areas" },
  overview: { he: "מבט על", en: "Overview" },
  deepDive: { he: "מינים", en: "Species" },
  people: { he: "אנשים", en: "People" },
  all: { he: "הכל", en: "All" },
  searchSpecies: { he: "חיפוש מינים...", en: "Search species..." },
};

const groupKeyMap: Record<string, keyof typeof dict> = {
  "General Public": "general_public",
  Community: "community",
  "Professional Monitoring": "expert",
  Students: "students",
  Professionals: "professionals",
};

type I18nCtx = {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  t: (k: keyof typeof dict) => string;
  groupLabel: (group: string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("he");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("eco_lang") as Lang | null;
    if (saved === "he" || saved === "en") setLangState(saved);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
    localStorage.setItem("eco_lang", lang);
  }, [lang]);

  const value = useMemo<I18nCtx>(() => ({
    lang,
    dir: lang === "he" ? "rtl" : "ltr",
    setLang: setLangState,
    t: (k) => dict[k]?.[lang] ?? String(k),
    groupLabel: (g) => {
      const key = groupKeyMap[g];
      return key ? dict[key][lang] : g;
    },
  }), [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be used within I18nProvider");
  return c;
}

export const USER_GROUPS = ["General Public", "Community", "Professional Monitoring", "Students", "Professionals"] as const;
