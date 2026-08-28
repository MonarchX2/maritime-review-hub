// ============================================================================
// Deck Review Core - Deck study/review controller and pagination
// ============================================================================

(function (globalScope) {
  let currentReviewSubject = null;
  let currentReviewQuestions = [];
  let derivedQuestionsCache = null;
  let reviewRenderFrame = null;
  let virtualReviewScrollFrame = null;
  const REVIEW_ESTIMATED_CARD_HEIGHT = 420;
  const REVIEW_VIRTUAL_OVERSCAN = 4;

  function scheduleVirtualReviewRender() {
    if (virtualReviewScrollFrame !== null) return;
    const render = () => {
      virtualReviewScrollFrame = null;
      if (
        document
          .getElementById("view-deck-review")
          ?.classList.contains("active") &&
        globalScope.state?.prefs?.studyLayout !== "single" &&
        globalScope.state?.prefs?.studyPageSize === "All"
      ) {
        reRenderDeckReview();
      }
    };
    virtualReviewScrollFrame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(render)
        : setTimeout(render, 0);
  }

  function ensureVirtualReviewScrollListener() {
    const main = document.querySelector("main");
    if (!main || main.dataset.reviewVirtualized === "true") return;
    main.dataset.reviewVirtualized = "true";
    main.addEventListener("scroll", scheduleVirtualReviewRender, {
      passive: true,
    });
  }

  function reRenderDeckReview() {
    if (reviewRenderFrame !== null) return;

    const render = () => {
      reviewRenderFrame = null;
      renderDeckReview(currentReviewSubject, currentReviewQuestions);
    };

    if (typeof requestAnimationFrame === "function") {
      reviewRenderFrame = requestAnimationFrame(render);
    } else {
      reviewRenderFrame = setTimeout(render, 0);
    }
  }

  function renderDeckReviewImplementation(subject, questions) {
    currentReviewSubject = subject;
    currentReviewQuestions = questions;

    const container = document.getElementById("deck-review-list");
    document.getElementById("deck-review-title").innerText =
      getShortSubjectLabel(subject, "General");

    const globalShowWrong = state.prefs.showWrongChoices !== false;
    const hideABCD = state.prefs.hideABCD === true;
    let layout = state.prefs.studyLayout || "scroll";
    let pageSize = state.prefs.studyPageSize || 50;
    const reviewNavigationPosition = getStudyNavigationPosition(layout);

    if (!state.prefs.studyProgress[subject]) {
      state.prefs.studyProgress[subject] = { page: 1, index: 0, scrollY: 0 };
    }
    let progress = state.prefs.studyProgress[subject];
    let currentPage = progress.page || 1;
    let currentIndex = progress.index || 0;

    const wrongToggle = document.getElementById("toggle-wrong-choices");
    if (wrongToggle) wrongToggle.checked = globalShowWrong;
    const hideABCDToggle = document.getElementById("toggle-hide-abcd");
    if (hideABCDToggle) hideABCDToggle.checked = hideABCD;

    let html = "";
    const favoriteQuestions = new Set(
      Array.isArray(state.prefs.favoriteQuestions)
        ? state.prefs.favoriteQuestions.filter(Boolean)
        : [],
    );

    const studyFilterMode = state.prefs.studyFilterMode || "all";
    const favoriteSignature = [...favoriteQuestions].join("\u001f");
    const canReuseCache =
      derivedQuestionsCache &&
      derivedQuestionsCache.questions === questions &&
      derivedQuestionsCache.filterMode === studyFilterMode &&
      derivedQuestionsCache.favoriteSignature === favoriteSignature;

    let filteredQuestions;
    let sortedQuestions;
    if (canReuseCache) {
      ({ filteredQuestions, sortedQuestions } = derivedQuestionsCache);
    } else {
      filteredQuestions =
        studyFilterMode === "favorites"
          ? questions.filter((question) => favoriteQuestions.has(question.ID))
          : questions;
      sortedQuestions = [...filteredQuestions].sort((a, b) => {
        const aFav = favoriteQuestions.has(a.ID) ? 1 : 0;
        const bFav = favoriteQuestions.has(b.ID) ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
        return 0;
      });
      derivedQuestionsCache = {
        questions,
        filterMode: studyFilterMode,
        favoriteSignature,
        filteredQuestions,
        sortedQuestions,
      };
    }

    if (filteredQuestions.length === 0) {
      container.innerHTML = `
      <div class="text-center p-8 text-gray-500 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <i class="fa-solid fa-star text-yellow-500 text-2xl mb-3"></i>
        <p class="font-bold text-lg">No favorite questions in this deck.</p>
        <p class="text-sm mt-1">Switch the study filter to All to see every question.</p>
      </div>
    `;
      navigate("deck-review");
      return;
    }

    if (questions.length === 0) {
      container.innerHTML =
        html +
        `<div class="text-center p-8 text-gray-500">No questions found for this deck.</div>`;
      navigate("deck-review");
      return;
    }

    let displayQuestions = [];
    let virtualStartIndex = 0;
    let virtualEndIndex = filteredQuestions.length;
    let totalPages = 1;

    displayQuestions = sortedQuestions;

    if (layout === "single") {
      if (currentIndex < 0) currentIndex = 0;
      if (currentIndex >= filteredQuestions.length)
        currentIndex = filteredQuestions.length - 1;
      progress.index = currentIndex;

      displayQuestions = [filteredQuestions[currentIndex]];
    } else {
      if (pageSize === "All") {
        ensureVirtualReviewScrollListener();
        const main = document.querySelector("main");
        const containerTop = main && container ? container.offsetTop : 0;
        const viewportTop = Math.max(0, (main?.scrollTop || 0) - containerTop);
        const viewportHeight = main?.clientHeight || window.innerHeight || 800;
        virtualStartIndex = Math.max(
          0,
          Math.floor(viewportTop / REVIEW_ESTIMATED_CARD_HEIGHT) -
            REVIEW_VIRTUAL_OVERSCAN,
        );
        virtualEndIndex = Math.min(
          filteredQuestions.length,
          Math.ceil(
            (viewportTop + viewportHeight) / REVIEW_ESTIMATED_CARD_HEIGHT,
          ) + REVIEW_VIRTUAL_OVERSCAN,
        );
        displayQuestions = filteredQuestions.slice(
          virtualStartIndex,
          virtualEndIndex,
        );
      } else {
        totalPages = Math.ceil(filteredQuestions.length / pageSize);
        if (currentPage < 1) currentPage = 1;
        if (currentPage > totalPages) currentPage = totalPages;
        progress.page = currentPage;

        let start = (currentPage - 1) * pageSize;
        displayQuestions = filteredQuestions.slice(start, start + pageSize);
      }
    }

    const pageCount = document.getElementById("review-page-count");
    const pageSizeInput = document.getElementById("review-page-size-input");
    if (pageSizeInput) pageSizeInput.value = pageSize === "All" ? "" : pageSize;
    if (pageCount)
      pageCount.innerText = pageSize === "All" ? "1" : Math.max(1, totalPages);

    let navigationHTML = "";
    if (layout === "single") {
      navigationHTML = `
        <div class="flex justify-between items-center mb-6 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 sticky top-4 z-20 gap-2">
            <button onclick="changeStudyIndex(-1)" ${currentIndex === 0 ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                <i class="fa-solid fa-arrow-left"></i> <span class="hidden sm:inline ml-1">Prev</span>
            </button>
          <span class="text-sm font-bold text-gray-600 dark:text-gray-300 flex-1 text-center">Card ${currentIndex + 1} / ${questions.length}</span>
          <button onclick="changeStudyIndex(1)" ${currentIndex === questions.length - 1 ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                <span class="hidden sm:inline mr-1">Next</span> <i class="fa-solid fa-arrow-right"></i>
            </button>
        </div>
    `;
    } else if (pageSize !== "All" && totalPages > 1) {
      navigationHTML = `
            <div class="flex justify-between items-center mt-6 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 sticky bottom-4 z-10 gap-2">
                <button onclick="changeStudyPage(-1)" ${currentPage === 1 ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                    <i class="fa-solid fa-arrow-left"></i> <span class="hidden sm:inline ml-1">Prev</span>
                </button>
                <div class="flex-1 flex items-center justify-center gap-1 text-sm font-bold text-gray-600 dark:text-gray-300">
                    <span>Page</span>
                    <label class="sr-only" for="study-page-input">Go to page</label>
                    <input
                        id="study-page-input"
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        min="1"
                        max="${totalPages}"
                        value="${currentPage}"
                        onchange="jumpToStudyPage(this.value)"
                        oninput="this.style.width = Math.max(1.8, (this.value.length || String(${currentPage}).length) + 1.2) + 'ch';"
                        class="border-0 border-b border-gray-300 dark:border-gray-600 bg-transparent px-0 py-0 text-center text-sm font-bold text-gray-800 dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-0 [-moz-appearance:textfield]"
                        style="width: ${Math.max(1.8, String(currentPage).length + 1.2)}ch;"
                    />
                    <span>of ${totalPages}</span>
                </div>
                <button onclick="changeStudyPage(1)" ${currentPage === totalPages ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                    <span class="hidden sm:inline mr-1">Next</span> <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        `;
    }

    const showTopNavigation = ["top", "both"].includes(
      reviewNavigationPosition,
    );
    const showBottomNavigation = ["bottom", "both"].includes(
      reviewNavigationPosition,
    );

    if (showTopNavigation) html += navigationHTML;

    if (pageSize === "All" && virtualStartIndex > 0) {
      html += `<div aria-hidden="true" style="height: ${virtualStartIndex * REVIEW_ESTIMATED_CARD_HEIGHT}px"></div>`;
    }

    const questionIndexById = new Map(
      filteredQuestions.map((question, index) => [question.ID, index]),
    );

    displayQuestions.forEach((q, displayIndex) => {
      const originalIndex = questionIndexById.get(q.ID) ?? displayIndex;
      const isQuestionFavorite = favoriteQuestions.has(q.ID);

      let rawQuestionText = q.Question ? String(q.Question) : "";
      let cleanQuestionText = rawQuestionText.replace(/^\s*\d+\.\s*/, "");

      let ansStr = q.Answer ? String(q.Answer).trim() : "";
      const { isIdent: isPureIdent } = getQuestionTypeMode(q);
      let isMultipleChoice = !isPureIdent;

      let correctText = ansStr;
      if (isMultipleChoice) {
        correctText = q[`Choice${ansStr.toUpperCase()}`] || ansStr;
      } else {
        correctText = q.ChoiceA || ansStr;
      }
      if (!correctText || correctText.toLowerCase() === "undefined") {
        correctText = "Answer missing from database";
      }

      let showWrongForThisQ = state.prefs.qToggles?.[q.ID];
      if (showWrongForThisQ === undefined) showWrongForThisQ = globalShowWrong;

      let choicesHTML = "";
      if (isMultipleChoice && showWrongForThisQ) {
        const letters = ["A", "B", "C", "D"];
        choicesHTML = `<div class="mt-4 flex flex-col gap-2">`;
        letters.forEach((letter) => {
          let choiceText = q[`Choice${letter}`];
          let prefix = hideABCD ? "" : `${letter}. `;

          if (choiceText) {
            let isCorrect = letter === ansStr.toUpperCase();
            if (isCorrect) {
              choicesHTML += `
                            <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-3 rounded-r-lg">
                                <p class="text-sm font-bold text-green-700 dark:text-green-400">
                                    ${prefix}${escapeHTML(choiceText)}
                                </p>
                            </div>`;
            } else {
              choicesHTML += `
                            <div class="bg-gray-50 dark:bg-gray-800/50 border-l-4 border-gray-300 dark:border-gray-600 p-3 rounded-r-lg opacity-70">
                                <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    ${prefix}${escapeHTML(choiceText)}
                                </p>
                            </div>`;
            }
          }
        });
        choicesHTML += `</div>`;
      } else {
        let prefix = hideABCD
          ? ""
          : isMultipleChoice
            ? `${ansStr.toUpperCase()}. `
            : "";
        choicesHTML = `
                <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-3 rounded-r-lg mt-4">
                    <p class="text-sm font-bold text-green-700 dark:text-green-400">
                        ${prefix}${escapeHTML(correctText)} <!-- Feature #22: Removed check icon -->
                    </p>
                </div>`;
      }

      const isProtectedDeck = isDeckPasswordProtected(q.Subject);
      let reportClass = globallyReportedQs.has(q.ID)
        ? "text-red-500 bg-red-50 dark:bg-red-900/30"
        : isProtectedDeck
          ? "text-gray-300 bg-gray-100 dark:bg-gray-700/40 cursor-not-allowed opacity-60"
          : "text-gray-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500";

      html += `
            <div class="review-question-card bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6 animate-card-in">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
                    <span class="bg-brand-50 text-brand-600 text-xs px-2 py-1 rounded font-bold dark:bg-brand-900/30 dark:text-brand-400">Question ${originalIndex + 1}</span>

                    <div class="flex gap-2 items-center">
                        <!-- Feature 16: Individual Toggle Button -->
                        ${
                          isMultipleChoice
                            ? `<button onclick="toggleSpecificChoices('${encodeHandlerValue(q.ID)}')" class="text-xs font-bold px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors">
                          ${showWrongForThisQ ? '<i class="fa-solid fa-eye-slash mr-1"></i> Hide Choices' : '<i class="fa-solid fa-eye mr-1"></i> Show Choices'}
                        </button>`
                            : ""
                        }

                        <button onclick="event.stopPropagation(); toggleQuestionFavorite('${encodeHandlerValue(q.ID)}')" class="${isQuestionFavorite ? "text-yellow-500" : "text-gray-400 hover:text-yellow-500"} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm active:scale-95 transition-all" title="${isQuestionFavorite ? "Remove from Favorites" : "Add to Favorites"}">
                            <i class="fa-solid fa-star"></i>
                        </button>

                        ${
                          isProtectedDeck
                            ? `<button type="button" class="${reportClass} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm transition-all" title="Reporting disabled for password-protected decks" disabled>
                                <i class="fa-solid fa-triangle-exclamation"></i>
                            </button>`
                            : `<button onclick="openReportModalFromStudy('${encodeHandlerValue(q.ID)}')" class="${reportClass} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm active:scale-95 transition-all" title="${globallyReportedQs.has(q.ID) ? "Active Community Report" : "Report Issue"}">
                                <i class="fa-solid fa-triangle-exclamation"></i>
                            </button>`
                        }
                    </div>
                </div>

                <p class="font-medium text-gray-800 dark:text-gray-100 mb-2 text-lg">${formatQuestionText(cleanQuestionText)}</p>


                ${choicesHTML}

                ${
                  q.Explanation && q.Explanation.trim() !== ""
                    ? `
                    <div class="mt-4 text-sm text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-gray-900/50 p-3 rounded-lg border border-blue-100 dark:border-gray-700">
                        <strong class="text-blue-800 dark:text-blue-400"><i class="fa-solid fa-lightbulb mr-1"></i> Explanation:</strong> ${escapeHTML(q.Explanation)}
                    </div>
                `
                    : ""
                }
            </div>
        `;
    });

    if (showBottomNavigation) html += navigationHTML;

    if (pageSize === "All" && virtualEndIndex < filteredQuestions.length) {
      html += `<div aria-hidden="true" style="height: ${(filteredQuestions.length - virtualEndIndex) * REVIEW_ESTIMATED_CARD_HEIGHT}px"></div>`;
    }

    container.innerHTML = html;
    navigate("deck-review");

    setTimeout(() => {
      const scrollContainer = document.querySelector("main");
      if (scrollContainer && layout === "scroll") {
        scrollContainer.scrollTop = progress.scrollY || 0;
      }
      applyTitleMode();
    }, 100);
  }

  if (typeof globalThis !== "undefined") {
    globalThis.renderDeckReviewImplementation = renderDeckReviewImplementation;
  }

  function renderDeckReview(subject, questions) {
    currentReviewSubject = subject;
    currentReviewQuestions = Array.isArray(questions) ? questions : [];
    globalScope.currentReviewSubject = currentReviewSubject;
    globalScope.currentReviewQuestions = currentReviewQuestions;

    return renderDeckReviewImplementation(subject, currentReviewQuestions);
  }

  const state = globalScope.state;
  const saveState = globalScope.saveState;

  function changeStudyLayout(layout) {
    if (!(state && ["scroll", "single"].includes(layout))) return;
    state.prefs.studyLayout = layout;
    if (
      layout === "single" &&
      !state.prefs.studyProgress[currentReviewSubject]
    ) {
      state.prefs.studyProgress[currentReviewSubject] = {
        page: 1,
        index: 0,
        scrollY: 0,
      };
    }
    saveState();
    reRenderDeckReview();
  }

  function changeStudyPageSize(size) {
    const validSizes = [10, 25, 50, 100, "All"];
    if (!validSizes.includes(Number(size)) && size !== "All") return;
    state.prefs.studyPageSize = size === "" ? 50 : Number(size) || size;
    if (state.prefs.studyProgress[currentReviewSubject]) {
      state.prefs.studyProgress[currentReviewSubject].page = 1;
    }
    saveState();
    reRenderDeckReview();
  }

  function changeStudyPage(delta) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    if (!progress) return;
    progress.page = Math.max(1, (progress.page || 1) + delta);
    saveState();
    reRenderDeckReview();
  }

  function changeStudyIndex(delta) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    if (!progress) return;
    const maxIndex = Math.max(0, currentReviewQuestions.length - 1);
    progress.index = Math.max(
      0,
      Math.min(maxIndex, (progress.index || 0) + delta),
    );
    saveState();
    reRenderDeckReview();
  }

  function jumpToStudyPage(pageNumber) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    const page = parseInt(pageNumber, 10);
    if (!progress || Number.isNaN(page)) return;
    progress.page = Math.max(1, page);
    saveState();
    reRenderDeckReview();
  }

  // ===================== MODULE EXPORT =====================
  const DeckReviewCore = {
    renderDeckReview,
    reRenderDeckReview,
    changeStudyLayout,
    changeStudyPageSize,
    changeStudyPage,
    changeStudyIndex,
    jumpToStudyPage,
    renderDeckReviewImplementation,
    // Expose state accessors
    getCurrentReviewSubject: () => currentReviewSubject,
    getCurrentReviewQuestions: () => currentReviewQuestions,
  };

  // Alias for backward compatibility
  const DeckReview = DeckReviewCore;

  // Export to global scope
  globalScope.DeckReviewCore = DeckReviewCore;
  globalScope.DeckReview = DeckReview;

  // Export individual functions for backward compatibility
  globalScope.renderDeckReview = renderDeckReview;
  globalScope.reRenderDeckReview = reRenderDeckReview;
  globalScope.changeStudyLayout = changeStudyLayout;
  globalScope.changeStudyPageSize = changeStudyPageSize;
  globalScope.changeStudyPage = changeStudyPage;
  globalScope.changeStudyIndex = changeStudyIndex;
  globalScope.jumpToStudyPage = jumpToStudyPage;
  globalScope.renderDeckReviewImplementation = renderDeckReviewImplementation;
  globalScope.currentReviewSubject = currentReviewSubject;
  globalScope.currentReviewQuestions = currentReviewQuestions;

  // For Node.js testing - export as CommonJS if in test environment
  if (typeof module !== "undefined" && module.exports) {
    module.exports = DeckReviewCore;
  }
})(
  typeof globalScope !== "undefined"
    ? globalScope
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
