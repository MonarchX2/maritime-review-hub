const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const appCore = fs.readFileSync("app-core.js", "utf8");
const backend = fs.readFileSync("backend/main.js", "utf8");
const deckNavigation = fs.readFileSync("deck-nav-core.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const releaseMetadata = JSON.parse(fs.readFileSync("version.json", "utf8"));
const appVersion = releaseMetadata.buildVersion;
const resourceStyles = fs.readFileSync("styles.css", "utf8");

assert.match(
  releaseMetadata.version,
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "version.json must define the editable semantic app version",
);
assert.match(
  appCore,
  /const RESOURCE_DASHBOARD_LAST_SECTION_KEY\s*=\s*"mrh_resource_dashboard_last_section_v1"/,
  "the portal should persist the last selected content section",
);
assert.match(
  appCore,
  /function getLastResourceDashboardSection\(\)[\s\S]*?includes\(section\)[\s\S]*?function saveResourceDashboardSection\(section\)[\s\S]*?localStorage\.setItem/,
  "section restoration must validate stored tabs and save valid selections",
);
assert.match(
  appCore,
  /tabName = hasReviewerSession\s*\?\s*getLastResourceDashboardSection\(\)\s*:\s*"PROFILE"/,
  "an authenticated portal entry should restore the last selected section",
);
assert.match(
  appCore,
  /Boolean\(response\.nextPageToken\)\s*&&\s*response\.nextPageToken === pageToken/,
  "folder pagination must not reject an empty next-page token",
);
assert.match(
  appCore,
  /const RESOURCE_PREVIEW_MAX_BYTES = 32 \* 1024 \* 1024/,
  "the in-site preview limit should allow 32 MiB files",
);
assert.match(
  backend,
  /RESOURCE_PORTAL_MAX_PREVIEW_BYTES = 32 \* 1024 \* 1024/,
  "the backend preview limit must match the frontend's 32 MiB bound",
);
const reviewerLessonParser =
  appCore.match(
    /function getReviewerPdfLessonTitle\([\s\S]*?\n  \}/,
  )?.[0] || "";
assert.match(
  reviewerLessonParser,
  /const sequenceAfterCourse = matchedCourse\s*\?[\s\S]*?const existingLesson = matchedCourse\s*\?[\s\S]*?const sequence = sequenceAfterCourse\s*\|\|\s*existingLesson\?\.\[1\]/,
  "Lesson labels must require the COURSE-column match, with matched-course sequences preferred",
);
assert.match(
  reviewerLessonParser,
  /const existingLesson = matchedCourse\s*\?/,
  "existing Lesson text may be used only when the filename also contains the COURSE-column value",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-folder-preview\s*\{[\s\S]*?--folder-preview-background:[\s\S]*?--folder-preview-accent:/,
  "folder preview colors should use the site's themeable color tokens",
);
assert.match(
  resourceStyles,
  /\.dark \.resource-dashboard-folder-preview\s*\{[\s\S]*?--folder-preview-background:[\s\S]*?--folder-preview-accent:/,
  "folder preview controls should have matching dark-theme colors",
);
assert.match(
  appVersion,
  /^mrh-[A-Za-z0-9._-]+$/,
  "version.json must define a valid generated release build identifier",
);
assert.match(
  resourceStyles,
  /\.resource-portal-shell\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*visible;/,
  "the dashboard box should expand with its content instead of clipping it",
);
assert.doesNotMatch(
  resourceStyles.match(/\.resource-portal-shell\s*\{([^}]+)\}/)?.[1] || "",
  /\b(?:height|min-height|max-height)\s*:/,
  "the dashboard box must not have a fixed or bounded height",
);
assert.match(
  resourceStyles,
  /\.resource-portal-sidebar\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/,
  "dashboard navigation should stay on one line and scroll horizontally if needed",
);
assert.match(
  resourceStyles,
  /\.resource-portal-browser\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*auto;/,
  "the dashboard content area should expand naturally with dynamically added content",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*visible;/,
  "wide tables may scroll horizontally without a vertical height limit",
);

assert.match(
  index,
  /id="resource-dashboard-syllabus-nav"[\s\S]*?Syllabus[\s\S]*?id="resource-dashboard-modules-nav"[\s\S]*?Modules[\s\S]*?id="resource-dashboard-reviewers-nav"[\s\S]*?Reviewers/,
  "the dashboard should show Syllabus before Modules and Reviewers",
);
assert.match(
  index,
  /id="resource-dashboard-reviewers-nav"[^>]*onclick="openResourceDashboardTab\('REVIEWERS'\)"[^>]*aria-label="Reviewers"[\s\S]*?Reviewers\s*<\/button>[\s\S]*?id="resource-reviewers-locked-panel"[\s\S]*?fa-lock resource-reviewers-locked-icon[\s\S]*?Locked[\s\S]*?Use Google to sign in and request access/,
  "the locked Reviewers panel should show a red lock, concise label, and Google sign-in prompt",
);
const lockedReviewerPanel =
  index.match(
    /<section[^>]*id="resource-reviewers-locked-panel"[^>]*>([\s\S]*?)<\/section>/,
  )?.[1] || "";
assert.equal(
  [...lockedReviewerPanel.matchAll(/Use Google to sign in and request access/g)]
    .length,
  1,
  "the locked review-materials panel should show only the approved Google sign-in prompt",
);
assert.match(
  resourceStyles,
  /\.resource-reviewers-locked-icon\s*\{[^}]*color:\s*#dc2626;/,
  "the Reviewer lock icon should be red",
);
assert.match(
  resourceStyles,
  /\.resource-reviewers-locked-panel\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;/,
  "the locked prompt background should span the dashboard content width",
);
assert.doesNotMatch(
  index,
  /or create a reviewer profile|to these resources\./,
  "the locked Reviewer prompt should not include the removed phrase or resource wording",
);
assert.doesNotMatch(
  appCore,
  /Sign in to request Reviewer access|Use Google to sign in and request Reviewer access|Google sign-in did not return a credential/,
  "Reviewer sign-in guidance should not repeat the Reviewer label",
);
assert.match(
  index,
  /id="resource-dashboard-reviewers-nav"[\s\S]*?<i class="fa-solid fa-clipboard-list" aria-hidden="true"><\/i>/,
  "the Reviewers tab should use a lined-note icon",
);
assert.match(
  index.match(/id="resource-dashboard-reviewers-nav"[^>]*>/)?.[0] || "",
  /\bdisabled\b[\s\S]*aria-disabled="true"/,
  "Review Materials should start disabled before account status is verified",
);
assert.match(
  index,
  /resource-reviewer-auth-status[\s\S]*?resource-reviewer-signin-button[\s\S]*?resource-reviewer-signout/,
  "the resource dashboard should include account sign-in and sign-out controls",
);
assert.match(
  resourceStyles,
  /#resource-reviewer-signin-button\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;[\s\S]*?#resource-reviewer-signin-button iframe\s*\{[^}]*flex:\s*0 0 auto;[^}]*max-width:\s*100%;/,
  "the Google sign-in iframe should not flex-shrink and displace its logo background outside the blue button",
);
assert.match(
  index,
  /class="resource-dashboard-topbar"[\s\S]*?resource-dashboard-title" aria-label="Student Portal"[\s\S]*?<span>Student Portal<\/span>[\s\S]*?id="resource-dashboard-profile-nav"[^>]*onclick="openResourceDashboardTab\('PROFILE'\)"[^>]*aria-label="Profile"[\s\S]*?<\/button>\s*<\/div>\s*<div class="resource-portal-shell">/,
  "the Profile button should sit to the right of the Student Portal title, outside the resource tabs",
);
assert.match(
  index,
  /<aside class="resource-portal-sidebar"[\s\S]*?id="resource-dashboard-reviewers-nav"[\s\S]*?<\/aside>/,
  "the resource tabs should remain grouped in their own navigation row",
);
assert.doesNotMatch(
  index.slice(
    index.indexOf('<aside class="resource-portal-sidebar"'),
    index.indexOf(
      "</aside>",
      index.indexOf('<aside class="resource-portal-sidebar"'),
    ),
  ),
  /resource-reviewer-signin-button|resource-reviewer-enrollment-form|resource-reviewer-signout/,
  "profile sign-in and settings controls should live in the Profile screen, not the tab header",
);
assert.match(
  index,
  /id="resource-dashboard-content" hidden[\s\S]*?id="resource-dashboard-profile"[^>]*class="resource-profile-screen"[^>]*aria-label="Profile settings"(?![^>]*hidden)[\s\S]*?resource-reviewer-auth-status[\s\S]*?resource-reviewer-signin-button[\s\S]*?resource-profile-account-details[\s\S]*?resource-profile-name[\s\S]*?resource-profile-email[\s\S]*?resource-reviewer-enrollment-form[\s\S]*?resource-reviewer-signout/,
  "Profile should remain the signed-out fallback with login/enrollment controls",
);
assert.doesNotMatch(
  index,
  /resource-profile-heading|<h2>Profile<\/h2>/,
  "Profile settings should not repeat a Profile heading or icon",
);
assert.match(
  index,
  /resource-reviewer-enrollment-form[\s\S]*?name="lastName"[\s\S]*?name="firstName"[\s\S]*?name="middleInitial"/,
  "the sign-in panel should collect the names needed for new account enrollment",
);
assert.match(
  index,
  /class="resource-reviewer-form-actions"[\s\S]*?<button type="submit">[\s\S]*?id="resource-reviewer-enrollment-status"[^>]*role="status"/,
  "profile submission progress should appear beneath the enrollment action",
);
assert.match(
  index,
  /id="resource-reviewer-email-name-warning"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden[\s\S]*?name entered does not closely match your\s*email address/,
  "the profile should provide a hidden, non-blocking live name/email warning",
);
assert.match(
  resourceStyles,
  /\.resource-reviewer-email-name-warning\s*\{[^}]*color:\s*#92400e;/,
  "the name/email mismatch should use a visible, non-blocking warning style",
);
assert.match(
  index,
  /<button type="submit">\s*Submit\s*<\/button>/,
  "the profile enrollment button should be labeled only Submit",
);
assert.ok(
  index.indexOf('id="resource-reviewer-enrollment-form"') >
    index.indexOf('id="resource-profile-account-details"'),
  "all name-entry fields should render below the profile details",
);
assert.doesNotMatch(
  index,
  /resource-reviewer-form-warning|False information will strictly not be entertained/,
  "the name form should not display the false-information warning above the fields",
);
assert.match(
  index,
  /Middle Initial[\s\S]*?name="middleInitial"[\s\S]*?maxlength="3"[\s\S]*?pattern="\[A-Za-z\]\\\."/,
  "profile should allow a blank optional middle initial or a single initial",
);
const middleInitialInput =
  index.match(
    /<input\s+id="resource-reviewer-middle-initial"[\s\S]*?\/>/,
  )?.[0] || "";
assert.ok(middleInitialInput, "the middle-initial input should be present");
assert.doesNotMatch(
  middleInitialInput,
  /\brequired\b/,
  "native form validation must allow a blank optional middle initial",
);
const middleInitialPattern = /^[A-Z]\.$/;
assert.deepEqual(
  ["A.", "M.", "Z."].map((value) => middleInitialPattern.test(value)),
  [true, true, true],
  "the frontend middle-initial format should accept any single letter followed by a period",
);
assert.deepEqual(
  ["K", "KK.", "K.."].map((value) => middleInitialPattern.test(value)),
  [false, false, false],
  "the frontend middle-initial format should reject values that are not exactly one letter and a period",
);
assert.match(
  index,
  /title="Optional\. Enter one letter followed by a period\."/,
  "the middle-initial hint should describe the optional field",
);
const middleInitialNormalizer =
  appCore.match(
    /function normalizeReviewerMiddleInitialInput\(input, event\)[\s\S]*?(?=\n  function openReviewerProfileEditor)/,
  )?.[0] || "";
assert.ok(
  middleInitialNormalizer.includes(
    'value.replace(/[^A-Z]/g, "")',
  ) &&
    middleInitialNormalizer.includes('if (value === "N/A")') &&
    middleInitialNormalizer.includes(
      'event?.inputType?.startsWith("delete")',
    ) &&
    middleInitialNormalizer.includes("`${initial}.`") &&
    middleInitialNormalizer.includes("? initial"),
  "middle initials should normalize autofill to one uppercase letter and a period while keeping deletion usable",
);
const normalizeMiddleInitial = new Function(
  `${middleInitialNormalizer}; return normalizeReviewerMiddleInitialInput;`,
)();
[
  ["a", {}, "A."],
  ["smith", {}, "S."],
  ["a..", {}, "A."],
  ["ab", { inputType: "deleteContentBackward" }, ""],
  ["A.", { inputType: "deleteContentBackward" }, ""],
  ["", { inputType: "deleteContentBackward" }, ""],
  ["N/A", {}, ""],
].forEach(([value, event, expected]) => {
  const input = { value };
  normalizeMiddleInitial(input, event);
  assert.equal(
    input.value,
    expected,
    `middle-initial normalization should convert ${JSON.stringify(value)} appropriately`,
  );
});
assert.match(
  appCore,
  /middleInitialInput\.addEventListener\("input", normalizeMiddleInitial\)[\s\S]*?middleInitialInput\.addEventListener\("change",[\s\S]*?middleInitialInput\.addEventListener\("blur",/,
  "autofilled middle initials should be normalized on input, change, blur, and submit",
);
assert.match(
  index,
  /resource-reviewer-input-wrap[\s\S]*?id="resource-reviewer-last-name"[\s\S]*?resource-reviewer-input-clear[\s\S]*?id="resource-reviewer-first-name"[\s\S]*?resource-reviewer-input-clear[\s\S]*?id="resource-reviewer-middle-initial"[\s\S]*?resource-reviewer-input-clear/,
  "name-entry inputs should each have an inline clear button on the right",
);
const reviewerInputClearButtons = [
  ...index.matchAll(
    /<button\b[^>]*class="resource-reviewer-input-clear"[\s\S]*?<\/button>/g,
  ),
].map(([button]) => button);
assert.equal(
  reviewerInputClearButtons.length,
  3,
  "all three name inputs should have a clear button",
);
assert.ok(
  reviewerInputClearButtons.every(
    (button) => !/(?:^|\s)hidden(?:\s|=|>)/.test(button),
  ),
  "name-input clear buttons should be visible before typing",
);
assert.match(
  resourceStyles,
  /\.resource-reviewer-enrollment \.resource-reviewer-input-clear\s*\{[^}]*padding:\s*0;[^}]*border-color:\s*#1e3a8a;[^}]*color:\s*#fff;[^}]*background:\s*#1e3a8a;/,
  "the inline clear controls should retain the dark-blue enrollment button styling",
);
assert.match(
  appCore,
  /function capitalizeReviewerName\(value\) \{\s*return String\(value \|\| ""\)\.toLocaleUpperCase\(\);[\s\S]*?function normalizeReviewerNameInput\(input\)[\s\S]*?capitalizeReviewerName\(input\.value\)/,
  "first and last names should become fully uppercase as the user types",
);
const reviewerNameCapitalizerSource = appCore.match(
  /function capitalizeReviewerName\(value\) \{[\s\S]*?\n  \}/,
);
assert.ok(reviewerNameCapitalizerSource);
const capitalizeReviewerName = new Function(
  `${reviewerNameCapitalizerSource[0]}; return capitalizeReviewerName;`,
)();
assert.equal(
  capitalizeReviewerName("mARia anne-marie o'brien"),
  "MARIA ANNE-MARIE O'BRIEN",
  "name input should convert every character to uppercase, not title case",
);
const reviewerNamePrefillFunction =
  appCore.match(
    /function prefillReviewerNameFromGoogle\(profile\) \{[\s\S]*?\n  \}/,
  )?.[0] || "";
assert.ok(reviewerNamePrefillFunction);
const prefillReviewerNameFromGoogle = new Function(
  "document",
  "capitalizeReviewerName",
  "updateReviewerEmailNameWarning",
  `${reviewerNamePrefillFunction}; return prefillReviewerNameFromGoogle;`,
);
const prefillFields = {
  "resource-reviewer-last-name": { value: "", dataset: {} },
  "resource-reviewer-first-name": { value: "", dataset: {} },
};
prefillReviewerNameFromGoogle(
  { getElementById: (id) => prefillFields[id] || null },
  capitalizeReviewerName,
  () => {},
)({
  accountStatus: "NOT_FOUND",
  suggestedFirstName: "Rita",
  suggestedLastName: "Reviewer",
});
assert.equal(
  prefillFields["resource-reviewer-first-name"].value,
  "RITA",
  "verified Google given names should prefill an empty new-account field",
);
assert.equal(
  prefillFields["resource-reviewer-last-name"].value,
  "REVIEWER",
  "verified Google family names should prefill an empty new-account field",
);
assert.equal(
  prefillFields["resource-reviewer-first-name"].dataset.savedValue,
  "RITA",
  "the autofill value should be tracked so later refreshes preserve user edits",
);
prefillFields["resource-reviewer-first-name"].value = "MY EDIT";
prefillFields["resource-reviewer-last-name"].value = "";
prefillReviewerNameFromGoogle(
  { getElementById: (id) => prefillFields[id] || null },
  capitalizeReviewerName,
  () => {},
)({
  accountStatus: "NOT_FOUND",
  suggestedFirstName: "Different",
  suggestedLastName: "Reviewer",
});
assert.equal(
  prefillFields["resource-reviewer-first-name"].value,
  "MY EDIT",
  "Google suggestions must not overwrite a name already edited by the user",
);
prefillFields["resource-reviewer-last-name"].value = "";
prefillReviewerNameFromGoogle(
  { getElementById: (id) => prefillFields[id] || null },
  capitalizeReviewerName,
  () => {},
)({
  accountStatus: "TRUE",
  suggestedFirstName: "Different",
  suggestedLastName: "Reviewer",
});
assert.equal(
  prefillFields["resource-reviewer-last-name"].value,
  "",
  "Google suggestions must not prefill or replace an existing account profile",
);
assert.match(
  appCore,
  /if \(!preserveEnrollmentDraft\) \{[\s\S]*?prefillReviewerNameFromGoogle\(\{\s*accountStatus,[\s\S]*?suggestedFirstName: response\.suggestedFirstName,[\s\S]*?suggestedLastName: response\.suggestedLastName/,
  "Google names should be applied only after account-status form resets",
);
assert.match(
  appCore,
  /function initializeReviewerEnrollmentInputs\(\)[\s\S]*?resource-reviewer-last-name[\s\S]*?resource-reviewer-first-name[\s\S]*?normalizeReviewerNameInput\(input\);[\s\S]*?updateReviewerEmailNameWarning\(\);[\s\S]*?function updateReviewerEmailNameWarning\(\)[\s\S]*?reviewerEmailMatchesName\([\s\S]*?function openReviewerProfileEditor[\s\S]*?async function initializeReviewerAuth\(\) \{\s*initializeReviewerEnrollmentInputs\(\);\s*if \(reviewerAuthConfigPromise\)/,
  "profile name/email validation should update while typing before auth configuration resolves",
);
assert.match(
  appCore,
  /if \(tabName === "PROFILE"\) \{\s*void logResourceDashboardAction\("PROFILE", "TAB_OPEN"\);\s*void initializeReviewerAuth\(\);/,
  "opening Profile should initialize live name capitalization immediately",
);
assert.match(
  appCore,
  /function reviewerEmailMatchesName\(email, firstName, middleInitial, lastName\)[\s\S]*?part\.length >= 3[\s\S]*?localPart\.includes\(part\)[\s\S]*?initials\.length >= 2 && localPart\.includes\(initials\)/,
  "email/name matching should accept a meaningful name part or matching initials",
);
const reviewerMatchFunctions =
  appCore.match(
    /function normalizeReviewerIdentityText\(value\)[\s\S]*?function reviewerEmailMatchesName\(email, firstName, middleInitial, lastName\)[\s\S]*?\n  \}/,
  )?.[0] || "";
const reviewerEmailMatchesName = new Function(
  `${reviewerMatchFunctions}; return reviewerEmailMatchesName;`,
)();
const reviewerWarningFunction =
  appCore.match(
    /function updateReviewerEmailNameWarning\(\)[\s\S]*?\n  \}/,
  )?.[0] || "";
const profileWarning = { hidden: true };
let profileFirstName = "MARIA";
let profileLastName = "SMITH";
const profileFields = {
  "resource-reviewer-email-name-warning": profileWarning,
  "resource-reviewer-first-name": { get value() { return profileFirstName; } },
  "resource-reviewer-last-name": { get value() { return profileLastName; } },
};
const updateReviewerEmailNameWarning = new Function(
  "document",
  "reviewerAuthorizedEmail",
  "reviewerEmailMatchesName",
  `${reviewerWarningFunction}; return updateReviewerEmailNameWarning;`,
)(
  { getElementById: (id) => profileFields[id] || null },
  "maria.smith@example.com",
  reviewerEmailMatchesName,
);
updateReviewerEmailNameWarning();
assert.equal(profileWarning.hidden, true, "a strong email/name match should hide the warning");
profileFirstName = "UNRELATED";
profileLastName = "MISMATCH";
updateReviewerEmailNameWarning();
assert.equal(profileWarning.hidden, false, "changing a name to a mismatch should show the warning");
profileFirstName = "";
profileLastName = "";
updateReviewerEmailNameWarning();
assert.equal(profileWarning.hidden, true, "empty name fields should not show a mismatch warning");
const enrollmentHandlerForEmailWarning =
  appCore.match(
    /async function requestReviewerEnrollment\(event\)[\s\S]*?(?=\n  async function )/,
  )?.[0] || "";
assert.doesNotMatch(
  enrollmentHandlerForEmailWarning,
  /if\s*\(\s*!reviewerEmailMatchesName/,
  "a name/email mismatch warning must not block profile submission",
);
assert.match(
  appCore,
  /const preserveEnrollmentDraft =\s*keepProfileEditorOpen \|\|\s*\(form &&\s*!form\.hidden &&\s*Object\.values\(inputs\)\.some\([\s\S]*?input\.dataset\.savedValue !== undefined &&\s*input\.value !== input\.dataset\.savedValue[\s\S]*?if \(!preserveEnrollmentDraft\) \{[\s\S]*?accountStatus === "NOT_FOUND"/,
  "account status refreshes should preserve edited enrollment fields while the form is open",
);
assert.match(
  appCore,
  /if \(\s*!lastName \|\|\s*!firstName \|\|\s*\(middleInitial && !\/\^\[A-Z\]\\\.\$\/\.test\(middleInitial\)\)\s*\)/,
  "profile submission should accept a blank optional middle initial and validate provided initials",
);
const enrollmentHandler =
  appCore.match(
    /async function requestReviewerEnrollment\(event\)[\s\S]*?(?=\n  async function )/,
  )?.[0] || "";
assert.ok(
  !enrollmentHandler.includes('middleInitialInput.value = "N/A"') &&
    enrollmentHandler.includes("middleInitial && !/^[A-Z]\\.$/.test(middleInitial)") &&
    enrollmentHandler.indexOf("middleInitial && !/^[A-Z]\\.$/.test(middleInitial)") <
      enrollmentHandler.indexOf("globalScope.AppNetwork.callBackend"),
  "the frontend should leave an optional middle initial blank and reject invalid provided values",
);
assert.match(
  appCore,
  /reviewerSessionRestorePending && !hasAuthorizedSessionCache\) \{\s*if \(lockedPanel\) lockedPanel\.hidden = true;[\s\S]*?showReviewerDashboardLoading\(true\)/,
  "session restoration without cached rows should never display the Locked panel alongside Loading",
);
assert.match(
  appCore,
  /const preferredTerm = "3\.2"[\s\S]*?const nextAvailableTerm = orderedTerms\.find[\s\S]*?year > preferredYear[\s\S]*?semester > preferredSemester[\s\S]*?nextAvailableTerm/,
  "the dashboard should default to 3.2, falling forward to the next available term",
);
assert.match(
  index,
  /id="resource-profile-access-status"[^>]*role="status"/,
  "the profile should provide a live access-status badge below the email",
);
assert.ok(
  [
    "function renderReviewerProfileAccessStatus(accountStatus)",
    'label: "ACCESS GRANTED"',
    'label: "ACCESS PENDING"',
    'label: "ACCESS DENIED"',
    'icon: "fa-check"',
    'icon: "fa-triangle-exclamation"',
    'icon: "fa-xmark"',
  ].every((marker) => appCore.includes(marker)),
  "profile access states should show Granted, Pending, and Denied with their icons",
);
assert.match(
  resourceStyles,
  /\.resource-reviewer-enrollment label > span\s*\{[^}]*font-weight:\s*700;/,
  "Last Name, First Name, and Middle Initial labels should be bold",
);
assert.doesNotMatch(
  index,
  /Reviewer access requires administrator approval/,
  "the Profile screen should not display the reviewer access approval notice",
);
assert.doesNotMatch(
  index.match(
    /<form\s+id="resource-reviewer-enrollment-form"[\s\S]*?<\/form>/,
  )?.[0] || "",
  /resource-profile-form-note|correct capitalization|Dela Cruz/,
  "the redundant form capitalization note should be removed",
);
assert.match(
  index,
  /id="resource-reviewer-enrollment-form"[\s\S]*?<\/form>\s*<button[^>]*id="resource-reviewer-signout"[^>]*class="resource-profile-signout-button"[^>]*hidden[^>]*>\s*Sign Out/,
  "Sign Out should appear directly below the name verification form's Verify action and remain hidden until a reviewer session is verified",
);
assert.match(
  appCore,
  / form\.hidden = !\(\s*accountStatus === "NOT_FOUND" \|\| accountStatus === "DENIED"\s*\)[\s\S]*?accountStatus === "NOT_FOUND"\s*\? "Verify"[\s\S]*?accountStatus === "DENIED"\s*\?\s*"Resubmit"/,
  "unverified accounts should see a Verify action and denied accounts a Resubmit action without an Edit button",
);
assert.doesNotMatch(
  index + appCore,
  /resource-reviewer-edit-profile|resource-profile-edit-button/,
  "the redundant profile Edit control should be removed",
);
assert.match(
  appCore,
  /const confirmed = await requestConfirmation\([\s\S]*?False information will strictly not be entertained[\s\S]*?ignored and deleted[\s\S]*?name entered here is accurate and belongs to you[\s\S]*?if \(!confirmed\) return false;[\s\S]*?globalScope\.AppNetwork\.callBackend/,
  "the single name-accuracy confirmation should not treat an email mismatch as a submission blocker",
);
assert.match(
  appCore,
  /function setReviewerAccessEnabled\(enabled\)[\s\S]*?reviewersNav\.disabled = !enabled;[\s\S]*?reviewersNav\.setAttribute\("aria-disabled", "true"\)/,
  "Reviewer navigation should be disabled for users without approved access",
);
assert.match(
  appCore,
  /if \(\s*tabName === "REVIEWERS" &&\s*\["FALSE", "DENIED", "NOT_FOUND"\]\.includes\(reviewerAccountStatus\)\s*\)\s*tabName = "PROFILE";/,
  "programmatic Reviewer navigation should be blocked when access is pending or denied",
);
assert.match(
  index,
  /id="resource-reviewer-cancel-edit"[\s\S]*?Cancel/,
  "the profile editor should allow users to cancel unsaved changes",
);
assert.match(
  index,
  /id="resource-dashboard-profile-picture"[^>]*hidden/,
  "the header Profile button should have a hidden image that can show the signed-in account photo",
);
assert.match(
  resourceStyles,
  /\.resource-profile-toggle > img\s*\{\s*width:\s*2\.75rem;\s*height:\s*2\.75rem;\s*\}[\s\S]*?\.resource-profile-toggle > i\s*\{\s*width:\s*2\.75rem;\s*height:\s*2\.75rem;/,
  "the header profile photo and fallback icon should use the enlarged size",
);
assert.match(
  resourceStyles,
  /\.resource-profile-signout-button\s*\{[^}]*border:\s*0;[^}]*color:\s*#dc2626;[^}]*background:\s*transparent;/,
  "Sign out should remain red text without a background box",
);
assert.match(
  resourceStyles,
  /\.resource-profile-avatar\s*\{[^}]*width:\s*7rem;[^}]*height:\s*7rem;/,
  "the Profile picture should be larger",
);
assert.match(
  resourceStyles,
  /\.resource-profile-account-details\s*\{[^}]*gap:\s*0;/,
  "the full name and email should have no added vertical gap",
);
assert.match(
  resourceStyles,
  /\.resource-profile-access-status\.is-granted\s*\{[^}]*background:\s*#dcfce7;[\s\S]*?\.resource-profile-access-status\.is-pending\s*\{[^}]*background:\s*#fef3c7;[\s\S]*?\.resource-profile-access-status\.is-denied\s*\{[^}]*background:\s*#fee2e2;/,
  "each access status should have its matching colored badge background",
);
assert.doesNotMatch(
  resourceStyles.match(
    /\.resource-profile-account-details\s*\{([^}]+)\}/,
  )?.[1] || "",
  /border-top|padding-top/,
  "the redundant separator above cached account details should be removed",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-browser\s*\.resource-portal-status\.resource-dashboard-status-stacked\[aria-busy="true"\]\s*\{[^}]*display:\s*grid;[^}]*justify-items:\s*center;/,
  "Reviewer loading should stack the spinner above its Loading label",
);
assert.doesNotMatch(
  index,
  /resource-reviewer-device-id|resource-reviewer-copy-device-id/,
  "the sign-in panel must not display or offer to copy the device identity",
);
assert.match(
  index,
  /resource-dashboard-topbar[\s\S]*?id="resource-dashboard-return"[\s\S]*?aria-label="Home"[\s\S]*?fa-house[\s\S]*?resource-dashboard-title" aria-label="Student Portal"[\s\S]*?<span>Student Portal<\/span>[\s\S]*?resource-portal-shell/,
  "the dashboard should place a home button and Student Portal label above and outside its card",
);
assert.match(
  index,
  /resource-dashboard-table-scroll[\s\S]*?class="resource-dashboard-update-note">\s*File updates may take up to a minute\.\s*<\/p>/,
  "the dashboard should show a concise note about file update delays",
);
assert.match(
  index,
  /resource-dashboard-table-head[\s\S]*?resource-dashboard-table-body/,
  "the resource view should render the dashboard spreadsheet as a table",
);
assert.doesNotMatch(
  index,
  /resource-portal-browser-header/,
  "the resource dashboard should not show a title bar",
);
assert.match(
  index,
  /<span class="resource-dashboard-title" aria-label="Student Portal">[\s\S]*?<span>Student Portal<\/span>\s*<\/span>/,
  "the dashboard title should retain its accessible text without a redundant home icon",
);
assert.doesNotMatch(
  index.match(/<span class="resource-dashboard-title" aria-label="Student Portal">[\s\S]*?<\/span>/)?.[0] || "",
  /fa-house/,
  "the redundant home icon should not appear beside the Student Portal title",
);
assert.doesNotMatch(
  index,
  /My Files|resource-portal-items|resource-portal-access-screen|resource-dashboard-search|Open spreadsheet|docs\.google\.com\/spreadsheets/,
  "the dashboard should not expose Drive controls, search, or a link back to its source",
);
assert.match(
  index,
  /id="resource-dashboard-content"[\s\S]*?id="resource-portal-preview"[^>]*hidden[\s\S]*?id="resource-portal-preview-title"[\s\S]*?<a\s+id="resource-portal-preview-download"[^>]*aria-label="Download PDF"[^>]*hidden[\s\S]*?id="resource-portal-preview-close"[\s\S]*?id="resource-portal-preview-status"[\s\S]*?id="resource-portal-preview-frame"[^>]*referrerpolicy="no-referrer"[^>]*hidden/,
  "the dashboard must contain a hidden fullscreen preview with download and close controls and accessible status",
);
assert.doesNotMatch(
  index,
  /id="resource-portal-preview-expand"/,
  "the fullscreen preview should not expose an expand or windowed-view toggle",
);
assert.match(
  index,
  /class="resource-portal-preview-heading"[\s\S]*?id="resource-portal-preview-file-icon"[\s\S]*?class="resource-portal-preview-file-icon fa-solid fa-file-pdf"[\s\S]*?id="resource-portal-preview-title"/,
  "the preview title bar should place an accessible-hidden PDF icon before the title",
);
assert.ok(
  appCore.includes(
    'fileIcon.hidden = !(reviewer || /\\.pdf$/i.test(String(fileName || "")));',
  ),
  "the preview header should show the PDF icon only for PDF resources",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table \.resource-dashboard-link-icon\.fa-file-pdf\s*\{\s*color:\s*#dc2626;/,
  "PDF icons on the table chips should use the preview icon's light-theme color",
);
assert.match(
  resourceStyles,
  /\.dark \.resource-dashboard-table \.resource-dashboard-link-icon\.fa-file-pdf\s*\{\s*color:\s*#dc2626;/,
  "all PDF icons on the table chips should remain dark red in dark theme",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-file-icon\s*\{\s*color:\s*#dc2626;[\s\S]*?\.dark \.resource-portal-preview-file-icon\s*\{\s*color:\s*#dc2626;/,
  "all PDF icons should remain dark red in the preview window in both themes",
);
assert.doesNotMatch(
  index.match(/id="resource-portal-preview"[\s\S]*?<\/section>/)?.[0] || "",
  /https?:\/\/|drive\.google\.com/,
  "the in-site preview must not contain an original Drive URL or fallback link",
);
assert.match(
  index,
  /<span>Year<\/span>[\s\S]*?resource-dashboard-filter-year[\s\S]*?<span>Semester<\/span>[\s\S]*?resource-dashboard-filter-semester[\s\S]*?<span>Category<\/span>[\s\S]*?resource-dashboard-filter-category/,
  "the dashboard should expose year, semester, and resource-category filters",
);
assert.match(
  index,
  /resource-dashboard-filter-semester[\s\S]*?resource-dashboard-category-filter/,
  "the filter controls should render without a manual refresh button",
);
assert.doesNotMatch(
  index,
  /resource-dashboard-refresh/,
  "the dashboard should not show a manual refresh button",
);
assert.match(
  index,
  /id="resource-dashboard-filter-year"[^>]*role="group"[\s\S]*?id="resource-dashboard-filter-semester"[^>]*role="group"[\s\S]*?id="resource-dashboard-category-filter"/,
  "Year and Semester should use segmented button groups",
);
assert.match(
  appCore,
  /initializeResourceDashboardAutoRefresh\(\)[\s\S]*?setInterval\([\s\S]*?RESOURCE_DASHBOARD_AUTO_REFRESH_INTERVAL_MS[\s\S]*?visibilitychange[\s\S]*?pageshow/,
  "the dashboard should periodically revalidate its backend version and refresh on tab return",
);
assert.match(
  index,
  /id="resource-dashboard-filter-category"[^>]*role="group"[\s\S]*?data-category="PRELIMS"[\s\S]*?data-category="MIDTERMS"[\s\S]*?data-category="FINALS"[\s\S]*?data-category="all"/,
  "the category segmented control should provide PRELIMS, MIDTERMS, FINALS, then All",
);
assert.match(
  appCore,
  /resourceDashboardSelectedCategories = \{\s*MODULES: "PRELIMS",\s*REVIEWERS: "all",\s*SYLLABUS: "all",\s*SUBJECTS: "all",\s*\}/,
  "the Modules category filter should default to PRELIMS",
);
assert.match(
  appCore,
  /const showCategoryFilter =\s*hasCategoryFilter \|\| resourceDashboardActiveTab === "SYLLABUS"[\s\S]*?button\.disabled = !hasCategoryFilter \|\| !categoryAvailable/,
  "unavailable category choices should remain visible and disabled",
);
assert.match(
  appCore,
  /const selectedPhaseColumnIndex =[\s\S]*?phaseColumnIndexes\[selectedCategory\]/,
  "a selected phase should restrict visible columns and rows to resources in that category",
);
assert.match(
  appCore,
  /if \(selectedPhaseColumnIndex === undefined\) return false;[\s\S]*?if \(!phaseValue && !isResourceDashboardLink\(phaseLink\)\) return false/,
  "a selected phase should show only its column and rows containing that phase resource",
);
assert.match(
  appCore,
  /const categoryColumnIndices =\s*hasCategoryFilter && selectedCategory !== "all"[\s\S]*?columnIndex === selectedPhaseColumnIndex[\s\S]*?const visibleColumnIndices = categoryColumnIndices\.filter/,
  "a selected phase should hide the other phase columns",
);
assert.match(
  appCore,
  /const visibleColumnIndices = categoryColumnIndices\.filter\(\s*\(columnIndex\) => columnIndex !== yearColumnIndex,\s*\)/,
  "the redundant Year column should be hidden across the syllabus, modules, and reviewers tables",
);
assert.doesNotMatch(
  index,
  /resource-dashboard-filter-column|resource-dashboard-filter-value|Filter column|Filter value/,
  "the dashboard should not expose generic column or text filters",
);
assert.match(
  index,
  /min-height: 64px/,
  "the website header should have increased height",
);
assert.match(
  appCore,
  /async function loadResourceDashboard\(\{ silent = false \} = \{\}\)[\s\S]*?type: "get_resource_dashboard"/,
  "the dashboard should load its sheet data from the backend",
);
assert.match(
  appCore,
  /function isResourceDashboardLink\(value\)[\s\S]*?drive\.google\.com", "docs\.google\.com"/,
  "dashboard resource links should be limited to supported Google resource URLs",
);
assert.doesNotMatch(
  appCore,
  /link\.target\s*=\s*"_blank"/,
  "dashboard resource links must open in the current tab",
);
assert.match(
  appCore,
  /link\.href =\s*reviewerPdfMatch \|\| isInSiteDashboardResource\s*\?\s*"#resource-portal-preview"\s*:\s*linkUrl/,
  "spreadsheet resource values should use in-site preview anchors rather than external Drive URLs",
);
assert.match(
  appCore,
  /titleInParentheses\s*\?\s*titleInParentheses\[1\]\s*:\s*fileTitle/,
  "resource link buttons should keep only the filename in parentheses",
);
assert.match(
  appCore,
  /cleanResourceDisplayName\(resourceTitle\)\.replace\(\/\\\.pdf\$\/i,\s*""\)/,
  "PDF buttons should omit the extension from their visible title",
);
assert.match(
  appCore,
  /isPdfResource =[\s\S]*?isPdfResource \? "fa-file-pdf" : "fa-folder"/,
  "resource links should show PDF icons for syllabuses and PDF filenames",
);
assert.match(
  appCore,
  /if \(!status \|\| !tableHead \|\| !tableBody\) return false;[\s\S]*?if \(!tab\) return false;/,
  "dashboard rendering should not require a visible title bar",
);
assert.match(
  fs.readFileSync("styles.css", "utf8"),
  /\.resource-dashboard-table-frame\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*overflow:\s*clip;[\s\S]*?\.resource-dashboard-table\s*\{[^}]*width:\s*max-content;[^}]*margin-inline:\s*auto;[\s\S]*?\.resource-dashboard-table thead tr::before,\s*\.resource-dashboard-table tbody tr::before\s*\{[^}]*inset:\s*0 -100vw;[^}]*border-bottom:\s*1px solid/,
  "decorative row overflow should be clipped separately without stretching table columns",
);
assert.match(
  appCore,
  /const hasCellValue = \(values, rowIndex, columnIndex\) =>[\s\S]*?displayValue !== "" \|\| isResourceDashboardLink\(linkUrl\)[\s\S]*?const nonEmptyRows = tab\.rows[\s\S]*?resourceColumnIndices\.some\(\(columnIndex\) =>\s*hasCellValue\(values, rowIndex, columnIndex\)[\s\S]*?const populatedColumnIndices = tab\.columns[\s\S]*?visibleRows\.some\(\(\{ values, rowIndex \}\) =>\s*hasCellValue\(values, rowIndex, columnIndex\)/,
  "dashboard rendering should omit rows and columns with no displayed values or resource links",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-topbar\s*\{[^}]*justify-content:\s*flex-start;/,
  "the Return button and Dashboard title should align to the dashboard's left",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-return i\s*\{[^}]*font-size:\s*1rem;/,
  "the home navigation control should display its home icon",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{[^}]*width:\s*min\(100%,\s*40rem\);[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;[^}]*margin-inline:\s*auto;/,
  "the dashboard layout should use a compact stable maximum width and remain responsive",
);
assert.match(
  resourceStyles,
  /\.resource-portal-nav-item\.is-active\s*\{[^}]*background:\s*transparent;/,
  "active dashboard tabs should not have a filled blue background",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control\s*\{[^}]*overflow:\s*hidden;[\s\S]*?\.resource-dashboard-segmented-control button\s*\{[^}]*overflow-x:\s*auto;[^}]*white-space:\s*nowrap;/,
  "filter options should use matching segmented controls without spilling long labels",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*visible;/,
  "the dashboard table should grow with its rows and remain horizontally scrollable",
);
assert.doesNotMatch(
  resourceStyles.match(
    /\.resource-dashboard-table-scroll\s*\{([^}]+)\}/,
  )?.[1] || "",
  /\b(?:height|min-height|max-height)\s*:/,
  "the dashboard table must not impose a fixed or bounded height",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{[^}]*width:\s*min\(100%,\s*40rem\);[^}]*max-width:\s*100%;[^}]*margin-inline:\s*auto;/,
  "the dashboard toolbar and card should maintain a compact consistent width within the available page width",
);
assert.match(
  resourceStyles,
  /\.resource-portal-shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;/,
  "the dashboard box should fill the stable-width layout without exceeding its parent",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;[\s\S]*?\.resource-dashboard-table-frame\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*overflow:\s*clip;[\s\S]*?\.resource-dashboard-table\s*\{[^}]*width:\s*max-content;[^}]*margin-inline:\s*auto;[\s\S]*?\.resource-dashboard-table thead tr::before,\s*\.resource-dashboard-table tbody tr::before\s*\{[^}]*inset:\s*0 -100vw;[^}]*border-bottom:\s*1px solid/,
  "the table frame should clip decorative overflow while actual columns control scrolling",
);
assert.match(
  appCore,
  /function getResourceDashboardColumnHeading\(column\)[\s\S]*?return String\(column\)\.trim\(\)\.toLowerCase\(\) === "course syllabus"\s*\?\s*"SYLLABUS"/,
  "the dashboard should display the syllabus link column as SYLLABUS",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-filters\s*\{[^}]*gap:\s*var\(--resource-dashboard-space\);[\s\S]*?\.resource-dashboard-control\s*\{[^}]*gap:\s*var\(--resource-dashboard-space-tight\);/,
  "filter spacing should use consistent dashboard spacing tokens",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table td\s*\{[^}]*text-align:\s*center;/,
  "dashboard table contents should remain centered",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table thead tr::after\s*\{[^}]*z-index:\s*2;[^}]*right:\s*-100vw;[^}]*bottom:\s*0;[^}]*left:\s*-100vw;[^}]*border-bottom:\s*1px solid/,
  "the table header divider should retain its full-frame decoration",
);
assert.doesNotMatch(
  resourceStyles,
  /\.resource-dashboard-table\s*\{[^}]*min-width:\s*38rem/,
  "the dashboard should not force fixed-width columns on mobile",
);
const dashboardHandler =
  backend.match(
    /function handleGetResourceDashboardRequest\(cachedVersion(?:,\s*accessData)?\)\s*\{[\s\S]*?\n\}/,
  )?.[0] || "";
assert.match(
  backend,
  /RESOURCE_DASHBOARD_INDEX_FILES\s*=\s*\{\s*MODULES:\s*"modules_combined\.json",\s*REVIEWERS:\s*"reviewers_combined\.json",\s*SYLLABUS:\s*"reviewers_combined\.json"/,
  "the backend should use the pasted Drive indexer's combined JSON exports",
);
assert.match(
  backend,
  /MRH_RESOURCE_DASHBOARD_VERSION_CACHE_TTL_SECONDS\s*=\s*CACHE_TTL_SECONDS[\s\S]*?MRH_REVIEWER_DASHBOARD_VERSION_CACHE_TTL_SECONDS\s*=\s*CACHE_TTL_SECONDS/,
  "version-keyed dashboard payloads should remain cached for six hours",
);
assert.match(
  backend,
  /DriveApp\.getFolderById\(RESOURCE_DASHBOARD_INDEX_FOLDER_ID\)[\s\S]*?getFilesByName\(fileName\)/,
  "the backend should read dashboard indexes from their Drive export folder",
);
assert.match(
  dashboardHandler,
  /mrh_resource_dashboard_latest_v1[\s\S]*?return jsonResponse\(parsedLatestDashboard\)/,
  "the backend should serve a fresh dashboard snapshot without Drive metadata lookups",
);
assert.match(
  backend,
  /function handleGetReviewerDashboardRequest\(data\)[\s\S]*?authorizeReviewerRequest_\(data, false\)[\s\S]*?getFilesByName\(fileName\)[\s\S]*?file\.getLastUpdated\(\)\.getTime\(\)[\s\S]*?reviewerCache\.get\(reviewerCacheKey\)[\s\S]*?tab: protectReviewerDashboardTab_\(parsedTab\)/,
  "the reviewer endpoint should authorize each request and check the current index version before serving cached rows",
);
assert.match(
  dashboardHandler,
  /dashboardCache\.put\(\s*dashboardCacheKey,\s*dashboardJson,\s*MRH_RESOURCE_DASHBOARD_VERSION_CACHE_TTL_SECONDS,\s*\)[\s\S]*?dashboardCache\.put\(\s*"mrh_resource_dashboard_latest_v1",\s*dashboardJson,\s*MRH_RESOURCE_DASHBOARD_CACHE_TTL_SECONDS,/,
  "resource payload retention should not extend the short freshness window for the latest snapshot",
);
assert.match(
  backend,
  /reviewerCache\.put\(\s*reviewerCacheKey,\s*reviewerJson,\s*MRH_REVIEWER_DASHBOARD_VERSION_CACHE_TTL_SECONDS,\s*\)/,
  "reviewer payloads should be cached only under their authoritative index version",
);
assert.match(
  backend,
  /links\.push\(rowLinks\)[\s\S]*?linkTitles\.push\(rowTitles\)/,
  "the dashboard adapter should preserve indexed resource links and filenames",
);
assert.match(
  backend,
  /Array\.isArray\(item\)[\s\S]*?item\[1\][\s\S]*?getResourceDashboardExportMimeType/,
  "the dashboard adapter should support legacy tuple exports as well as compact objects",
);
assert.doesNotMatch(
  dashboardHandler,
  /SpreadsheetApp|RESOURCE_DASHBOARD_SPREADSHEET_ID/,
  "the dashboard request must not depend on Google Sheets",
);
assert.match(
  dashboardHandler,
  /versionParts\.push\("reviewers-locked-v1"\)[\s\S]*?\["MODULES", "SYLLABUS"\]\.forEach[\s\S]*?tabs\.REVIEWERS = \{\s*columns: \[\],\s*rows: \[\],/,
  "the public backend should invalidate old caches and return no reviewer content while locked",
);
assert.match(
  appCore,
  /tab\.links\?\.\[rowIndex\]\?\.\[index\]/,
  "dashboard rendering should use the backend-provided hyperlink target",
);
assert.doesNotMatch(
  appCore,
  /sortButton\.addEventListener\("click"[\s\S]*?resourceDashboardSortDirection/,
  "dashboard table headings should not sort their columns",
);
assert.match(
  appCore,
  /resourceDashboardSelectedYear = "3"[\s\S]*?resourceDashboardSelectedSemester = "2"/,
  "dashboard filters should default to year 3, semester 2",
);
assert.match(
  appCore,
  /if \(!hasTermFilter\) return true;[\s\S]*?\(resourceDashboardSelectedYear === "all" \|\|\s*year === resourceDashboardSelectedYear\) &&\s*\(resourceDashboardSelectedSemester === "all" \|\|\s*semester === resourceDashboardSelectedSemester\)/,
  "All Year Levels should retain semester filtering while skipping only the year constraint",
);
assert.match(
  appCore,
  /\.filter\(\s*\(term\) =>\s*allYearLevelsSelected \|\|\s*term\.split\("\."\)\[0\] === resourceDashboardSelectedYear/,
  "semester options should reflect the selected year, or all available years when Year is All",
);
assert.match(
  appCore,
  /options\.push\(\{\s*value:\s*"all",\s*label:\s*"All"\s*\}\)[\s\S]*?button\.dataset\.filterValue = value[\s\S]*?control\.replaceChildren\(\.\.\.buttons\)/,
  "year and semester segments should retain All as a selectable option",
);
assert.match(
  index,
  /id="resource-dashboard-filter-year"[^>]*role="group"[\s\S]*?id="resource-dashboard-filter-semester"[^>]*role="group"/,
  "Year and Semester should be segmented controls",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  "Year and Semester should share the first filter row",
);
assert.match(
  resourceStyles,
  /#resource-dashboard-category-filter\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;/,
  "Category should span the second filter row",
);
assert.doesNotMatch(
  index,
  /id="resource-dashboard-help"|aria-describedby="resource-dashboard-help"/,
  "the resource tabs should not show the removed explanatory note",
);
assert.match(
  appCore,
  /if \(!hasTermFilter\) return true;/,
  "tabs without year data should remain visible without term filtering",
);
assert.match(
  deckNavigation,
  /if \(viewId === "resources"\) \{[\s\S]*?Promise\.resolve\(globalScope\.loadResourceDashboard\?\.\(\)\)\.catch/,
  "opening Resources should load the dashboard without blocking navigation",
);
assert.doesNotMatch(
  fs
    .readFileSync("app-core.js", "utf8")
    .match(/async function loadResourceDashboard\(\)[\s\S]*?\n  \}\n/)?.[0] ||
    "",
  /list_public_resources|get_resource_preview/,
  "dashboard loading should not call the previous Drive listing or preview APIs",
);

let indexReadCount = 0;
let dashboardDriveLookupCount = 0;
let dashboardCacheClock = 0;
const dashboardIndexModifiedTimes = {
  "modules_combined.json": 1000,
  "reviewers_combined.json": 2000,
};
const dashboardCacheValues = new Map();
const dashboardIndexes = {
  "modules_combined.json": {
    b: "https://drive.google.com/open?id=",
    d: {
      3.1: {
        PRELIMS: {
          "SHIP'S AUDIT": [
            "01 SHIP'S AUDIT (Prelims module)",
            "modulePrelims_123456",
            123,
          ],
        },
      },
      4.1: {
        PRELIMS: {
          SAFETY: {
            i: "linkedModule_123456",
            n: "01 SAFETY (Prelims).pdf",
            u: "linkedModule_123456",
            t: 1,
          },
        },
        MIDTERMS: {
          SAFETY: {
            i: "midtermModule_123456",
            n: "02 SAFETY (Exam guide)",
            u: "midtermModule_123456",
            t: 1,
          },
        },
      },
      4.2: {
        FINALS: {
          "SEARCH AND RESCUE": {
            i: "finalModule_123456",
            n: "03 SEARCH AND RESCUE",
            u: "finalModule_123456",
            t: 1,
          },
        },
      },
    },
  },
  "reviewers_combined.json": {
    b: "https://drive.google.com/open?id=",
    d: {
      3.1: {
        PRELIMS: {
          NAV6: [
            "01 NAV6 REVIEWER (Reviewer One).pdf",
            "reviewerPdf_123456",
            123,
            4,
          ],
        },
      },
      4.2: {
        SYLLABUS: {
          "SHIP'S AUDIT": {
            i: "reviewerSyllabus_123456",
            n: "SHIP'S AUDIT COURSE SYLLABUS",
            u: "reviewerSyllabus_123456",
            t: "gdoc",
          },
        },
      },
    },
  },
};
const context = {
  console,
  JSON,
  Math,
  Date,
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => "",
      setProperty() {},
    }),
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest(_algorithm, value) {
      return Array.from(
        crypto.createHash("sha256").update(String(value), "utf8").digest(),
        (byte) => (byte > 127 ? byte - 256 : byte),
      );
    },
  },
  CacheService: {
    getScriptCache: () => ({
      get(key) {
        const entry = dashboardCacheValues.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= dashboardCacheClock) {
          dashboardCacheValues.delete(key);
          return null;
        }
        return entry.value;
      },
      put(key, value, ttlSeconds) {
        dashboardCacheValues.set(key, {
          value,
          expiresAt: dashboardCacheClock + (ttlSeconds || 60) * 1000,
        });
      },
      remove: (key) => dashboardCacheValues.delete(key),
    }),
  },
  DriveApp: {
    getFolderById(id) {
      if (id === "10IQyKdYYX5_jP1hQHVjoSEml4FxAlGCl")
        return {
          createFile(blob) {
            return context.DriveApp.createFile(blob);
          },
        };
      dashboardDriveLookupCount += 1;
      assert.equal(id, "1cP2FBOW-Jryu9eknJgDjUZcxx9qwC22Z");
      return {
        getFilesByName(name) {
          const content = dashboardIndexes[name];
          const files = content
            ? [
                {
                  getId: () => `id-${name}`,
                  getLastUpdated: () =>
                    new Date(dashboardIndexModifiedTimes[name]),
                  getBlob: () => {
                    indexReadCount += 1;
                    return {
                      getDataAsString: () => JSON.stringify(content),
                    };
                  },
                },
              ]
            : [];
          let index = 0;
          return {
            hasNext: () => index < files.length,
            next: () => files[index++],
          };
        },
      };
    },
  },
  ContentService: {
    MimeType: { JSON: "application/json" },
    createTextOutput(text) {
      return {
        text,
        setMimeType() {
          return this;
        },
      };
    },
  },
};
vm.createContext(context);
vm.runInContext(backend, context, { filename: "backend/main.js" });
const readReviewerPdfIndexEntries = context.getReviewerPdfIndexEntries_;

const dashboard = JSON.parse(context.handleGetResourceDashboardRequest().text);
assert.deepEqual(
  JSON.parse(JSON.stringify(dashboard)),
  {
    status: "success",
    version:
      "modules_combined.json:id-modules_combined.json:1000|reviewers_combined.json:id-reviewers_combined.json:2000|reviewers-locked-v1",
    tabs: {
      MODULES: {
        columns: ["Year", "Course", "PRELIMS", "MIDTERMS", "FINALS"],
        rows: [
          ["3.1", "SHIP'S AUDIT", "01 SHIP'S AUDIT (Prelims module)", "", ""],
          [
            "4.1",
            "SAFETY",
            "01 SAFETY (Prelims).pdf",
            "02 SAFETY (Exam guide)",
            "",
          ],
          ["4.2", "SEARCH AND RESCUE", "", "", "03 SEARCH AND RESCUE"],
        ],
        links: [
          [
            "",
            "",
            "https://drive.google.com/open?id=modulePrelims_123456",
            "",
            "",
          ],
          [
            "",
            "",
            "https://drive.google.com/open?id=linkedModule_123456",
            "https://drive.google.com/open?id=midtermModule_123456",
            "",
          ],
          [
            "",
            "",
            "",
            "",
            "https://drive.google.com/open?id=finalModule_123456",
          ],
        ],
        linkTitles: [
          ["", "", "01 SHIP'S AUDIT (Prelims module)", "", ""],
          ["", "", "01 SAFETY (Prelims).pdf", "02 SAFETY (Exam guide)", ""],
          ["", "", "", "", "03 SEARCH AND RESCUE"],
        ],
        linkTypes: [
          ["", "", "application/vnd.google-apps.folder", "", ""],
          [
            "",
            "",
            "application/vnd.google-apps.folder",
            "application/vnd.google-apps.folder",
            "",
          ],
          ["", "", "", "", "application/vnd.google-apps.folder"],
        ],
        truncated: false,
      },
      REVIEWERS: {
        columns: [],
        rows: [],
        links: [],
        linkTitles: [],
        linkTypes: [],
        truncated: false,
      },
      SYLLABUS: {
        columns: ["Year", "Course", "COURSE SYLLABUS"],
        rows: [["4.2", "SHIP'S AUDIT", "SHIP'S AUDIT COURSE SYLLABUS"]],
        links: [
          ["", "", "https://drive.google.com/open?id=reviewerSyllabus_123456"],
        ],
        linkTitles: [["", "", "SHIP'S AUDIT COURSE SYLLABUS"]],
        linkTypes: [["", "", "application/vnd.google-apps.document"]],
        truncated: false,
      },
    },
  },
  "the backend should return Modules and Syllabus while withholding Reviewers dashboard content",
);
assert.equal(indexReadCount, 2);
const dashboardVersionCacheKey = Array.from(dashboardCacheValues.keys()).find(
  (key) => key.startsWith("mrh_resource_dashboard_v1_"),
);
assert.ok(dashboardVersionCacheKey);
assert.equal(
  dashboardCacheValues.get(dashboardVersionCacheKey).expiresAt -
    dashboardCacheClock,
  Number(backend.match(/const CACHE_TTL_SECONDS = (\d+)/)?.[1]) * 1000,
  "the version-keyed public dashboard payload should stay cached for six hours",
);
assert.equal(
  dashboardCacheValues.get("mrh_resource_dashboard_latest_v1").expiresAt -
    dashboardCacheClock,
  context.MRH_RESOURCE_DASHBOARD_CACHE_TTL_SECONDS * 1000,
  "the latest dashboard pointer should keep its short freshness lifetime",
);

const routedDashboard = JSON.parse(
  context.doPost({
    postData: {
      contents: JSON.stringify({
        type: "get_resource_dashboard",
        eventId: "12345678-1234-4123-8123-123456789abc",
        appVersion,
      }),
    },
  }).text,
);
assert.equal(
  routedDashboard.status,
  "success",
  "the public backend should expose the Drive-index dashboard action",
);
assert.equal(
  indexReadCount,
  2,
  "the latest dashboard snapshot should avoid rereading index contents",
);
assert.equal(
  dashboardDriveLookupCount,
  1,
  "a cached dashboard snapshot should avoid another Drive metadata lookup",
);

const reviewerPdfTestTab = {
  columns: ["Year", "PRELIMS", "FINALS"],
  rows: [
    ["3.1", "Reviewer.pdf", "Original notes"],
    ["4.1", "Other PDF", ""],
  ],
  links: [
    [
      "",
      "https://drive.google.com/file/d/reviewerPdf_123456/view",
      "https://drive.google.com/file/d/notesFile_123456/view",
    ],
    ["", "https://drive.google.com/file/d/otherPdf_123456/view", ""],
  ],
  linkTitles: [
    ["", "Reviewer.pdf", "Original notes"],
    ["", "Other PDF", ""],
  ],
  linkTypes: [
    ["", "application/pdf", "text/plain"],
    ["", "application/pdf", ""],
  ],
  truncated: false,
};
const protectedReviewerPdfTab = JSON.parse(
  JSON.stringify(context.protectReviewerDashboardTab_(reviewerPdfTestTab)),
);
assert.equal(
  protectedReviewerPdfTab.links[0][1],
  "mrh-reviewer-pdf:reviewerPdf_123456",
  "Reviewer PDF links should be replaced by protected IDs",
);
assert.equal(
  protectedReviewerPdfTab.links[0][2],
  reviewerPdfTestTab.links[0][2],
  "non-PDF Reviewer resource links should retain their existing behavior",
);
assert.equal(
  protectedReviewerPdfTab.links[1][1],
  "mrh-reviewer-pdf:otherPdf_123456",
  "all Reviewer PDF rows should use protected links",
);
assert.match(
  reviewerPdfTestTab.links[0][1],
  /^https:\/\/drive\.google\.com/,
  "sanitizing the response must not mutate the original index object",
);
(async function runAsyncReviewerChecks() {
  let sourceDriveReads = 0;
  context.authorizeReviewerRequest_ = (_data, bypassAccountCache) => {
    assert.equal(bypassAccountCache, true);
    return {
      error: context.errorResponse("Account is pending.", "ACCOUNT_PENDING"),
    };
  };
  const pendingPreview = JSON.parse(
    context.handleGetReviewerPdfPreviewRequest_({
      eventId: "42345678-1234-4123-8123-123456789abc",
      fileId: "reviewerPdf_123456",
      sessionId: "a".repeat(96),
    }).text,
  );
  assert.equal(pendingPreview.code, "ACCOUNT_PENDING");
  assert.equal(sourceDriveReads, 0, "pending reviewers must be denied before source read");

  context.authorizeReviewerRequest_ = () => ({
    email: "reviewer@example.com",
    account: {
      firstName: "Rita",
      middleInitial: "A.",
      lastName: "Reviewer",
      rawAccountStatus: "TRUE",
    },
  });
  context.appendMRHAccessLog_ = () => true;
  context.getReviewerPdfSource_ = (fileId) => ({
    entry: { fileId, title: "NAV7 Lesson 1.pdf" },
    driveFile: { id: fileId, name: "Reviewer.pdf" },
    sourceVersion: "a".repeat(64),
  });
  const sourceBytes = [37, 80, 68, 70, 45, 49, 46, 55];
  context.DriveApp.getFileById = (fileId) => {
    assert.equal(fileId, "reviewerPdf_123456");
    sourceDriveReads += 1;
    return { getBlob: () => ({ getBytes: () => sourceBytes }) };
  };
  context.Utilities.base64Encode = (bytes) =>
    Buffer.from(bytes.map((byte) => byte & 255)).toString("base64");
  const sourceResponse = JSON.parse(
    context.handleGetReviewerPdfPreviewRequest_({
      eventId: "52345678-1234-4123-8123-123456789abc",
      fileId: "reviewerPdf_123456",
      sessionId: "a".repeat(96),
    }).text,
  );
  assert.equal(sourceResponse.status, "success");
  assert.equal(sourceResponse.deliveryMode, "source");
  assert.equal(sourceResponse.mimeType, "application/pdf");
  assert.equal(sourceResponse.fullName, "Rita A. Reviewer");
  assert.equal(sourceResponse.firstName, "Rita");
  assert.equal(sourceResponse.lastName, "Reviewer");
  assert.equal(sourceResponse.email, "reviewer@example.com");
  assert.equal(
    context.reviewerPdfDownloadName_(
      "NAV7 Lesson 1.pdf",
      "Rita",
      "Reviewer",
    ),
    "[REVIEWER] NAV7 Lesson 1 [RITA].pdf",
  );
  assert.equal(
    context.reviewerPdfDownloadName_(
      "Lesson: 1?.pdf",
      "Rita",
      "Reviewer",
    ),
    "[REVIEWER] Lesson 1 [RITA].pdf",
    "the backend should sanitize resource names before constructing download filenames",
  );
  assert.equal(
    sourceResponse.downloadFileName,
    "[REVIEWER] NAV7 Lesson 1 [RITA].pdf",
  );
  assert.deepEqual([...Buffer.from(sourceResponse.data, "base64")], sourceBytes);
  assert.equal(sourceResponse.watermarked, undefined);
  assert.equal(sourceDriveReads, 1);

  const cachedSourceResponse = JSON.parse(
    context.handleGetReviewerPdfPreviewRequest_({
      eventId: "62345678-1234-4123-8123-123456789abc",
      fileId: "reviewerPdf_123456",
      sessionId: "a".repeat(96),
      cachedSourceVersion: "a".repeat(64),
    }).text,
  );
  assert.equal(cachedSourceResponse.cacheHit, true);
  assert.equal(cachedSourceResponse.deliveryMode, "source");
  assert.equal(cachedSourceResponse.fullName, "Rita A. Reviewer");
  assert.equal(cachedSourceResponse.firstName, "Rita");
  assert.equal(cachedSourceResponse.lastName, "Reviewer");
  assert.equal(cachedSourceResponse.email, "reviewer@example.com");
  assert.equal(
    cachedSourceResponse.downloadFileName,
    "[REVIEWER] NAV7 Lesson 1 [RITA].pdf",
  );
  assert.equal(cachedSourceResponse.data, undefined);
  assert.equal(sourceDriveReads, 1, "validated browser cache avoids another source download");

  const staleQueueTrigger = {
    getHandlerFunction: () => "processReviewerPdfQueue",
  };
  let deletedStaleQueueTrigger = false;
  context.LockService = {
    getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }),
  };
  context.ScriptApp = {
    getProjectTriggers: () => [staleQueueTrigger],
    deleteTrigger: (trigger) => {
      deletedStaleQueueTrigger = trigger === staleQueueTrigger;
    },
  };
  assert.equal(context.processReviewerPdfQueue().status, "disabled");
  assert.equal(
    deletedStaleQueueTrigger,
    true,
    "a stale scheduled queue trigger should retire itself without processing PDFs",
  );

  let aclDeleteCount = 0;
  const aclReport = {
    files: [{
      id: "reviewerPdf_123456",
      name: "Reviewer.pdf",
      mimeType: "application/pdf",
      insideRoot: true,
      reviewerTitles: ["Reviewer.pdf"],
      permissions: [{
        id: "direct-share",
        type: "user",
        role: "writer",
        emailAddress: "former@example.com",
        deleted: false,
        inherited: false,
        inheritedFrom: [],
      }],
    }],
  };
  context.Session = {
    getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }),
  };
  context.PropertiesService.getScriptProperties = () => ({
    getProperty: () => "owner@example.com",
  });
  context.auditReviewerPdfDrivePermissions = () => aclReport;
  context.Drive = {
    Permissions: {
      delete() {
        aclDeleteCount += 1;
      },
    },
  };
  const aclDryRun = context.applyReviewedReviewerPdfPermissionRevocations(
    [{ fileId: "reviewerPdf_123456", permissionId: "direct-share" }],
    "",
  );
  assert.equal(aclDryRun.dryRun, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(aclDryRun.planned)),
    [{ fileId: "reviewerPdf_123456", permissionId: "direct-share" }],
  );
  assert.equal(aclDeleteCount, 0, "ACL dry-run must not change Drive permissions");
  aclReport.files[0].permissions[0].inherited = true;
  assert.throws(
    () =>
      context.applyReviewedReviewerPdfPermissionRevocations(
        [{ fileId: "reviewerPdf_123456", permissionId: "direct-share" }],
        "",
      ),
    /Inherited access must be reviewed/,
    "the permission helper must never delete inherited folder access",
  );
  assert.equal(aclDeleteCount, 0);

  const indexReadsBeforeCacheTest = indexReadCount;
  context.getReviewerPdfIndexEntries_ = readReviewerPdfIndexEntries;
  const cachedPdfIndex = context.getReviewerPdfIndexEntries_();
  const indexReadsAfterFirstPdfIndex = indexReadCount;
  assert.ok(cachedPdfIndex.some((entry) => entry.fileId === "reviewerPdf_123456"));
  assert.equal(indexReadsAfterFirstPdfIndex, indexReadsBeforeCacheTest + 1);
  context.getReviewerPdfIndexEntries_();
  assert.equal(
    indexReadCount,
    indexReadsAfterFirstPdfIndex,
    "a stable authoritative Reviewer index version should be read once from Drive",
  );

  const resourceRootId = "19LoMUsogxTHB5xrI1Gd08NASQv2Zqi6E";
  function makeIterator(values) {
    let index = 0;
    return {
      hasNext: () => index < values.length,
      next: () => values[index++],
    };
  }
  const resourceRootFolder = {
    getId: () => resourceRootId,
    getName: () => "Shared Resources",
    getParents: () => makeIterator([]),
  };
  const publicSubfolder = {
    getId: () => "publicSubFolder_123456",
    getName: () => "Course Materials",
    getParents: () => makeIterator([resourceRootFolder]),
  };
  const privateSubfolder = {
    getId: () => "privateSubFolder_123456",
    getName: () => "REVIEWERS v26.10.31",
    getParents: () => makeIterator([resourceRootFolder]),
  };
  const publicShortcutFile = {
    getParents: () => makeIterator([resourceRootFolder]),
  };
  const outsideShortcutFile = {
    getParents: () => makeIterator([{
      getId: () => "outsideShortcutFolder_123456",
      getName: () => "Outside",
      getParents: () => makeIterator([]),
    }]),
  };
  context.DriveApp.getFolderById = (folderId) => {
    if (folderId === resourceRootId) return resourceRootFolder;
    if (folderId === publicSubfolder.getId()) return publicSubfolder;
    if (folderId === privateSubfolder.getId()) return privateSubfolder;
    throw new Error("Folder not found.");
  };
  context.DriveApp.getFileById = (fileId) => {
    if (fileId === "publicFile_123456") return publicShortcutFile;
    if (fileId === "outsideFile_123456") return outsideShortcutFile;
    throw new Error("File not found.");
  };
  const resourcePages = {
    first: {
      files: [
        {
          id: publicSubfolder.getId(),
          name: publicSubfolder.getName(),
          mimeType: "application/vnd.google-apps.folder",
        },
        {
          id: "publicFile_123456",
          name: "Lesson.pdf",
          mimeType: "application/pdf",
          modifiedTime: "2026-10-17T06:00:00.000Z",
        },
        {
          id: privateSubfolder.getId(),
          name: privateSubfolder.getName(),
          mimeType: "application/vnd.google-apps.folder",
        },
        {
          id: "folderShortcut_123456",
          name: "Course Materials shortcut",
          mimeType: "application/vnd.google-apps.shortcut",
          shortcutDetails: {
            targetId: publicSubfolder.getId(),
            targetMimeType: "application/vnd.google-apps.folder",
          },
        },
        {
          id: "fileShortcut_123456",
          name: "Lesson shortcut.pdf",
          mimeType: "application/vnd.google-apps.shortcut",
          shortcutDetails: {
            targetId: "publicFile_123456",
            targetMimeType: "application/pdf",
          },
        },
        {
          id: "outsideShortcut_123456",
          name: "Outside lesson.pdf",
          mimeType: "application/vnd.google-apps.shortcut",
          shortcutDetails: {
            targetId: "outsideFile_123456",
            targetMimeType: "application/pdf",
          },
        },
      ],
      nextPageToken: "resource_page_2",
    },
    resource_page_2: {
      files: [{
        id: "secondPageFile_123456",
        name: "More content.pdf",
        mimeType: "application/pdf",
      }],
    },
  };
  let resourceListDriveCalls = 0;
  context.Drive = {
    Files: {
      list(options) {
        resourceListDriveCalls += 1;
        assert.match(options.q, new RegExp(`'${resourceRootId}' in parents`));
        assert.match(options.fields, /shortcutDetails\(targetId,targetMimeType\)/);
        return resourcePages[options.pageToken || "first"];
      },
    },
  };
  const firstResourcePage = JSON.parse(
    context.handleListPublicResourcesRequest({ folderId: resourceRootId }).text,
  );
  assert.equal(firstResourcePage.status, "success");
  assert.equal(firstResourcePage.items.length, 4);
  assert.equal(firstResourcePage.items[0].type, "folder");
  assert.equal(firstResourcePage.nextPageToken, "resource_page_2");
  assert.equal(
    firstResourcePage.items.some((item) => item.id === privateSubfolder.getId()),
    false,
    "private Reviewer folders must never be listed as public descendants",
  );
  assert.ok(firstResourcePage.items.some((item) => item.id === publicSubfolder.getId()));
  assert.ok(firstResourcePage.items.some((item) => item.id === "publicFile_123456"));
  assert.equal(
    firstResourcePage.items.some((item) => item.name === "Outside lesson.pdf"),
    false,
    "shortcuts must not expose targets outside the public resource root",
  );
  const secondResourcePage = JSON.parse(
    context.handleListPublicResourcesRequest({
      folderId: resourceRootId,
      pageToken: firstResourcePage.nextPageToken,
    }).text,
  );
  assert.equal(secondResourcePage.items[0].id, "secondPageFile_123456");
  assert.equal(secondResourcePage.truncated, false);
  context.handleListPublicResourcesRequest({
    folderId: resourceRootId,
    pageToken: firstResourcePage.nextPageToken,
  });
  assert.equal(resourceListDriveCalls, 2, "each cached page should avoid a duplicate Drive query");
  assert.equal(
    JSON.parse(
      context.handleListPublicResourcesRequest({
        folderId: privateSubfolder.getId(),
      }).text,
    ).code,
    "FORBIDDEN",
  );
  assert.equal(
    JSON.parse(
      context.handleListPublicResourcesRequest({
        folderId: resourceRootId,
        pageToken: "invalid\npage",
      }).text,
    ).code,
    "BAD_REQUEST",
  );
  const routedFolderPage = JSON.parse(
    context.doPost({
      postData: {
        contents: JSON.stringify({
          type: "list_public_resources",
          folderId: resourceRootId,
          appVersion,
        }),
      },
    }).text,
  );
  assert.equal(
    routedFolderPage.status,
    "success",
    "the public resource API should expose the ancestry-checked folder listing",
  );

  const previewBytes = Array.from(Buffer.from("%PDF-1.4\nIn-site preview", "ascii"));
  const googleDocBytes = Array.from(Buffer.from("%PDF-1.4\nExported Google Doc", "ascii"));
  context.DriveApp.getFileById = (fileId) => {
    if (fileId === "outsideFile_123456") {
      return {
        getParents: () => makeIterator([{
          getId: () => "outsideFolder_123456",
          getName: () => "Outside",
          getParents: () => makeIterator([]),
        }]),
      };
    }
    if (fileId === "googleDoc_123456") {
      return {
        getName: () => "Course Notes",
        getMimeType: () => "application/vnd.google-apps.document",
        getSize: () => 1024,
        getParents: () => makeIterator([resourceRootFolder]),
        getAs(mimeType) {
          assert.equal(mimeType, "application/pdf");
          return { getBytes: () => googleDocBytes };
        },
      };
    }
    assert.equal(fileId, "publicFile_123456");
    return {
      getName: () => "Lesson.pdf",
      getMimeType: () => "application/pdf",
      getSize: () => previewBytes.length,
      getParents: () => makeIterator([resourceRootFolder]),
      getBlob: () => ({ getBytes: () => previewBytes }),
    };
  };
  const resourcePreview = JSON.parse(
    context.handleGetResourcePreviewRequest({ fileId: "publicFile_123456" }).text,
  );
  assert.equal(resourcePreview.status, "success");
  assert.equal(resourcePreview.mimeType, "application/pdf");
  assert.equal(
    Buffer.from(resourcePreview.data, "base64").toString("ascii"),
    Buffer.from(previewBytes).toString("ascii"),
    "the in-site preview should receive the bytes of files beneath the public root",
  );
  const googleDocPreview = JSON.parse(
    context.handleGetResourcePreviewRequest({ fileId: "googleDoc_123456" }).text,
  );
  assert.equal(googleDocPreview.mimeType, "application/pdf");
  assert.equal(
    Buffer.from(googleDocPreview.data, "base64").toString("ascii"),
    Buffer.from(googleDocBytes).toString("ascii"),
    "Google Workspace documents should be exported for in-site PDF preview",
  );
  assert.equal(
    JSON.parse(
      context.handleGetResourcePreviewRequest({ fileId: "outsideFile_123456" }).text,
    ).code,
    "FORBIDDEN",
    "the in-site preview must reject files outside the public resource root",
  );

  console.log("Resource dashboard, in-site folder, and browser-watermarked PDF checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
