(function (globalScope) {
  "use strict";

  const state = globalScope.state;

  function saveState() {
    return globalScope.saveState?.();
  }

  function renderCategoryProgress() {
    return globalScope.renderCategoryProgress?.();
  }

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
    const deckOverrides = overrides[deckKey];
    if (!deckOverrides || !deckOverrides[type]) return null;
    return deckOverrides[type];
  }

  function setDeckNavigationOverride(subject, type, value) {
    const deckKey = String(subject || "").trim();
    if (!deckKey) return;
    state.prefs.deckNavigationOverrides =
      state.prefs.deckNavigationOverrides || {};
    state.prefs.deckNavigationOverrides[deckKey] =
      state.prefs.deckNavigationOverrides[deckKey] || {};
    state.prefs.deckNavigationOverrides[deckKey][type] = value;
    saveState();
  }

  function getStudyNavigationPosition(
    layoutType = state.prefs.studyLayout || "scroll",
    subject = getNavigationContextSubject(),
  ) {
    const normalizedLayout = layoutType === "single" ? "single" : "scroll";
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

    if (effectiveLayout === "single") {
      const nextValue = normalized === "both" ? "top" : normalized;
      if (subject) {
        setDeckNavigationOverride(subject, "studySingle", nextValue);
      } else {
        state.prefs.studySingleNavigationPosition = nextValue;
      }
    } else if (subject) {
      setDeckNavigationOverride(subject, "studyScroll", normalized);
    } else {
      state.prefs.studyScrollNavigationPosition = normalized;
    }

    state.prefs.reviewNavigationPosition =
      effectiveLayout === "single"
        ? subject
          ? getStudyNavigationPosition("single", subject)
          : state.prefs.studySingleNavigationPosition
        : subject
          ? getStudyNavigationPosition("scroll", subject)
          : state.prefs.studyScrollNavigationPosition;
  }

  function getScrollNavigationButtonLabel(position) {
    const normalized = ["top", "bottom", "both"].includes(position)
      ? position
      : "top";
    if (normalized === "both") return "TOP + BOTTOM";
    if (normalized === "bottom") return "on Bottom";
    return "on TOP";
  }

  function cycleNavigationModeButton(mode, button) {
    const layoutType =
      mode === "study"
        ? state.prefs.studyLayout === "single"
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
      if (subject) {
        setDeckNavigationOverride(subject, "quiz", next);
      } else {
        state.prefs.quizNavigationPosition = next;
        state.prefs.quizNavigationMode = "manual";
      }
    } else if (layoutType === "single") {
      setStudyNavigationPosition("single", next, subject);
    } else {
      setStudyNavigationPosition("scroll", next, subject);
    }

    saveState();
    applyNavigationPosition();
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      globalScope.reRenderDeckReview?.();
    }
    if (button) button.textContent = getScrollNavigationButtonLabel(next);
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
      : getStudyNavigationPosition(state.prefs.studyLayout || "scroll");
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

  function changeNavigationPosition(position) {
    const normalized = position === "top" ? "top" : "bottom";
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      const layoutType =
        state.prefs.studyLayout === "single" ? "single" : "scroll";
      setStudyNavigationPosition(layoutType, normalized);
    } else {
      state.prefs.quizNavigationPosition = normalized;
      state.prefs.quizNavigationMode = "manual";
    }
    saveState();
    applyNavigationPosition();
    const select = document.getElementById("navigation-position-select");
    if (select) select.value = normalized;
  }

  function toggleMainNavigationPosition(mode, source) {
    const normalized = source.checked ? "bottom" : "top";
    if (mode === "quiz") {
      state.prefs.quizNavigationPosition = normalized;
      state.prefs.quizNavigationMode = "manual";
    } else {
      setStudyNavigationPosition(mode, normalized);
    }
    saveState();
    applyNavigationPosition();
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      globalScope.reRenderDeckReview?.();
    }
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
    state.prefs.layoutMode =
      state.prefs.layoutMode === "grid" ? "list" : "grid";
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
    if (menu) menu.open = false;

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
      all: "All Decks",
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
    if (menu) menu.open = false;

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

      if (mode === "clip") {
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
    getNavigationContextSubject,
    getQuizNavigationPosition,
    getDeckNavigationOverride,
    setDeckNavigationOverride,
    getStudyNavigationPosition,
    setStudyNavigationPosition,
    getScrollNavigationButtonLabel,
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
