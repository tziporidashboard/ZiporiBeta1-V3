/**
 * NavBar — top application header with the app title/logo, primary nav
 * link(s), and a language toggle (Hebrew/English).
 *
 * What it does:
 *   - Highlights the active route via `useRouterState` (TanStack Router).
 *   - Flips the active locale by calling `setLang` from `useI18n()`.
 *
 * Depends on: `@tanstack/react-router`, `lucide-react`, `@/lib/i18n`.
 * Called by: `src/routes/__root.tsx` (rendered in the app shell above
 *   the routed `<Outlet />`).
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { Leaf, LayoutDashboard, Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function NavBar() {
  const { t, lang, setLang } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const linkCls = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-foreground/70 hover:text-foreground hover:bg-secondary"
    }`;

  return (
    <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Leaf className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{t("appTitle")}</div>
            <div className="text-[11px] text-muted-foreground">iNaturalist Analytics</div>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          <Link to="/" className={linkCls(pathname === "/")}>
            <LayoutDashboard className="h-4 w-4" />
            <span>{t("dashboard")}</span>
          </Link>
        </nav>

        <button
          onClick={() => setLang(lang === "he" ? "en" : "he")}
          className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-secondary transition-colors"
        >
          <Languages className="h-4 w-4" />
          {t("language")}
        </button>
      </div>
    </header>
  );
}
