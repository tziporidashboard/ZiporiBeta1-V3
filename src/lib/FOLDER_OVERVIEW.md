# `src/lib/` Overview

Non-visual application logic: the global data store, taxonomy/species
data, spatial filtering, i18n, and server-only helpers. No React
components live here (`observations-store.tsx` and `i18n.tsx` are
`.tsx` only because they define React Context Providers).

## Files

| File | Purpose |
| --- | --- |
| `observations-store.tsx` | **Core global store.** Loads/joins all CSV data sources, holds the full `observations` array + all filter state, exposes `useObservations()`. See "Data Flow" below. |
| `i18n.tsx` | Hebrew/English translation dictionary + `useI18n()` context. |
| `taxonomy-engine.ts` | Single source of truth for species taxonomy lookups (`getTaxonDetails`, `getTaxonCategory`, `getTaxonStatus`), backed by `species-map.ts` + `species-registry.ts`. |
| `species-map.ts` | **Active** curated species dictionary (~2,000 entries): scientific name → category/Hebrew/English names. |
| `species-dictionary.ts` | O(1) `Map`-based lookup wrapper around `species-map.ts`. |
| `species-registry.ts` | Hard-coded invasive/rare species classification list. |
| `master-species-map.ts` | **DEPRECATED** — superseded by `species-map.ts`; confirmed unused (no imports anywhere in `src/`). Kept for reference only. |
| `survey-polygons.ts` | Static, hard-coded survey-area polygons (Canal/Floodplains/Stream) + point-in-polygon test. |
| `monitoring-areas.ts` | Dynamic monitoring-area polygons loaded from `/monitoring-areas.geojson` at runtime + spatial index. |
| `config.server.ts` | Server-only env config (never bundled to the client). |
| `error-capture.ts` | Captures the last unhandled error/rejection for `server.ts` to recover. |
| `error-page.ts` | Static fallback HTML error page. |
| `lovable-error-reporting.ts` | Bridges caught errors to the Lovable.dev monitoring integration. |
| `utils.ts` | `cn()` Tailwind class-merging helper (shadcn/ui convention). |
| `api/example.functions.ts` | Sample TanStack Start `createServerFn` server function. |

## Data Flow & CSV/Dataset Architecture

All data loading happens client-side in `observations-store.tsx`
(`ObservationsProvider`, inside a `useEffect` skipped during SSR). Files
are fetched from `public/` by absolute path and parsed with `papaparse`.

### 1. `public/user_groups.csv`
Maps each iNaturalist username to its raw contributor group.

| Column | Required | Used for |
| --- | --- | --- |
| `user_login` | yes | Join key into the main observations CSV. |
| `group` | yes | Raw group (e.g. `zevulun`, `expert`, `student`, `קהילות מקוונות`) — mapped via `CATEGORY_MAP` to one of the 4 canonical `user_category` values (`expert`, `student`, `local_communities`, `online_communities`), while the raw value is preserved as `user_subcategory` for the People dashboard's finer-grained grouping. |

### 2. `public/Until_June26.csv` (main iNaturalist export)
Each row becomes one `Observation` (see the `Observation` type in
`observations-store.tsx`). Rows with an unparseable date or non-numeric
lat/lng are silently dropped.

| Column | Required | Maps to |
| --- | --- | --- |
| `observed_on` | yes | `Observation.observed_on` (normalized to `DD/MM/YYYY`). |
| `latitude`, `longitude` | yes | `Observation.latitude/longitude` → map bubbles, area/polygon filtering. |
| `user_login` | yes | `Observation.user_login` → joined against `user_groups.csv` for `user_category`/`user_subcategory`. |
| `quality_grade` | no | `Observation.quality_grade` → "Research Grade Only" filter. |
| `iconic_taxon_name` | no | `Observation.iconic_taxon_name` → fallback taxa-group classification. |
| `scientific_name` | no | `Observation.scientific_name` → species lookups (`species-map.ts`), invasive/rare classification (`species-registry.ts`). |
| `common_name` | no | `Observation.common_name` (optional fallback display name). |
| `taxon_order_name` | no | `Observation.taxon_order_name` → taxa-group classification (e.g. Odonata). |
| `establishment_means` | no | `Observation.establishment_means` (optional). |
| `id` | no | Becomes `composite_id: "inat_<id>"` — used as the React/map key and to look up full detail in the map sidebar. |
| `url` | no | `Observation.source_url` — "View on iNaturalist" link. |

### 3. `public/MERLIN all observations for Zohar.csv` (expert monitoring)
Parsed by `parseMerlinRow`. Represents professional/expert field
observations, always tagged `quality_grade: "research"`.

| Column | Required | Maps to |
| --- | --- | --- |
| `timeStamp` | yes | `Observation.observed_on`. |
| `decimalLatitudeStart`, `decimalLongitudeStart` | yes | `Observation.latitude/longitude`. |
| `family` | no | Drives both `iconic_taxon_name` inference (bird/mammal/butterfly family lists) and Odonata detection (`ODONATA_FAMILIES`). |
| `personName` / `recordedBy` / `eMail` | one required (unless Odonata) | `Observation.user_login`. Odonata-family rows are always attributed to the fixed name `REA_SHAISH_NAME` ("רע שיש"). |
| `observationID` | no | Becomes `composite_id: "expert_<observationID>"` (falls back to `expert_<row index>`). |

### 4. `public/monitoring-areas.geojson` (dynamic monitoring areas)
Loaded via `@/lib/monitoring-areas.ts`'s `loadMonitoringAreas()`. A
GeoJSON `FeatureCollection` of `Polygon`/`MultiPolygon` features, each
requiring `properties.id`, `properties.name`, `properties.color`. Used to
build a per-observation membership index
(`buildObservationMonitoringAreaIndex`) for the "Monitoring Areas" filter
section, independent of the 4 static `survey-polygons.ts` shapes.

### Combined pipeline
```
user_groups.csv ──┐
                   ├─▶ tziporiObservations (from Until_June26.csv)  ─┐
                   │                                                 ├─▶ observations[] (ObservationsProvider state)
MERLIN ...csv ─────┴─▶ merlinObservations ───────────────────────────┘
monitoring-areas.geojson ─▶ observationMonitoringAreaIndex (WeakMap)
```

Every component under `@/src/components/` reads `observations` +
`filters` from `useObservations()` and builds its own memoized filter
pipeline over that shared array — see `@/src/components/FOLDER_OVERVIEW.md`.
