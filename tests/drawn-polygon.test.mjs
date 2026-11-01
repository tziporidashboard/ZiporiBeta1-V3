import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import Papa from "papaparse";
import {
  evaluate,
  find,
  functionText,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";

const geometry = loadProductionModule("src/lib/drawn-polygon.ts");
const store = loadProductionModule("src/lib/observations-store.tsx");
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const taxonomy = loadProductionModule("src/lib/taxonomy-engine.ts");
const dict = loadProductionModule("src/lib/i18n.tsx");
const speciesDict = loadProductionModule("src/lib/species-dictionary.ts");
const rectangle = (west, south, east, north) => ({
  type: "Polygon",
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});
const polygon = rectangle(34, 31, 36, 33);
const point = (longitude, latitude) => ({ longitude, latitude });
const inside = (p, shape = polygon) => geometry.observationMatchesDrawnPolygon(p, shape);
const observation = (id, longitude, latitude, patch = {}) =>
  Object.freeze({
    composite_id: id,
    longitude,
    latitude,
    observed_on: "15/09/2025",
    scientific_name: "Acridotheres tristis",
    iconic_taxon_name: "Aves",
    taxon_order_name: "",
    user_login: id,
    user_category: "online_communities",
    user_subcategory: "community",
    quality_grade: "research",
    source: "inaturalist",
    ...patch,
  });
const observations = Object.freeze([
  observation("inside", 35, 32),
  observation("edge", 34, 32),
  observation("outside", 37, 32),
  observation("expert", 35.5, 32, {
    source: "merlin",
    user_category: "expert",
    user_subcategory: "expert",
  }),
  observation("mammal", 35, 32, { scientific_name: "Canis aureus", iconic_taxon_name: "Mammalia" }),
  observation("invalid", NaN, 32),
]);
const defaults = () => ({
  drawnPolygon: null,
  dateRange: null,
  time: new Map(),
  taxa: new Set(store.TAXA_GROUP_KEYS),
  groups: new Set(["expert", "online_communities"]),
  localCommunitySubgroups: new Set(),
  qualityGrades: quality.createDefaultQualitySelection(),
  areas: new Set(survey.SURVEY_AREA_KEYS),
  monitoringAreas: new Set(),
  speciesTypes: new Set(["invasive", "rare", "other_species"]),
});
const monitoringAreas = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "zone", name: "zone", color: "blue" },
      geometry: rectangle(35.25, 31.5, 35.75, 32.5),
    },
  ],
};
const observationMonitoringAreaIndex = areas.buildObservationMonitoringAreaIndex(
  observations.filter((o) => geometry.hasValidCoordinates(o)),
  monitoringAreas,
);
const bindings = {
  ...store,
  ...areas,
  ...survey,
  ...quality,
  ...taxonomy,
  observationMonitoringAreaIndex,
};
const ast = (name) => tree(read(`src/components/${name}.tsx`));
const dashboard = ast("dashboard"),
  species = ast("species-deep-dive"),
  people = ast("people-dashboard"),
  mapAst = ast("observation-map"),
  control = ast("polygon-filter-control");
const memo = (source, name) => variable(source, name).initializer.arguments[0].getText(source);
const runMemo = (source, name, values) =>
  evaluate(`return (${memo(source, name)})();`, { ...bindings, ...values });
const pipeline = (source, name, filters, rows = observations) =>
  evaluate(`${functionText(source, "parseObsTimestamp")} return (${memo(source, name)})();`, {
    ...bindings,
    observations: rows,
    filters,
  });
const ids = (rows) => rows.map((o) => o.composite_id).sort();
const pipelines = [
  [dashboard, "filtered"],
  [dashboard, "chartData"],
  [dashboard, "metricsData"],
  [species, "globallyFilteredObservations"],
  [people, "globallyFilteredObservations"],
];

test("no polygon is a no-op, including records without usable coordinates", () => {
  for (const p of [point(35, 32), point(NaN, 32), point(null, undefined)])
    assert.equal(inside(p, null), true);
  for (const [source, name] of pipelines)
    assert.deepEqual(
      pipeline(source, name, defaults()),
      pipeline(source, name, { ...defaults(), drawnPolygon: undefined }),
    );
});

test("GeoJSON longitude/latitude order, edges and vertices are respected", () => {
  for (const p of [
    point(35, 32),
    point(34, 32),
    point(36, 32),
    point(35, 31),
    point(35, 33),
    point(34, 31),
  ])
    assert.equal(inside(p), true);
  for (const p of [point(32, 35), point(33.999, 32), point(37, 32)]) assert.equal(inside(p), false);
});

test("invalid, missing and out-of-range coordinates cannot pass an active polygon", () => {
  for (const p of [
    point(NaN, 32),
    point(Infinity, 32),
    point(181, 32),
    point(35, 91),
    point(null, 32),
    point("35", 32),
    {},
  ])
    assert.equal(inside(p), false);
});

test("concave polygons test the actual shape, not only its bounding box", () => {
  const concave = {
    type: "Polygon",
    coordinates: [
      [
        [34, 31],
        [36, 31],
        [36, 32],
        [35, 32],
        [35, 33],
        [34, 33],
        [34, 31],
      ],
    ],
  };
  assert.equal(inside(point(35.5, 32.5), concave), false);
  assert.equal(inside(point(34.5, 32.5), concave), true);
  assert.equal(inside(point(35, 32.5), concave), true);
});

test("unfinished and zero-area shapes are rejected; small legitimate areas pass", () => {
  assert.equal(geometry.isValidDrawnPolygon(polygon), true);
  assert.equal(geometry.isValidDrawnPolygon(rectangle(35, 32, 35.000001, 32.000001)), true);
  for (const coordinates of [
    [],
    [
      [
        [34, 31],
        [35, 32],
        [36, 33],
        [34, 31],
      ],
    ],
    [
      [
        [34, 31],
        [36, 31],
        [36, 33],
      ],
    ],
  ])
    assert.equal(geometry.isValidDrawnPolygon({ type: "Polygon", coordinates }), false);
});

test("all five existing geographic pipelines include both sources and exclude outside/invalid records", () => {
  for (const [source, name] of pipelines)
    assert.deepEqual(
      ids(pipeline(source, name, { ...defaults(), drawnPolygon: polygon })),
      ["edge", "expert", "inside", "mammal"],
      name,
    );
});

test("polygon intersects taxa, quality, dates, groups and existing monitoring-area selections", () => {
  const filters = {
    ...defaults(),
    drawnPolygon: polygon,
    taxa: new Set(["birds"]),
    areas: new Set(),
    monitoringAreas: new Set(["zone"]),
  };
  for (const [source, name] of pipelines)
    assert.deepEqual(ids(pipeline(source, name, filters)), ["expert"]);
  assert.deepEqual(
    pipeline(dashboard, "filtered", { ...filters, groups: new Set(["online_communities"]) }),
    [],
  );
  assert.deepEqual(pipeline(dashboard, "filtered", { ...filters, qualityGrades: new Set() }), []);
  assert.deepEqual(
    pipeline(dashboard, "filtered", { ...filters, time: new Map([["2024", new Set()]]) }),
    [],
  );
  assert.deepEqual(
    pipeline(dashboard, "filtered", { ...filters, dateRange: { start: 0, end: 1 } }),
    [],
  );
});

test("removal preserves other filters; replacement and an empty area immediately replace results", () => {
  const base = { ...defaults(), taxa: new Set(["birds"]) };
  assert.deepEqual(ids(pipeline(dashboard, "filtered", { ...base, drawnPolygon: polygon })), [
    "edge",
    "expert",
    "inside",
  ]);
  assert.deepEqual(
    ids(pipeline(dashboard, "filtered", { ...base, drawnPolygon: rectangle(36.5, 31, 37.5, 33) })),
    ["outside"],
  );
  assert.deepEqual(
    pipeline(dashboard, "filtered", { ...base, drawnPolygon: rectangle(1, 1, 2, 2) }),
    [],
  );
  assert.deepEqual(
    pipeline(dashboard, "filtered", { ...base, drawnPolygon: null }),
    pipeline(dashboard, "filtered", base),
  );
});

function prop(source, component, name, values) {
  const element = find(
    source,
    (n) => ts.isJsxSelfClosingElement(n) && n.tagName.getText(source) === component,
  );
  const attribute = element.attributes.properties.find((p) => p.name.text === name);
  return evaluate(`return (${attribute.initializer.expression.getText(source)});`, values);
}

test("map, counters, tables and charts all receive polygon-filtered records", () => {
  const filtered = pipeline(dashboard, "filtered", { ...defaults(), drawnPolygon: polygon });
  for (const component of ["ObservationMap", "MetricsTable", "TimeSeriesChart"])
    assert.equal(prop(dashboard, component, "data", { filtered }), filtered);
  assert.equal(runMemo(dashboard, "summary", { filtered }).rows, filtered.length);
  const globallyFilteredObservations = pipeline(species, "globallyFilteredObservations", {
    ...defaults(),
    drawnPolygon: polygon,
  });
  const values = {
    globallyFilteredObservations,
    category: "birds",
    species: new Set(["Acridotheres tristis"]),
  };
  const deepDiveFiltered = runMemo(species, "deepDiveFiltered", values);
  assert.deepEqual(ids(prop(species, "ObservationMap", "data", { deepDiveFiltered })), [
    "edge",
    "expert",
    "inside",
  ]);
  assert.equal(prop(species, "SpeciesInsightsTable", "data", values), globallyFilteredObservations);
  assert.equal(
    prop(species, "DeepDiveTimeSeriesChart", "allObservations", values),
    globallyFilteredObservations,
  );
  const displayObservations = runMemo(people, "displayObservations", {
    groupObservations: filtered,
    selectedUser: "expert",
  });
  assert.deepEqual(ids(displayObservations), ["expert"]);
  assert.equal(
    prop(people, "ObservationMap", "data", { displayObservations }),
    displayObservations,
  );
  for (const component of ["UserAnalyticsTable", "UserActivityChart"])
    assert.equal(
      prop(people, component, "observations", { displayObservations }),
      displayObservations,
    );
  assert.equal(runMemo(people, "summary", { displayObservations }).rows, 1);
});

test("selected observation details can only resolve currently visible records", () => {
  const data = pipeline(dashboard, "filtered", { ...defaults(), drawnPolygon: polygon });
  const observationsMap = runMemo(mapAst, "observationsMap", { data });
  const selected = runMemo(mapAst, "selectedObservations", {
    observationsMap,
    selectedBubbleIds: ["inside", "outside"],
  });
  assert.deepEqual(ids(selected), ["inside"]);
});

test("global reset and a new provider both initialize with no polygon", () => {
  const route = tree(read("src/routes/index.tsx"));
  let filters;
  evaluate(`return (${variable(route, "reset").initializer.getText(route)});`, {
    ...bindings,
    observations,
    monitoringAreas,
    datasetBounds: null,
    uniqueYears: ["2025"],
    deepDiveActions: { setDeepDiveCategory() {} },
    setFilters: (next) => {
      filters = next;
    },
    bumpResetVersion() {},
  })();
  assert.equal(filters.drawnPolygon, null);
  const source = tree(read("src/lib/observations-store.tsx"));
  const initial = variable(source, "[filters, setFilters]").initializer.arguments[0];
  assert.equal(evaluate(`return (${initial.getText(source)});`, bindings).drawnPolygon, null);
});

test("both export actions retain their inputs and bilingual CSV structure", async () => {
  const filtered = pipeline(dashboard, "filtered", { ...defaults(), drawnPolygon: polygon });
  const callbacks = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === "onSelect")
      callbacks.push(node.initializer.expression.getText(dashboard));
    ts.forEachChild(node, visit);
  }
  visit(dashboard);
  const exportAst = tree(read("src/lib/export-observations.ts"));
  for (const lang of ["he", "en"]) {
    let blob;
    const exportRows = evaluate(
      `const ${variable(exportAst, "ENGLISH_HEADERS").getText(exportAst)}; ${functionText(exportAst, "exportObservations")} return exportObservations;`,
      {
        ...bindings,
        ...dict,
        ...speciesDict,
        Papa,
        Blob,
        URL: {
          createObjectURL(value) {
            blob = value;
            return "blob:test";
          },
          revokeObjectURL() {},
        },
        document: {
          createElement: () => ({ click() {}, remove() {} }),
          body: { appendChild() {} },
        },
        setTimeout: (fn) => fn(),
      },
    );
    let headers;
    for (const [index, callback] of callbacks.entries()) {
      evaluate(`return (${callback});`, {
        filtered,
        observations,
        monitoringAreas,
        observationMonitoringAreaIndex,
        lang,
        exportObservations: exportRows,
      })();
      const csv = Papa.parse(await blob.text(), { header: true, skipEmptyLines: true });
      const expected = index === 0 ? filtered : observations;
      assert.deepEqual(
        csv.data.map((r) => r[lang === "he" ? "מזהה תצפית" : "Observation ID"]).sort(),
        ids(expected),
      );
      if (headers) assert.deepEqual(csv.meta.fields, headers);
      headers = csv.meta.fields;
    }
    assert.equal(callbacks.length, 2);
  }
});

test("Geoman lifecycle replaces one polygon, cancels drafts and cleans all listeners on remount", () => {
  const effect = find(
    control,
    (n) =>
      ts.isCallExpression(n) &&
      n.expression.getText(control) === "useEffect" &&
      n.arguments[0].getText(control).includes('map.on("pm:create"'),
  );
  class Events {
    listeners = new Map();
    on(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    off(name, callback) {
      this.listeners.get(name)?.delete(callback);
    }
    fire(name, event) {
      this.listeners.get(name)?.forEach((fn) => fn(event));
    }
    count() {
      return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
    }
  }
  class Polygon {
    constructor(geometry) {
      this.geometry = geometry;
    }
    toGeoJSON(precision) {
      assert.equal(precision, false);
      return { geometry: this.geometry };
    }
  }
  const map = new Events(),
    document = new Events(),
    workingLayer = new Events();
  document.addEventListener = document.on;
  document.removeEventListener = document.off;
  let drawing = false,
    vertexCount = 0,
    invalid = false,
    removed = 0,
    filters = { ...defaults(), drawnPolygon: polygon };
  map.removeLayer = () => removed++;
  map.pm = {
    globalDrawModeEnabled: () => drawing,
    disableDraw() {
      drawing = false;
      map.fire("pm:drawend");
    },
  };
  const mount = () =>
    evaluate(`return (${effect.arguments[0].getText(control)})();`, {
      ...geometry,
      L: { Polygon },
      map,
      document,
      setFilters: (fn) => {
        filters = fn(filters);
      },
      onDrawingChange: (value) => {
        drawing = value;
      },
      setVertexCount: (value) => {
        vertexCount = typeof value === "function" ? value(vertexCount) : value;
      },
      setInvalid: (value) => {
        invalid = value;
      },
    });
  for (let cycle = 0; cycle < 2; cycle++) {
    const cleanup = mount();
    assert.equal(map.count(), 3);
    assert.equal(document.count(), 1);
    map.fire("pm:drawstart", { workingLayer });
    workingLayer.fire("pm:vertexadded");
    assert.equal(vertexCount, 1);
    const previous = filters;
    document.fire("keydown", { key: "Escape" });
    assert.equal(drawing, false);
    assert.equal(filters, previous);
    assert.equal(workingLayer.count(), 0);
    map.fire("pm:drawstart", { workingLayer });
    const replacement = rectangle(36, 31, 38, 33);
    map.fire("pm:create", { shape: "Polygon", layer: new Polygon(replacement) });
    map.fire("pm:drawend");
    assert.equal(filters.drawnPolygon, replacement);
    assert.equal(filters.taxa, previous.taxa);
    map.fire("pm:create", {
      shape: "Polygon",
      layer: new Polygon({ type: "Polygon", coordinates: [] }),
    });
    assert.equal(invalid, true);
    assert.equal(filters.drawnPolygon, replacement);
    map.fire("pm:drawstart", { workingLayer });
    cleanup();
    assert.equal(map.count(), 0);
    assert.equal(document.count(), 0);
    assert.equal(workingLayer.count(), 0);
    assert.equal(drawing, false);
  }
  assert.equal(removed, 4);
});
