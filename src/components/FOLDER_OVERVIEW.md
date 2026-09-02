# `src/components/` Overview

Feature components for the **Eyes for Nahal Tzippori** (Eco-Watch Insight)
dashboard. These are the "smart" building blocks composed by the routes in
`src/routes/`. Low-level, unstyled-logic UI primitives (buttons, dialogs,
tables, etc.) live separately in `src/components/ui/` — see that folder's
own `FOLDER_OVERVIEW.md`.

## Top-level views (one per tab/route)

| File | Purpose |
| --- | --- |
| `dashboard.tsx` | Main analytics view: KPI strip, taxa filter bar, map, metrics table, time-series chart. |
| `people-dashboard.tsx` | "People" view: contributor group/subgroup breakdown with per-user drill-down. |
| `species-deep-dive.tsx` | "Species Deep Dive" view: per-category and per-species drill-down across map/table/chart. |

## Shared sub-components used by the views above

| File | Purpose |
| --- | --- |
| `nav-bar.tsx` | Top app header — title, route nav link, language toggle. |
| `filter-sidebar.tsx` | Collapsible filter panel (years/months, quality, species type, target population, monitoring areas). |
| `date-range-slider.tsx` | Dual-thumb date-range slider with year-gap masking, used alongside the filter sidebar. |
| `taxa-filter-bar.tsx` | Row of taxa-group toggle pills, used by `dashboard.tsx`. |
| `observation-map.tsx` | Shared Leaflet map (bubbles + polygons + detail sidebar) used by all three top-level views. |
| `metrics-table.tsx` | Per-contributor-group summary statistics table (days monitoring, quality %, invasive/rare counts, etc.). |
| `time-series-chart.tsx` | Dashboard-wide monthly observation count chart, split by contributor group. |
| `deep-dive-time-series-chart.tsx` | Species Deep Dive's monthly chart (category-vs-rest, or per-species lines). |
| `species-insights-table.tsx` | Top-5 species table (trend, research %, dominant season) for Species Deep Dive. |
| `user-activity-chart.tsx` | Per-user monthly activity chart for the People dashboard. |
| `user-analytics-table.tsx` | Top-N contributor ranking table for the People dashboard. |

## Data flow

Every component here consumes the shared observation dataset and filter
state from `useObservations()` (`@/lib/observations-store`). Each
top-level view builds its own memoized filter pipeline(s) over the raw
`observations` array and passes the resulting filtered arrays down as
props to the shared sub-components (map/table/chart). See
`@/src/lib/FOLDER_OVERVIEW.md` for the full data-loading and CSV/dataset
architecture.
