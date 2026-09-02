# Eyes for Nahal Tzippori — Eco-Watch Insight

An interactive ecological monitoring dashboard for the Nahal Tzippori
restoration project ("עיניים לנחל ציפורי"). It visualizes and analyzes
biodiversity observations (birds, mammals, butterflies, dragonflies,
arthropods, plants) collected by professional monitors, local
communities, students, and online iNaturalist contributors, across a
Leaflet map, aggregate metrics tables, and time-series charts — with
full Hebrew (RTL) / English bilingual support.

## Overview

The app has three main analytics tabs, all sharing one global dataset
and filter state:

- **Overview (`Dashboard`)** — KPI strip, taxa-group filter tabs, the
  observation map, a per-contributor-group metrics table, and a monthly
  observation time-series chart.
- **Species Deep Dive (`SpeciesDeepDive`)** — drill into a single taxa
  category and/or specific species, with its own map highlighting,
  top-species insights table, and category/species time-series chart.
- **People (`PeopleDashboard`)** — breakdown by contributor
  group/subgroup (expert monitors, local community subgroups, students,
  online communities) with a searchable per-user drill-down, activity
  chart, and leaderboard table.

A persistent **filter sidebar** (years/months, research-grade quality,
species type, target population, monitoring/survey areas) and a global
**date-range slider** apply across all three tabs.

See `@/src/components/FOLDER_OVERVIEW.md` and
`@/src/lib/FOLDER_OVERVIEW.md` for a deeper breakdown of the component
architecture and data pipeline.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | [TanStack Start](https://tanstack.com/start) (file-based routing via `@tanstack/react-router`, SSR-capable) |
| UI library | [React 19](https://react.dev) + TypeScript |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) (Radix UI primitives) |
| Maps | [Leaflet](https://leafletjs.com) + [react-leaflet](https://react-leaflet.js.org) (+ `@turf/boolean-point-in-polygon` for spatial filtering) |
| Charts | [Recharts](https://recharts.org) |
| Forms/validation | `react-hook-form`, `zod` |
| CSV parsing | [PapaParse](https://www.papaparse.com) |
| Build tool | [Vite 7](https://vitejs.dev) (via `@lovable.dev/vite-tanstack-config`), with `nitro` targeting the `cloudflare-pages` preset |
| Deployment | Cloudflare Pages (see `dist/_worker.js/wrangler.json` build output) |
| i18n | Custom lightweight Hebrew/English context (`@/src/lib/i18n.tsx`) — no external i18n library |
| Backend (optional) | [Supabase](https://supabase.com) config/migrations under `@/supabase/` (not required for local dashboard use) |

## Local Setup

**Prerequisites:** [Node.js](https://nodejs.org) 18+ and `npm` (this
project uses an `npm`-managed `package-lock.json` — see below).

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev

# 3. Open the printed local URL (default: http://localhost:3000 or similar Vite port)
```

Other useful scripts (see `package.json`):

```bash
npm run build       # production build (outputs to dist/, Cloudflare Pages preset)
npm run build:dev   # development-mode build
npm run preview     # preview a production build locally
npm run lint        # run ESLint
npm run format      # run Prettier (writes formatting fixes)
```

> **Package manager note:** this project is npm-managed
> (`package-lock.json` is the source of truth for installs). Do not add
> a `bunfig.toml`/`bun.lock` unless the deployment pipeline is
> deliberately switched to Bun — see project history for a prior
> Cloudflare "frozen lockfile" incident caused by a stray `bunfig.toml`.

## Core System Files

| Path | Role |
| --- | --- |
| `@/src/routes/__root.tsx` | App shell: HTML document, `I18nProvider`, global 404/error boundaries. |
| `@/src/routes/index.tsx` | The `/` route — hosts the 3 dashboard tabs, filter sidebar, and global date-range bar. |
| `@/src/lib/observations-store.tsx` | Global data store — loads/joins all CSV sources, holds observations + filter state (`useObservations()`). |
| `@/src/lib/taxonomy-engine.ts` | Single source of truth for species taxonomy lookups. |
| `@/src/lib/species-map.ts` | Active curated species dictionary (~2,000 entries). |
| `@/src/lib/survey-polygons.ts` / `@/src/lib/monitoring-areas.ts` | Static and dynamic spatial-area definitions used for area filtering. |
| `@/src/components/` | Feature components (dashboard views, map, tables, charts). See its `FOLDER_OVERVIEW.md`. |
| `@/src/components/ui/` | shadcn/ui primitive components. See its `FOLDER_OVERVIEW.md`. |
| `@/src/server.ts` / `@/src/start.ts` | Server entry point + error-handling middleware (Cloudflare Workers runtime). |
| `@/vite.config.ts` | Build config — TanStack Start + Nitro `cloudflare-pages` preset. |

## Data Sources

All datasets are static files served from `@/public/` and loaded
client-side at runtime (parsed with PapaParse). Full column-level
documentation lives in `@/src/lib/FOLDER_OVERVIEW.md#data-flow--csvdataset-architecture`.

| File | Description |
| --- | --- |
| `public/Until_June26.csv` | Main iNaturalist observation export. |
| `public/MERLIN all observations for Zohar.csv` | Expert/professional field-monitoring observations. |
| `public/user_groups.csv` | Maps each `user_login` to its contributor group. |
| `public/monitoring-areas.geojson` | Dynamic monitoring-area polygons (id/name/color). |
| `public/Tzipori_2325.csv`, `species_master_list.csv`, `species_dictionary.json` | Source data historically used to generate the species dictionary (`@/src/lib/species-map.ts`). |

## Project Structure

```
├── public/                 # Static CSV/GeoJSON datasets served to the client
├── src/
│   ├── components/         # Feature components (dashboard, map, tables, charts)
│   │   └── ui/              # shadcn/ui primitives
│   ├── hooks/               # Standalone React hooks
│   ├── lib/                 # Data store, taxonomy engine, spatial logic, i18n
│   │   └── api/              # TanStack Start server functions
│   ├── routes/               # File-based routes (TanStack Router)
│   ├── router.tsx, server.ts, start.ts, styles.css
├── supabase/                # Optional Supabase config/migrations
├── scripts/                  # One-off data-maintenance scripts
└── vite.config.ts, tsconfig.json, components.json  # root config files
```
