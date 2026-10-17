# תיקון טקסונומי נקודתי לתוספות ספטמבר 2026 — מקומי בלבד

תאריך אימות: 17/10/2026. מאגר: ZiporiDashboard-Gal-Dev.

## תוצאה וגבולות

אומתו ותוקנו 44 מתוך 418 פערי הסיווג שנמצאו ב־979 התוספות:
43 תצפיות עופות עברו מפרוקי רגליים לעופות; תצפית Vertebrata אחת עברה מצמחים לשאר המינים.
אין רשומות לא פתורות בתוך קבוצה זו של 44. לא שונו 374 הפערים האחרים.

תיקון הקבוצה אינו אימות מחודש של הזיהוי הביולוגי מתוך צילום: הוא תיקון שיוך הקבוצה של השם המדעי הקיים,
באמצעות מקורות טקסונומיים חיצוניים ולא על סמך ערכי Excel בלבד.

## ראיות ביולוגיות

| שם מדעי | תוספות מתוקנות | תצפיות היסטוריות באותו שם שנשארו ללא שינוי | ראיה וקבוצת יעד קיימת |
|---|---:|---:|---|
| Ardea cinerea | 17 | 6 | [AEWA, Class Aves](https://www.unep-aewa.org/species/ardea-cinerea) — עופות |
| Milvus migrans | 21 | 3 | [NCBI, lineage Aves](https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=52810&mode=Info) — עופות |
| Circus aeruginosus | 3 | 4 | [GBIF, class Aves](https://www.gbif.org/fr/species/2480482) — עופות |
| Alectoris chukar | 1 | 8 | [CNCB/NGDC Genome Warehouse, lineage Aves](https://ngdc.cncb.ac.cn/gwh/Genome/1437/show) — עופות |
| Motacilla cinerea | 1 | 1 | [NCBI, lineage Aves](https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=56325&mode=Info) — עופות |
| Vertebrata | 1 | 250 | [NCBI, animal lineage Metazoa/Chordata](https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=7742&mode=Info) — שאר המינים |

Vertebrata הוא זיהוי ברמה גבוהה הכולל כמה קבוצות בעלי חוליות. אין מידע המצדיק שיוך ליונקים או לעופות.
הקבוצה הקיימת ״שאר המינים״ מתאימה לרמת הידע; השם המדעי ו־isGeneric=true נשמרו.
לא הומצאה קטגוריה חדשה ולא שונה סטטוס פולש/נדיר.

## מנגנון התיקון

- קובץ צדדי observation-taxonomy-overrides.ts מכיל רשימת 44 מזהים מקוריים שנבדקו, עם השם המדעי הצפוי והקבוצה.
- החלה מותנית בו־זמנית במקור inaturalist, במזהה inat_<originalRecordId>, בהתאמת מזהה המקור,
  בחותמת SHA-256 המדויקת של קובץ Excel שנבדק ובשם המדעי הזהה בתצפית ובמטא־נתונים.
- getTaxaGroup מחזיר את התיקון לפני בדיקת המילון; לכל תצפית אחרת נשמר מסלול הסיווג הקודם.
- זהו ערך מחושב בלבד. אובייקטי התצפיות, נתוני Excel המקוריים, המילונים ומנגנון הייבוא אינם משתנים.
- תצפית בעלת אותו שם בלבד, מקור אחר, מזהה אחר, חותמת אחרת או ללא מטא־נתוני התוספות אינה מקבלת תיקון.
- אין תלות בקובץ Excel המקומי בזמן ריצה.

## עקביות בתצוגות

מסנני הדשבורד, People, Species, מונים, תרשימים וייצוא CSV כבר משתמשים ב־getTaxaGroup.

שני מסלולים במסך המינים דרשו התאמה:
1. רשימת המינים מוסיפה את קבוצת העופות לחמשת השמות המתוקנים לפי התצפיות המאומתות בלבד;
   הבחירות ההיסטוריות נשמרות. ב״כל הקבוצות״ כל שם מופיע פעם אחת.
2. טבלת המינים מסננת כל תצפית לפי הקבוצה הפעילה לפני איגוד לפי שם.
   כך בחירה בעופות סופרת רק את הרשומות המתוקנות, ובחירה בפרוקי רגליים שומרת את הרשומות ההיסטוריות.
   ללא קבוצה פעילה הספירה הכוללת לפי שם נשמרת.
   השינוי הנלווה המכוון: הטבלה מציגה עד חמישה מינים בתוך הקבוצה הפעילה, ולא משלימה מינים מקבוצות אחרות.

קיבוץ בועות במפה מפריד רק את 44 הרשומות המתוקנות, כדי שצבע של תצפית היסטורית לא יקבע צבע של תוספת מתוקנת
באותו שם, תאריך ומיקום מעוגל. קיבוץ 13,609 הרשומות האחרות נשמר בדיוק; פרטי כל התצפיות נשמרים לפי המזהים המקוריים.
הסיווג הכללי של Vertebrata נשאר generic, ולכן אינו נספר כמין מזוהה.

## ספירות לאחר התיקון

| קבוצה | 12,674 היסטוריות — ללא שינוי | 979 חדשות לפני | 979 חדשות אחרי | כל 13,653 התצפיות אחרי |
|---|---:|---:|---:|---:|
| יונקים | 752 | 19 | 19 | 771 |
| עופות | 1,603 | 59 | 102 | 1,705 |
| פרפרים | 1,129 | 58 | 58 | 1,187 |
| שפיראים | 1,042 | 134 | 134 | 1,176 |
| פרוקי רגליים | 4,173 | 96 | 53 | 4,226 |
| צמחים | 3,320 | 83 | 82 | 3,402 |
| שאר המינים | 655 | 530 | 531 | 1,186 |
| סך הכול | 12,674 | 979 | 979 | 13,653 |

דרגות האיכות נשמרו: research=8,317; needs_id=5,306; casual=30.
נשמרו מזהים, תאריכים ושעות, קואורדינטות, קבוצות משתמשים, 512 העשרות שמות ומנגנון הייבוא האדיטיבי.
272 תצפיות היסטוריות בעלות אותם ששת שמות מדעיים לא שונו.

## פערים שנדחו להחלטה נפרדת

| קבוצה | מספר תצפיות חדשות | מצב והחלטה נדרשת |
|---|---:|---|
| רשומות חסרות במילון | 195 | לא תוקנו; נדרשת בדיקת שם, רמת זיהוי ומקור לכל מיפוי |
| סיווג מילוני כללי מדי | 44 | לא תוקנו; כולל 42 רשומות בנושא פרפרים/עשים ו־2 שפיראים; נדרשת החלטת מדיניות |
| הבדלי רמת פירוט | 135 | לא תוקנו; 82 צמחים ו־53 פרוקי רגליים מול Other Species ב־Excel; אין ראיה שמדובר בטעות ביולוגית |

ב־14 מהרשומות החסרות מופיע Lycaena thersamon.
[GBIF/Catalogue of Life](https://www.gbif.org/taxon/56F4V) מקשר אותו ל־Thersamonia thersamon.
זו ראיית נרדפות לתיקון עתידי בלבד: לא הוחל מיפוי ולא הוחלף שום שם מדעי.
135 הבדלי הפירוט יכולים להישאר כפערי ייצוג אם שלום יאשר את מדיניות הקבוצות; לא סומנו כטעויות מוכחות.
אין אישור לשינוי סיווג היסטורי, למילונים גלובליים או למדיניות פרפרים מול עשים.

## בדיקות

תוצאה: 64 בדיקות עברו — 52 קיימות ו־12 חדשות. TypeScript ו־git diff --check עברו.
הרצה חוזרת נתקלה במחסור בזיכרון של Node; החבילה שנקטעה הורצה בנפרד בהצלחה,
ולבסוף הרצה סדרתית מלאה הסתיימה עם 64/64, אפס כישלונות וקוד יציאה 0.
בדיקת lint מלאה לקבצים הרלוונטיים עדיין מדווחת על 61 בעיות Prettier בקוד קיים ועל 8 אזהרות Fast Refresh קודמות.
השוואה לקוד שלפני התיקון ולשורות הדיפ לא מצאה שגיאות חדשות בשורות שהשתנו; בדיקת הכללים שאינם עיצוב עברה.
סיומות שורה בקבצים שנערכו בלבד הותאמו ל־LF; לא בוצע עיצוב גורף של הקוד הקיים.

פקודות אימות: node --test --test-concurrency=1 tests/*.test.mjs;
node --test tests/observation-dates.test.mjs; node node_modules/typescript/bin/tsc --noEmit;
ESLint על תשעת קובצי הקוד/בדיקות הרלוונטיים; git diff --check.

בדיקות חדשות: רשימת 44 מזהים מדויקת ומטא־נתוני Excel; דחיית החלה מחוץ לתחום; חותמת כל הסיווגים ההיסטוריים;
חותמת 935 התוספות שלא תוקנו; שמירת כל 13,653 אובייקטי התצפיות; כל 56 שילובי קבוצה ודרגת איכות בחמישה
מסלולי נתונים; בחירות ומוני מינים; טבלת מינים בקבוצות מעורבות; בועות ופרטי תצפית;
Vertebrata כללי; סדרות זמן חודשיות; ייצוא בעברית ובאנגלית.

החותמות צולמו לפני המימוש, ולא חושבו מחדש כערכי ציפייה לאחר התיקון:
- כל אובייקטי התצפיות: 23a82f76d697c7e79a9c54bbf1a489b4d94767d0fd49394a510e5fe379b2a7f2
- מזהה וסיווג לכל תצפית היסטורית: fff48b2210879586542afe19f19c565f027f8c7ed79044c2f30b9979934efeb9
- מזהה וסיווג ל־935 תוספות שלא תוקנו: 024e19d3c40941f6b17763762a9eabca0978ec811e50fe8e52434ba24c898fb3

ממצא טכני קיים, שלא תוקן: בשוויון בין חודשי שיא, getSeasonalStatus בוחר לפי סדר הקלט.
בדיקת היפוך סדר קלט נועדה לאמת ספירות וסיווג ולא לשנות את מדיניות שובר השוויון העונתית.
הבדיקות מפעילות את פונקציות הייצור ואת חישובי רכיבי React; הן אינן בדיקת דפדפן אינטראקטיבית.

ממצא מפה קיים שנשמר מחוץ להיקף התיקון: inat_328024766 ו־inat_328024838 מאוגדים באותה בועה
אף שסיווגיהם המחושבים הם arthropods ו־other. אף אחד מהם אינו ברשימת 44 התיקונים.
לא שונו הסיווגים או קיבוץ הבועה הזאת. הפרדה כללית לפי קבוצה דורשת החלטה נפרדת כדי לא להרחיב את השינוי.

## קבצים והיקף השינוי המקומי

נוצרו:
- src/lib/observation-taxonomy-overrides.ts — תיקונים מוגבלים למזהים ולקובץ מקור מאומת.
- tests/observation-taxonomy.test.mjs — 12 בדיקות רגרסיה.
- docs/observation-taxonomy-corrections.md — מסמך זה, לרבות 44 שורות ראיות.

עודכנו:
- src/lib/observations-store.tsx — החלת התיקון במסווג המרכזי בלבד; שינויים קודמים במנגנון הייבוא נשמרו.
- src/components/species-deep-dive.tsx — בחירות מינים המתאימות גם לקבוצות לפי תצפית.
- src/components/species-insights-table.tsx — סינון לפי תצפית לפני חישוב ספירות בקבוצה.
- src/components/observation-map.tsx — הפרדת הרשומות המתוקנות בלבד בקיבוץ הבועות.
- tests/observation-dates.test.mjs, tests/observation-enrichment.test.mjs, tests/observation-import.test.mjs — אספקת פונקציית התיקון האמיתית לרתמת בדיקות המפה; תנאי האימות הקיימים לא שונו.
- package.json — הוספת test:taxonomy; test:import הקיים נשמר.

לא בוצעו staging, commit, push, merge או deployment. HEAD נשאר 6d75a951b59bc9f2d109795173dcf0d3e4e8c369.
קובצי CSV, user_groups.csv, JSON התוספות, קוד הייבוא והמילונים הגלובליים נשמרו ללא שינוי.
גם src/routeTree.gen.ts ו־public/Until_June26 מעודכן.csv נשמרו עם אותה חותמת קובץ שהייתה בתחילת העבודה.
לפני פרסום נדרשים בדיקה חזותית מקומית ואישור מפורש; לא בוצעה פריסה למאגר האישי או הרשמי.

## ראיות ברמת רשומה

מקור: all observations until September 2026 (3).xlsx, גיליון all observations until Septembe.
SHA-256: f261a8c4abeed8909fee64a1947c76b7535e00177ee3381c258c5d56582df16d.
הערכים נלקחו מהמטא־נתונים המקוריים של חבילת התוספות והוצלבו עם ביקורת import-quality-audit-2026-10-17.
השורה היא מספר שורת Excel המקורית, כולל הכותרת. המזהים נשמרים כטקסט.
לכל רשומה חלה ראיית השם המדעי בטבלת המקורות למעלה.

| originalRecordId | מזהה דשבורד | מזהה פלטפורמה ב־Excel | שורת Excel | שם מדעי | סיווג קודם | ערך Excel מקורי | סיווג מחושב מתוקן |
|---|---|---|---:|---|---|---|---|
| 206446233 | inat_206446233 | ai4biodiversity.haifa.ac.il_115378 | 2824 | Ardea cinerea | arthropods | Birds | birds |
| 233784595 | inat_233784595 | ai4biodiversity.haifa.ac.il_116082 | 3528 | Ardea cinerea | arthropods | Birds | birds |
| 248718564 | inat_248718564 | ai4biodiversity.haifa.ac.il_116373 | 3819 | Milvus migrans | arthropods | Birds | birds |
| 253732202 | inat_253732202 | ai4biodiversity.haifa.ac.il_116450 | 3896 | Milvus migrans | arthropods | Birds | birds |
| 253734539 | inat_253734539 | ai4biodiversity.haifa.ac.il_116482 | 3928 | Milvus migrans | arthropods | Birds | birds |
| 253734909 | inat_253734909 | ai4biodiversity.haifa.ac.il_116491 | 3937 | Circus aeruginosus | arthropods | Birds | birds |
| 258225986 | inat_258225986 | ai4biodiversity.haifa.ac.il_117007 | 4453 | Milvus migrans | arthropods | Birds | birds |
| 258717192 | inat_258717192 | ai4biodiversity.haifa.ac.il_117045 | 4491 | Ardea cinerea | arthropods | Birds | birds |
| 258719777 | inat_258719777 | ai4biodiversity.haifa.ac.il_117051 | 4497 | Ardea cinerea | arthropods | Birds | birds |
| 259227022 | inat_259227022 | ai4biodiversity.haifa.ac.il_117118 | 4564 | Milvus migrans | arthropods | Birds | birds |
| 259314503 | inat_259314503 | ai4biodiversity.haifa.ac.il_117121 | 4567 | Milvus migrans | arthropods | Birds | birds |
| 259623222 | inat_259623222 | ai4biodiversity.haifa.ac.il_117136 | 4582 | Milvus migrans | arthropods | Birds | birds |
| 259623741 | inat_259623741 | ai4biodiversity.haifa.ac.il_117142 | 4588 | Milvus migrans | arthropods | Birds | birds |
| 259623802 | inat_259623802 | ai4biodiversity.haifa.ac.il_117143 | 4589 | Milvus migrans | arthropods | Birds | birds |
| 259636780 | inat_259636780 | ai4biodiversity.haifa.ac.il_117155 | 4601 | Circus aeruginosus | arthropods | Birds | birds |
| 268881345 | inat_268881345 | ai4biodiversity.haifa.ac.il_118678 | 6124 | Milvus migrans | arthropods | Birds | birds |
| 274066600 | inat_274066600 | ai4biodiversity.haifa.ac.il_118989 | 6435 | Circus aeruginosus | arthropods | Birds | birds |
| 316792764 | inat_316792764 | ai4biodiversity.haifa.ac.il_119844 | 7290 | Milvus migrans | arthropods | Birds | birds |
| 316792767 | inat_316792767 | ai4biodiversity.haifa.ac.il_119845 | 7291 | Milvus migrans | arthropods | Birds | birds |
| 316792768 | inat_316792768 | ai4biodiversity.haifa.ac.il_119846 | 7292 | Milvus migrans | arthropods | Birds | birds |
| 323250669 | inat_323250669 | ai4biodiversity.haifa.ac.il_120126 | 7572 | Ardea cinerea | arthropods | Birds | birds |
| 323969770 | inat_323969770 | ai4biodiversity.haifa.ac.il_120260 | 7706 | Milvus migrans | arthropods | Birds | birds |
| 324852267 | inat_324852267 | ai4biodiversity.haifa.ac.il_120579 | 8025 | Milvus migrans | arthropods | Birds | birds |
| 326765189 | inat_326765189 | ai4biodiversity.haifa.ac.il_120855 | 8301 | Ardea cinerea | arthropods | Birds | birds |
| 327481722 | inat_327481722 | ai4biodiversity.haifa.ac.il_121014 | 8460 | Milvus migrans | arthropods | Birds | birds |
| 327816580 | inat_327816580 | ai4biodiversity.haifa.ac.il_121037 | 8483 | Milvus migrans | arthropods | Birds | birds |
| 329804796 | inat_329804796 | ai4biodiversity.haifa.ac.il_121256 | 8702 | Ardea cinerea | arthropods | Birds | birds |
| 329889226 | inat_329889226 | ai4biodiversity.haifa.ac.il_121259 | 8705 | Milvus migrans | arthropods | Birds | birds |
| 331764857 | inat_331764857 | ai4biodiversity.haifa.ac.il_121436 | 8882 | Ardea cinerea | arthropods | Birds | birds |
| 332709705 | inat_332709705 | ai4biodiversity.haifa.ac.il_121509 | 8955 | Ardea cinerea | arthropods | Birds | birds |
| 333412856 | inat_333412856 | ai4biodiversity.haifa.ac.il_121577 | 9023 | Ardea cinerea | arthropods | Birds | birds |
| 334698926 | inat_334698926 | ai4biodiversity.haifa.ac.il_121717 | 9163 | Milvus migrans | arthropods | Birds | birds |
| 335228371 | inat_335228371 | ai4biodiversity.haifa.ac.il_121771 | 9217 | Milvus migrans | arthropods | Birds | birds |
| 335855393 | inat_335855393 | ai4biodiversity.haifa.ac.il_121892 | 9338 | Milvus migrans | arthropods | Birds | birds |
| 338042618 | inat_338042618 | ai4biodiversity.haifa.ac.il_122202 | 9648 | Ardea cinerea | arthropods | Birds | birds |
| 338562405 | inat_338562405 | ai4biodiversity.haifa.ac.il_122242 | 9688 | Ardea cinerea | arthropods | Birds | birds |
| 338680479 | inat_338680479 | ai4biodiversity.haifa.ac.il_122257 | 9703 | Ardea cinerea | arthropods | Birds | birds |
| 338682227 | inat_338682227 | ai4biodiversity.haifa.ac.il_122258 | 9704 | Ardea cinerea | arthropods | Birds | birds |
| 376451053 | inat_376451053 | ai4biodiversity.haifa.ac.il_123958 | 11404 | Ardea cinerea | arthropods | Birds | birds |
| 378367967 | inat_378367967 | ai4biodiversity.haifa.ac.il_124012 | 11458 | Ardea cinerea | arthropods | Birds | birds |
| 384470349 | inat_384470349 | ai4biodiversity.haifa.ac.il_124232 | 11678 | Ardea cinerea | arthropods | Birds | birds |
| 389990426 | inat_389990426 | ai4biodiversity.haifa.ac.il_124370 | 11816 | Alectoris chukar | arthropods | Birds | birds |
| 395846621 | inat_395846621 | ai4biodiversity.haifa.ac.il_124640 | 12086 | Motacilla cinerea | arthropods | Birds | birds |
| 401166224 | inat_401166224 | ai4biodiversity.haifa.ac.il_124778 | 12224 | Vertebrata | plants | Other Species | other |
