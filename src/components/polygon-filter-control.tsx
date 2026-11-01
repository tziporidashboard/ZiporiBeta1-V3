import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { GeoJSON, Pane, useMap } from "react-leaflet";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import { Check, PenLine, Trash2, X } from "lucide-react";
import { useObservations } from "@/lib/observations-store";
import { useI18n } from "@/lib/i18n";
import { isValidDrawnPolygon } from "@/lib/drawn-polygon";
import { Button } from "@/components/ui/button";

// Only the map opts in. Existing survey polygons and observation markers must
// never become editable (or incur Geoman setup for thousands of markers).
L.PM.setOptIn(true);

const polygonStyle = { color: "#7c3aed", fillColor: "#8b5cf6", fillOpacity: 0.12, weight: 3 };

export function PolygonFilterControl({
  toolbar,
  drawing,
  onDrawingChange,
}: {
  toolbar: HTMLDivElement | null;
  drawing: boolean;
  onDrawingChange: (drawing: boolean) => void;
}) {
  const map = useMap();
  const { filters, setFilters, resetVersion } = useObservations();
  const { t, dir } = useI18n();
  const [vertexCount, setVertexCount] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const renderer = useMemo(() => L.svg({ pane: "drawn-filter" }), []);

  // Wrapping controls on a small screen changes the map's available height.
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    let workingLayer: L.Layer | null = null;
    const vertexAdded = () => setVertexCount((count) => count + 1);
    const intersected = () => setInvalid(true);
    const detachWorkingLayer = () => {
      workingLayer?.off("pm:vertexadded", vertexAdded);
      workingLayer?.off("pm:intersect", intersected);
      workingLayer = null;
    };
    const started: L.PM.DrawStartEventHandler = (event) => {
      detachWorkingLayer();
      workingLayer = event.workingLayer;
      workingLayer.on("pm:vertexadded", vertexAdded);
      workingLayer.on("pm:intersect", intersected);
      setVertexCount(0);
      setInvalid(false);
      onDrawingChange(true);
    };
    const ended = () => {
      detachWorkingLayer();
      onDrawingChange(false);
      setVertexCount(0);
    };
    const created: L.PM.CreateEventHandler = (event) => {
      if (event.shape !== "Polygon" || !(event.layer instanceof L.Polygon)) return;
      // toGeoJSON(false) preserves the drawn coordinates without rounding.
      const geometry = event.layer.toGeoJSON(false).geometry;
      // React owns the sole persistent overlay; remove Geoman's temporary layer.
      map.removeLayer(event.layer);
      if (geometry.type !== "Polygon" || !isValidDrawnPolygon(geometry)) {
        setInvalid(true);
        return;
      }
      setFilters((previous) => ({ ...previous, drawnPolygon: geometry }));
      setInvalid(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && map.pm.globalDrawModeEnabled()) {
        map.pm.disableDraw();
        setInvalid(false);
      }
    };
    map.on("pm:drawstart", started);
    map.on("pm:drawend", ended);
    map.on("pm:create", created);
    document.addEventListener("keydown", keyDown);
    return () => {
      map.off("pm:drawstart", started);
      map.off("pm:drawend", ended);
      map.off("pm:create", created);
      document.removeEventListener("keydown", keyDown);
      detachWorkingLayer();
      map.pm.disableDraw();
    };
  }, [map, setFilters, onDrawingChange]);

  useEffect(() => {
    map.pm.disableDraw();
    onDrawingChange(false);
    setInvalid(false);
  }, [map, resetVersion, onDrawingChange]);

  const startDrawing = () => {
    map.pm.enableDraw("Polygon", {
      snappable: false,
      allowSelfIntersection: false,
      continueDrawing: false,
      tooltips: false,
      pathOptions: polygonStyle,
      templineStyle: { color: polygonStyle.color },
      hintlineStyle: { color: polygonStyle.color, dashArray: "5,5" },
    });
  };

  return (
    <>
      {toolbar &&
        createPortal(
          <div className="flex flex-wrap items-center gap-2 p-2 text-xs" dir={dir}>
            <Button
              type="button"
              variant={drawing ? "default" : "outline"}
              size="sm"
              className="min-h-9"
              aria-pressed={drawing}
              disabled={drawing}
              onClick={startDrawing}
            >
              <PenLine aria-hidden="true" />
              {t(
                drawing
                  ? "polygonDrawing"
                  : filters.drawnPolygon
                    ? "polygonReplace"
                    : "polygonDraw",
              )}
            </Button>
            {drawing && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-9"
                  disabled={vertexCount < 3}
                  onClick={() => {
                    if (!map.pm.finishDraw()) setInvalid(true);
                  }}
                >
                  <Check aria-hidden="true" />
                  {t("polygonFinish")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-9"
                  onClick={() => {
                    map.pm.disableDraw();
                    setInvalid(false);
                  }}
                >
                  <X aria-hidden="true" />
                  {t("cancel")}
                </Button>
              </>
            )}
            {filters.drawnPolygon && !drawing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={() => {
                  setFilters((previous) => ({ ...previous, drawnPolygon: null }));
                  setInvalid(false);
                }}
              >
                <Trash2 aria-hidden="true" />
                {t("polygonRemove")}
              </Button>
            )}
            <span
              role="status"
              className={`min-w-0 ${invalid ? "text-destructive" : "text-muted-foreground"}`}
            >
              {t(
                invalid
                  ? "polygonInvalid"
                  : drawing
                    ? "polygonInstructions"
                    : filters.drawnPolygon
                      ? "polygonActive"
                      : "polygonHint",
              )}
            </span>
          </div>,
          toolbar,
        )}
      {/* Keep the pane mounted with its renderer: removing it detaches the SVG,
          but Leaflet still reuses that renderer for the next polygon. */}
      <Pane name="drawn-filter" style={{ zIndex: 450, pointerEvents: "none" }}>
        {filters.drawnPolygon && (
          <GeoJSON
            key={JSON.stringify(filters.drawnPolygon)}
            data={filters.drawnPolygon}
            interactive={false}
            pmIgnore={true}
            style={{ ...polygonStyle, renderer }}
          />
        )}
      </Pane>
    </>
  );
}
