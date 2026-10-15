(function (globalScope) {
  "use strict";

  const state = globalScope.state;

  function saveState() {
    return globalScope.saveState?.();
  }

  function renderCategoryProgress() {
    return globalScope.renderCategoryProgress?.();
  }

  const SESSION_SETTING_KEYS = {
    quiz: new Set([
      "activeRecall",
      "shuffleChoices",
      "shuffleQuestions",
      "quizHideABCD",
      "clozeEnabled",
      "srsEnabled",
      "qTypeOverride",
      "quizShowExplanations",
    ]),
    study: new Set([
      "hideABCD",
      "showWrongChoices",
      "studyShowExplanations",
      "studyLayout",
      "studyPageSize",
      "studyFilterMode",
    ]),
  };
  const hasOwn = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);

  function syncPreferenceControls() {
    if (typeof globalScope.AppState?.syncPreferenceControls === "function") {
      return globalScope.AppState.syncPreferenceControls();
    }
    throw new Error(
      "AppState is required before synchronizing preference controls.",
    );
  }

  function getNavigationContextSubject() {
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      return globalScope.getCurrentReviewSubject?.() || "";
    }

    if (state.session?.active) {
      return (
        state.session.questions?.[state.session.currentIndex]?.Subject || ""
      );
    }

    return "";
  }

  function getDeckSessionSetting(
    mode,
    key,
    subject = getNavigationContextSubject(),
  ) {
    const deckKey = String(subject || "").trim();
    if (!SESSION_SETTING_KEYS[mode]?.has(key) || !deckKey) {
      return state.prefs[key];
    }
    const decks = state.prefs.deckSessionSettings;
    const settings =
      decks && hasOwn(decks, deckKey)
        ? decks[deckKey]?.[mode]
        : null;
    return settings && hasOwn(settings, key)
      ? settings[key]
      : state.prefs[key];
  }

  function setDeckSessionSetting(
    mode,
    key,
    value,
    subject = getNavigationContextSubject(),
  ) {
    const deckKey = String(subject || "").trim();
    if (!SESSION_SETTING_KEYS[mode]?.has(key) || !deckKey) return false;

    let deckSettings = state.prefs.deckSessionSettings;
    if (!deckSettings || Object.getPrototypeOf(deckSettings) !== null) {
      deckSettings = Object.assign(
        Object.create(null),
        deckSettings || {},
      );
    }
    state.prefs.deckSessionSettings = deckSettings;
    if (
      !hasOwn(deckSettings, deckKey) ||
      !deckSettings[deckKey] ||
      typeof deckSettings[deckKey] !== "object"
    ) {
      deckSettings[deckKey] = Object.create(null);
    }
    if (
      !hasOwn(deckSettings[deckKey], mode) ||
      !deckSettings[deckKey][mode] ||
      typeof deckSettings[deckKey][mode] !== "object"
    ) {
      deckSettings[deckKey][mode] = Object.create(null);
    }
    deckSettings[deckKey][mode][key] = value;
    return true;
  }

  function getDeckSessionSettings(
    mode,
    subject = getNavigationContextSubject(),
  ) {
    const deckKey = String(subject || "").trim();
    const decks = state.prefs.deckSessionSettings;
    const settings =
      decks && hasOwn(decks, deckKey)
        ? decks[deckKey]?.[mode]
        : null;
    if (!SESSION_SETTING_KEYS[mode] || !settings) return {};
    return Object.fromEntries(
      Object.entries(settings).filter(([key]) =>
        SESSION_SETTING_KEYS[mode].has(key),
      ),
    );
  }

  function getQuizNavigationPosition(subject = getNavigationContextSubject()) {
    const deckKey = String(subject || "").trim();
    const override = deckKey
      ? getDeckNavigationOverride(deckKey, "quiz")
      : null;
    if (override) {
      return ["top", "bottom"].includes(override) ? override : "top";
    }
    if (state.prefs.quizNavigationPosition !== "auto") {
      return state.prefs.quizNavigationPosition;
    }
    const breakpoint = globalScope.MRH_CONFIG?.quizNavigationBreakpoint ?? 768;
    return window.innerWidth <= breakpoint ? "top" : "bottom";
  }

  function getDeckNavigationOverride(subject, type) {
    const deckKey = String(subject || "").trim();
    if (!deckKey) return null;
    const overrides = state.prefs.deckNavigationOverrides || {};
    if (!hasOwn(overrides, deckKey)) return null;
    const deckOverrides = overrides[deckKey];
    if (!deckOverrides || !hasOwn(deckOverrides, type) || !deckOverrides[type])
      return null;
    return deckOverrides[type];
  }

  function setDeckNavigationOverride(subject, type, value) {
    const deckKey = String(subject || "").trim();
    if (!deckKey) return false;
    let overrides = state.prefs.deckNavigationOverrides;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      overrides = Object.create(null);
    } else if (Object.getPrototypeOf(overrides) !== null) {
      overrides = Object.assign(Object.create(null), overrides);
    }
    state.prefs.deckNavigationOverrides = overrides;
    if (
      !hasOwn(overrides, deckKey) ||
      !overrides[deckKey] ||
      typeof overrides[deckKey] !== "object" ||
      Array.isArray(overrides[deckKey])
    ) {
      overrides[deckKey] = Object.create(null);
    } else if (Object.getPrototypeOf(overrides[deckKey]) !== null) {
      overrides[deckKey] = Object.assign(
        Object.create(null),
        overrides[deckKey],
      );
    }
    overrides[deckKey][type] = value;
    saveState();
    return true;
  }

  function getStudyNavigationPosition(
    layoutType,
    subject = getNavigationContextSubject(),
  ) {
    const effectiveLayout =
      layoutType ||
      getDeckSessionSetting("study", "studyLayout", subject) ||
      "scroll";
    const normalizedLayout =
      effectiveLayout === "single" ? "single" : "scroll";
    const overrideKey =
      normalizedLayout === "single" ? "studySingle" : "studyScroll";
    const overrideValue = getDeckNavigationOverride(subject, overrideKey);
    if (overrideValue) {
      if (normalizedLayout === "single") {
        return ["top", "bottom"].includes(overrideValue)
          ? overrideValue
          : "top";
      }
      return ["top", "bottom", "both"].includes(overrideValue)
        ? overrideValue
        : "both";
    }

    const value =
      normalizedLayout === "single"
        ? state.prefs.studySingleNavigationPosition
        : state.prefs.studyScrollNavigationPosition;

    if (normalizedLayout === "single") {
      return ["top", "bottom"].includes(value) ? value : "top";
    }

    if (!["top", "bottom", "both"].includes(value)) return "both";
    return value;
  }

  function setStudyNavigationPosition(
    layoutType,
    position,
    subject = getNavigationContextSubject(),
  ) {
    const normalized =
      position === "bottom" ? "bottom" : position === "both" ? "both" : "top";
    const effectiveLayout = layoutType === "single" ? "single" : "scroll";

    if (!String(subject || "").trim()) return false;

    if (effectiveLayout === "single") {
      const nextValue = normalized === "both" ? "top" : normalized;
      return setDeckNavigationOverride(subject, "studySingle", nextValue);
    } else {
      return setDeckNavigationOverride(subject, "studyScroll", normalized);
    }
  }

  function getScrollNavigationButtonLabel(position) {
    const normalized = ["top", "bottom", "both"].includes(position)
      ? position
      : "top";
    if (normalized === "both") return "TOP + BOTTOM";
    if (normalized === "bottom") return "on Bottom";
    return "on TOP";
  }

  function syncNavigationButtonLabels() {
    const label = globalScope.getScrollNavigationButtonLabel;
    const getQuizPosition = globalScope.getQuizNavigationPosition;
    const getStudyPosition = globalScope.getStudyNavigationPosition;
    if (
      typeof label !== "function" ||
      typeof getQuizPosition !== "function" ||
      typeof getStudyPosition !== "function"
    ) {
      return;
    }

    const studyLayout =
      getDeckSessionSetting("study", "studyLayout") ||
      state.prefs.studyLayout ||
      "scroll";
    const positions = {
      "toggle-main-navigation-quiz": getQuizPosition(),
      "toggle-main-navigation-single": getStudyPosition("single"),
      "main-navigation-scroll-button": getStudyPosition("scroll"),
      "toggle-session-navigation-bottom": getQuizPosition(),
      "toggle-review-navigation-bottom": getStudyPosition(studyLayout),
    };

    Object.entries(positions).forEach(([id, position]) => {
      const button = document.getElementById(id);
      if (button) button.textContent = label(position);
    });
  }

  function cycleNavigationModeButton(mode, button) {
    const layoutType =
      mode === "study"
        ? (getDeckSessionSetting("study", "studyLayout") ||
            state.prefs.studyLayout) === "single"
          ? "single"
          : "scroll"
        : mode;
    const orderByMode = {
      quiz: ["top", "bottom"],
      single: ["top", "bottom"],
      scroll: ["top", "both", "bottom"],
    };
    const order = orderByMode[layoutType] || ["top", "bottom"];
    const subject = getNavigationContextSubject() || null;
    let current = "top";

    if (layoutType === "quiz") {
      current = getQuizNavigationPosition(subject) || "top";
    } else if (layoutType === "single") {
      current = getStudyNavigationPosition("single", subject) || "top";
    } else {
      current = getStudyNavigationPosition("scroll", subject) || "top";
    }

    const next = order[(order.indexOf(current) + 1) % order.length];
    if (layoutType === "quiz") {
      if (!subject || !setDeckNavigationOverride(subject, "quiz", next)) {
        notifyNavigationSettingUnavailable();
        return false;
      }
    } else if (layoutType === "single") {
      if (!setStudyNavigationPosition("single", next, subject)) {
        notifyNavigationSettingUnavailable();
        return false;
      }
    } else {
      if (!setStudyNavigationPosition("scroll", next, subject)) {
        notifyNavigationSettingUnavailable();
        return false;
      }
    }

    saveState();
    applyNavigationPosition();
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      globalScope.reRenderDeckReview?.();
    }
    syncNavigationButtonLabels();
    if (button) button.textContent = getScrollNavigationButtonLabel(next);
    return true;
  }

  function cycleScrollNavigationPosition() {
    cycleNavigationModeButton(
      "scroll",
      document.getElementById("main-navigation-scroll-button"),
    );
  }

  function applyNavigationPosition() {
    const navigation = document.getElementById("quiz-navigation");
    const topAnchor = document.getElementById("quiz-navigation-top");
    const bottomAnchor = document.getElementById("quiz-navigation-bottom");
    if (!navigation || !topAnchor || !bottomAnchor) return;

    const savedPosition = state.session.active
      ? getQuizNavigationPosition()
      : getStudyNavigationPosition();
    const position = ["top", "bottom", "both"].includes(savedPosition)
      ? savedPosition
      : "top";

    if (navigation.parentElement)
      navigation.parentElement.removeChild(navigation);
    const existingBottomClone = bottomAnchor.querySelector(
      ".quiz-navigation-clone",
    );
    if (existingBottomClone) existingBottomClone.remove();

    if (position === "both") {
      topAnchor.appendChild(navigation);
      const bottomClone = navigation.cloneNode(true);
      bottomClone.id = "quiz-navigation-bottom-clone";
      bottomClone.classList.add("quiz-navigation-clone");
      bottomAnchor.appendChild(bottomClone);
      topAnchor.classList.remove("hidden");
      bottomAnchor.classList.remove("hidden");
      return;
    }

    (position === "top" ? topAnchor : bottomAnchor).appendChild(navigation);
    topAnchor.classList.toggle("hidden", position !== "top");
    bottomAnchor.classList.toggle("hidden", position !== "bottom");
  }

  function notifyNavigationSettingUnavailable() {
    if (typeof globalScope.showToast === "function") {
      globalScope.showToast(
        "Open a deck session before changing navigation position.",
        "warning",
      );
      return;
    }
    throw new Error(
      "Unable to save navigation position without an active deck.",
    );
  }

  function changeNavigationPosition(position) {
    const normalized = position === "top" ? "top" : "bottom";
    const isStudyActive = document
      .getElementById("view-deck-review")
      ?.classList.contains("active");
    const subject = getNavigationContextSubject();
    if (!subject) {
      notifyNavigationSettingUnavailable();
      return false;
    }
    if (isStudyActive) {
      const layoutType =
        (getDeckSessionSetting("study", "studyLayout", subject) ||
          state.prefs.studyLayout) === "single"
          ? "single"
          : "scroll";
      if (!setStudyNavigationPosition(layoutType, normalized, subject)) {
        notifyNavigationSettingUnavailable();
        return false;
      }
    } else if (!setDeckNavigationOverride(subject, "quiz", normalized)) {
      notifyNavigationSettingUnavailable();
      return false;
    }
    saveState();
    applyNavigationPosition();
    syncNavigationButtonLabels();
    const select = document.getElementById("navigation-position-select");
    if (select) select.value = normalized;
    return true;
  }

  function toggleMainNavigationPosition(mode, source) {
    const normalized = source.checked ? "bottom" : "top";
    const subject = getNavigationContextSubject();
    if (!subject) {
      notifyNavigationSettingUnavailable();
      return false;
    }
    if (mode === "quiz") {
      if (!setDeckNavigationOverride(subject, "quiz", normalized)) {
        notifyNavigationSettingUnavailable();
        return false;
      }
    } else if (!setStudyNavigationPosition(mode, normalized, subject)) {
      notifyNavigationSettingUnavailable();
      return false;
    }
    saveState();
    applyNavigationPosition();
    syncNavigationButtonLabels();
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      globalScope.reRenderDeckReview?.();
    }
    return true;
  }

  function toggleNavigationPosition(source) {
    changeNavigationPosition(source.checked ? "bottom" : "top");
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      globalScope.reRenderDeckReview?.();
    }
  }

  function toggleLayout() {
    const layoutModes = ["grid", "list", "tree"];
    const currentIndex = layoutModes.indexOf(state.prefs.layoutMode);
    state.prefs.layoutMode =
      layoutModes[(currentIndex + 1) % layoutModes.length];
    saveState();
    renderCategoryProgress();
  }

  function changeDeckNameMode(mode) {
    const normalizedMode = ["clip", "wrap"].includes(mode) ? mode : "wrap";
    state.prefs.deckNameMode = normalizedMode;
    state.prefs.titleMode = normalizedMode;
    saveState();
    applyTitleMode();
    renderCategoryProgress();
  }

  function changeDeckSort(sortOrder) {
    state.prefs.deckSortBy = ["letters", "questions"].includes(sortOrder)
      ? sortOrder
      : "letters";

    const menu = document.getElementById("deck-sort-menu");
    if (menu) {
      if (typeof globalScope.closeDropdownMenu === "function") {
        globalScope.closeDropdownMenu(menu);
      } else {
        menu.open = false;
      }
    }

    saveState();
    renderCategoryProgress();
  }

  function changeDeckSource(sourceValue) {
    const validSources = [
      "all",
      "favorites",
      "downloaded",
      "cloud",
      "archived",
    ];
    state.prefs.deckSourceFilter = validSources.includes(sourceValue)
      ? sourceValue
      : "all";

    const sourceLabels = {
      all: "All",
      favorites: "Favorites",
      downloaded: "Downloaded",
      cloud: "Cloud Only",
      archived: "Archived",
    };

    const label = document.getElementById("deck-source-label");
    if (label) label.innerText = sourceLabels[state.prefs.deckSourceFilter];

    document.querySelectorAll(".deck-source-option").forEach((btn) => {
      const check = btn.querySelector(".source-check");
      const isSelected =
        btn.dataset.sourceValue === state.prefs.deckSourceFilter;
      if (check) check.style.opacity = isSelected ? "1" : "0";
    });

    const menu = document.getElementById("deck-source-menu");
    if (menu) {
      if (typeof globalScope.closeDropdownMenu === "function") {
        globalScope.closeDropdownMenu(menu);
      } else {
        menu.open = false;
      }
    }

    const select = document.getElementById("deck-source-filter");
    if (select) select.value = state.prefs.deckSourceFilter;

    saveState();
    renderCategoryProgress();
  }

  function toggleDeckSortDirection() {
    setDeckSortDirection(
      state.prefs.deckSortDirection === "desc" ? "asc" : "desc",
    );
  }

  function setDeckSortDirection(direction) {
    state.prefs.deckSortDirection = direction === "desc" ? "desc" : "asc";
    saveState();
    renderCategoryProgress();
  }

  function setTitleMode(mode) {
    if (!["clip", "wrap"].includes(mode)) return;

    const normalizedMode = mode === "clip" ? "clip" : "wrap";
    state.prefs.deckNameMode = normalizedMode;
    state.prefs.titleMode = normalizedMode;
    saveState();
    applyTitleMode();
    updateTitleModeButton();
  }

  function applyTitleMode() {
    const mode = state.prefs.titleMode || "wrap";
    const body = document.body;

    if (body) {
      body.classList.toggle("title-mode-wrap", mode === "wrap");
      body.classList.toggle("title-mode-clip", mode === "clip");
    }

    document
      .querySelectorAll(
        ".dashboard-header-row, .quiz-header-row, .review-header-row, .app-content-shell, main, .view-section, #view-dashboard, #view-practice, #view-deck-review",
      )
      .forEach((element) => {
        element.classList.add("min-w-0", "max-w-full");
        if (mode === "wrap") {
          element.classList.add("flex-wrap");
          element.style.maxWidth = "100%";
          element.style.minWidth = "0";
        } else {
          element.classList.remove("flex-wrap");
          element.style.maxWidth = "100%";
          element.style.minWidth = "0";
        }
      });

    const dashboardHeading = document.querySelector(".dashboard-header-row h2");
    const quizSubject = document.getElementById("q-subject");
    const reviewTitle = document.getElementById("deck-review-title");

    [dashboardHeading, quizSubject, reviewTitle].forEach((element) => {
      if (!element) return;

      const parent = element.parentElement;
      const elementMode = element === dashboardHeading ? "clip" : mode;

      if (elementMode === "clip") {
        element.classList.add("truncate", "overflow-hidden");
        element.classList.remove("whitespace-normal", "break-words");
        element.style.whiteSpace = "nowrap";
        element.style.overflow = "hidden";
        element.style.textOverflow = "ellipsis";
        element.style.overflowWrap = "normal";
        element.style.wordBreak = "normal";

        if (parent) {
          parent.classList.add("min-w-0", "overflow-hidden");
          parent.classList.remove("flex-wrap");
        }
      } else if (mode === "wrap") {
        element.classList.remove("truncate", "overflow-hidden");
        element.classList.add("whitespace-normal", "break-words");
        element.style.whiteSpace = "normal";
        element.style.overflow = "hidden";
        element.style.textOverflow = "clip";
        element.style.overflowWrap = "anywhere";
        element.style.wordBreak = "break-word";

        if (parent) {
          parent.classList.add("min-w-0");
          parent.classList.add("overflow-hidden");
          parent.classList.remove("flex-wrap");
        }
      }
    });
  }

  function toggleTitleMode() {
    const currentMode = state.prefs.titleMode || "wrap";
    const newMode = currentMode === "wrap" ? "clip" : "wrap";
    setTitleMode(newMode);
    updateTitleModeButton();
  }

  function updateTitleModeButton() {
    const mode = state.prefs.titleMode || "wrap";
    const button = document.getElementById("title-mode-toggle-btn");
    if (button) {
      button.textContent = mode === "clip" ? "Clip" : "Wrap";
    }
  }

  function applyTextAlignment(alignment = state.prefs.textAlignment) {
    const validAlignment = ["left", "center", "right", "justify"].includes(
      alignment,
    )
      ? alignment
      : "left";
    const body = document.body;
    if (!body) return;

    body.classList.remove(
      "text-align-left",
      "text-align-center",
      "text-align-right",
      "text-align-justify",
    );
    body.classList.add(`text-align-${validAlignment}`);
  }

  function setTextAlignment(alignment) {
    if (!["left", "center", "right", "justify"].includes(alignment)) {
      return false;
    }

    state.prefs.textAlignment = alignment;
    applyTextAlignment(alignment);
    const select = document.getElementById("text-alignment-select");
    if (select) select.value = alignment;
    saveState();
    return true;
  }

  const PreferencesCore = {
    syncPreferenceControls,
    toggleLayout,
    changeDeckNameMode,
    changeDeckSort,
    changeDeckSource,
    toggleDeckSortDirection,
    setDeckSortDirection,
    setTitleMode,
    applyTitleMode,
    toggleTitleMode,
    updateTitleModeButton,
    applyTextAlignment,
    setTextAlignment,
    getNavigationContextSubject,
    getDeckSessionSetting,
    setDeckSessionSetting,
    getDeckSessionSettings,
    getQuizNavigationPosition,
    getDeckNavigationOverride,
    setDeckNavigationOverride,
    getStudyNavigationPosition,
    setStudyNavigationPosition,
    getScrollNavigationButtonLabel,
    syncNavigationButtonLabels,
    cycleNavigationModeButton,
    cycleScrollNavigationPosition,
    applyNavigationPosition,
    changeNavigationPosition,
    toggleMainNavigationPosition,
    toggleNavigationPosition,
  };

  globalScope.PreferencesCore = PreferencesCore;
  Object.assign(globalScope, PreferencesCore);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PreferencesCore;
  }
})(
  typeof globalScope !== "undefined"
    ? globalScope
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
