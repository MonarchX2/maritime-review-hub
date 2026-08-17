// ============================================================================
// UI Modal Core - Modal handlers, dropdown menus, and feature UI management
// Extracted from app-core.js - Phase 4
// ============================================================================

(function (globalScope) {
  // Import global utilities
  const { getStoredItem, setStoredItem, callBackend } = globalScope;

  // ===================== CORE MODAL CONTROL =====================
  function toggleModal(modalId, isVisible) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const inner = modal.querySelector("div");

    if (isVisible) {
      modal.classList.remove("hidden");
      setTimeout(() => {
        modal.classList.remove("opacity-0");
        if (inner) inner.classList.remove("scale-95", "opacity-0");
      }, 10);
    } else {
      modal.classList.add("opacity-0");
      if (inner) inner.classList.add("scale-95");
      setTimeout(() => {
        modal.classList.add("hidden");
      }, 300);
    }
  }

  // ===================== ABOUT MODAL =====================
  function openAboutModal() {
    toggleModal("about-modal", true);
  }

  function closeAboutModal() {
    toggleModal("about-modal", false);
  }

  // ===================== CONFIRM MODAL =====================
  let confirmResolver = null;

  function requestConfirmation(message, title = "Confirm Action") {
    return new Promise((resolve) => {
      confirmResolver = resolve;
      const modal = document.getElementById("confirm-modal");
      if (!modal) {
        resolve(window.confirm(message));
        return;
      }
      if (modal.parentElement !== document.body) document.body.appendChild(modal);
      document.getElementById("confirm-title").innerHTML =
        `<i class="fa-solid fa-circle-question text-brand-500 mr-2"></i>${globalScope.escapeHTML(title)}`;
      document.getElementById("confirm-message").innerText = message;
      toggleModal("confirm-modal", true);
    });
  }

  function closeConfirmModal(confirmed) {
    toggleModal("confirm-modal", false);
    if (confirmResolver) {
      const resolve = confirmResolver;
      confirmResolver = null;
      setTimeout(() => resolve(confirmed), 320);
    }
  }

  // ===================== REPORT MODAL =====================
  function openReportModal() {
    const state = globalScope.state;
    const q = state.session?.questions?.[state.session?.currentIndex];
    if (!q) return;

    let reportedQs = [];
    try {
      reportedQs = JSON.parse(getStoredItem("reported_qs", "[]"));
    } catch (e) {
      console.warn("Reported QS array corrupted. Resetting.", e);
      setStoredItem("reported_qs", "[]");
    }

    if (reportedQs.includes(q.ID)) {
      alert(
        "You have already reported this question. Thank you for your feedback!",
      );
      return;
    }

    state.reportQuestion = q;

    const reportType = document.getElementById("report-type");
    const reportLesson = document.getElementById("report-lesson");
    const reportComments = document.getElementById("report-comments");
    if (reportType) reportType.value = "";
    if (reportLesson) reportLesson.value = "";
    if (reportComments) reportComments.value = "";

    toggleModal("report-modal", true);
  }

  function closeReportModal() {
    const state = globalScope.state;
    state.reportQuestion = null;
    toggleModal("report-modal", false);
  }

  function openReportModalFromStudy(questionId) {
    const state = globalScope.state;
    questionId = globalScope.decodeHandlerValue(questionId);
    const q = (state.db || []).find((item) => item.ID === questionId);
    if (!q) return;

    let reportedQs = [];
    try {
      reportedQs = JSON.parse(getStoredItem("reported_qs", "[]"));
    } catch (e) {
      console.warn("Reported QS array corrupted. Resetting.", e);
      setStoredItem("reported_qs", "[]");
    }

    if (reportedQs.includes(q.ID)) {
      alert(
        "You have already reported this question. Thank you for your feedback!",
      );
      return;
    }

    state.reportQuestion = q;

    const reportType = document.getElementById("report-type");
    const reportComments = document.getElementById("report-comments");
    if (reportType) reportType.value = "";
    if (reportComments) reportComments.value = "";

    toggleModal("report-modal", true);
  }

  async function submitReport() {
    const state = globalScope.state;
    const typeEl = document.getElementById("report-type");
    const lesson = document.getElementById("report-lesson").value.trim();
    const comments = document.getElementById("report-comments").value.trim();

    if (!typeEl.value) {
      alert("Please select an Error Type.");
      return;
    }

    const btn = document.getElementById("btn-submit-report");
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Sending...';
    btn.disabled = true;

    const q =
      state.reportQuestion || state.session.questions[state.session.currentIndex];

    if (!q) {
      alert("Error: No question found to report.");
      btn.innerHTML = originalText;
      btn.disabled = false;
      return;
    }

    if (globalScope.isDeckPasswordProtected(q.Subject)) {
      alert("Reporting is disabled for password-protected decks.");
      btn.innerHTML = originalText;
      btn.disabled = false;
      return;
    }

    try {
      const result = await callBackend({
        type: "submit_report",
        questionId: q.ID,
        subject: q.Subject,
        questionText: q.Question,
        errorType: typeEl.value,
        lesson: lesson,
        comments: comments,
        choices: { A: q.ChoiceA, B: q.ChoiceB, C: q.ChoiceC, D: q.ChoiceD },
        correctAnswer: q.Answer,
      });

      if (result.status === "success") {
        const reportedQs = JSON.parse(getStoredItem("reported_qs", "[]"));
        reportedQs.push(q.ID);
        setStoredItem("reported_qs", JSON.stringify(reportedQs));

        btn.innerHTML =
          '<i class="fa-solid fa-check mr-2"></i> Report Submitted!';
        btn.classList.remove("bg-red-500", "hover:bg-red-600");
        btn.classList.add("bg-green-500", "hover:bg-green-600");

        setTimeout(() => {
          closeReportModal();
          setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.classList.remove("bg-green-500", "hover:bg-green-600");
            btn.classList.add("bg-red-500", "hover:bg-red-600");
          }, 500);

          if (!state.reportQuestion) {
            if (state.session.userAnswers[state.session.currentIndex]) {
              globalScope.nextQuestion();
            } else {
              globalScope.revealAnswer();
            }
          }

          state.reportQuestion = null;
        }, 1500);
      }
    } catch (err) {
      console.error(err);
      alert("Network error. Please try again.");
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  // ===================== SESSION SETTINGS MODAL =====================
  function openSessionSettingsModal() {
    const state = globalScope.state;
    const recallToggle = document.getElementById("toggle-active-recall");
    if (recallToggle) recallToggle.checked = state.prefs.activeRecall === true;

    const choicesToggle = document.getElementById("toggle-shuffle-choices");
    if (choicesToggle)
      choicesToggle.checked = state.prefs.shuffleChoices !== false;
    const modalChoicesToggle = document.getElementById(
      "toggle-modal-shuffle-choices",
    );
    if (modalChoicesToggle)
      modalChoicesToggle.checked = state.prefs.shuffleChoices !== false;

    const questionsToggle = document.getElementById("toggle-shuffle-questions");
    if (questionsToggle)
      questionsToggle.checked = state.prefs.shuffleQuestions !== false;

    const quizHideToggle = document.getElementById("toggle-quiz-hide-abcd");
    if (quizHideToggle)
      quizHideToggle.checked = state.prefs.quizHideABCD === true;

    const clozeToggle = document.getElementById("toggle-cloze-mode");
    if (clozeToggle) clozeToggle.checked = state.prefs.clozeEnabled !== false;

    const srsToggle = document.getElementById("toggle-srs-mode");
    if (srsToggle) srsToggle.checked = state.prefs.srsEnabled === true;

    const qTypeSelect = document.getElementById("toggle-question-type");
    if (qTypeSelect) qTypeSelect.value = state.prefs.qTypeOverride || "auto";

    const navigationSelect = document.getElementById(
      "navigation-position-select",
    );
    if (navigationSelect) navigationSelect.value = globalScope.getQuizNavigationPosition();
    const navigationButton = document.getElementById(
      "toggle-session-navigation-bottom",
    );
    if (navigationButton) {
      navigationButton.textContent = globalScope.getScrollNavigationButtonLabel(
        state.prefs.quizNavigationPosition || "top",
      );
    }

    toggleModal("session-settings-modal", true);
  }

  function closeSessionSettingsModal() {
    toggleModal("session-settings-modal", false);
  }

  // ===================== REVIEW SETTINGS MODAL =====================
  function openReviewSettingsModal() {
    const modal = document.getElementById("review-settings-modal");
    const navigationButton = document.getElementById(
      "toggle-review-navigation-bottom",
    );
    if (navigationButton) {
      navigationButton.textContent = globalScope.getScrollNavigationButtonLabel(
        globalScope.getStudyNavigationPosition(globalScope.state.prefs.studyLayout || "scroll"),
      );
    }
    updateStudyFilterToggle();
    modal.classList.remove("hidden");
    // Small delay allows the browser to render 'block' before applying opacity for the transition
    setTimeout(() => {
      modal.classList.remove("opacity-0");
      modal.querySelector("div").classList.remove("scale-95");
    }, 10);
  }

  function closeReviewSettingsModal() {
    const modal = document.getElementById("review-settings-modal");
    modal.classList.add("opacity-0");
    modal.querySelector("div").classList.add("scale-95");
    // Wait for transition to finish before hiding element
    setTimeout(() => {
      modal.classList.add("hidden");
    }, 300);
  }

  function handleReviewLayoutChange(layoutType) {
    const perPageContainer = document.getElementById("review-per-page-container");
    const navigationToggle = document.getElementById(
      "toggle-review-navigation-bottom",
    );

    if (layoutType === "single") {
      perPageContainer.classList.add("hidden");
    } else {
      perPageContainer.classList.remove("hidden");
    }

    if (navigationToggle) {
      navigationToggle.textContent = globalScope.getScrollNavigationButtonLabel(
        globalScope.getStudyNavigationPosition(layoutType),
      );
    }

    globalScope.changeStudyLayout(layoutType);
  }

  // ===================== STUDY FILTER MANAGEMENT =====================
  function updateStudyFilterToggle() {
    const toggle = document.getElementById("study-filter-toggle");
    const icon = document.getElementById("study-filter-icon");
    if (!toggle || !icon) return;

    const isFavorites = (globalScope.state.prefs.studyFilterMode || "all") === "favorites";
    toggle.setAttribute("aria-pressed", String(isFavorites));
    toggle.setAttribute(
      "aria-label",
      isFavorites ? "Favorites mode enabled" : "All items mode enabled",
    );
    toggle.title = isFavorites ? "Favorites only" : "All items";
    icon.className = isFavorites ? "fa-solid fa-star" : "fa-solid fa-list";

    toggle.classList.toggle("bg-yellow-100", isFavorites);
    toggle.classList.toggle("text-yellow-600", isFavorites);
    toggle.classList.toggle("dark:bg-yellow-900/30", isFavorites);
    toggle.classList.toggle("dark:text-yellow-300", isFavorites);

    toggle.classList.toggle("bg-gray-200", !isFavorites);
    toggle.classList.toggle("text-gray-700", !isFavorites);
    toggle.classList.toggle("dark:bg-gray-700", !isFavorites);
    toggle.classList.toggle("dark:text-gray-200", !isFavorites);
  }

  function toggleStudyFilterMode() {
    const nextMode =
      (globalScope.state.prefs.studyFilterMode || "all") === "favorites"
        ? "all"
        : "favorites";
    changeStudyFilterMode(nextMode);
  }

  function changeStudyFilterMode(mode) {
    const state = globalScope.state;
    const nextMode = mode === "favorites" ? "favorites" : "all";
    state.prefs.studyFilterMode = nextMode;
    globalScope.saveState();
    updateStudyFilterToggle();
    if (globalScope.currentReviewSubject) {
      const currentQuestions = globalScope.getQuestionsForSubject(globalScope.currentReviewSubject) || [];
      if (currentQuestions.length > 0) {
        globalScope.renderDeckReview(globalScope.currentReviewSubject, currentQuestions);
      }
    }
  }

  // ===================== PASSWORD PROTECTION MODALS =====================
  let pendingLockedFolderPath = null;
  let pendingLockedFolderName = null;

  function openFolderPasswordModal(fullPath, folderName) {
    pendingLockedFolderPath = fullPath;
    pendingLockedFolderName = folderName;

    document.getElementById("folder-password-message").innerText =
      `The folder "${folderName}" requires a password to view its contents.`;

    toggleModal("folder-password-modal", true);
  }

  function closeFolderPasswordModal() {
    toggleModal("folder-password-modal", false);
    const inputEl = document.getElementById("folder-password-input");
    if (inputEl) inputEl.value = "";
  }

  let pendingDeckSubject = null;
  let pendingDeckAction = null;

  function openDeckPasswordModal(subject, action) {
    pendingDeckSubject = subject;
    pendingDeckAction = action;

    const messageEl = document.getElementById("deck-password-message");
    if (messageEl) {
      const shortName = subject.split("::").pop();
      messageEl.innerText = `The deck "${globalScope.escapeHTML(shortName)}" requires a password.`;
    }

    toggleModal("deck-password-modal", true);
  }

  function closeDeckPasswordModal() {
    toggleModal("deck-password-modal", false);
    const inputEl = document.getElementById("deck-password-input");
    if (inputEl) inputEl.value = "";
  }

  // ===================== DROPDOWN MENU MANAGEMENT =====================
  function closeAllDropdownMenus(exceptElement = null) {
    document
      .querySelectorAll("#deck-source-menu, #deck-sort-menu, #quiz-filter-menu")
      .forEach((menu) => {
        if (menu !== exceptElement) menu.open = false;
      });
  }

  function initDetailsExclusivity() {
    const detailsElements = document.querySelectorAll(
      "#deck-source-menu, #deck-sort-menu, #quiz-filter-menu",
    );

    detailsElements.forEach((details) => {
      details.addEventListener("toggle", (e) => {
        if (e.target.open) {
          detailsElements.forEach((other) => {
            if (other !== e.target && other.open) {
              other.open = false;
            }
          });
        }
      });
    });

    document.addEventListener("click", (event) => {
      const clickedInsideDetails = event.target.closest("details");
      if (!clickedInsideDetails) {
        closeAllDropdownMenus();
      }
    });
  }

  // ===================== MODULE EXPORT =====================
  const ModalCore = {
    toggleModal,
    openAboutModal,
    closeAboutModal,
    requestConfirmation,
    closeConfirmModal,
    openReportModal,
    closeReportModal,
    openReportModalFromStudy,
    submitReport,
    openSessionSettingsModal,
    closeSessionSettingsModal,
    openReviewSettingsModal,
    closeReviewSettingsModal,
    handleReviewLayoutChange,
    updateStudyFilterToggle,
    toggleStudyFilterMode,
    changeStudyFilterMode,
    openFolderPasswordModal,
    closeFolderPasswordModal,
    openDeckPasswordModal,
    closeDeckPasswordModal,
    closeAllDropdownMenus,
    initDetailsExclusivity,
    // Expose state for external access
    getPendingLockedFolderPath: () => pendingLockedFolderPath,
    getPendingLockedFolderName: () => pendingLockedFolderName,
    getPendingDeckSubject: () => pendingDeckSubject,
    getPendingDeckAction: () => pendingDeckAction,
    setPendingLockedFolder: (path, name) => {
      pendingLockedFolderPath = path;
      pendingLockedFolderName = name;
    },
    setPendingDeck: (subject, action) => {
      pendingDeckSubject = subject;
      pendingDeckAction = action;
    },
  };

  // Alias for backward compatibility and dual exports
  const UIModal = ModalCore;

  // Export to global scope
  globalScope.ModalCore = ModalCore;
  globalScope.UIModal = UIModal;

  // Export individual functions for backward compatibility
  globalScope.toggleModal = toggleModal;
  globalScope.openAboutModal = openAboutModal;
  globalScope.closeAboutModal = closeAboutModal;
  globalScope.requestConfirmation = requestConfirmation;
  globalScope.closeConfirmModal = closeConfirmModal;
  globalScope.openReportModal = openReportModal;
  globalScope.closeReportModal = closeReportModal;
  globalScope.openReportModalFromStudy = openReportModalFromStudy;
  globalScope.submitReport = submitReport;
  globalScope.openSessionSettingsModal = openSessionSettingsModal;
  globalScope.closeSessionSettingsModal = closeSessionSettingsModal;
  globalScope.openReviewSettingsModal = openReviewSettingsModal;
  globalScope.closeReviewSettingsModal = closeReviewSettingsModal;
  globalScope.handleReviewLayoutChange = handleReviewLayoutChange;
  globalScope.updateStudyFilterToggle = updateStudyFilterToggle;
  globalScope.toggleStudyFilterMode = toggleStudyFilterMode;
  globalScope.changeStudyFilterMode = changeStudyFilterMode;
  globalScope.openFolderPasswordModal = openFolderPasswordModal;
  globalScope.closeFolderPasswordModal = closeFolderPasswordModal;
  globalScope.openDeckPasswordModal = openDeckPasswordModal;
  globalScope.closeDeckPasswordModal = closeDeckPasswordModal;
  globalScope.closeAllDropdownMenus = closeAllDropdownMenus;
  globalScope.initDetailsExclusivity = initDetailsExclusivity;

  // For Node.js testing - export as CommonJS if in test environment
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ModalCore;
  }
})(globalScope);
