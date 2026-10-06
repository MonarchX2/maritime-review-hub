// ============================================================================
// UI Modal Core - Modal handlers, dropdown menus, and feature UI management
// Extracted from app-core.js - Phase 4
// ============================================================================

(function (globalScope) {
  // Import global utilities
  const lifecycle = globalScope.LifecycleUtils || globalScope;

  // ===================== CORE MODAL CONTROL =====================
  const modalTimers = new WeakMap();
  const modalInnerCache = new WeakMap();
  let dropdownMenusCache = null;

  function getModalInner(modal) {
    if (!modal) return null;
    let inner = modalInnerCache.get(modal);
    if (!inner) {
      inner =
        modal.querySelector(":scope > div") ||
        modal.querySelector("div") ||
        null;
      if (inner) modalInnerCache.set(modal, inner);
    }
    return inner;
  }

  function toggleModal(modalId, isVisible) {
    const modal = document.getElementById(modalId);
    if (!modal) return false;
    const inner = getModalInner(modal);
    const previous = modalTimers.get(modal);
    if (previous) {
      lifecycle.clearTimeout(previous.show);
      lifecycle.clearTimeout(previous.hide);
    }

    if (isVisible) {
      modal.setAttribute("aria-hidden", "false");
      const show = lifecycle.setTimeout(() => {
        if (modal.getAttribute("aria-hidden") === "true") return;
        modal.classList.remove("opacity-0");
        if (inner) inner.classList.remove("scale-95", "opacity-0");
      }, 10);
      modalTimers.set(modal, { show, hide: null });
    } else {
      modal.setAttribute("aria-hidden", "true");
      modal.classList.add("opacity-0");
      if (inner) inner.classList.add("scale-95", "opacity-0");
      const hide = lifecycle.setTimeout(() => {
        modal.setAttribute("aria-hidden", "true");
      }, 300);
      modalTimers.set(modal, { show: null, hide });
    }
    return true;
  }

  // ===================== ABOUT MODAL =====================
  function openAboutModal() {
    toggleModal("about-modal", true);
  }

  function closeAboutModal() {
    toggleModal("about-modal", false);
  }

  // ===================== CONFIRM MODAL =====================
  let confirmRequest = null;

  function requestConfirmation(message, title = "Confirm Action") {
    return new Promise((resolve) => {
      if (confirmRequest) confirmRequest.resolve(false);
      confirmRequest = { resolve };
      const modal = document.getElementById("confirm-modal");
      if (!modal) {
        const result =
          typeof globalScope.confirm === "function"
            ? globalScope.confirm(message)
            : false;
        confirmRequest = null;
        resolve(result);
        return;
      }
      if (modal.parentElement !== document.body)
        document.body.appendChild(modal);
      const titleEl = document.getElementById("confirm-title");
      const messageEl = document.getElementById("confirm-message");
      if (titleEl) {
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-circle-question text-brand-500 mr-2";
        titleEl.replaceChildren(
          icon,
          document.createTextNode(String(title ?? "")),
        );
      }
      if (messageEl) messageEl.textContent = String(message ?? "");
      toggleModal("confirm-modal", true);
    });
  }

  function closeConfirmModal(confirmed) {
    toggleModal("confirm-modal", false);
    if (confirmRequest) {
      const current = confirmRequest;
      confirmRequest = null;
      queueMicrotask(() => current.resolve(Boolean(confirmed)));
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
    if (navigationSelect)
      navigationSelect.value = globalScope.getQuizNavigationPosition();
    globalScope.syncNavigationButtonLabels?.();

    toggleModal("session-settings-modal", true);
  }

  function closeSessionSettingsModal() {
    toggleModal("session-settings-modal", false);
  }

  // ===================== REVIEW SETTINGS MODAL =====================
  function openReviewSettingsModal() {
    const modal = document.getElementById("review-settings-modal");
    if (!modal) return false;

    globalScope.syncNavigationButtonLabels?.();
    updateStudyFilterToggle();
    modal.setAttribute("aria-hidden", "false");
    // Small delay allows the browser to render 'block' before applying opacity for the transition
    lifecycle.setTimeout(() => {
      modal.classList.remove("opacity-0");
      getModalInner(modal)?.classList.remove("scale-95");
    }, 10);
  }

  function closeReviewSettingsModal() {
    const modal = document.getElementById("review-settings-modal");
    if (!modal) return false;

    modal.classList.add("opacity-0");
    modal.querySelector("div")?.classList.add("scale-95");
    // Wait for transition to finish before hiding element
    lifecycle.setTimeout(() => {
      modal.setAttribute("aria-hidden", "true");
    }, 300);
    return true;
  }

  function handleReviewLayoutChange(layoutType) {
    const perPageContainer = document.getElementById(
      "review-per-page-container",
    );
    if (perPageContainer) {
      if (layoutType === "single") {
        perPageContainer.classList.add("hidden");
      } else {
        perPageContainer.classList.remove("hidden");
      }
    }

    globalScope.changeStudyLayout(layoutType);
    globalScope.syncNavigationButtonLabels?.();
  }

  // ===================== STUDY FILTER MANAGEMENT =====================
  function updateStudyFilterToggle() {
    const toggle = document.getElementById("study-filter-toggle");
    const icon = document.getElementById("study-filter-icon");
    if (!toggle || !icon) return;

    const isFavorites =
      (globalScope.state.prefs.studyFilterMode || "all") === "favorites";
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
    const currentReviewSubject =
      globalScope.DeckReviewCore?.getCurrentReviewSubject?.() || "";

    if (currentReviewSubject) {
      const currentQuestions =
        globalScope.getQuestionsForSubject(currentReviewSubject) || [];
      if (currentQuestions.length > 0) {
        globalScope.renderDeckReview(currentReviewSubject, currentQuestions);
      }
    }
  }

  // ===================== PASSWORD PROTECTION MODALS =====================
  let pendingLockedFolderPath = null;
  let pendingLockedFolderName = null;

  function openFolderPasswordModal(fullPath, folderName) {
    pendingLockedFolderPath = fullPath;
    pendingLockedFolderName = folderName;

    const messageEl = document.getElementById("folder-password-message");
    if (messageEl)
      messageEl.textContent = `The folder "${folderName}" requires a password to view its contents.`;

    const inputEl = document.getElementById("folder-password-input");
    if (inputEl) {
      inputEl.value = "";
      inputEl.setAttribute("aria-invalid", "false");
      inputEl.classList.remove("border-red-500", "focus:ring-red-500");
    }
    setInlineError(document.getElementById("folder-password-input-error"), "");

    toggleModal("folder-password-modal", true);
  }

  function closeFolderPasswordModal() {
    toggleModal("folder-password-modal", false);
    const inputEl = document.getElementById("folder-password-input");
    if (inputEl) inputEl.value = "";
    setInlineError(document.getElementById("folder-password-input-error"), "");
    if (inputEl) {
      inputEl.setAttribute("aria-invalid", "false");
      inputEl.classList.remove("border-red-500", "focus:ring-red-500");
    }
  }

  let pendingDeckSubject = null;
  let pendingDeckAction = null;

  function openDeckPasswordModal(subject, action) {
    pendingDeckSubject = subject;
    pendingDeckAction = action;

    const messageEl = document.getElementById("deck-password-message");
    if (messageEl) {
      const shortName = subject.split("::").pop();
      messageEl.innerText = `The deck "${shortName}" requires a password.`;
    }

    const inputEl = document.getElementById("deck-password-input");
    if (inputEl) {
      inputEl.value = "";
      inputEl.setAttribute("aria-invalid", "false");
      inputEl.classList.remove("border-red-500", "focus:ring-red-500");
    }
    setInlineError(document.getElementById("deck-password-input-error"), "");

    toggleModal("deck-password-modal", true);
  }

  function closeDeckPasswordModal() {
    toggleModal("deck-password-modal", false);
    const inputEl = document.getElementById("deck-password-input");
    if (inputEl) inputEl.value = "";
    setInlineError(document.getElementById("deck-password-input-error"), "");
    if (inputEl) {
      inputEl.setAttribute("aria-invalid", "false");
      inputEl.classList.remove("border-red-500", "focus:ring-red-500");
    }
  }

  // ===================== DROPDOWN MENU MANAGEMENT =====================
  function closeAllDropdownMenus(exceptElement = null) {
    const menus =
      dropdownMenusCache ||
      (dropdownMenusCache = document.querySelectorAll(
        "#deck-source-menu, #deck-sort-menu, #quiz-filter-menu",
      ));
    menus.forEach((menu) => {
      if (menu !== exceptElement) menu.open = false;
    });
  }

  function initDetailsExclusivity() {
    if (typeof document === "undefined") return false;
    const detailsElements =
      dropdownMenusCache ||
      (dropdownMenusCache = document.querySelectorAll(
        "#deck-source-menu, #deck-sort-menu, #quiz-filter-menu",
      ));

    if (
      document.documentElement.dataset.mrhDetailsExclusivityInitialized ===
      "true"
    )
      return;
    document.documentElement.dataset.mrhDetailsExclusivityInitialized = "true";
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

  // Export to global scope
  globalScope.ModalCore = ModalCore;

  // Export individual functions for backward compatibility
  globalScope.toggleModal = toggleModal;
  globalScope.openAboutModal = openAboutModal;
  globalScope.closeAboutModal = closeAboutModal;
  globalScope.requestConfirmation = requestConfirmation;
  globalScope.closeConfirmModal = closeConfirmModal;
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
})(
  typeof globalScope !== "undefined"
    ? globalScope
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
