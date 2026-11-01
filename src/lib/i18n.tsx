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
  exportCsv: { he: "ייצוא CSV", en: "Export CSV" },
  exportFilteredObservations: { he: "ייצוא תצפיות מסוננות", en: "Export filtered observations" },
  exportAllObservations: { he: "ייצוא כל התצפיות", en: "Export all observations" },
  dropOrClick: { he: "גרור קובץ או לחץ לבחירה", en: "Drag a file or click to select" },
  parsed: { he: "תצפיות נטענו", en: "observations loaded" },
  filters: { he: "מסננים", en: "Filters" },
  filterTip: {
    he: "טיפ: ניתן לסגור את חלונית המסננים ולפתוח אותה שוב בעת הצורך באמצעות התפריט.",
    en: "Tip: You can close the filters panel and reopen it anytime from the menu.",
  },
  restoredArea: { he: "אזור משוקם", en: "Restored Area" },
  nonRestoredArea: { he: "אזור לא משוקם", en: "Non-Restored Area" },
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
  needsId: { he: "דורש זיהוי", en: "Needs ID" },
  researchOnly: { he: "דרגת מחקר", en: "Research Grade" },
  casual: { he: "בסיסי", en: "Casual" },
  targetPop: { he: "מנטרים", en: "Target Population" },
  resetFilters: { he: "איפוס מסננים", en: "Reset Filters" },
  map: { he: "מפת תצפיות", en: "Observation Map" },
  polygonDraw: { he: "ציור אזור", en: "Draw area" },
  polygonReplace: { he: "ציור אזור חדש", en: "Draw new area" },
  polygonDrawing: { he: "מצב ציור פעיל", en: "Drawing area" },
  polygonFinish: { he: "סיום הציור", en: "Finish drawing" },
  polygonRemove: { he: "הסרת האזור", en: "Remove area" },
  polygonHint: { he: "אפשר לצייר אזור לסינון הדשבורד", en: "Draw an area to filter the dashboard" },
  polygonActive: { he: "הדשבורד מסונן לפי האזור שצויר", en: "Dashboard filtered by drawn area" },
  polygonInstructions: {
    he: "לחצו על 3 נקודות לפחות. לסיום לחצו על הנקודה הראשונה או על סיום הציור. Esc לביטול.",
    en: "Click at least 3 points. Click the first point or Finish drawing to close. Esc cancels.",
  },
  polygonInvalid: {
    he: "הצורה אינה תקינה. יש לסמן שטח ללא חציית קווים; נסו שוב או בטלו את הציור.",
    en: "Invalid shape. Draw an area without crossing edges; try again or cancel drawing.",
  },
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
  searchPeople: { he: "חיפוש אנשים...", en: "Search people..." },
  minimize: { he: "מזער", en: "Minimize" },
  speciesName: { he: "שם המין", en: "Species Name" },
  observationCount: { he: "מספר תצפיות", en: "Observations" },
  annualTrend: { he: "מגמה שנתית", en: "Annual Trend" },
  seasonalStatus: { he: "עונה פעילה", en: "Seasonal Status" },
  allCategories: { he: "כל הקטגוריות", en: "All Categories" },
  otherCategories: { he: "שאר הקטגוריות", en: "Other Categories" },
  monitoringArea: { he: "אזור ניטור", en: "Monitoring Area" },
  observationDetails: { he: "פרטי תצפית", en: "Observation Details" },
  close: { he: "סגור", en: "Close" },
  noObservationDetails: { he: "לא נמצאו פרטים עבור תצפית זו.", en: "No details found for this observation." },
  userName: { he: "שם משתמש", en: "User Name" },
  professionalObserver: { he: "מנטר מקצועי", en: "Professional Observer" },
  viewOnINaturalist: { he: "צפה ב-iNaturalist", en: "View on iNaturalist" },
};

const ENGLISH_SEASONAL_LABELS: Record<string, string> = {
  "יציב שנתית": "Stable Year-Round",
  "חורף": "Winter",
  "אביב": "Spring",
  "קיץ": "Summer",
  "סתיו": "Autumn",
};

export function translateSeasonalStatus(status: string, lang: Lang): string {
  return lang === "en" ? (ENGLISH_SEASONAL_LABELS[status] ?? status) : status;
}

export function getHebrewLabel(key: string): string {
  return dict[key]?.he ?? key;
}

export function getLabel(key: string, lang: Lang): string {
  return dict[key]?.[lang] ?? key;
}

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
