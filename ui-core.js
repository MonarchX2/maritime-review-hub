(function (globalScope) {
  function populateFilters() {
    const select = document.getElementById("filter-subject");
    const subjectIndex = globalScope.ensureQuestionIndex();
    const subjects = [...subjectIndex.bySubject.keys()];

    let tags = new Set();
    (globalScope.state.db || []).forEach((q) => {
      if (q && q.Tags) {
        q.Tags.split(",")
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

  async function navigate(viewId) {
    if (viewId === "settings") {
      globalScope.settingsClickCount++;
      clearTimeout(globalScope.settingsClickTimeout);
      if (globalScope.settingsClickCount >= 5) {
        const adminBtn = document.getElementById("btn-admin-nav");
        adminBtn.classList.remove("hidden");
        adminBtn.classList.add("animate-card-in");
        globalScope.settingsClickCount = 0;
      } else {
        globalScope.settingsClickTimeout = setTimeout(() => {
          globalScope.settingsClickCount = 0;
        }, 2000);
      }
    }

    if (
      globalScope.state.session.active &&
      viewId !== "practice" &&
      !(await globalScope.requestConfirmation(
        "You have an active session. Do you want to pause and return? Your progress will be saved.",
        "Pause Session",
      ))
    )
      return;

    if (globalScope.state.session.active && viewId !== "practice") {
      globalScope.saveSessionProgress();
      globalScope.state.session.active = false;
      globalScope.saveState();
    }

    globalScope.updateDashboard();

    document
      .querySelectorAll(".view-section")
      .forEach((el) => el.classList.remove("active"));
    document.getElementById(`view-${viewId}`).classList.add("active");

    if (viewId === "stats") globalScope.renderCharts();

    if (viewId === "admin") {
      await globalScope.ensureAdminLoaded();
      const activeAdminToken =
        typeof globalScope.getAdminToken === "function"
          ? globalScope.getAdminToken()
          : "";
      if (
        activeAdminToken &&
        typeof globalScope.loadAdminSubjects === "function"
      ) {
        globalScope.loadAdminSubjects();
      }
    }
  }

  function syncPreferenceControls() {
    const values = {
      "toggle-active-recall": globalScope.state.prefs.activeRecall === true,
      "toggle-shuffle-choices":
        globalScope.state.prefs.shuffleChoices !== false,
      "toggle-modal-shuffle-choices":
        globalScope.state.prefs.shuffleChoices !== false,
      "toggle-shuffle-questions":
        globalScope.state.prefs.shuffleQuestions !== false,
      "toggle-hide-abcd": globalScope.state.prefs.hideABCD === true,
      "toggle-quiz-hide-abcd": globalScope.state.prefs.quizHideABCD === true,
      "toggle-cloze-mode": globalScope.state.prefs.clozeEnabled !== false,
      "toggle-main-cloze-mode": globalScope.state.prefs.clozeEnabled !== false,
      "toggle-srs-mode": globalScope.state.prefs.srsEnabled === true,
      "toggle-main-srs-mode": globalScope.state.prefs.srsEnabled === true,
      "toggle-wrong-choices":
        globalScope.state.prefs.showWrongChoices !== false,
      globalModeToggle: globalScope.state.prefs.lastActivity?.mode === "review",
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
      [
        "toggle-main-navigation-quiz",
        globalScope.state.prefs.quizNavigationPosition || "top",
      ],
      [
        "toggle-main-navigation-single",
        globalScope.state.prefs.studySingleNavigationPosition || "top",
      ],
      [
        "toggle-main-navigation-scroll",
        globalScope.state.prefs.studyScrollNavigationPosition || "top",
      ],
      [
        "toggle-session-navigation-bottom",
        globalScope.state.prefs.quizNavigationPosition || "top",
      ],
      [
        "toggle-review-navigation-bottom",
        globalScope.getStudyNavigationPosition(
          globalScope.state.prefs.studyLayout || "scroll",
        ),
      ],
    ].forEach(([id, value]) => {
      const button = document.getElementById(id);
      if (button) button.textContent = buttonLabel(value);
    });

    const databaseUpdateMode = document.getElementById("database-update-mode");
    if (databaseUpdateMode)
      databaseUpdateMode.value =
        globalScope.state.prefs.databaseUpdateMode || "idle";

    const deckNameMode = document.getElementById("deck-name-mode");
    if (deckNameMode) {
      deckNameMode.value = ["wrap", "clip"].includes(
        globalScope.state.prefs.deckNameMode,
      )
        ? globalScope.state.prefs.deckNameMode
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
      ? globalScope.state.prefs.reviewNavigationPosition
      : globalScope.getQuizNavigationPosition();
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
    const sortBy = globalScope.state.prefs.deckSortBy || "letters";
    const sortDirection =
      globalScope.state.prefs.deckSortDirection === "desc" ? "desc" : "asc";
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
