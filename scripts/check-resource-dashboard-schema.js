const assert = require("node:assert/strict");
const fs = require("node:fs");

const appCore = fs.readFileSync("app-core.js", "utf8");
function extractFunction(name) {
  const start = appCore.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `expected frontend helper ${name}`);
  const end = appCore.indexOf("\n  function ", start + 1);
  return appCore.slice(start, end < 0 ? appCore.length : end);
}

const courseTitleConstant =
  appCore.match(/  const COURSE_TITLES = \{[\s\S]*?\n  \};/)?.[0] || "";
assert.ok(courseTitleConstant, "the course-title map should be centralized");
const getResourceDashboardFileId = extractFunction(
  "getResourceDashboardFileId",
);
const testedHelpers = new Function(
  [
    courseTitleConstant,
    "let resourceDashboardCourseNamesEnabled = false;",
    getResourceDashboardFileId,
    extractFunction("getCourseCodeMatch"),
    extractFunction("getCourseTitle"),
    extractFunction("buildCourseCatalogEntries"),
    extractFunction("getCourseHeading"),
    extractFunction("extractLeadingOrderNumber"),
    extractFunction("cleanResourceDisplayName"),
    extractFunction("compareResourceOrder"),
    extractFunction("normalizeResourceDashboardIndex"),
    extractFunction("normalizeResourceDashboardTabs"),
    `return {
      COURSE_TITLES,
      getCourseCodeMatch,
      getCourseTitle,
      buildCourseCatalogEntries,
      getCourseHeading,
      extractLeadingOrderNumber,
      cleanResourceDisplayName,
      compareResourceOrder,
      normalizeResourceDashboardIndex,
      normalizeResourceDashboardTabs
    };`,
  ].join("\n"),
)();

const {
  COURSE_TITLES,
  getCourseCodeMatch,
  getCourseTitle,
  buildCourseCatalogEntries,
  getCourseHeading,
  extractLeadingOrderNumber,
  cleanResourceDisplayName,
  compareResourceOrder,
  normalizeResourceDashboardIndex,
  normalizeResourceDashboardTabs,
} = testedHelpers;

assert.equal(Object.keys(COURSE_TITLES).length, 46);
assert.equal(Object.hasOwn(COURSE_TITLES, "TOTAL"), false);
assert.equal(COURSE_TITLES.ICT1, "SOFTWARE APPLICATIONS");
assert.equal(
  COURSE_TITLES.ROTC1,
  "National Service Training Program 1",
);
assert.equal(
  COURSE_TITLES.ROTC2,
  "National Service Training Program 2",
);
assert.equal(Object.hasOwn(COURSE_TITLES, "ICT"), false);
assert.equal(Object.hasOwn(COURSE_TITLES, "NSTP1"), false);
assert.equal(Object.hasOwn(COURSE_TITLES, "NSTP2"), false);
assert.equal(getCourseTitle(" nav6 "), "OPERATIONAL USE OF ECDIS");
assert.equal(
  getCourseTitle("SHIP OPERATION"),
  "SHIP OPERATION AND SHIPYARD PRACTICE",
);
assert.equal(getCourseTitle("UNKNOWN COURSE"), "UNKNOWN COURSE");
assert.equal(getCourseTitle("NAV3 (LEC.)"), "TERRESTRIAL AND COASTAL NAVIGATION 2 (LEC.)");
assert.equal(getCourseTitle("ict"), "SOFTWARE APPLICATIONS");
assert.equal(getCourseTitle("NSTP1 (LEC.)"), "National Service Training Program 1 (LEC.)");
assert.equal(getCourseTitle("ROTC2 (LAB.)"), "National Service Training Program 2 (LAB.)");
assert.equal(getCourseTitle("NSTP3 (LEC.)"), "ROTC3 (LEC.)");
assert.equal(
  getCourseHeading("NAV6"),
  "NAV6",
);
assert.equal(
  getCourseHeading("NAV6", true),
  "OPERATIONAL USE OF ECDIS",
);
assert.equal(getCourseHeading("NAV3 (LEC.)", true), "TERRESTRIAL AND COASTAL NAVIGATION 2 (LEC.)");
assert.equal(getCourseHeading("ICT"), "ICT1");
assert.equal(getCourseHeading("NSTP1 (LEC.)"), "ROTC1 (LEC.)");
assert.equal(getCourseHeading("NSTP3 (LEC.)"), "ROTC3 (LEC.)");
assert.equal(getCourseHeading("UNKNOWN COURSE"), "UNKNOWN COURSE");
assert.deepEqual(
  buildCourseCatalogEntries([
    { course: "03.1 NAV3" },
    { course: "03.2 NAV3" },
    { course: "NAV4" },
  ]),
  [
    {
      course: "NAV3",
      subject: "TERRESTRIAL AND COASTAL NAVIGATION 2",
      year: "",
    },
    {
      course: "NAV4",
      subject: "CELESTIAL NAVIGATION",
      year: "",
    },
  ],
  "the Subjects catalogue should remove leading 03.1/03.2 markers and merge NAV3 entries",
);
assert.deepEqual(
  buildCourseCatalogEntries([
    { course: "NAV3 (LEC.)" },
    { course: "NAV3 (LAB.)" },
  ]),
  [
    {
      course: "NAV3",
      subject: "TERRESTRIAL AND COASTAL NAVIGATION 2 (LEC. / LAB.)",
      year: "",
    },
  ],
  "merged course sections should retain their distinct suffixes",
);
assert.deepEqual(
  buildCourseCatalogEntries([
    { course: "03.1 NAV3", year: "3", semester: "1" },
    { course: "03.2 NAV3", year: "3", semester: "2" },
  ]),
  [
    {
      course: "NAV3",
      subject: "TERRESTRIAL AND COASTAL NAVIGATION 2",
      year: "3.1 / 3.2",
    },
  ],
  "merged course search results should show all associated Year.Semester terms",
);
assert.deepEqual(
  buildCourseCatalogEntries([
    { course: "NAV6", year: "3", semester: "1" },
    { course: "NAV6", year: "3", semester: "2" },
  ]),
  [
    {
      course: "NAV6",
      subject: "OPERATIONAL USE OF ECDIS",
      year: "3.1",
    },
  ],
  "the NAV6 catalogue entry should always be associated with 3.1",
);
for (const course of [
  "SEAM5",
  "NGEC3",
  "NGEC8",
  "NGEC10",
  "CME CA",
  "MARLAW",
  "SHIP'S AUDIT",
]) {
  assert.equal(
    buildCourseCatalogEntries([
      { course, year: "3", semester: "2" },
    ])[0].year,
    "3.1",
    `${course} should always be associated with 3.1`,
  );
}
assert.deepEqual(extractLeadingOrderNumber("01# Name #2.pdf"), [1, 0]);
assert.deepEqual(extractLeadingOrderNumber("02 Another #3.pdf"), [2, 0]);
assert.deepEqual(extractLeadingOrderNumber("02.3# Lesson.pdf"), [2, 3]);
assert.equal(extractLeadingOrderNumber("Lesson 12.pdf"), null);
assert.equal(cleanResourceDisplayName("01# Name #2.pdf"), "Name #2.pdf");
assert.equal(cleanResourceDisplayName("02 - Lesson 12.pdf"), "Lesson 12.pdf");
assert.equal(cleanResourceDisplayName("02.3# Lesson.pdf"), "Lesson.pdf");
assert.equal(cleanResourceDisplayName("Lesson 12.pdf"), "Lesson 12.pdf");

const orderedNames = [
  "Unnumbered.pdf",
  "03# Third.pdf",
  "02 Second #4.pdf",
  "01 First.pdf",
  "02.3# Subsequence.pdf",
  "02 Another second.pdf",
];
const stableOrderedNames = orderedNames
  .map((name, index) => ({ name, index }))
  .sort(
    (left, right) =>
      compareResourceOrder(left.name, right.name) ||
      left.index - right.index,
  )
  .map(({ name }) => name);
assert.deepEqual(stableOrderedNames, [
  "01 First.pdf",
  "02 Second #4.pdf",
  "02 Another second.pdf",
  "02.3# Subsequence.pdf",
  "03# Third.pdf",
  "Unnumbered.pdf",
]);

const modulesIndex = {
  b: "https://drive.google.com/open?id=",
  d: {
    "3.1": {
      PRELIMS: {
        NAV6: { i: "navSix_123456", n: "02# Second #1.pdf", t: "pdf" },
        SEAM5: {
          i: "seamFive_123456",
          n: "01 First.pdf",
          u: "seamFive_123456",
          t: "pdf",
        },
        UNKNOWN: {
          i: "unknown_123456",
          n: "No sequence.pdf",
          u: "unknown_123456",
        },
        TOTAL: {
          i: "total_123456",
          n: "99# Ignore.pdf",
          u: "total_123456",
          t: "pdf",
        },
      },
      MIDTERMS: {
        "SHIP OP.": {
          i: "shipOperation_123456",
          n: "03# Final #2.pdf",
          u: "shipOperation_123456",
          t: "pdf",
        },
      },
    },
  },
};
const originalModulesJson = JSON.stringify(modulesIndex);
const modulesTab = normalizeResourceDashboardIndex("MODULES", modulesIndex);
assert.ok(modulesTab);
assert.deepEqual(
  modulesTab.rows.map((row) => row[1]),
  ["SEAM5", "NAV6", "SHIP OP.", "UNKNOWN"],
  "course rows should be ordered by numeric leading n markers across categories",
);
assert.equal(modulesTab.rows.some((row) => row[1] === "TOTAL"), false);
assert.equal(modulesTab.rows[1][2], "02# Second #1.pdf");
assert.equal(
  modulesTab.links[1][2],
  "https://drive.google.com/open?id=navSix_123456",
  "resource IDs should resolve against the shared Drive URL base",
);
assert.equal(
  modulesTab.linkTypes[1][2],
  "application/pdf",
  "entry-level t should continue to identify the resource type",
);
assert.equal(JSON.stringify(modulesIndex), originalModulesJson);

const reviewersIndex = {
  b: "https://drive.google.com/open?id=",
  d: {
    "2.1": {
      PRELIMS: {
        NAV6: [
          "01# Reviewer guide.pdf",
          "reviewerPdf_123456",
          123,
          4,
        ],
      },
      SYLLABUS: {
        "SHIP'S AUDIT": {
          i: "syllabus_123456",
          n: "01# Ship auditing syllabus.pdf",
          u: "syllabus_123456",
          t: "pdf",
        },
      },
    },
  },
};
const normalizedCombined = normalizeResourceDashboardTabs({
  MODULES: modulesIndex,
  REVIEWERS: reviewersIndex,
});
assert.equal(normalizedCombined.MODULES.rows.length, 4);
assert.equal(normalizedCombined.SYLLABUS.rows.length, 1);
assert.equal(
  normalizedCombined.SYLLABUS.rows[0][1],
  "SHIP'S AUDIT",
  "the second combined payload should also yield its syllabus hierarchy",
);

const individualYearIndex = {
  b: "https://drive.google.com/open?id=",
  p: ["legacy-prefix-metadata"],
  d: {
    "2": {
      PRELIMS: {
        SAFETY: {
          i: "safety_123456",
          n: "01# Safety module.pdf",
          u: "safety_123456",
          t: "pdf",
          p: 0,
        },
      },
    },
  },
};
const individualYearTab = normalizeResourceDashboardIndex(
  "MODULES",
  individualYearIndex,
);
assert.equal(individualYearTab.rows[0][0], "2");
assert.equal(individualYearTab.rows[0][2], "01# Safety module.pdf");
assert.equal(
  individualYearTab.linkTypes[0][2],
  "application/pdf",
  "legacy p metadata must not interfere with current entry type handling",
);

console.log("Student Portal combined-schema and ordering checks passed.");
