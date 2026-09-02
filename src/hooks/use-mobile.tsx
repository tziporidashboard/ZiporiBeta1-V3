/**
 * use-mobile.tsx — `useIsMobile()` hook, tracking whether the viewport is
 * narrower than `MOBILE_BREAKPOINT` (768px) via a `matchMedia` listener.
 *
 * Called by: `@/components/ui/sidebar.tsx` (and any other component
 *   needing responsive mobile/desktop branching).
 */
import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
