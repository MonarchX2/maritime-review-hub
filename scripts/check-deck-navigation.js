const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const timers = [];
const views = new Map();
const deckNavSource = fs.readFileSync("deck-nav-core.js", "utf8");
const appCoreSource = fs.readFileSync("app-core.js", "utf8");
const modalCoreSource = fs.readFileSync("ui-modal-core.js", "utf8");
const stylesSource = fs.readFileSync("styles.css", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");

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
for (const passwordModalId of ["deck-password-modal", "folder-password-modal"]) {
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
  stylesSource,
  /deck-card-lock-overlay/,
  "locked deck blur should not style an overlay lock icon",
);
assert.match(
  modalCoreSource,
  /className:\s*"locked-deck-name-blurred"[\s\S]*?textContent:\s*shortName/,
  "the locked deck name should be isolated in a blurred text element",
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
  /function setDeckPasswordTransitionLoading\(isLoading, statusText = "Loading\.\.\."\) \{[\s\S]*?sibling\.setAttribute\("inert", ""\)[\s\S]*?deckPasswordTransitionSnapshots\.forEach/,
  "password transitions should block background interaction and restore previous state",
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
assert.ok(deckEntryLockFunction, "deck entry should have a global interaction lock");
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
  /  function setDeckPasswordTransitionLoading\(isLoading,[\s\S]*?\n  \}/,
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
  ["settings", false],
]) {
  views.set(`view-${id}`, createView(id, active));
}

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
vm.runInContext(
  deckNavSource,
  context,
  { filename: "deck-nav-core.js" },
);

async function checkConcurrentNavigation() {
  const firstNavigation = context.module.exports.navigate("practice");
  const secondNavigation = context.module.exports.navigate("settings");
  await Promise.all([firstNavigation, secondNavigation]);
  assert.equal(timers.length, 0, "view navigation should not wait for animation timers");

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
}

checkConcurrentNavigation()
  .then(() => console.log("Deck navigation concurrency checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
