(function (globalScope) {
  function populateFilters() {
    const select = document.getElementById("filter-subject");
    if (!select || typeof globalScope.ensureQuestionIndex !== "function")
      return;
    const subjectIndex = globalScope.ensureQuestionIndex();
    const subjects = [...subjectIndex.bySubject.keys()];

    let tags = new Set();
    (globalScope.state.db || []).forEach((q) => {
      if (q && q.Tags != null) {
        String(q.Tags)
          .split(",")
          .map((t) => t.trim())
          .forEach((t) => tags.add(t));
      }
    });
    tags = [...tags];

    let html = '<option value="ALL">All Subjects (Randomized)</option>';
    if (subjects.length > 0) {
      html += '<optgroup label="Subjects">';
      html += subjects
        .map(
          (s) =>
            `<option value="SUBJ:${globalScope.escapeHTML(s)}">${globalScope.escapeHTML(s)}</option>`,
        )
        .join("");
      html += "</optgroup>";
    }
    if (tags.length > 0) {
      html += '<optgroup label="Tags">';
      html += tags
        .map(
          (t) =>
            `<option value="TAG:${globalScope.escapeHTML(t)}">${globalScope.escapeHTML(t)}</option>`,
        )
        .join("");
      html += "</optgroup>";
    }

    select.innerHTML = html;
  }

  async function updateDashboard() {
    const statTotal = document.getElementById("stat-total");
    if (statTotal) statTotal.innerText = globalScope.state.stats.totalAnswered;

    const statCorrect = document.getElementById("stat-correct");
    if (statCorrect) statCorrect.innerText = globalScope.state.stats.correct;

    const dbSize = document.getElementById("db-size-display");
    if (dbSize) dbSize.innerText = globalScope.state.db.length;

    if (typeof globalScope.checkSavedSession === "function")
      globalScope.checkSavedSession();
    if (typeof globalScope.renderCategoryProgress === "function")
      globalScope.renderCategoryProgress();
  }

  const navigate = async (...args) => {
    if (
      globalScope.DeckNavCore &&
      typeof globalScope.DeckNavCore.navigate === "function"
    ) {
      return globalScope.DeckNavCore.navigate(...args);
    }
    const [viewId] = args;
    const target = document.getElementById(`view-${viewId}`);
    if (!target) return false;
    document
      .querySelectorAll(".view-section")
      .forEach((el) => el.classList.remove("active"));
    target.classList.add("active");
    return true;
  };

  function syncPreferenceControls() {
    const prefs = globalScope.state?.prefs || {};
    const values = {
      "toggle-active-recall": prefs.activeRecall === true,
      "toggle-shuffle-choices": prefs.shuffleChoices !== false,
      "toggle-modal-shuffle-choices": prefs.shuffleChoices !== false,
      "toggle-shuffle-questions": prefs.shuffleQuestions !== false,
      "toggle-hide-abcd": prefs.hideABCD === true,
      "toggle-quiz-hide-abcd": prefs.quizHideABCD === true,
      "toggle-cloze-mode": prefs.clozeEnabled !== false,
      "toggle-main-cloze-mode": prefs.clozeEnabled !== false,
      "toggle-srs-mode": prefs.srsEnabled === true,
      "toggle-main-srs-mode": prefs.srsEnabled === true,
      "toggle-wrong-choices": prefs.showWrongChoices !== false,
      globalModeToggle: prefs.lastActivity?.mode === "review",
    };

    Object.entries(values).forEach(([id, checked]) => {
      const control = document.getElementById(id);
      if (control) control.checked = checked;
    });

    const buttonLabel = (value) => {
      if (value === "both") return "TOP + BOTTOM";
      if (value === "bottom") return "on Bottom";
      return "on TOP";
    };

    [
      ["toggle-main-navigation-quiz", prefs.quizNavigationPosition || "top"],
      [
        "toggle-main-navigation-single",
        prefs.studySingleNavigationPosition || "top",
      ],
      [
        "toggle-main-navigation-scroll",
        prefs.studyScrollNavigationPosition || "top",
      ],
      [
        "toggle-session-navigation-bottom",
        prefs.quizNavigationPosition || "top",
      ],
      [
        "toggle-review-navigation-bottom",
        typeof globalScope.getStudyNavigationPosition === "function"
          ? globalScope.getStudyNavigationPosition(
              prefs.studyLayout || "scroll",
            )
          : prefs.reviewNavigationPosition || "top",
      ],
    ].forEach(([id, value]) => {
      const button = document.getElementById(id);
      if (button) button.textContent = buttonLabel(value);
    });

    const databaseUpdateMode = document.getElementById("database-update-mode");
    if (databaseUpdateMode)
      databaseUpdateMode.value = prefs.databaseUpdateMode || "idle";

    const deckNameMode = document.getElementById("deck-name-mode");
    if (deckNameMode) {
      deckNameMode.value = ["wrap", "clip"].includes(prefs.deckNameMode)
        ? prefs.deckNameMode
        : "wrap";
    }

    const modeLabel = document.getElementById("modeLabel");
    if (modeLabel)
      modeLabel.innerText = values.globalModeToggle ? "Study" : "Quiz";
    const navigationSelect = document.getElementById(
      "navigation-position-select",
    );
    const activeNavigationPosition = document
      .getElementById("view-deck-review")
      ?.classList.contains("active")
      ? prefs.reviewNavigationPosition
      : typeof globalScope.getQuizNavigationPosition === "function"
        ? globalScope.getQuizNavigationPosition()
        : prefs.quizNavigationPosition || "top";
    if (navigationSelect) navigationSelect.value = activeNavigationPosition;
    [
      "toggle-main-navigation-quiz",
      "toggle-main-navigation-single",
      "toggle-main-navigation-scroll",
      "toggle-session-navigation-bottom",
      "toggle-review-navigation-bottom",
    ].forEach((id) => {
      const control = document.getElementById(id);
      if (control) control.checked = values[id] ?? false;
    });
    const sortBy = prefs.deckSortBy || "letters";
    const sortDirection = prefs.deckSortDirection === "desc" ? "desc" : "asc";
    const deckSortIcon = document.getElementById("deck-sort-icon");
    if (deckSortIcon) {
      deckSortIcon.className = `fa-solid fa-arrow-${sortDirection === "desc" ? "down" : "up"}`;
    }
    document
      .querySelectorAll(".deck-sort-option[data-sort-value]")
      .forEach((option) => {
        const check = option.querySelector(".sort-check");
        if (check) {
          check.style.opacity = option.dataset.sortValue === sortBy ? "1" : "0";
        }
      });
    document
      .querySelectorAll(".deck-sort-option[data-sort-direction]")
      .forEach((option) => {
        const check = option.querySelector(".sort-direction-check");
        if (check) {
          check.style.opacity =
            option.dataset.sortDirection === sortDirection ? "1" : "0";
        }
      });
  }

  const UiCore = {
    populateFilters,
    updateDashboard,
    navigate,
    syncPreferenceControls,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = UiCore;
  }

  globalScope.UiCore = UiCore;
})(typeof window !== "undefined" ? window : globalThis);
