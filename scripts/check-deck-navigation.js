const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const timers = [];
const views = new Map();
const deckNavSource = fs.readFileSync("deck-nav-core.js", "utf8");
const appCoreSource = fs.readFileSync("app-core.js", "utf8");
const appCoreStateSource = fs.readFileSync("app-core-state.js", "utf8");
const modalCoreSource = fs.readFileSync("ui-modal-core.js", "utf8");
const stylesSource = fs.readFileSync("styles.css", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const textUtils = require("../text-utils.js");
const confirmationRequests = [];
let confirmationResult = true;

const protectedDeckName = "Maritime Safety";
const scrambledDeckName = textUtils.scrambleWords(protectedDeckName);
assert.notEqual(scrambledDeckName, protectedDeckName);
assert.equal(
  textUtils.scrambleWords(protectedDeckName),
  scrambledDeckName,
  "scrambled locked names should remain stable between renders",
);
assert.equal(
  scrambledDeckName.split(" ").length,
  protectedDeckName.split(" ").length,
  "scrambling should preserve word boundaries",
);
assert.equal(
  textUtils.scrambleWords("A-B 12"),
  "A-B 12",
  "scrambling should preserve punctuation and numeric identifiers",
);

assert.match(
  deckNavSource,
  /async function resetCategory\(subject\)[\s\S]*?emphasis: deckName,\s*blurEmphasis: isDeckLocked\(subject\),/,
  "reset confirmation should request a blurred deck name only when the deck is locked",
);
assert.match(
  modalCoreSource,
  /emphasis\.className =\s*message\.blurEmphasis === true \? "locked-deck-name-blurred" : "";/,
  "confirmation modal should apply the existing locked-deck blur to the emphasized name when requested",
);

const compactDashboardControls = [
  indexSource.match(
    /<summary\s+id="deck-source-trigger"[\s\S]*?<\/summary>/,
  )?.[0],
  indexSource.match(
    /<summary\s+id="deck-sort-trigger"[\s\S]*?<\/summary>/,
  )?.[0],
  indexSource.match(
    /<!-- Study\/Quiz Mode Toggle -->\s*<label[\s\S]*?<\/label>/,
  )?.[0],
  indexSource.match(/<button\s+id="layout-toggle"[\s\S]*?<\/button>/)?.[0],
];
assert.ok(
  compactDashboardControls.every((control) =>
    control?.includes("dashboard-control"),
  ),
  "filter, sort, mode, and layout controls should share the compact dashboard-control style",
);
const dashboardControlClasses = compactDashboardControls
  .map((control) => control.match(/class="([^"]*dashboard-control[^"]*)"/)?.[1])
  .join(" ");
assert.doesNotMatch(
  dashboardControlClasses,
  /\bbg-gray-(?:100|800)\b|\bborder\b|\bshadow-sm\b|\bpy-1\.5\b/,
  "dashboard controls should not render bulky idle backgrounds, borders, shadows, or vertical padding",
);
assert.match(
  stylesSource,
  /\.dashboard-controls\s*\{[^}]*gap:\s*0\.375rem;/,
  "dashboard controls should have reduced spacing between them",
);
assert.match(
  stylesSource,
  /\.dashboard-controls \.dashboard-control\s*\{[^}]*min-height:\s*2rem;[^}]*padding:\s*0\.25rem 0\.375rem;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
  "dashboard controls should use compact height and padding with a clean transparent idle state",
);
assert.match(
  stylesSource,
  /\.dashboard-controls > #deck-sort-menu::before,[\s\S]*?\.dashboard-controls > label\.dashboard-control::before,[\s\S]*?\.dashboard-controls > #layout-toggle::before/,
  "dashboard controls should be visually separated with vertical dividers",
);
assert.match(
  indexSource,
  /class="dashboard-header-row[^"]*\bmb-0\b/,
  "dashboard header should have no bottom margin above the navigation bar",
);
assert.match(
  indexSource,
  /<h2\s+aria-label="Home"[^>]*>[\s\S]*?<span class="dashboard-subject-label" aria-hidden="true"\s*>\s*HOME\s*<\/span\s*>[\s\S]*?class="dashboard-subject-icon fa-solid fa-house"/,
  "the dashboard heading should identify Home with a house icon",
);
assert.match(
  appCoreSource,
  /data-deck-breadcrumb[\s\S]*?<button onclick="goToPath\(-1\)" aria-label="Home" title="Home" class="deck-breadcrumb-home[^"]*"[^>]*>[\s\S]*?<i class="fa-solid fa-house text-brand-500" aria-hidden="true"><\/i>\s*<\/button>/,
  "the deck breadcrumb should use an accessible icon-only house button for Home navigation",
);
assert.match(
  stylesSource,
  /\.deck-breadcrumb-home\s*\{[^}]*display:\s*inline-flex;[^}]*flex:\s*0 0 auto;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;/,
  "the breadcrumb Home button should center its icon without adding width or a background",
);
assert.match(
  appCoreSource,
  /<div data-deck-breadcrumb class="[^"]*">/,
  "the deck breadcrumb should remain a simple inline navigation row",
);
assert.doesNotMatch(
  appCoreSource.match(/<div data-deck-breadcrumb class="([^"]*)">/)?.[1] ?? "",
  /\bbg-white\b|\bdark:bg-gray-800\b|\bp-3\b|\brounded-lg\b|\bshadow-sm\b|\bborder\b/,
  "the deck breadcrumb should not render a background box, border, or shadow",
);
assert.match(
  stylesSource,
  /\.dashboard-header-row\s*\{[^}]*min-height:\s*2\.375rem;[\s\S]*?\.deck-breadcrumb-nav\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*2\.375rem;[^}]*margin-block:\s*0 1rem;[^}]*padding-block:\s*0\.5rem;[^}]*border-block:\s*1px solid #e5e7eb;[\s\S]*?\.dark \.deck-breadcrumb-nav\s*\{[^}]*border-color:\s*#374151;/,
  "the Home/controls row and breadcrumb should align with zero top gap and theme-aware separators",
);
assert.match(
  indexSource,
  /class="student-portal-deck-icon" aria-hidden="true">\s*<i class="fa-solid fa-book-open"><\/i>/,
  "the Student Portal deck in Home should use a book icon",
);

function checkSessionNavigationUrls() {
  const location = {
    protocol: "file:",
    pathname: "/index.html",
    search: "",
    hash: "#/Parent+1/Parent+2",
  };
  const window = {
    location,
    history: {},
    MRH_CONFIG: {},
    addEventListener() {},
  };
  const stateContext = {
    module: { exports: {} },
    window,
    console,
    encodeURIComponent,
    decodeURIComponent,
  };
  vm.createContext(stateContext);
  vm.runInContext(appCoreStateSource, stateContext, {
    filename: "app-core-state.js",
  });

  window.AppState.state.currentPath = ["Parent 1", "Parent 2"];
  window.updateSessionNavigationUrl("Parent 1::Parent 2::Deck A", "study");
  assert.equal(
    location.hash,
    "#/Parent+1/Parent+2/Deck+A/study",
    "study mode should append the deck and study suffix to the folder route",
  );
  assert.equal(
    window.getNavigationPathFromUrl().join("::"),
    "Parent 1::Parent 2",
    "a study session URL should resolve to the deck's immediate parent",
  );
  const studyRoute = window.getSessionNavigationFromUrl();
  assert.equal(studyRoute.mode, "study");
  assert.equal(
    studyRoute.subject,
    "Parent 1::Parent 2::Deck A",
    "the study route should retain the complete deck subject for refresh recovery",
  );

  window.updateSessionNavigationUrl("Parent 1::Parent 2::Deck A", "quiz");
  assert.equal(
    location.hash,
    "#/Parent+1/Parent+2/Deck+A/quiz",
    "quiz mode should append the deck and quiz suffix to the folder route",
  );
  assert.equal(
    window.getNavigationPathFromUrl().join("::"),
    "Parent 1::Parent 2",
    "a quiz session URL should resolve to the deck's immediate parent",
  );
  const quizRoute = window.getSessionNavigationFromUrl();
  assert.equal(quizRoute.mode, "quiz");
  assert.equal(
    quizRoute.subject,
    "Parent 1::Parent 2::Deck A",
    "the quiz route should retain the complete deck subject for refresh recovery",
  );

  location.hash = "#/dashboard";
  assert.deepEqual(
    Array.from(window.getNavigationPathFromUrl()),
    ["resources"],
    "the legacy Dashboard URL should continue opening the portal view",
  );
  location.hash = "#/portal";
  assert.deepEqual(
    Array.from(window.getNavigationPathFromUrl()),
    ["resources"],
    "the Portal URL should open the portal view",
  );
  location.hash = "#/resources";
  assert.deepEqual(
    Array.from(window.getNavigationPathFromUrl()),
    ["resources"],
    "the legacy Resources URL should continue opening the portal view",
  );
  window.updateNavigationUrl(["resources"]);
  assert.equal(
    location.hash,
    "#/portal",
    "opening the portal should use the canonical Portal URL",
  );
}

checkSessionNavigationUrls();
assert.match(
  indexSource,
  /<div class="flex items-center gap-4 relative">\s*<button[\s\S]*?onclick="navigate\('resources'\)"[\s\S]*?aria-label="Open Student Portal"[\s\S]*?fa-house[\s\S]*?Student Portal[\s\S]*?id="btn-theme-toggle"/,
  "the house-icon Student Portal button should appear in the header's right-side actions",
);
assert.match(
  indexSource,
  /<section id="view-resources" class="view-section">[\s\S]*?aria-label="Resource dashboard"/,
  "the dashboard route should open the Resource Dashboard",
);
assert.match(
  indexSource,
  /id="resource-dashboard-return"[\s\S]*?Return to main menu/,
  "the Resource Dashboard should provide a return-to-main-menu control",
);
assert.match(
  indexSource,
  /class="resource-dashboard-topbar"[\s\S]*?resource-dashboard-title" aria-label="Student Portal"[\s\S]*?fa-house[\s\S]*?id="resource-dashboard-profile-nav"[\s\S]*?is-active[\s\S]*?aria-current="page"[\s\S]*?id="resource-dashboard-content" hidden[\s\S]*?id="resource-dashboard-profile"[\s\S]*?resource-profile-screen/,
  "the Student Portal should open on Profile and keep the Profile control beside the title",
);
assert.match(
  deckNavSource,
  /confirmNavigationAwayFromResourceDashboard[\s\S]*?Are you sure you want to exit the Student Portal\?[\s\S]*?requestConfirmation\(message, title\)[\s\S]*?currentView\?\.id === "view-resources"[\s\S]*?confirmNavigationAwayFromResourceDashboard/,
  "leaving the Student Portal should ask for confirmation",
);
assert.doesNotMatch(
  indexSource,
  /Sign in or manage your reviewer account|A reviewer profile must be approved by an administrator/,
  "Profile should not repeat the account/sign-in instructions",
);
assert.match(
  indexSource,
  /frame-src blob:/,
  "the app content security policy should permit only in-site preview frames",
);
for (const inputId of ["deck-password-input", "folder-password-input"]) {
  const inputMarkup = indexSource.match(
    new RegExp(`<input(?=[^>]*id="${inputId}")[^>]*>`, "s"),
  )?.[0];
  assert.ok(inputMarkup, `${inputId} should exist in the page`);
  assert.match(
    inputMarkup,
    /autocomplete="(?:off|new-password)"/,
    `${inputId} should not trigger browser password autofill`,
  );
  assert.match(
    inputMarkup,
    /data-(?:1p-ignore|lpignore|bwignore)="true"/,
    `${inputId} should signal common password managers to ignore this field`,
  );
  assert.match(
    inputMarkup,
    /autocapitalize="off"/,
    `${inputId} should preserve entered password casing on mobile`,
  );
}
for (const passwordModalId of [
  "deck-password-modal",
  "folder-password-modal",
]) {
  const passwordModal = indexSource.match(
    new RegExp(`id="${passwordModalId}"[\\s\\S]*?</div>\\s*</div>`, "s"),
  )?.[0];
  assert.ok(passwordModal, `${passwordModalId} should exist in the page`);
  assert.match(
    passwordModal,
    /class="mt-4 flex gap-3"/,
    `${passwordModalId} should have consistent spacing above its buttons`,
  );
}

assert.match(
  deckNavSource,
  /temporary issue with our servers or services, so this session couldn't start\. Please check your internet connection and try again later\./,
  "deck-start failures should explain the temporary service issue and recovery",
);
assert.match(
  deckNavSource,
  /"error",\s*8000/,
  "the deck-start failure notice should remain visible long enough to read",
);
assert.match(
  appCoreSource,
  /temporary issue with our servers or services, so this deck couldn't start\. Please check your internet connection and try again later\./,
  "the outer deck-start failure notice should use the same guidance",
);
const studyDeckStart = appCoreSource.match(
  /async function reviewDeck\([\s\S]*?\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(studyDeckStart, "Study Mode deck-opening handler should exist");
assert.match(
  studyDeckStart,
  /await globalScope\.navigate\("deck-review"\)[\s\S]*?renderDeckReview\(subject, validQuestions\)[\s\S]*?updateSessionNavigationUrl\?\.\(subject, "study"\)/,
  "Study Mode should finish navigating before updating the session URL",
);
assert.match(
  appCoreStateSource,
  /if \(window\.location\.protocol === "file:"\) \{[\s\S]*?window\.location\.hash = nextHash/,
  "local-file route updates should not reload the page",
);
assert.match(
  appCoreSource,
  /class="deck-card \$\{isDeckInteractionBusy \? "deck-interaction-blocked" : "cursor-pointer"\} \$\{syncLockClass\} \$\{isLocked \? "password-protected-deck" : ""\}/,
  "password-protected deck cards should receive the blur class",
);
const deckCardMarkup = appCoreSource.match(
  /<div data-deck-key="\$\{escapeHTML\(subj\)\}"[\s\S]*?aria-busy="\$\{isDeckInteractionBusy \|\| isDeckLoading\}">/,
)?.[0];
assert.ok(deckCardMarkup, "dashboard deck card markup should exist");
assert.doesNotMatch(
  deckCardMarkup,
  /hover:-translate-y|active:scale|transition-transform/,
  "deck cards should not move or animate during entry and exit navigation",
);
const folderCardMarkup = appCoreSource.match(
  /<div data-folder-key="\$\{escapeHTML\(key\)\}"[\s\S]*?overflow-hidden flex flex-col relative">/,
)?.[0];
assert.ok(folderCardMarkup, "dashboard folder card markup should exist");
assert.doesNotMatch(
  folderCardMarkup,
  /hover:-translate-y|transition-transform/,
  "folders should not move during entry and exit navigation",
);
assert.match(indexSource, /<div id="category-list"><\/div>/);
assert.match(
  indexSource,
  /<button\s+onclick="navigate\('resources'\)"[\s\S]*?aria-label="Open Student Portal"[\s\S]*?type="button"[\s\S]*?hidden[\s\S]*?Student Portal/,
  "the legacy header Student Portal control should be hidden",
);
assert.match(
  indexSource,
  /<section id="view-dashboard"[^>]*>\s*<div class="student-portal-deck-grid">[\s\S]*?<button[\s\S]*?class="student-portal-deck deck-card"[\s\S]*?onclick="navigate\('resources'\)"[\s\S]*?aria-label="Open Student Portal"[\s\S]*?<span class="student-portal-deck-title">STUDENT PORTAL<\/span>[\s\S]*?<\/button>[\s\S]*?<\/div>\s*<div\s+id="deck-not-found-notice"/,
  "the Student Portal deck should be the first item at the top of the dashboard",
);
assert.match(
  indexSource,
  /id="student-portal-welcome-name"[\s\S]*?aria-label="Welcome, Guest\."[\s\S]*?>\s*Welcome, Guest\.\s*<\/h1>[\s\S]*?<a\s+id="student-portal-welcome-signin"[\s\S]*?class="student-portal-welcome-signin"[\s\S]*?onclick="navigate\('resources'\); return false;"[\s\S]*?>\s*Sign in<\/a\s*>[\s\S]*?id="student-portal-welcome-email"/,
  "the dashboard should show the Guest welcome with a Sign in link to the portal",
);
assert.match(
  indexSource,
  /class="student-portal-welcome-email-line"[\s\S]*?id="student-portal-welcome-email"/,
  "the welcome banner should group the email into its own identity line",
);
assert.match(
  indexSource,
  /id="student-portal-welcome-access-icon"[\s\S]*?id="student-portal-welcome-verification"[\s\S]*?>\s*Unverified<\/span\s*>/,
  "the welcome banner should provide an email-adjacent access icon and an Unverified label below the email",
);
assert.match(
  indexSource,
  /<\/p>\s*<div class="student-portal-welcome-verification-actions">[\s\S]*?id="student-portal-welcome-view-profile"[\s\S]*?View Profile[\s\S]*?id="student-portal-welcome-verification"[\s\S]*?>\s*Unverified/,
  "the View Profile button and Unverified label should appear in that order below the email line",
);
assert.match(
  indexSource,
  /id="student-portal-welcome-view-profile"[\s\S]*?navigate\('resources'\)\.then\(\(navigated\) => \{ if \(navigated\) openResourceDashboardTab\('PROFILE'\); \}\)/,
  "View Profile should navigate directly to Profile settings",
);
assert.match(
  appCoreSource,
  /function renderStudentPortalWelcome\([\s\S]*?accountStatus = ""[\s\S]*?TRUE:\s*\["fa-check", "is-granted", "Access granted"\][\s\S]*?FALSE:\s*\["fa-triangle-exclamation", "is-pending", "Access pending"\][\s\S]*?DENIED:\s*\["fa-xmark", "is-denied", "Access denied"\][\s\S]*?const isUnverified = isSignedIn && accountStatus === "NOT_FOUND"[\s\S]*?welcomeVerification\.hidden = !isUnverified[\s\S]*?welcomeViewProfile\.hidden = !isSignedIn/,
  "the welcome banner should show approval states, mark unverified accounts, and always provide Profile navigation when signed in",
);
assert.match(
  stylesSource,
  /\.student-portal-welcome-verification-actions\s*\{[^}]*display:\s*flex;[^}]*margin-top:\s*0\.25rem;/,
  "welcome verification status and profile navigation should occupy a separate line under the email",
);
assert.match(
  appCoreSource,
  /renderStudentPortalWelcome\(\s*response\.accountStatus === "NOT_FOUND" \? "" : displayName,[\s\S]*?response\.accountStatus,/,
  "unsubmitted Gmail profiles should show Welcome, Guest and status verification should follow backend account state",
);
assert.match(
  stylesSource,
  /\.student-portal-welcome-access-icon\.is-granted\s*\{[^}]*color:\s*#16a34a;[\s\S]*?\.student-portal-welcome-access-icon\.is-pending\s*\{[^}]*color:\s*#d97706;[\s\S]*?\.student-portal-welcome-access-icon\.is-denied\s*\{[^}]*color:\s*#dc2626;/,
  "welcome access icons should use green, orange, and red status colors",
);
assert.match(
  indexSource,
  /id="student-portal-welcome-picture"[\s\S]*?<span class="student-portal-deck-description">\s*Syllabus, Modules, and Reviewers/,
  "the dashboard should show a profile picture and requested Student Portal subtitle",
);
assert.match(
  indexSource,
  /id="student-portal-welcome-toggle"[^>]*aria-controls="student-portal-welcome"[^>]*aria-expanded="true"/,
  "the welcome banner should provide an accessible show/hide control",
);
assert.match(
  appCoreSource,
  /STUDENT_PORTAL_WELCOME_HIDDEN_KEY[\s\S]*?function setStudentPortalWelcomeHidden\(hidden, persist = false\)[\s\S]*?localStorage\.setItem\([\s\S]*?function initializeStudentPortalWelcome\(\)[\s\S]*?localStorage\.getItem\(/,
  "the welcome banner visibility choice should persist across reloads",
);
assert.match(
  appCoreSource,
  /function updateStudentPortalWelcomeLayout\(\)[\s\S]*?if \(welcome\.hidden\)[\s\S]*?container\.classList\.add\("is-stacked"\)[\s\S]*?getBoundingClientRect\(\)[\s\S]*?overlapsVertically[\s\S]*?container\.classList\.toggle\("is-stacked", !isSideBySide\)/,
  "welcome centering should respond to whether the portal and banner actually share a row",
);
assert.match(
  appCoreSource,
  /function updateStudentPortalWelcomeName\(\)[\s\S]*?container\?\.classList\.contains\("is-stacked"\)[\s\S]*?heading\.textContent = `Welcome, \$\{lastName\}\.`[\s\S]*?heading\.textContent = fullText/,
  "stacked banners should show only the last name while side-by-side banners retain the full name when it fits",
);
assert.match(
  appCoreSource,
  /function initializeStudentPortalWelcome\(\)[\s\S]*?const cachedProfile = getStoredReviewerProfile\(\)[\s\S]*?renderStudentPortalWelcome\([\s\S]*?cachedProfile\.email[\s\S]*?cachedProfile\.picture/,
  "cached reviewer profile details should populate the welcome banner during startup",
);
assert.match(
  stylesSource,
  /\.student-portal-welcome-container\.is-stacked \.student-portal-welcome\s*\{[^}]*flex-direction:\s*column;[^}]*gap:\s*0\.5rem;[^}]*padding-bottom:\s*0;[^}]*text-align:\s*center;[\s\S]*?\.student-portal-welcome-container\.is-stacked \.student-portal-welcome-avatar\s*\{[^}]*width:\s*7rem;[^}]*height:\s*7rem;/,
  "a stacked welcome profile should be centered with reduced spacing before its visibility control",
);
assert.match(
  stylesSource,
  /\.student-portal-welcome-container\.is-stacked \.student-portal-welcome-view-profile\s*\{[^}]*margin-block:\s*0\.25rem;/,
  "the stacked small-screen View Profile button should have breathing room above and below",
);
assert.match(
  stylesSource,
  /\.student-portal-welcome-toggle\s*\{[^}]*display:\s*none;[\s\S]*?\.student-portal-welcome-container\.is-stacked \.student-portal-welcome-toggle\s*\{[^}]*display:\s*inline-flex;/,
  "the welcome visibility toggle should only show when the banner is stacked",
);
assert.match(
  stylesSource.match(/\.student-portal-welcome-avatar\s*\{([^}]*)\}/)?.[1] ?? "",
  /width:\s*5rem;[^}]*height:\s*5rem;[^}]*font-size:\s*4rem;/,
  "the side-by-side welcome avatar should be larger than the stacked layout avatar",
);
assert.match(
  stylesSource,
  /\.student-portal-welcome-copy p\s*\{[^}]*margin:\s*0\.125rem 0 0;/,
  "the welcome email line should be tightly spaced below the greeting",
);
assert.match(
  stylesSource,
  /\.student-portal-welcome-container\.is-stacked \.student-portal-welcome-copy p\s*\{[^}]*margin-top:\s*0;[^}]*line-height:\s*1\.1;/,
  "the stacked small-screen welcome email line should sit closer to the greeting",
);
assert.match(
  appCoreSource,
  /Show Welcome Banner/,
  "the hidden-banner action should say Show Welcome Banner",
);
assert.match(
  appCoreSource,
  /function updateStudentPortalWelcomeName\(\)[\s\S]*?heading\.scrollWidth > heading\.clientWidth[\s\S]*?heading\.textContent = `Welcome, \$\{lastName\}\.`[\s\S]*?function renderStudentPortalWelcome\([\s\S]*?lastName = ""[\s\S]*?response\.lastName/,
  "the welcome heading should use the full name when it fits and the last name when space is short",
);
assert.match(
  stylesSource,
  /\.student-portal-welcome-copy h1\s*\{[^}]*width:\s*100%;[^}]*white-space:\s*nowrap;/,
  "the welcome name should stay on one line so its available space can be measured",
);
assert.doesNotMatch(
  indexSource,
  /<span class="student-portal-deck-action"[^>]*>[\s\S]*?Open portal/,
  "the Student Portal card should not show an Open Portal action label",
);
assert.match(
  stylesSource,
  /\.student-portal-deck-grid\s*\{[^}]*display:\s*grid;[^}]*gap:\s*1rem;[^}]*margin-block:\s*-0\.5rem 1rem;[\s\S]*?\.student-portal-deck\s*\{[^}]*width:\s*100%;[^}]*gap:\s*0\.75rem;[^}]*padding:\s*0\.75rem 1rem;[\s\S]*?background:\s*#fff;[\s\S]*?\.student-portal-deck-icon\s*\{[^}]*width:\s*2\.5rem;[^}]*height:\s*2\.5rem;[\s\S]*?\.dark \.student-portal-deck\s*\{[\s\S]*?background:\s*#1f2937;/,
  "the Student Portal deck should use compact spacing and match the dashboard's neutral light and dark styling",
);
assert.match(
  stylesSource,
  /@media \(min-width: 48rem\)\s*\{\s*\.student-portal-deck-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;[^}]*gap:\s*0\.5rem;[\s\S]*?\.student-portal-deck\s*\{[^}]*width:\s*fit-content;[^}]*flex-direction:\s*row-reverse;[^}]*justify-self:\s*end;/,
  "the wide-screen portal button should right-align with its icon on the right and reduced spacing",
);
assert.match(
  stylesSource,
  /@media \(min-width: 48rem\)\s*\{\s*\.student-portal-deck-grid\s*\{[^}]*margin-top:\s*-1\.5rem;/,
  "the wide-screen Student Portal row should reduce the main-content top gap",
);
assert.doesNotMatch(
  stylesSource.match(/\.student-portal-deck\s*\{([^}]*)\}/)?.[1] ?? "",
  /min-height:\s*8rem/,
  "the Student Portal deck should grow to its content instead of retaining excess minimum height",
);
assert.match(
  stylesSource.match(/\.student-portal-deck\s*\{([^}]*)\}/)?.[1] ?? "",
  /align-self:\s*center;/,
  "the Student Portal background should size to its own content instead of stretching with the welcome toggle",
);
assert.match(
  appCoreSource,
  /container\.className = "";/,
  "dashboard list rendering should not animate layout changes",
);
assert.match(
  appCoreSource,
  /!isGroup &&\s*\(isDeckLocked\(deckSubject\) \|\| Boolean\(item\._data\?\.Locked\)\)/,
  "locked leaf decks in tree mode should receive the protected treatment",
);
assert.match(
  stylesSource,
  /\.password-protected-deck > :not\(\[data-deck-loader\]\)\s*\{\s*filter:\s*blur\(4px\);/,
  "locked deck content should be blurred while its loading veil remains sharp",
);
assert.doesNotMatch(
  appCoreSource,
  /deck-card-lock-overlay/,
  "locked decks should not render an overlay lock icon",
);
assert.doesNotMatch(
  appCoreSource,
  /fa-lock text-red-500 ml-2/,
  "locked deck and folder names should not have a redundant lock icon",
);
assert.doesNotMatch(
  stylesSource,
  /deck-card-lock-overlay/,
  "locked deck blur should not style an overlay lock icon",
);
assert.match(
  modalCoreSource,
  /className:\s*"locked-deck-name-blurred"[\s\S]*?scrambleWords\(shortName\)/,
  "the locked deck name should be scrambled inside its blurred text element",
);
assert.match(
  modalCoreSource,
  /createTextNode\('The folder "'\)[\s\S]*?className:\s*"locked-deck-name-blurred"[\s\S]*?scrambleWords\(folderName\)/,
  "the locked folder name should be scrambled and blurred in its password dialog",
);
assert.match(
  stylesSource,
  /\.locked-deck-name-blurred\s*\{\s*filter:\s*blur\(4px\);/,
  "the deck name in its password dialog should be blurred",
);
assert.match(
  modalCoreSource,
  /replaceChildren\([\s\S]*?createTextNode\("The deck "\)[\s\S]*?createTextNode\(" requires a password\."\)/,
  "only the deck name should be blurred while dialog instructions remain readable",
);
assert.match(
  indexSource,
  /id="deck-password-loading-status"[\s\S]*?hidden[\s\S]*?role="status"[\s\S]*?fa-spinner fa-spin/,
  "the deck password dialog should provide a hidden accessible loading indicator",
);
assert.match(
  appCoreSource,
  /function setDeckPasswordTransitionLoading\(\s*isLoading,\s*statusText = "Loading\.\.\.",?\s*\) \{[\s\S]*?sibling\.setAttribute\("inert", ""\)[\s\S]*?deckPasswordTransitionSnapshots\.forEach/,
  "password transitions should block background interaction and restore previous state",
);
assert.match(
  appCoreSource,
  /setDeckPasswordTransitionLoading\(true, ""\);/,
  "password modal mode switches should hide the Switching modes status text",
);
assert.doesNotMatch(
  appCoreSource,
  /"Switching modes\.\.\."/,
  "the password modal should not display the Switching modes status text",
);
const passwordSubmitHandler = appCoreSource.match(
  /if \(btnSubmitDeckPassword\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(passwordSubmitHandler, "the password submit handler should exist");
assert.match(
  passwordSubmitHandler,
  /setDeckPasswordTransitionLoading\(\s*true,[\s\S]*?closeDeckPasswordModal\(\);[\s\S]*?setDeckPasswordTransitionLoading\(false\)/,
  "the password dialog should remain open and loading until the operation finishes",
);
assert.match(
  passwordSubmitHandler,
  /catch \(error\) \{[\s\S]*?setFormError\("deck-password-input", "Incorrect password\."\);[\s\S]*?input\?\.focus\(\);/,
  "incorrect deck passwords should be reported inline in the dialog",
);
assert.match(
  appCoreSource,
  /errorText\.includes\("incorrect password"\) && pass\)\s*\{\s*throw new Error\("Incorrect password\."\);/,
  "incorrect password responses returned as data should reach the inline dialog error",
);
assert.match(
  appCoreSource,
  /if \(\s*pass &&\s*\(\/incorrect password\/i\.test\(String\(err\?\.message \|\| ""\)\) \|\|\s*String\(err\?\.code \|\| ""\)\.toUpperCase\(\) === "PASSWORD_REQUIRED"\)\s*\) \{\s*throw err;\s*\}/,
  "incorrect password fetch errors should bypass the background toast and reach the dialog",
);
assert.match(
  appCoreSource,
  /if \(!pathValid && isInitialSyncComplete\) \{\s*showDeckNotFound\(state\.currentPath\);/,
  "missing deep links should show a not-found message after the first category summary loads",
);
const deckEntryLockFunction = appCoreSource.match(
  /  function setDeckEntryInteractionsLocked\(isLocked\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(
  deckEntryLockFunction,
  "deck entry should have a global interaction lock",
);
const entryLockElements = ["header", "main"].map(() => {
  const attributes = new Map();
  return {
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    attributes,
  };
});
entryLockElements[0].setAttribute("aria-busy", "false");
entryLockElements[1].setAttribute("inert", "");
const entryLockContext = {
  document: {
    querySelectorAll: (selector) => {
      assert.equal(selector, "body");
      return entryLockElements;
    },
  },
};
vm.createContext(entryLockContext);
vm.runInContext(
  `let deckEntryInteractionSnapshots = null;
  ${deckEntryLockFunction}
  globalThis.setDeckEntryInteractionsLocked = setDeckEntryInteractionsLocked;`,
  entryLockContext,
);
entryLockContext.setDeckEntryInteractionsLocked(true);
entryLockContext.setDeckEntryInteractionsLocked(true);
assert.equal(entryLockElements[0].hasAttribute("inert"), true);
assert.equal(entryLockElements[1].hasAttribute("aria-busy"), true);
entryLockContext.setDeckEntryInteractionsLocked(false);
assert.equal(entryLockElements[0].hasAttribute("inert"), false);
assert.equal(entryLockElements[0].getAttribute("aria-busy"), "false");
assert.equal(entryLockElements[1].hasAttribute("inert"), true);
assert.equal(entryLockElements[1].hasAttribute("aria-busy"), false);

const passwordTransitionFunction = appCoreSource.match(
  /  function setDeckPasswordTransitionLoading\(\s*isLoading,[\s\S]*?\n  \}/,
)?.[0];
assert.ok(
  passwordTransitionFunction,
  "password transitions should have a loading and interaction-lock helper",
);
function createTransitionElement(parent = null, { disabled = false } = {}) {
  const attributes = new Map();
  const classes = new Set();
  const element = {
    parentElement: parent,
    children: [],
    disabled,
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    querySelector(selector) {
      return selector === "span" ? element.statusLabel : null;
    },
    querySelectorAll(selector) {
      return selector === "input, button" ? element.controls || [] : [];
    },
  };
  if (parent) parent.children.push(element);
  return element;
}
const transitionBody = createTransitionElement();
const pageContent = createTransitionElement(transitionBody);
pageContent.setAttribute("aria-busy", "false");
const modalShell = createTransitionElement(transitionBody);
const modalHeading = createTransitionElement(modalShell);
const transitionModal = createTransitionElement(modalShell);
transitionModal.setAttribute("aria-busy", "previous");
const transitionStatus = createTransitionElement();
transitionStatus.hidden = true;
transitionStatus.statusLabel = { textContent: "" };
transitionModal.controls = [
  createTransitionElement(),
  createTransitionElement(null, { disabled: true }),
  createTransitionElement(),
];
transitionModal.controls[2].id = "btn-submit-deck-password";
const transitionContext = {
  document: {
    body: transitionBody,
    getElementById(id) {
      if (id === "deck-password-modal") return transitionModal;
      if (id === "deck-password-loading-status") return transitionStatus;
      return null;
    },
  },
};
vm.createContext(transitionContext);
vm.runInContext(
  `let deckPasswordTransitionSnapshots = null;
  let deckPasswordControlSnapshots = null;
  let deckPasswordPreviousAriaBusy = null;
  ${passwordTransitionFunction}
  globalThis.setDeckPasswordTransitionLoading = setDeckPasswordTransitionLoading;`,
  transitionContext,
);
transitionContext.setDeckPasswordTransitionLoading(true, "Switching modes...");
assert.equal(transitionStatus.hidden, false);
assert.equal(transitionStatus.statusLabel.textContent, "Switching modes...");
assert.equal(pageContent.hasAttribute("inert"), true);
assert.equal(pageContent.getAttribute("aria-busy"), "true");
assert.equal(modalHeading.hasAttribute("inert"), true);
assert.equal(transitionModal.controls[0].disabled, true);
assert.equal(transitionModal.controls[1].disabled, true);
assert.equal(
  transitionModal.controls[2].disabled,
  false,
  "the submit button remains under the busy-button lifecycle",
);
transitionContext.setDeckPasswordTransitionLoading(false);
assert.equal(transitionStatus.hidden, true);
assert.equal(pageContent.hasAttribute("inert"), false);
assert.equal(pageContent.getAttribute("aria-busy"), "false");
assert.equal(modalHeading.hasAttribute("inert"), false);
assert.equal(transitionModal.getAttribute("aria-busy"), "previous");
assert.equal(transitionModal.controls[0].disabled, false);
transitionContext.setDeckPasswordTransitionLoading(true, "");
assert.equal(
  transitionStatus.hidden,
  true,
  "the redundant modal loading message should stay hidden during a normal deck load",
);
transitionContext.setDeckPasswordTransitionLoading(false);
assert.equal(
  transitionModal.controls[1].disabled,
  true,
  "dialog controls that were already disabled remain disabled after loading",
);

const pathValidation = appCoreSource.match(
  /if \(!Array\.isArray\(state\.currentPath\)\) state\.currentPath = \[\];[\s\S]*?if \(!pathValid && isInitialSyncComplete\) \{[\s\S]*?\n      \} else if \(pathValid\) \{[\s\S]*?\n      \}/,
);
assert.ok(pathValidation, "category path validation should be available");
const validateCategoryPath = vm.runInNewContext(
  `function validateCategoryPath(state, tree, isInitialSyncComplete, globalScope, showDeckNotFound, dismissDeckNotFound) {
    ${pathValidation[0]}
    return state.currentPath;
  }
  validateCategoryPath;`,
);
const deepPath = ["BSMT Competencies", "Function 2"];
const persistedPaths = [];
const notFoundPaths = [];
assert.deepEqual(
  Array.from(
    validateCategoryPath(
      { currentPath: [...deepPath] },
      {},
      false,
      { persistNavigationPath: (path) => persistedPaths.push(path) },
      (path) => notFoundPaths.push(Array.from(path)),
      () => {},
    ),
  ),
  deepPath,
  "a valid deep link should survive while the first category summary is loading",
);
assert.deepEqual(
  Array.from(
    validateCategoryPath(
      { currentPath: [...deepPath] },
      {},
      true,
      { persistNavigationPath: (path) => persistedPaths.push(path) },
      (path) => notFoundPaths.push(Array.from(path)),
      () => {},
    ),
  ),
  [],
  "an invalid deep link should still be cleared after the initial summary loads",
);
assert.deepEqual(
  notFoundPaths,
  [deepPath],
  "the not-found message should identify the invalid deck path",
);

function createView(id, active = false) {
  const classes = new Set(["view-section"]);
  if (active) classes.add("active");
  return {
    id: `view-${id}`,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    setAttribute() {},
    removeAttribute() {},
    isActive: () => classes.has("active"),
  };
}

for (const [id, active] of [
  ["dashboard", true],
  ["practice", false],
  ["deck-review", false],
  ["settings", false],
  ["resources", false],
]) {
  views.set(`view-${id}`, createView(id, active));
}

const navigationUrlUpdates = [];
const context = {
  module: { exports: {} },
  state: { session: { active: false }, currentPath: [] },
  LifecycleUtils: {},
  document: {
    head: { appendChild() {} },
    createElement: () => ({ textContent: "" }),
    getElementById: (id) => views.get(id) || null,
    querySelector: (selector) =>
      selector === ".view-section.active"
        ? [...views.values()].find((view) => view.isActive()) || null
        : null,
  },
  updateDashboard() {},
  updateNavigationUrl(path, options) {
    navigationUrlUpdates.push({ path: [...path], options });
  },
  getNavigationPathFromUrl: () => [],
  requestConfirmation: async (message, title) => {
    confirmationRequests.push({ message, title });
    return confirmationResult;
  },
  openResourceDashboardTab(tabName) {
    this.resourceDashboardDefaultTab = tabName;
  },
  loadResourceDashboard: async () => true,
  saveSessionProgress() {},
  saveState: async () => true,
  renderCategoryProgressNow(options) {
    assert.equal(options?.allowInactive, true);
    assert.equal(
      views.get("view-dashboard").isActive(),
      false,
      "dashboard progress should be rendered before the dashboard is revealed",
    );
    this.dashboardPreRendered = true;
  },
};
context.globalScope = context;
vm.createContext(context);
vm.runInContext(deckNavSource, context, { filename: "deck-nav-core.js" });

async function checkConcurrentNavigation() {
  const firstNavigation = context.module.exports.navigate("practice");
  const secondNavigation = context.module.exports.navigate("settings");
  await Promise.all([firstNavigation, secondNavigation]);
  assert.equal(
    timers.length,
    0,
    "view navigation should not wait for animation timers",
  );

  const activeViews = [...views.values()].filter((view) => view.isActive());
  assert.deepEqual(
    activeViews.map((view) => view.id),
    ["view-settings"],
    "rapid navigation must leave only the last requested view active",
  );

  await context.module.exports.navigate("dashboard");
  assert.equal(
    context.dashboardPreRendered,
    true,
    "returning to the dashboard should render its latest deck state before revealing it",
  );
  context.state.currentPath = ["Parent 1", "Parent 2"];
  context.state.session.active = true;
  await context.module.exports.navigate("practice");
  await context.module.exports.navigate("dashboard");
  assert.equal(
    navigationUrlUpdates.at(-1).path.join("::"),
    "Parent 1::Parent 2",
    "returning from a quiz should restore its immediate parent folder URL",
  );
  assert.equal(
    navigationUrlUpdates.at(-1).options.replace,
    true,
    "quiz return should replace the session URL in browser history",
  );

  await context.module.exports.navigate("deck-review");
  await context.module.exports.navigate("dashboard");
  assert.equal(
    navigationUrlUpdates.at(-1).path.join("::"),
    "Parent 1::Parent 2",
    "returning from study mode should restore its immediate parent folder URL",
  );
  assert.equal(
    navigationUrlUpdates.at(-1).options.replace,
    true,
    "study return should replace the session URL in browser history",
  );

  await context.module.exports.navigate("resources");
  assert.equal(
    context.resourceDashboardDefaultTab,
    "DEFAULT",
    "entering the Resource Dashboard should let the saved reviewer session select its default tab",
  );
  assert.equal(
    navigationUrlUpdates.at(-1).path.join("/"),
    "resources",
    "opening Resources should set its dedicated navigation route",
  );
  confirmationResult = false;
  assert.equal(
    await context.module.exports.navigate("dashboard"),
    false,
    "cancelling the Resource Dashboard exit should keep the user in it",
  );
  assert.equal(
    views.get("view-resources").isActive(),
    true,
    "the Resource Dashboard should remain visible after exit is cancelled",
  );
  assert.deepEqual(confirmationRequests.at(-1), {
    message: "Are you sure you want to exit the Student Portal?",
    title: "Exit Student Portal",
  });
  confirmationResult = true;
  await context.module.exports.navigate("dashboard");
  assert.equal(
    navigationUrlUpdates.at(-1).path.join("::"),
    "Parent 1::Parent 2",
    "leaving Resources should restore the current dashboard path",
  );
}

checkConcurrentNavigation()
  .then(() => console.log("Deck navigation concurrency checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
