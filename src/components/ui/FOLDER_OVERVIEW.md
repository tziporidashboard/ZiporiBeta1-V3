# `src/components/ui/` Overview

This folder contains **shadcn/ui** components — thin, styled wrappers
around [Radix UI](https://www.radix-ui.com/) primitives, generated via the
shadcn CLI and configured in `@/components.json` (root of the repo).

These files are considered largely **vendor/generated boilerplate**:
they follow shadcn's standard conventions (a `cva` variants object +
`React.forwardRef` wrapper + `cn()` class merging via
`@/lib/utils`), are not hand-written business logic, and are typically
left unmodified except for small styling tweaks. For that reason they do
NOT carry individual bespoke header comments — this file documents the
folder as a whole instead.

## Contents

Standard primitives: `accordion`, `alert`, `alert-dialog`, `aspect-ratio`,
`avatar`, `badge`, `breadcrumb`, `button`, `calendar`, `card`, `carousel`,
`chart` (Recharts theming wrapper), `checkbox`, `collapsible`, `command`
(cmdk-based), `context-menu`, `dialog`, `drawer` (vaul-based), `dropdown-menu`,
`form` (react-hook-form bindings), `hover-card`, `input`, `input-otp`,
`label`, `menubar`, `navigation-menu`, `pagination`, `popover`, `progress`,
`radio-group`, `resizable` (react-resizable-panels), `scroll-area`, `select`,
`separator`, `sheet`, `sidebar`, `skeleton`, `slider`, `sonner` (toast),
`switch`, `table`, `tabs`, `textarea`, `toggle`, `toggle-group`, `tooltip`.

## Usage

Feature components in `@/src/components/` (e.g. `filter-sidebar.tsx`,
`people-dashboard.tsx`, `species-deep-dive.tsx`) import individual pieces
from here, e.g. `import { Input } from "@/components/ui/input"`.

## Updating

To add or update a primitive, prefer regenerating it via the shadcn CLI
(`npx shadcn@latest add <component>`) rather than hand-editing, so it
stays in sync with upstream conventions and `@/components.json`.
