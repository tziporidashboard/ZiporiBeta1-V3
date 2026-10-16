import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import Papa from "papaparse";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  evaluate,
  find,
  functionText,
  loadPipeline,
  loadProductionModule,
  read,
  root,
  tree,
  variable,
} from "./helpers/observation-source.mjs";

// Compare dates with the approved pre-fix commit. The separately tested name
// enrichment is allowed; every other field must remain unchanged.
const baselineCommit = "d4b5a40bbb91629bdc3b7c95623007763524ac90";
const storePath = "src/lib/observations-store.tsx";
const { getInaturalistCommonName } = loadProductionModule("src/lib/observation-enrichment.ts");

function csv(file) {
  const parsed = Papa.parse(read(file), { header: true, skipEmptyLines: true });
  assert.equal(parsed.errors.length, 0, file);
  return parsed.data;
}

const inat = csv("public/Until_June26.csv");
const merlin = csv("public/MERLIN all observations for Zohar.csv");
const users = new Map(csv("public/user_groups.csv").map((r) => [r.user_login, r.group]));
const rawRows = [
  ...inat.map((raw) => ({ source: "inaturalist", raw, id: `inat_${raw.id}` })),
  ...merlin.map((raw) => ({ source: "merlin", raw, id: `expert_${raw.observationID}` })),
];

// Independent expectations come directly from the documented raw source formats.
const expected = rawRows.map(({ source, raw, id }) => {
  let year, month, day;
  if (source === "inaturalist") {
    assert.match(raw.observed_on, /^\d{2}\/\d{2}\/\d{4}$/);
    [day, month, year] = raw.observed_on.split("/");
  } else {
    assert.match(raw.timeStamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    [year, month, day] = raw.timeStamp.slice(0, 10).split("-");
  }
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  assert.equal(calendar.getUTCFullYear(), Number(year));
  assert.equal(calendar.getUTCMonth() + 1, Number(month));
  assert.equal(calendar.getUTCDate(), Number(day));
  const clockSource = source === "inaturalist" ? raw.observed_on_string : raw.timeStamp;
  const time = clockSource
    .split(/[T\s]/)
    .map((part) => part.split(/[Z+-]/)[0])
    .find((part) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(part));
  return { id, date: `${day}/${month}/${year}`, iso: `${year}-${month}-${day}`, time };
});
const expectedById = new Map(expected.map((r) => [r.id, r]));
const current = loadPipeline(read(storePath));
const baselineSource = execFileSync("git", ["show", `${baselineCommit}:${storePath}`], {
  cwd: root,
  encoding: "utf8",
});
const baseline = loadPipeline(baselineSource);
const before = baseline.load(inat, merlin, users);
const after = current.load(inat, merlin, users);
const corrected = after.filter((row, index) => row.observed_on !== before[index].observed_on);

test("all 12,674 source records survive; exactly 949 dates change and 11,725 stay unchanged", (t) => {
  assert.equal(inat.length, 10317);
  assert.equal(merlin.length, 2357);
  assert.equal(before.length, 12674);
  assert.equal(after.length, 12674);
  assert.equal(corrected.length, 949);
  assert.equal(after.length - corrected.length, 11725);
  assert.equal(new Set(after.map((r) => r.composite_id)).size, 12674);
  after.forEach((row, index) => {
    assert.equal(row.composite_id, expected[index].id);
    assert.equal(row.observed_on, expected[index].date, row.composite_id);
    const { observed_on: oldDate, ...oldMetadata } = before[index];
    const { observed_on: newDate, ...newMetadata } = row;
    const expectedMetadata =
      row.source === "inaturalist"
        ? {
            ...oldMetadata,
            common_name: getInaturalistCommonName(inat[index].id, oldMetadata.common_name),
          }
        : oldMetadata;
    assert.deepEqual(newMetadata, expectedMetadata, row.composite_id);
    if (oldDate === expected[index].date) assert.equal(newDate, oldDate);
  });
  t.diagnostic(
    "949 corrected; 11,725 unchanged; identifiers and other metadata preserved except the approved name enrichment.",
  );
});

test("all 2,357 MERLIN records remain byte-for-byte equivalent as observation objects", () => {
  assert.deepEqual(
    after.filter((r) => r.source === "merlin"),
    before.filter((r) => r.source === "merlin"),
  );
});

test("all available raw clock times are retained, including seconds; absent times remain absent", () => {
  after.forEach((row, index) =>
    assert.equal(row.observed_time, expected[index].time, row.composite_id),
  );
  assert.equal(after.filter((r) => r.observed_time === undefined).length, 24);
});

test("ambiguous, unambiguous, month/year-boundary and ISO dates use explicit source formats", () => {
  for (const [input, source, output] of [
    ["02/10/2024", "inaturalist", "02/10/2024"],
    ["04/11/2024", "inaturalist", "04/11/2024"],
    ["01/12/2025", "inaturalist", "01/12/2025"],
    ["10/02/2024", "inaturalist", "10/02/2024"],
    ["31/01/2025", "inaturalist", "31/01/2025"],
    ["31/12/2025 23:59:59", "inaturalist", "31/12/2025"],
    ["1/1/2026 00:00", "inaturalist", "01/01/2026"],
    [" 02/10/2024 ", "inaturalist", "02/10/2024"],
    ["2025-12-31", "merlin", "31/12/2025"],
    ["2026-01-01 00:00:00", "merlin", "01/01/2026"],
    ["2024-02-29T12:30:45Z", "merlin", "29/02/2024"],
  ])
    assert.equal(current.parseObservedOn(input, source), output, input);
  assert.equal(current.parseObservedOn("2024-10-02", "inaturalist"), "");
  assert.equal(current.parseObservedOn("02/10/2024", "merlin"), "");
  assert.equal(current.parseObservedOn("10/31/2024", "inaturalist"), "");
});

test("Gregorian calendar validation covers every day, leap centuries and impossible dates", () => {
  for (const year of [1900, 2000, 2023, 2024, 2025, 2026, 2100]) {
    for (let month = 1; month <= 12; month++) {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let day = 1; day <= lastDay + 1; day++) {
        const d = String(day).padStart(2, "0"),
          m = String(month).padStart(2, "0");
        const expectedDate = day <= lastDay ? `${d}/${m}/${year}` : "";
        assert.equal(current.parseObservedOn(`${d}/${m}/${year}`, "inaturalist"), expectedDate);
        assert.equal(current.parseObservedOn(`${year}-${m}-${d}`, "merlin"), expectedDate);
      }
    }
  }
  for (const input of [
    "",
    "garbage",
    "00/01/2024",
    "01/00/2024",
    "01/13/2024",
    "32/01/2024",
    "01/01/0000",
    "2x/10/2024",
    "01/01/2024junk",
    "01/01/24",
  ])
    assert.equal(current.parseObservedOn(input, "inaturalist"), "", input);
  for (const input of [
    "2024-00-01",
    "2024-13-01",
    "2024-04-31",
    "2023-02-29",
    "0000-01-01",
    "2024-01-01junk",
  ])
    assert.equal(current.parseObservedOn(input, "merlin"), "", input);
});

test("recorded dates and times do not shift across timezone offsets or host timezones", () => {
  const previousTimezone = process.env.TZ;
  try {
    for (const zone of ["UTC", "Asia/Jerusalem", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      for (const [input, date, time] of [
        ["2026-01-01T00:15:30+14:00", "01/01/2026", "00:15:30"],
        ["2025-12-31T23:45:12-12:00", "31/12/2025", "23:45:12"],
        ["2024-03-29T02:30:00+02:00", "29/03/2024", "02:30:00"],
        ["2024-10-27T01:30:00+03:00", "27/10/2024", "01:30:00"],
        ["2024-02-29T23:59Z", "29/02/2024", "23:59"],
      ]) {
        assert.equal(current.parseObservedOn(input, "merlin"), date, zone);
        assert.equal(current.parseObservedTime(input), time, zone);
      }
      assert.equal(
        current.parseObservedOn("02/10/2024 00:15:30+03:00", "inaturalist"),
        "02/10/2024",
      );
      assert.equal(current.parseObservedTime("02/10/2024 00:15:30+03:00"), "00:15:30");
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
  for (const input of ["2024-01-01", "2024-01-01 24:00", "2024-01-01 12:60", "2024-01-01 12:00:60"])
    assert.equal(current.parseObservedTime(input), undefined);
});

test("invalid calendar dates are safely excluded by both actual row transformations", () => {
  assert.equal(current.load([{ ...inat[0], observed_on: "31/04/2024" }], [], users).length, 0);
  assert.equal(
    current.load([], [{ ...merlin[0], timeStamp: "2023-02-29 12:00:00" }], users).length,
    0,
  );
});

function memoText(ast, name) {
  return variable(ast, name).initializer.arguments[0].getText(ast);
}

const qualityAst = tree(read("src/lib/quality-filter.ts"));
const matchesQualitySelection = evaluate(
  `const ${variable(qualityAst, "QUALITY_OPTIONS").getText(qualityAst)};
   ${functionText(qualityAst, "matchesQualitySelection")}; return matchesQualitySelection;`,
);
const monthKeys = [...new Set(expected.map((r) => r.iso.slice(0, 7)))];
const ids = (rows) => rows.map((r) => r.composite_id).sort();

for (const [file, name] of [
  ["dashboard.tsx", "filtered"],
  ["dashboard.tsx", "chartData"],
  ["dashboard.tsx", "metricsData"],
  ["people-dashboard.tsx", "globallyFilteredObservations"],
  ["species-deep-dive.tsx", "globallyFilteredObservations"],
]) {
  test(`${file}/${name}: date-range and month filters match raw dates for every populated month`, () => {
    const ast = tree(read(`src/components/${file}`));
    const run = evaluate(
      `${functionText(ast, "parseObsTimestamp")}
       return (observations, filters) => (${memoText(ast, name)})();`,
      {
        matchesQualitySelection,
        // Unchanged spatial/taxonomy filters are held open to isolate date behavior.
        observationMatchesSelectedAreas: () => true,
        observationMonitoringAreaIndex: new WeakMap(),
      },
    );
    const filters = {
      time: new Map(),
      dateRange: null,
      taxa: new Set(),
      speciesTypes: new Set(),
      qualityGrades: new Set(["research", "needs_id", "casual"]),
      groups: new Set(after.map((r) => r.user_category)),
      localCommunitySubgroups: new Set(after.map((r) => r.user_subcategory)),
    };
    assert.equal(run(after, filters).length, 12674);
    for (const monthKey of monthKeys) {
      const [year, month] = monthKey.split("-");
      const expectedIds = expected
        .filter((r) => r.iso.startsWith(monthKey))
        .map((r) => r.id)
        .sort();
      filters.time = new Map([[year, new Set([month])]]);
      assert.deepEqual(ids(run(after, filters)), expectedIds);
      filters.time = new Map();
      filters.dateRange = {
        start: new Date(Number(year), Number(month) - 1, 1).getTime(),
        end: new Date(Number(year), Number(month), 0, 23, 59, 59, 999).getTime(),
      };
      assert.deepEqual(ids(run(after, filters)), expectedIds);
      filters.dateRange = null;
    }
    for (const date of ["2024-10-02", "2024-11-04", "2025-12-01", "2025-12-31", "2026-01-01"]) {
      const [year, month, day] = date.split("-").map(Number);
      filters.dateRange = {
        start: new Date(year, month - 1, day).getTime(),
        end: new Date(year, month - 1, day, 23, 59, 59, 999).getTime(),
      };
      assert.deepEqual(
        ids(run(after, filters)),
        expected
          .filter((r) => r.iso === date)
          .map((r) => r.id)
          .sort(),
      );
    }
  });
}

test("monthly chart counts and People/Deep Dive sort keys agree with raw year/month values", () => {
  const ast = tree(read("src/components/time-series-chart.tsx"));
  const run = evaluate(
    `return (data) => (${memoText(ast, "{ rawCounts, allSortKeys, allGroups }")})();`,
    {
      lang: "en",
      translateMonth: String,
      PROFESSIONAL_MONITORING_KEY: "expert",
    },
  );
  const counts = run(after).rawCounts;
  for (const monthKey of monthKeys) {
    const entry = counts.get(Number(monthKey.replace("-", "")));
    assert.equal(
      [...entry.counts.values()].reduce((a, b) => a + b, 0),
      expected.filter((r) => r.iso.startsWith(monthKey)).length,
    );
  }
  for (const file of ["user-activity-chart.tsx", "deep-dive-time-series-chart.tsx"]) {
    const consumer = tree(read(`src/components/${file}`));
    const parse = evaluate(`${functionText(consumer, "parseSortKey")}; return parseSortKey;`, {
      lang: "en",
      translateMonth: String,
    });
    after.forEach((row, index) =>
      assert.equal(
        parse(row.observed_on, "en").sortKey,
        Number(expected[index].iso.slice(0, 7).replace("-", "")),
      ),
    );
  }
});

test("seasonal classification uses the source month for every observation", () => {
  const seasons = [
    "חורף",
    "חורף",
    "אביב",
    "אביב",
    "אביב",
    "קיץ",
    "קיץ",
    "קיץ",
    "סתיו",
    "סתיו",
    "סתיו",
    "חורף",
  ];
  for (const [file, name] of [
    ["species-insights-table.tsx", "getSeasonalStatus"],
    ["user-analytics-table.tsx", "getPreferredSeason"],
  ]) {
    const ast = tree(read(`src/components/${file}`));
    const classify = evaluate(`${functionText(ast, name)}; return ${name};`);
    after.forEach((row, index) =>
      assert.equal(classify([row]), seasons[Number(expected[index].iso.slice(5, 7)) - 1]),
    );
  }
});

test("map bubble records and rendered sidebar dates use corrected dates without losing IDs", () => {
  const ast = tree(read("src/components/observation-map.tsx"));
  const group = evaluate(`return (data) => (${memoText(ast, "bubbles")})();`, {
    getTaxaGroup: () => "other",
  });
  const bubbles = group(after);
  assert.equal(
    bubbles.reduce((n, b) => n + b.count, 0),
    12674,
  );
  for (const bubble of bubbles) {
    bubble.observation_ids.forEach((id, index) =>
      assert.equal(bubble.raw_observations[index].date, expectedById.get(id).date),
    );
  }
  const dateElement = find(
    ast,
    (node) =>
      ts.isJsxElement(node) &&
      node.children.some(
        (child) =>
          ts.isJsxExpression(child) && child.expression?.getText(ast) === "obs.observed_on",
      ),
  );
  const render = evaluate(`return (obs) => (${dateElement.getText(ast)});`, { t: () => "Date" });
  for (const row of corrected)
    assert.ok(renderToStaticMarkup(render(row)).includes(expectedById.get(row.composite_id).date));
});

test("Hebrew and English CSV exports preserve all source dates, times and identifiers", async () => {
  const ast = tree(read("src/lib/export-observations.ts"));
  for (const lang of ["he", "en"]) {
    let blob;
    const exportRows = evaluate(
      `const ${variable(ast, "ENGLISH_HEADERS").getText(ast)};
       ${functionText(ast, "exportObservations")}; return exportObservations;`,
      {
        Papa,
        Blob,
        URL: {
          createObjectURL: (value) => {
            blob = value;
            return "blob:test";
          },
          revokeObjectURL: () => {},
        },
        document: {
          createElement: () => ({ click() {}, remove() {} }),
          body: { appendChild() {} },
        },
        setTimeout: (fn) => fn(),
        getLabel: (key) => key,
        getSpeciesClassification: () => "other_species",
        getTaxaGroup: () => "other",
        translateGroupName: (name) => name,
        getSpeciesEnglishName: () => undefined,
        getObservationArea: () => null,
        translateArea: (name) => name,
        translateMonitoringAreaName: () => "",
      },
    );
    exportRows(after, null, new WeakMap(), lang);
    const rows = Papa.parse(await blob.text(), { header: true, skipEmptyLines: true }).data;
    assert.equal(rows.length, 12674);
    rows.forEach((row, index) => {
      assert.equal(row[lang === "he" ? "מזהה תצפית" : "Observation ID"], expected[index].id);
      assert.equal(row[lang === "he" ? "תאריך תצפית" : "Observation Date"], expected[index].iso);
      assert.equal(
        row[lang === "he" ? "שעת תצפית" : "Observation Time"],
        expected[index].time ?? "",
      );
    });
  }
});
