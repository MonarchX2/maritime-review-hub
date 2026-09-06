(function (globalScope) {
  "use strict";

  const state = globalScope.state;
  let categoryProgressSignatureCache = null;
  let filterModelSource = null;
  let filterModel = { subjects: [], tags: [] };
  let filterDomSignature = "";

  function populateFilters() {
    if (
      typeof window !== "undefined" &&
      window.__MRH_BOOTSTRAP__?.status !== "ready" &&
      !globalScope.__mrhAppReady
    ) {
      return;
    }

    if (filterModelSource !== state.db) {
      const subjectIndex = globalScope.ensureQuestionIndex();
      const subjects = [...subjectIndex.bySubject.keys()];
      const tagSet = new Set();

      (state.db || []).forEach((question) => {
        if (!question || !question.Tags) return;
        question.Tags.split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
          .forEach((tag) => tagSet.add(tag));
      });

      filterModelSource = state.db;
      filterModel = { subjects, tags: [...tagSet] };
    }

    const { subjects, tags } = filterModel;
    const escapeHTML = globalScope.escapeHTML || ((value) => String(value));
    const encodeHandlerValue =
      globalScope.encodeHandlerValue || ((value) => String(value));

    const select = document.getElementById("filter-subject");
    if (select) {
      let html = '<option value="ALL">All Subjects (Randomized)</option>';
      if (subjects.length > 0) {
        html += '<optgroup label="Subjects">';
        html += subjects
          .map(
            (subject) =>
              `<option value="SUBJ:${escapeHTML(subject)}">${escapeHTML(subject)}</option>`,
          )
          .join("");
        html += "</optgroup>";
      }
      if (tags.length > 0) {
        html += '<optgroup label="Tags">';
        html += tags
          .map(
            (tag) =>
              `<option value="TAG:${escapeHTML(tag)}">${escapeHTML(tag)}</option>`,
          )
          .join("");
        html += "</optgroup>";
      }
      select.innerHTML = html;
    }

    const filterListContainer = document.getElementById("quiz-filter-list");
    if (!filterListContainer) return;

    const filterSignature = `${subjects.join("\u001f")}\u001e${tags.join("\u001f")}`;
    if (filterSignature === filterDomSignature) return;
    filterDomSignature = filterSignature;
    let html = "";

    if (subjects.length > 0) {
      html +=
        '<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Subjects</div>';
      html += subjects
        .map(
          (subject) =>
            `<button type="button" data-filter-value="SUBJ:${escapeHTML(subject)}" onclick="changeQuizFilter(decodeHandlerValue('SUBJ:${encodeHandlerValue(subject)}'))" class="quiz-filter-option">${escapeHTML(subject)} <i class="fa-solid fa-check filter-check"></i></button>`,
        )
        .join("");
    }

    if (tags.length > 0) {
      if (subjects.length > 0) {
        html +=
          '<div class="my-1 border-t border-gray-200 dark:border-gray-700"></div>';
      }
      html +=
        '<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Tags</div>';
      html += tags
        .map(
          (tag) =>
            `<button type="button" data-filter-value="TAG:${escapeHTML(tag)}" onclick="changeQuizFilter(decodeHandlerValue('TAG:${encodeHandlerValue(tag)}'))" class="quiz-filter-option">${escapeHTML(tag)} <i class="fa-solid fa-check filter-check"></i></button>`,
        )
        .join("");
    }

    filterListContainer.innerHTML = html;
  }

  function changeQuizFilter(filterValue) {
    const displayEl = document.getElementById("filter-subject-display");

    if (filterValue === "ALL") {
      if (displayEl) displayEl.textContent = "All Subjects";
    } else if (filterValue.startsWith("SUBJ:")) {
      if (displayEl) displayEl.textContent = filterValue.substring(5);
    } else if (filterValue.startsWith("TAG:")) {
      if (displayEl) displayEl.textContent = `Tag: ${filterValue.substring(4)}`;
    }

    document.querySelectorAll(".quiz-filter-option").forEach((button) => {
      const isSelected =
        button.getAttribute("data-filter-value") === filterValue;
      const checkIcon = button.querySelector(".filter-check");
      if (checkIcon) checkIcon.style.opacity = isSelected ? "1" : "0";
    });

    const allSubjectsButton = document.querySelector(
      "[data-filter-value='ALL']",
    );
    if (allSubjectsButton) {
      const checkIcon = allSubjectsButton.querySelector(".filter-check");
      if (checkIcon)
        checkIcon.style.opacity = filterValue === "ALL" ? "1" : "0";
    }

    let hiddenSelect = document.getElementById("filter-subject");
    if (!hiddenSelect) {
      hiddenSelect = document.createElement("select");
      hiddenSelect.id = "filter-subject";
      hiddenSelect.style.display = "none";
      document.body.appendChild(hiddenSelect);
    }
    hiddenSelect.value = filterValue;

    const menu = document.getElementById("quiz-filter-menu");
    if (menu) menu.open = false;
  }

  function getShortSubjectLabel(subject, fallback = "General") {
    const raw = String(subject ?? "").trim();
    if (!raw) return fallback;

    const parts = raw
      .split("::")
      .map((part) => part.trim())
      .filter(Boolean);

    return parts.length >= 2 ? parts.slice(-2).join(" :: ") : raw;
  }

  function getSubjectProgressStats(
    subject,
    subjectIdsBySubject,
    completedSet,
    mistakesSet,
  ) {
    const subjectIds = subjectIdsBySubject?.get(subject) || [];
    const totalQuestionsInDb = subjectIds.length;
    let completedCount = 0;
    let mistakesCount = 0;
    for (const id of subjectIds) {
      if (completedSet?.has(id)) completedCount += 1;
      if (mistakesSet?.has(id)) mistakesCount += 1;
    }
    const progressPercent =
      totalQuestionsInDb > 0
        ? Math.min(100, Math.round((completedCount / totalQuestionsInDb) * 100))
        : 0;
    const isCompleted =
      totalQuestionsInDb > 0 && completedCount >= totalQuestionsInDb;

    return {
      completedCount,
      mistakesCount,
      totalQuestionsInDb,
      progressPercent,
      isCompleted,
    };
  }

  function getDeckLoaderId(subject) {
    const normalized = String(subject || "").replace(/[^a-zA-Z0-9_-]+/g, "_");
    return `loading-${normalized || "deck"}`;
  }

  function getVisibleCategorySummary() {
    if (
      globalScope.DeckNavCore &&
      typeof globalScope.DeckNavCore.getVisibleCategorySummary === "function"
    ) {
      return globalScope.DeckNavCore.getVisibleCategorySummary();
    }
    return state.categorySummary || [];
  }

  function getCollectionSignature(values) {
    if (!Array.isArray(values)) return "";
    return values.map((value) => String(value ?? "")).join("\u001f");
  }

  function getAccessMetadataSignature() {
    const accessMetadata = state.accessMetadata || {};
    return Object.keys(accessMetadata)
      .sort()
      .map((subject) => {
        const access = accessMetadata[subject] || {};
        return [
          subject,
          access.Hidden,
          access.Locked,
          access.Password ? "protected" : "",
        ]
          .map((value) => String(value ?? ""))
          .join("\u001f");
      })
      .join("\u001e");
  }

  function getCategoryProgressRenderSignature({
    currentAppMode = globalScope.currentAppMode || "quiz",
    isInitialSyncComplete = false,
  } = {}) {
    const summary = state.categorySummary || [];
    const database = Array.isArray(state.db) ? state.db : [];
    const currentPath = state.currentPath || [];
    const completedQuestions = state.stats?.completedQs;
    const mistakes = state.stats?.mistakes;
    const favoriteDecks = state.prefs.favoriteDecks;
    const archivedDecks = state.prefs.archivedDecks;
    const accessMetadata = state.accessMetadata || {};
    const getSummarySignature = globalScope.getSummarySignature || (() => "");

    if (!categoryProgressSignatureCache) categoryProgressSignatureCache = {};
    const cache = categoryProgressSignatureCache;

    if (cache.summaryRef !== summary) {
      cache.summaryRef = summary;
      cache.summarySignature = getSummarySignature(summary);
    }
    if (cache.databaseRef !== database) {
      cache.databaseRef = database;
      cache.databaseSignature = getCollectionSignature(
        [
          ...new Set(
            database
              .map((question) => String(question?.Subject || "").trim())
              .filter(Boolean),
          ),
        ].sort(),
      );
    }
    if (cache.pathRef !== currentPath) {
      cache.pathRef = currentPath;
      cache.pathSignature = getCollectionSignature(currentPath);
    }
    if (cache.completedRef !== completedQuestions) {
      cache.completedRef = completedQuestions;
      cache.completedSignature = getCollectionSignature(completedQuestions);
    }
    if (cache.mistakesRef !== mistakes) {
      cache.mistakesRef = mistakes;
      cache.mistakesSignature = getCollectionSignature(mistakes);
    }
    if (cache.favoriteDecksRef !== favoriteDecks) {
      cache.favoriteDecksRef = favoriteDecks;
      cache.favoriteDecksSignature = getCollectionSignature(favoriteDecks);
    }
    if (cache.archivedDecksRef !== archivedDecks) {
      cache.archivedDecksRef = archivedDecks;
      cache.archivedDecksSignature = getCollectionSignature(archivedDecks);
    }
    if (cache.accessMetadataRef !== accessMetadata) {
      cache.accessMetadataRef = accessMetadata;
      cache.accessMetadataSignature = getAccessMetadataSignature();
    }

    return [
      cache.summarySignature,
      cache.databaseSignature,
      cache.pathSignature,
      state.prefs.layoutMode,
      state.prefs.deckSourceFilter,
      state.prefs.deckSortBy,
      state.prefs.deckSortDirection,
      state.prefs.deckNameMode,
      currentAppMode,
      cache.completedSignature,
      cache.mistakesSignature,
      cache.favoriteDecksSignature,
      cache.archivedDecksSignature,
      cache.accessMetadataSignature,
      isInitialSyncComplete,
    ].join("\u001e");
  }

  function invalidateCategoryProgressSignatureCache() {
    categoryProgressSignatureCache = null;
  }

  function buildCategoryTree(summary) {
    const tree = {};
    if (!Array.isArray(summary)) return tree;

    summary.forEach((category) => {
      if (!category?.Subject) return;
      const parts = String(category.Subject).split("::");
      let currentLevel = tree;

      parts.forEach((part, index) => {
        const normalizedPart = String(part || "").trim();
        if (!normalizedPart) return;
        if (!currentLevel[normalizedPart]) {
          currentLevel[normalizedPart] = { _children: {}, _data: null };
        }
        if (index === parts.length - 1) {
          currentLevel[normalizedPart]._data = category;
        }
        currentLevel = currentLevel[normalizedPart]._children;
      });
    });

    return tree;
  }

  function getFolderStats(node, folderStatsCache) {
    if (!node || typeof node !== "object") return 0;
    if (folderStatsCache.has(node)) return folderStatsCache.get(node);

    let total = 0;
    if (node._data && Number(node._data.QuestionCount || 0) > 0) {
      total += Number(node._data.QuestionCount || 0);
    }
    const childKeys = Object.keys(node._children || {});
    for (let i = 0; i < childKeys.length; i += 1) {
      total += getFolderStats(node._children[childKeys[i]], folderStatsCache);
    }
    folderStatsCache.set(node, total);
    return total;
  }

  function getNodeMetadata(node, nodeMetadataCache, folderStatsCache) {
    if (!node || typeof node !== "object") {
      return {
        childKeys: [],
        hasChildren: false,
        isFolder: false,
        totalCards: 0,
      };
    }
    if (nodeMetadataCache.has(node)) return nodeMetadataCache.get(node);

    const childKeys = Object.keys(node._children || {});
    const hasChildren = childKeys.length > 0;
    const isFolder = hasChildren || Boolean(node._data?.IsFolder);
    const totalCards = getFolderStats(node, folderStatsCache);
    const metadata = { childKeys, hasChildren, isFolder, totalCards };
    nodeMetadataCache.set(node, metadata);
    return metadata;
  }

  function syncDashboardControls(dashboardControls = document) {
    if (!state.prefs.deckSourceFilter) state.prefs.deckSourceFilter = "all";

    const sourceLabel = document.getElementById("deck-source-label");
    if (sourceLabel) {
      const sourceLabels = {
        all: "All Decks",
        favorites: "Favorites",
        downloaded: "Downloaded",
        cloud: "Cloud Only",
        archived: "Archived",
      };
      sourceLabel.innerText =
        sourceLabels[state.prefs.deckSourceFilter] || "All Decks";
    }

    dashboardControls
      .querySelectorAll(".deck-source-option")
      .forEach((button) => {
        const check = button.querySelector(".source-check");
        if (check) {
          check.style.opacity =
            button.dataset.sourceValue === state.prefs.deckSourceFilter
              ? "1"
              : "0";
        }
      });

    const selectedSortBy = state.prefs.deckSortBy || "letters";
    const selectedSortDirection =
      state.prefs.deckSortDirection === "desc" ? "desc" : "asc";
    dashboardControls
      .querySelectorAll(".deck-sort-option[data-sort-value]")
      .forEach((button) => {
        const check = button.querySelector(".sort-check");
        if (check) {
          check.style.opacity =
            button.dataset.sortValue === selectedSortBy ? "1" : "0";
        }
      });
    dashboardControls
      .querySelectorAll(".deck-sort-option[data-sort-direction]")
      .forEach((button) => {
        const check = button.querySelector(".sort-direction-check");
        if (check) {
          check.style.opacity =
            button.dataset.sortDirection === selectedSortDirection ? "1" : "0";
        }
      });

    const layoutIcon = document.getElementById("layout-icon");
    if (layoutIcon) {
      const layoutIconColor =
        state.prefs.lastActivity?.mode === "review"
          ? "text-purple-600 dark:text-purple-400"
          : "text-brand-500";
      const layoutIcons = {
        grid: `fa-solid fa-table-cells ${layoutIconColor}`,
        list: `fa-solid fa-list ${layoutIconColor}`,
        tree: `fa-solid fa-sitemap ${layoutIconColor}`,
      };
      layoutIcon.className =
        layoutIcons[state.prefs.layoutMode] || layoutIcons.grid;
    }
  }

  const DashboardCore = {
    populateFilters,
    changeQuizFilter,
    getShortSubjectLabel,
    getSubjectProgressStats,
    getDeckLoaderId,
    getVisibleCategorySummary,
    getCollectionSignature,
    getAccessMetadataSignature,
    buildCategoryTree,
    getFolderStats,
    getNodeMetadata,
    getCategoryProgressRenderSignature,
    invalidateCategoryProgressSignatureCache,
    syncDashboardControls,
  };
  globalScope.DashboardCore = DashboardCore;
  Object.assign(globalScope, DashboardCore);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DashboardCore;
  }
})(
  typeof globalScope !== "undefined"
    ? globalScope
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
