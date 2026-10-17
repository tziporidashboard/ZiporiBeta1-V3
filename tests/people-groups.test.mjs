import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Papa from "papaparse";
import ts from "typescript";
import {
  evaluate,
  find,
  functionText,
  loadPipeline,
  loadProductionModule,
  read,
  tree,
  variable,
} from "./helpers/observation-source.mjs";

const store = loadProductionModule("src/lib/observations-store.tsx");
const quality = loadProductionModule("src/lib/quality-filter.ts");
const areas = loadProductionModule("src/lib/monitoring-areas.ts");
const survey = loadProductionModule("src/lib/survey-polygons.ts");
const csv = (file) => {
  const parsed = Papa.parse(read(file), { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.errors, [], file);
  return parsed.data;
};
const rawInat = csv("public/Until_June26.csv");
const userGroups = new Map(csv("public/user_groups.csv").map((r) => [r.user_login, r.group]));
const observations = loadPipeline(read("src/lib/observations-store.tsx")).load(
  rawInat,
  csv("public/MERLIN all observations for Zohar.csv"),
  userGroups,
);
// Expected membership is derived independently from the unchanged source files.
const studentIds = new Set(
  rawInat
    .filter((r) => userGroups.get(r.user_login.trim()) === "student")
    .map((r) => `inat_${r.id}`),
);
const students = observations.filter((o) => studentIds.has(o.composite_id));
observations.forEach(Object.freeze);
Object.freeze(observations);
const monitoringAreas = JSON.parse(read("public/monitoring-areas.geojson"));
const observationMonitoringAreaIndex = areas.buildObservationMonitoringAreaIndex(
  observations,
  monitoringAreas,
);
const bindings = { ...store, ...quality, ...areas, observationMonitoringAreaIndex };
const people = tree(read("src/components/people-dashboard.tsx"));
const dashboard = tree(read("src/components/dashboard.tsx"));
const sidebar = tree(read("src/components/filter-sidebar.tsx"));
const memo = (ast, name) => variable(ast, name).initializer.arguments[0].getText(ast);
const groups = evaluate(`const ${variable(people, "GROUPS").getText(people)}; return GROUPS;`);

// Run the actual People callbacks, including badges, search and per-user drill-down.
const runPeople = evaluate(
  `const ${variable(people, "GROUPS").getText(people)};
  ${functionText(people, "parseObsTimestamp")}
  return (observations, filters, selectedGroup = null, selectedUser = null, userSearch = "") => {
    ${[
      "globallyFilteredObservations",
      "groupObservations",
      "displayObservations",
      "summary",
      "groupCounts",
      "userChipList",
      "userDropdownList",
      "topUserLogins",
    ]
      .map((name) => `const ${name} = (${memo(people, name)})();`)
      .join("\n")}
    return { globallyFilteredObservations, groupObservations, displayObservations, summary, groupCounts, userChipList, userDropdownList, topUserLogins };
  };`,
  bindings,
);
const runMain = evaluate(
  `${functionText(dashboard, "parseObsTimestamp")}
  return (observations, filters) => (${memo(dashboard, "filtered")})();`,
  bindings,
);
const defaults = () => ({
  dateRange: null,
  time: new Map(),
  qualityGrades: quality.createDefaultQualitySelection(),
  taxa: new Set(),
  speciesTypes: new Set(),
  groups: new Set(["expert", "local_communities", "online_communities"]),
  localCommunitySubgroups: new Set(["student", "zevulun", "yizrael", "mechnistim"]),
  areas: new Set(survey.SURVEY_AREA_KEYS),
  monitoringAreas: new Set(monitoringAreas.features.map((f) => f.properties.id)),
});
const ids = (rows) => rows.map((o) => o.composite_id).sort();
const result = (filters = defaults()) => runPeople(observations, filters, "student");
const dayTimestamp = (o) => {
  const [day, month, year] = o.observed_on.split("/").map(Number);
  return new Date(year, month - 1, day).getTime();
};

test("Students badge and results identify all 1,097 historical students under Local Communities", () => {
  assert.equal(studentIds.size, 1097);
  assert.equal(students.length, 1097);
  assert.ok(
    students.every(
      (o) => o.user_category === "local_communities" && o.user_subcategory === "student",
    ),
  );
  const selected = result();
  assert.equal(selected.globallyFilteredObservations.length, 12674);
  assert.equal(selected.groupCounts.get("student"), 1097);
  assert.equal(selected.summary.rows, 1097);
  assert.deepEqual(ids(selected.displayObservations), [...studentIds].sort());
  assert.equal(selected.summary.observers, new Set(students.map((o) => o.user_login)).size);
});

test("other group memberships and Hebrew/English labels remain correct", () => {
  const expected = {
    expert: 2357,
    zevulun: 1346,
    yizrael: 295,
    mechnistim: 351,
    student: 1097,
    public: 7228,
  };
  const all = runPeople(observations, defaults());
  assert.equal(all.summary.rows, 12674);
  assert.deepEqual(Object.fromEntries(all.groupCounts), expected);
  for (const [key, count] of Object.entries(expected)) {
    const rows = runPeople(observations, defaults(), key).displayObservations;
    const independentlySelected = observations.filter((o) =>
      key === "public"
        ? o.user_category === "online_communities" && o.user_subcategory === "community"
        : key === "expert"
          ? o.user_category === "expert"
          : o.user_subcategory === key,
    );
    assert.equal(rows.length, count);
    assert.deepEqual(ids(rows), ids(independentlySelected));
  }
  assert.equal(groups.find((g) => g.key === "student").label, "תלמידים");
  assert.equal(store.translateGroupName("student", "he"), "תלמידים");
  assert.equal(store.translateGroupName("student", "en"), "Students");
});

test("membership follows each observation's subgroup, independent of user-level assignment", () => {
  // Predicate-only fixtures, never added to the historical data or import pipeline.
  const match = groups.find((g) => g.key === "student").match;
  const record = {
    user_login: "same-user",
    user_category: "local_communities",
    user_subcategory: "student",
  };
  assert.equal(match(record), true);
  assert.equal(match({ ...record, user_subcategory: "zevulun" }), false);
  assert.equal(
    match({ ...record, user_category: "online_communities", user_subcategory: "community" }),
    false,
  );
  assert.equal(match({ ...record, user_login: "not-in-user-groups" }), true);
});

test("Students combines correctly with all eight quality selections, including Casual", () => {
  const grades = ["research", "needs_id", "casual"];
  for (let mask = 0; mask < 8; mask++) {
    const filters = defaults();
    filters.qualityGrades = new Set(grades.filter((_, bit) => mask & (1 << bit)));
    const expected = students.filter((o) => filters.qualityGrades.has(o.quality_grade));
    assert.deepEqual(ids(result(filters).displayObservations), ids(expected));
    assert.equal(result(filters).groupCounts.get("student"), expected.length);
  }
});

test("Students combines with month and date-range filters for every populated student month", () => {
  for (const key of new Set(students.map((o) => o.observed_on.slice(3)))) {
    const [month, year] = key.split("/");
    const expected = students.filter((o) => o.observed_on.slice(3) === key);
    const filters = defaults();
    filters.time = new Map([[year, new Set([month])]]);
    assert.deepEqual(ids(result(filters).displayObservations), ids(expected));
    filters.time = new Map();
    filters.dateRange = {
      start: new Date(Number(year), Number(month) - 1, 1).getTime(),
      end: new Date(Number(year), Number(month), 0).getTime(),
    };
    assert.deepEqual(ids(result(filters).displayObservations), ids(expected));
  }
});

test("Students combines with taxa, species-type, survey-area and monitoring-area filters", () => {
  const check = (patch, predicate) => {
    assert.deepEqual(
      ids(result({ ...defaults(), ...patch }).displayObservations),
      ids(students.filter(predicate)),
    );
  };
  for (const key of store.TAXA_GROUP_KEYS)
    check({ taxa: new Set([key]) }, (o) => store.getTaxaGroup(o) === key);
  for (const key of ["invasive", "rare", "other_species"])
    check({ speciesTypes: new Set([key]) }, (o) => store.getSpeciesClassification(o) === key);
  for (const key of survey.SURVEY_AREA_KEYS)
    check(
      { areas: new Set([key]), monitoringAreas: new Set() },
      (o) => (survey.getObservationArea(o.latitude, o.longitude) ?? "other_areas") === key,
    );
  for (const feature of monitoringAreas.features) {
    const key = feature.properties.id;
    check({ areas: new Set(), monitoringAreas: new Set([key]) }, (o) =>
      observationMonitoringAreaIndex.get(o)?.has(key),
    );
  }
  check({ areas: new Set(), monitoringAreas: new Set() }, () => false);
  const anchor = students[0];
  const [day, month, year] = anchor.observed_on.split("/");
  const filters = {
    ...defaults(),
    time: new Map([[year, new Set([month])]]),
    dateRange: { start: dayTimestamp(anchor), end: dayTimestamp(anchor) },
    qualityGrades: new Set([anchor.quality_grade]),
    taxa: new Set([store.getTaxaGroup(anchor)]),
    speciesTypes: new Set([store.getSpeciesClassification(anchor)]),
    areas: new Set([survey.getObservationArea(anchor.latitude, anchor.longitude) ?? "other_areas"]),
    monitoringAreas: new Set(),
  };
  const expected = students.filter(
    (o) =>
      o.observed_on === `${day}/${month}/${year}` &&
      o.quality_grade === anchor.quality_grade &&
      store.getTaxaGroup(o) === store.getTaxaGroup(anchor) &&
      store.getSpeciesClassification(o) === store.getSpeciesClassification(anchor) &&
      (survey.getObservationArea(o.latitude, o.longitude) ?? "other_areas") ===
        [...filters.areas][0],
  );
  assert.ok(expected.length > 0 && expected.length < 1097);
  assert.deepEqual(ids(result(filters).displayObservations), ids(expected));
});

test("People retains its independent group selector; per-user selection, search and reset work", () => {
  const filters = { ...defaults(), groups: new Set(), localCommunitySubgroups: new Set() };
  assert.equal(result(filters).summary.rows, 1097);
  const user = students[0].user_login;
  const expected = students.filter((o) => o.user_login === user);
  const selected = runPeople(observations, filters, "student", user, ` ${user.toUpperCase()} `);
  assert.deepEqual(ids(selected.displayObservations), ids(expected));
  assert.equal(
    selected.userChipList.reduce((total, row) => total + row.count, 0),
    1097,
  );
  assert.ok(
    selected.userDropdownList.some((row) => row.user === user && row.count === expected.length),
  );
  const reset = find(
    people,
    (n) =>
      ts.isCallExpression(n) &&
      n.expression.getText(people) === "useEffect" &&
      n.arguments[1]?.getText(people) === "[resetVersion]",
  ).arguments[0];
  let selectedGroup = "student",
    selectedUser = user;
  evaluate(`return (${reset.getText(people)});`, {
    setSelectedGroup: (v) => {
      selectedGroup = v;
    },
    setSelectedUser: (v) => {
      selectedUser = v;
    },
  })();
  assert.equal(selectedGroup, null);
  assert.equal(selectedUser, null);
  assert.equal(
    runPeople(observations, defaults(), selectedGroup, selectedUser).summary.rows,
    12674,
  );
});

test("sidebar parent/subgroup toggles preserve Students within Local Communities", () => {
  let filters = { ...defaults(), groups: new Set(), localCommunitySubgroups: new Set() };
  const options = evaluate(`return (${memo(sidebar, "localCommunityOptions")})();`, {
    ...store,
    lang: "he",
  });
  const toggle = (name, value) =>
    evaluate(`return ${variable(sidebar, name).initializer.getText(sidebar)};`, {
      setFilters: (update) => {
        filters = update(filters);
      },
      localCommunityOptions: options,
    })(value);
  toggle("toggleLocalCommunitySubgroup", "student");
  assert.ok(filters.groups.has("local_communities"));
  assert.deepEqual(ids(runMain(observations, filters)), [...studentIds].sort());
  toggle("toggleGroup", "local_communities");
  assert.equal(runMain(observations, filters).length, 0);
  toggle("toggleGroup", "local_communities");
  assert.equal(runMain(observations, filters).length, 1097);
  toggle("toggleLocalCommunitySubgroup", "zevulun");
  assert.equal(runMain(observations, filters).length, 1097 + 1346);
  toggle("toggleLocalCommunitySubgroup", "student");
  assert.equal(runMain(observations, filters).length, 1346);
  toggle("toggleLocalCommunitySubgroup", "zevulun");
  assert.ok(!filters.groups.has("local_communities"));
  assert.equal(runMain(observations, filters).length, 0);
  toggle("toggleAllLocalCommunitySubgroups", true);
  assert.equal(runMain(observations, filters).length, 3089);
  toggle("toggleAllLocalCommunitySubgroups", false);
  toggle("toggleGroup", "online_communities");
  assert.equal(runMain(observations, filters).length, 7228);
});

test("filtering leaves all 12,674 enriched historical observation objects unchanged", () => {
  assert.equal(observations.length, 12674);
  assert.equal(new Set(observations.map((o) => o.composite_id)).size, 12674);
  // Fingerprint captured from the actual loaded data before this filter-only fix.
  assert.equal(
    createHash("sha256").update(JSON.stringify(observations)).digest("hex"),
    "b32476e2cd6ee766678b58d583314f2ea802dab368e7fa95587a027ae87d421a",
  );
});
