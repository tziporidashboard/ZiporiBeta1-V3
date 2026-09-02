# `src/hooks/` Overview

Standalone React hooks not tied to a specific feature/domain (contrast
with `useObservations()` and `useI18n()`, which live in `@/lib/` since
they're context-provider hooks central to the app's data model).

| File | Purpose |
| --- | --- |
| `use-mobile.tsx` | `useIsMobile()` — tracks whether the viewport is below the 768px mobile breakpoint via `matchMedia`. Used by responsive UI (e.g. `@/components/ui/sidebar.tsx`). |
