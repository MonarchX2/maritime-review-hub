// ============================================================================
// Deck Review Core - Deck study/review controller and pagination
// ============================================================================

(function (globalScope) {
  const lifecycle = globalScope.LifecycleUtils || globalScope;
  let currentReviewSubject = null;
  let currentReviewQuestions = [];
  let derivedQuestionsCache = null;
  let reviewRenderFrame = null;
  let virtualReviewScrollFrame = null;
  let lastVirtualRenderKey = null;
  let reviewMainElement = null;
  let reviewContainerElement = null;
  let cachedReviewContainerTop = 0;
  let pendingReviewScrollPosition = null;
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
        reRenderDeckReview(true);
      }
    };
    virtualReviewScrollFrame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(render)
        : lifecycle.setTimeout(render, 0);
  }

  function reRenderDeckReview(isVirtualScroll = false) {
    if (reviewRenderFrame !== null) return;

    const render = () => {
      reviewRenderFrame = null;
      renderDeckReview(
        currentReviewSubject,
        currentReviewQuestions,
        isVirtualScroll,
      );
    };

    if (typeof requestAnimationFrame === "function") {
      reviewRenderFrame = requestAnimationFrame(render);
    } else {
      reviewRenderFrame = lifecycle.setTimeout(render, 0);
    }
  }

  function buildReviewChoicesHTML(question, showAllChoices, hideABCD) {
    const answer = question.Answer ? String(question.Answer).trim() : "";
    const isMultipleChoice = !getQuestionTypeMode(question).isIdent;
    let correctText = isMultipleChoice
      ? question[`Choice${answer.toUpperCase()}`] || answer
      : question.ChoiceA || answer;
    if (!correctText || correctText.toLowerCase() === "undefined") {
      correctText = "Answer missing from database";
    }

    if (isMultipleChoice && showAllChoices) {
      let choicesHTML = `<div class="mt-4 flex flex-col gap-2">`;
      ["A", "B", "C", "D", "E"].forEach((letter) => {
        const choiceText = question[`Choice${letter}`];
        if (!choiceText) return;
        const prefix = hideABCD ? "" : `${letter}. `;
        if (letter === answer.toUpperCase()) {
          choicesHTML += `
            <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-3 rounded-r-lg">
              <p class="text-sm font-bold text-green-700 dark:text-green-400">${prefix}${escapeHTML(choiceText)}</p>
            </div>`;
        } else {
          choicesHTML += `
            <div class="bg-gray-50 dark:bg-gray-800/50 border-l-4 border-gray-300 dark:border-gray-600 p-3 rounded-r-lg opacity-70">
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">${prefix}${escapeHTML(choiceText)}</p>
            </div>`;
        }
      });
      return `${choicesHTML}</div>`;
    }

    const prefix = hideABCD
      ? ""
      : isMultipleChoice
        ? `${answer.toUpperCase()}. `
        : "";
    return `
      <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-3 rounded-r-lg mt-4">
        <p class="text-sm font-bold text-green-700 dark:text-green-400">
          ${prefix}${escapeHTML(correctText)}
        </p>
      </div>`;
  }

  function updateQuestionChoices(
    questionId = null,
    questions = currentReviewQuestions,
  ) {
    const container =
      reviewContainerElement ||
      (reviewContainerElement = document.getElementById("deck-review-cards"));
    if (!container) return false;

    const questionsById = new Map(
      questions.map((question) => [
        String(question.ID),
        question,
      ]),
    );
    const globalShowWrong = state.prefs.showWrongChoices !== false;
    const hideABCD = state.prefs.hideABCD === true;
    const cards = container.querySelectorAll(".review-question-card");
    const scrollContainer =
      reviewMainElement || document.querySelector("main");
    const scrollTop = scrollContainer?.scrollTop;

    cards.forEach((card) => {
      const id = String(card.dataset.questionId || "");
      if (questionId !== null && id !== String(questionId)) return;
      const question = questionsById.get(id);
      if (!question || getQuestionTypeMode(question).isIdent) return;

      const showAllChoices =
        state.prefs.qToggles?.[id] === undefined
          ? globalShowWrong
          : Boolean(state.prefs.qToggles[id]);
      const choices = card.querySelector("[data-review-choices]");
      if (choices) {
        choices.innerHTML = buildReviewChoicesHTML(
          question,
          showAllChoices,
          hideABCD,
        );
      }

      const toggle = card.querySelector("[data-review-choice-toggle]");
      if (toggle) {
        toggle.innerHTML = showAllChoices
          ? '<i class="fa-solid fa-eye-slash mr-1"></i> Hide Choices'
          : '<i class="fa-solid fa-eye mr-1"></i> Show Choices';
      }
    });

    if (scrollContainer && Number.isFinite(scrollTop)) {
      scrollContainer.scrollTop = scrollTop;
    }
    updateStudyProgressIndicator();
    return true;
  }

  function updateStudyProgressIndicator() {
    const text = document.getElementById("study-progress-text");
    const bar = document.getElementById("study-progress");
    const track = document.getElementById("study-progress-track");
    if (!text || !bar || !track) return;

    const progress = state?.prefs?.studyProgress?.[currentReviewSubject] || {};
    const reviewQuestions =
      derivedQuestionsCache?.questions === currentReviewQuestions
        ? derivedQuestionsCache.sortedQuestions
        : currentReviewQuestions;
    const total = reviewQuestions.length;
    const layout = state.prefs.studyLayout || "scroll";
    const pageSize = state.prefs.studyPageSize || 10;
    const questionIndexById = new Map(
      reviewQuestions.map((question, index) => [
        String(question.ID),
        index,
      ]),
    );
    let viewQuestionCount = 0;
    if (total > 0) {
      if (layout === "single") {
        viewQuestionCount = 1;
      } else if (pageSize === "All") {
        viewQuestionCount = total;
      } else {
        const totalPages = Math.ceil(total / pageSize);
        const page = Math.min(totalPages, Math.max(1, progress.page || 1));
        viewQuestionCount = Math.min(pageSize, total - (page - 1) * pageSize);
      }
    }
    let current =
      total > 0
        ? Math.min(total, Math.max(1, (progress.index || 0) + 1))
        : 0;
    let label = `0 / ${total}`;

    if (total > 0) {
      const container = reviewContainerElement;
      const viewport = reviewMainElement?.getBoundingClientRect();
      const viewportTop = viewport?.top ?? 0;
      const viewportBottom = viewport?.bottom ?? window.innerHeight;
      const visibleCards = Array.from(
        container?.querySelectorAll(".review-question-card") || [],
      ).filter((card) => {
        const bounds = card.getBoundingClientRect();
        return bounds.bottom > viewportTop && bounds.top < viewportBottom;
      });
      const visibleCard =
        visibleCards.find(
          (card) => card.getBoundingClientRect().top <= viewportTop + 1,
        ) || visibleCards[0];
      const questionId = String(visibleCard?.dataset.questionId || "");
      const visibleIndex = questionIndexById.get(questionId);

      if (Number.isSafeInteger(visibleIndex)) {
        progress.index = visibleIndex;
        progress.questionId = questionId;
        markStudyProgressChanged(progress);
        current = visibleIndex + 1;

        if (
          !progress.questionScrollOffsets ||
          typeof progress.questionScrollOffsets !== "object" ||
          Array.isArray(progress.questionScrollOffsets)
        ) {
          progress.questionScrollOffsets = {};
        }
        progress.questionScrollOffsets = {
          ...progress.questionScrollOffsets,
          [questionId]: Math.round(
            visibleCard.getBoundingClientRect().top - viewportTop,
          ),
        };
      } else if (layout === "single") {
        current = Math.min(total, Math.max(1, (progress.index || 0) + 1));
      }

      if (layout === "single") {
        label = `Question ${current} / ${total}`;
      } else if (pageSize !== "All") {
        const totalPages = Math.ceil(total / pageSize);
        const page = Math.min(totalPages, Math.max(1, progress.page || 1));
        const start = (page - 1) * pageSize + 1;
        const end = Math.min(total, page * pageSize);
        const questionLabel =
          viewQuestionCount === 1 ? "Question" : "Questions";
        label = `${questionLabel} ${start} - ${end} / ${total}`;
      } else {
        const questionLabel =
          viewQuestionCount === 1 ? "Question" : "Questions";
        label = `${questionLabel} ${current} / ${total}`;
      }
    }

    const percent = total > 0 ? (current / total) * 100 : 0;
    text.textContent = label;
    bar.style.width = `${percent}%`;
    track.setAttribute("aria-valuenow", String(Math.round(percent)));
  }

  function renderDeckReviewImplementation(
    subject,
    questions,
    isVirtualScroll = false,
  ) {
    currentReviewSubject = subject;
    currentReviewQuestions = questions;

    const container =
      reviewContainerElement ||
      (reviewContainerElement = document.getElementById("deck-review-cards"));
    const titleElement = document.getElementById("deck-review-title");
    if (titleElement) {
      titleElement.textContent = getShortSubjectLabel(subject, "General");
    }
    const parentElement = document.getElementById("deck-review-parent");
    if (parentElement) {
      const subjectParts = String(subject ?? "")
        .split("::")
        .map((part) => part.trim())
        .filter(Boolean);
      parentElement.textContent = subjectParts.at(-2) || "";
      parentElement.hidden = subjectParts.length < 2;
    }
    if (!reviewMainElement && typeof document !== "undefined") {
      reviewMainElement = document.querySelector("main");
    }
    if (reviewMainElement && container && !isVirtualScroll) {
      cachedReviewContainerTop =
        reviewMainElement === container ? 0 : container.offsetTop;
    }

    const globalShowWrong = state.prefs.showWrongChoices !== false;
    const showExplanations = state.prefs.studyShowExplanations !== false;
    const hideABCD = state.prefs.hideABCD === true;
    let layout = state.prefs.studyLayout || "scroll";
    let pageSize = state.prefs.studyPageSize || 10;
    const reviewNavigationPosition = getStudyNavigationPosition(layout);

    if (!state.prefs.studyProgress[subject]) {
      state.prefs.studyProgress[subject] = {
        page: 1,
        index: 0,
        scrollY: 0,
        updatedAt: Date.now(),
      };
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
      if (studyFilterMode === "favorites") {
        sortedQuestions = filteredQuestions;
      } else if (favoriteQuestions.size > 0) {
        const favoriteFirst = [];
        const regular = [];
        for (const question of filteredQuestions) {
          (favoriteQuestions.has(question.ID) ? favoriteFirst : regular).push(
            question,
          );
        }
        sortedQuestions = favoriteFirst.concat(regular);
      } else {
        sortedQuestions = filteredQuestions;
      }
      derivedQuestionsCache = {
        questions,
        filterMode: studyFilterMode,
        favoriteSignature,
        filteredQuestions,
        sortedQuestions,
        questionIndexById: new Map(
          sortedQuestions.map((question, index) => [
            String(question.ID),
            index,
          ]),
        ),
      };
    }

    const questionIndexById = derivedQuestionsCache.questionIndexById;
    const savedQuestionIndex = questionIndexById.get(
      String(progress.questionId || ""),
    );
    if (Number.isSafeInteger(savedQuestionIndex)) {
      currentIndex = savedQuestionIndex;
      progress.index = savedQuestionIndex;
      if (layout !== "single" && pageSize !== "All") {
        currentPage = Math.floor(savedQuestionIndex / pageSize) + 1;
        progress.page = currentPage;
      }
    } else if (progress.questionId) {
      delete progress.questionId;
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
      updateStudyProgressIndicator();
      return;
    }

    if (questions.length === 0) {
      container.innerHTML =
        html +
        `<div class="text-center p-8 text-gray-500">No questions found for this deck.</div>`;
      navigate("deck-review");
      updateStudyProgressIndicator();
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

      displayQuestions = [sortedQuestions[currentIndex]];
    } else {
      if (pageSize === "All") {
        const main = reviewMainElement;
        const containerTop = cachedReviewContainerTop;
        const viewportTop =
          !isVirtualScroll && Number.isSafeInteger(savedQuestionIndex)
            ? savedQuestionIndex * REVIEW_ESTIMATED_CARD_HEIGHT
            : Math.max(0, (main?.scrollTop || 0) - containerTop);
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
        displayQuestions = sortedQuestions.slice(
          virtualStartIndex,
          virtualEndIndex,
        );
      } else {
        totalPages = Math.ceil(filteredQuestions.length / pageSize);
        if (currentPage < 1) currentPage = 1;
        if (currentPage > totalPages) currentPage = totalPages;
        progress.page = currentPage;

        let start = (currentPage - 1) * pageSize;
        displayQuestions = sortedQuestions.slice(start, start + pageSize);
      }
    }

    const virtualRenderKey = `${subject}|${layout}|${pageSize}|${virtualStartIndex}|${virtualEndIndex}`;
    if (
      isVirtualScroll &&
      pageSize === "All" &&
      lastVirtualRenderKey === virtualRenderKey
    ) {
      return;
    }
    lastVirtualRenderKey = pageSize === "All" ? virtualRenderKey : null;

    const pageCount = document.getElementById("review-page-count");
    const pageSizeInput = document.getElementById("review-page-size-input");
    if (pageSizeInput) pageSizeInput.value = pageSize === "All" ? "" : pageSize;
    if (pageCount)
      pageCount.innerText = pageSize === "All" ? "1" : Math.max(1, totalPages);

    let navigationHTML = "";
    if (layout === "single") {
      navigationHTML = `
        <div class="flex justify-between items-center {{navigation-placement}} p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 gap-2">
            <button onclick="changeStudyIndex(-1)" ${currentIndex === 0 ? "disabled" : ""} class="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-600 transition-colors">
                <i class="fa-solid fa-arrow-left"></i> <span class="hidden sm:inline ml-1">Previous</span>
            </button>
          <span data-review-card-count class="text-sm font-bold text-gray-600 dark:text-gray-300 flex-1 text-center">Card ${currentIndex + 1} / ${sortedQuestions.length}</span>
          <button onclick="changeStudyIndex(1)" ${currentIndex === sortedQuestions.length - 1 ? "disabled" : ""} class="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-600 transition-colors">
                <span class="hidden sm:inline mr-1">Next</span> <i class="fa-solid fa-arrow-right"></i>
            </button>
        </div>
    `;
    } else if (pageSize !== "All" && totalPages > 1) {
      navigationHTML = `
            <div class="flex justify-between items-center {{navigation-placement}} p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 gap-2">
                <button onclick="changeStudyPage(-1)" class="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-600 transition-colors">
                    <i class="fa-solid fa-arrow-left"></i> <span class="hidden sm:inline ml-1">Previous</span>
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
                <button onclick="changeStudyPage(1)" ${currentPage === totalPages ? "disabled" : ""} class="px-4 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-600 transition-colors">
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
    const renderNavigation = (placement) =>
      navigationHTML.replace(
        "{{navigation-placement}}",
        placement === "top"
          ? "mb-6 sticky top-4 z-20"
          : "mt-6",
      );

    if (showTopNavigation) html += renderNavigation("top");

    if (pageSize === "All" && virtualStartIndex > 0) {
      html += `<div aria-hidden="true" style="height: ${virtualStartIndex * REVIEW_ESTIMATED_CARD_HEIGHT}px"></div>`;
    }

    const passwordProtectedCache = new Map();
    function getIsProtected(subj) {
      if (!passwordProtectedCache.has(subj)) {
        passwordProtectedCache.set(subj, isDeckPasswordProtected(subj));
      }
      return passwordProtectedCache.get(subj);
    }

    displayQuestions.forEach((q, displayIndex) => {
      const originalIndex =
        questionIndexById.get(String(q.ID)) ?? displayIndex;
      const isQuestionFavorite = favoriteQuestions.has(q.ID);

      let rawQuestionText = q.Question ? String(q.Question) : "";
      let cleanQuestionText = rawQuestionText.replace(/^\s*\d+\.\s*/, "");
      const imageUrl = String(q.ImageURL || "").trim();
      const imageHTML =
        imageUrl &&
        typeof globalScope.isSafeImageURL === "function" &&
        globalScope.isSafeImageURL(imageUrl)
          ? `<img src="${escapeHTML(imageUrl)}" alt="${escapeHTML(cleanQuestionText)}" loading="lazy" decoding="async" class="block w-full max-w-2xl max-h-96 object-contain rounded-lg mt-3 mb-4">`
          : "";

      const isMultipleChoice = !getQuestionTypeMode(q).isIdent;

      let showWrongForThisQ = state.prefs.qToggles?.[q.ID];
      if (showWrongForThisQ === undefined) showWrongForThisQ = globalShowWrong;

      const choicesHTML = buildReviewChoicesHTML(
        q,
        Boolean(showWrongForThisQ),
        hideABCD,
      );

      html += `
            <div data-question-id="${escapeHTML(String(q.ID))}" data-review-index="${originalIndex}" class="review-question-card bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
                    <span class="bg-brand-50 text-brand-600 text-xs px-2 py-1 rounded font-bold dark:bg-brand-900/30 dark:text-white">Question ${originalIndex + 1}</span>

                    <div class="flex gap-2 items-center">
                        <!-- Feature 16: Individual Toggle Button -->
                        ${
                          isMultipleChoice
                            ? `<button data-review-choice-toggle onclick="toggleSpecificChoices('${encodeHandlerValue(q.ID)}')" class="text-xs font-bold px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors">
                          ${showWrongForThisQ ? '<i class="fa-solid fa-eye-slash mr-1"></i> Hide Choices' : '<i class="fa-solid fa-eye mr-1"></i> Show Choices'}
                        </button>`
                            : ""
                        }

                        <button onclick="event.stopPropagation(); toggleQuestionFavorite('${encodeHandlerValue(q.ID)}')" class="${isQuestionFavorite ? "text-yellow-500" : "text-gray-400 hover:text-yellow-500"} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm active:scale-95 transition-all" title="${isQuestionFavorite ? "Remove from Favorites" : "Add to Favorites"}">
                            <i class="fa-solid fa-star"></i>
                        </button>

                    </div>
                </div>

                <p class="user-text-content font-medium text-gray-800 dark:text-gray-100 mb-2 text-lg">${formatQuestionText(cleanQuestionText)}</p>

                ${imageHTML}

                <div data-review-choices>${choicesHTML}</div>

                ${
                  showExplanations &&
                  q.Explanation &&
                  q.Explanation.trim() !== ""
                    ? `
                    <div class="user-text-content mt-4 text-sm text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-gray-900/50 p-3 rounded-lg border border-blue-100 dark:border-gray-700">
                        <strong class="text-blue-800 dark:text-blue-400"><i class="fa-solid fa-lightbulb mr-1"></i> Explanation:</strong>
                        <div class="mt-2 leading-relaxed">${formatQuestionText(q.Explanation)}</div>
                    </div>
                `
                    : ""
                }
            </div>
        `;
    });

    if (showBottomNavigation) html += renderNavigation("bottom");

    if (pageSize === "All" && virtualEndIndex < filteredQuestions.length) {
      html += `<div aria-hidden="true" style="height: ${(filteredQuestions.length - virtualEndIndex) * REVIEW_ESTIMATED_CARD_HEIGHT}px"></div>`;
    }

    if (pageSize === "All") {
      const template = document.createElement("template");
      template.innerHTML = html;

      const fragment = document.createDocumentFragment();
      const existingCards = new Map(
        Array.from(container.querySelectorAll(".review-question-card"))
          .filter((card) => card.dataset.questionId)
          .map((card) => [card.dataset.questionId, card]),
      );

      Array.from(template.content.childNodes).forEach((node) => {
        if (!(node instanceof Element)) {
          fragment.appendChild(node.cloneNode(true));
          return;
        }

        const questionId = node.dataset.questionId;
        if (questionId && existingCards.has(questionId)) {
          const existingCard = existingCards.get(questionId);
          existingCard.replaceWith(node);
        }
        fragment.appendChild(node);
      });

      container.replaceChildren(fragment);
    } else if (layout === "single") {
      const host = document.createElement("div");
      host.innerHTML = html;
      const currentCard = container.querySelector(".review-question-card");
      const nextCard = host.querySelector(".review-question-card");

      if (currentCard && nextCard) {
        currentCard.dataset.questionId = nextCard.dataset.questionId;
        currentCard.dataset.reviewIndex = nextCard.dataset.reviewIndex;
        currentCard.replaceChildren(...Array.from(nextCard.childNodes));

        container
          .querySelectorAll("[data-review-card-count]")
          .forEach((count) => {
            count.textContent = `Card ${currentIndex + 1} / ${sortedQuestions.length}`;
          });
        container
          .querySelectorAll('button[onclick="changeStudyIndex(-1)"]')
          .forEach((button) => {
            button.disabled = currentIndex === 0;
          });
        container
          .querySelectorAll('button[onclick="changeStudyIndex(1)"]')
          .forEach((button) => {
            button.disabled = currentIndex === sortedQuestions.length - 1;
          });
      } else {
        const fragment = document.createDocumentFragment();
        Array.from(host.childNodes).forEach((node) =>
          fragment.appendChild(node),
        );
        container.replaceChildren(fragment);
      }
    } else {
      const fragment = document.createDocumentFragment();
      const host = document.createElement("div");
      host.innerHTML = html;
      Array.from(host.childNodes).forEach((node) => fragment.appendChild(node));
      container.replaceChildren(fragment);
    }
    const navigation = navigate("deck-review");
    updateStudyProgressIndicator();

    if (!isVirtualScroll) {
      const requestedScrollPosition = pendingReviewScrollPosition;
      pendingReviewScrollPosition = null;
      if (
        reviewMainElement &&
        layout === "scroll" &&
        requestedScrollPosition
      ) {
        const restoreScrollPosition = () => {
          const scrollContainer = scrollReviewContent(
            requestedScrollPosition,
          );
          if (scrollContainer) {
            progress.scrollY = scrollContainer.scrollTop;
          }
          updateStudyProgressIndicator();
          saveState("prefs");
        };
        if (navigation && typeof navigation.then === "function") {
          navigation.then(restoreScrollPosition);
        } else {
          restoreScrollPosition();
        }
      } else if (
        reviewMainElement &&
        layout === "scroll" &&
        (progress.questionId || progress.scrollY)
      ) {
        const restoreScrollPosition = () =>
          requestAnimationFrame(() => {
            const questionCard = progress.questionId
              ? Array.from(
                  container.querySelectorAll(".review-question-card"),
                ).find(
                  (card) =>
                    String(card.dataset.questionId) ===
                    String(progress.questionId),
                )
              : null;
            const questionOffset =
              progress.questionScrollOffsets?.[progress.questionId];
            if (
              reviewMainElement &&
              questionCard &&
              Number.isFinite(questionOffset)
            ) {
              const mainTop = reviewMainElement.getBoundingClientRect().top;
              const cardTop = questionCard.getBoundingClientRect().top;
              reviewMainElement.scrollTop +=
                cardTop - mainTop - questionOffset;
            } else if (reviewMainElement) {
              reviewMainElement.scrollTop = progress.scrollY || 0;
            }
            updateStudyProgressIndicator();
          });
        if (navigation && typeof navigation.then === "function") {
          navigation.then(restoreScrollPosition);
        } else {
          restoreScrollPosition();
        }
      }
      if (typeof applyTitleMode === "function") applyTitleMode();
    }
  }

  if (typeof globalThis !== "undefined") {
  }

  function renderDeckReview(subject, questions, isVirtualScroll = false) {
    currentReviewSubject = subject;
    currentReviewQuestions = Array.isArray(questions) ? questions : [];

    return renderDeckReviewImplementation(
      subject,
      currentReviewQuestions,
      isVirtualScroll,
    );
  }

  function scrollReviewContent(position) {
    const main = reviewMainElement;
    const mainIsScrollable =
      main && main.scrollHeight > main.clientHeight + 1;
    const scrollContainer = mainIsScrollable
      ? main
      : document.scrollingElement || document.documentElement || document.body;
    if (!scrollContainer) return null;

    const top =
      position === "bottom"
        ? Math.max(
            0,
            scrollContainer.scrollHeight - scrollContainer.clientHeight,
          )
        : 0;
    const previousScrollBehavior = scrollContainer.style.scrollBehavior;
    scrollContainer.style.scrollBehavior = "auto";
    scrollContainer.scrollTop = top;
    scrollContainer.style.scrollBehavior = previousScrollBehavior;
    return scrollContainer;
  }

  function getOrderedReviewQuestions() {
    return derivedQuestionsCache?.questions === currentReviewQuestions
      ? derivedQuestionsCache.sortedQuestions
      : currentReviewQuestions;
  }

  function markStudyProgressChanged(progress) {
    if (progress && typeof progress === "object") {
      progress.updatedAt = Date.now();
    }
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
        updatedAt: Date.now(),
      };
    }
    saveState();
    reRenderDeckReview();
  }

  function changeStudyPageSize(size) {
    const pageSizeInput = document.getElementById("review-page-size-input");
    const normalizedSize =
      size === "" ? 10 : size === "All" ? "All" : Number(size);
    if (
      normalizedSize !== "All" &&
      (!Number.isSafeInteger(normalizedSize) || normalizedSize < 1)
    ) {
      if (pageSizeInput) {
        pageSizeInput.setCustomValidity(
          "Enter a positive whole number of items per page.",
        );
        pageSizeInput.reportValidity();
      }
      return false;
    }
    if (pageSizeInput) pageSizeInput.setCustomValidity("");

    state.prefs.studyPageSize = normalizedSize;
    if (state.prefs.studyProgress[currentReviewSubject]) {
      state.prefs.studyProgress[currentReviewSubject].page = 1;
      markStudyProgressChanged(
        state.prefs.studyProgress[currentReviewSubject],
      );
    }
    saveState();
    reRenderDeckReview();
    return true;
  }

  function changeStudyPage(delta) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    if (!progress) return;
    const currentPage = progress.page || 1;
    if (delta < 0 && currentPage <= 1) {
      void returnFromStudyMode();
      return;
    }
    const nextPage = Math.max(1, currentPage + delta);
    if (nextPage === currentPage) return;
    progress.page = nextPage;
    const pageSize = state.prefs.studyPageSize || 10;
    if (pageSize !== "All") {
      const targetQuestion =
        getOrderedReviewQuestions()[(nextPage - 1) * pageSize];
      if (targetQuestion) {
        progress.index = (nextPage - 1) * pageSize;
        progress.questionId = String(targetQuestion.ID);
      }
    }
    if (typeof window !== "undefined") clearTimeout(window.scrollSaveTimeout);
    progress.scrollY = 0;
    markStudyProgressChanged(progress);
    pendingReviewScrollPosition = delta > 0 ? "top" : "bottom";
    saveState("prefs");
    reRenderDeckReview();
  }

  async function returnFromStudyMode() {
    const confirmed = await globalScope.requestConfirmation?.(
      "Do you want to return to the Main Menu? Your study progress will be saved.",
      "Return to Main Menu",
    );
    if (!confirmed) return false;

    updateStudyProgressIndicator();
    const progress = state.prefs.studyProgress[currentReviewSubject];
    if (progress && reviewMainElement) {
      progress.scrollY = reviewMainElement.scrollTop;
      markStudyProgressChanged(progress);
    }
    const saved = await saveState("prefs");
    if (saved === false) {
      globalScope.showToast?.(
        "Your study progress could not be saved. Please try again.",
        "error",
      );
      return false;
    }

    if (typeof globalScope.navigate === "function") {
      return globalScope.navigate("dashboard");
    }
    return false;
  }

  function changeStudyIndex(delta) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    if (!progress) return;
    const orderedQuestions = getOrderedReviewQuestions();
    const maxIndex = Math.max(0, orderedQuestions.length - 1);
    progress.index = Math.max(
      0,
      Math.min(maxIndex, (progress.index || 0) + delta),
    );
    const targetQuestion = orderedQuestions[progress.index];
    if (targetQuestion) {
      progress.questionId = String(targetQuestion.ID);
    }
    markStudyProgressChanged(progress);
    renderDeckReview(currentReviewSubject, currentReviewQuestions);
    saveState("prefs");
  }

  function jumpToStudyPage(pageNumber) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    const page = parseInt(pageNumber, 10);
    if (!progress || Number.isNaN(page)) return;
    progress.page = Math.max(1, page);
    const pageSize = state.prefs.studyPageSize || 10;
    if (pageSize !== "All") {
      const targetIndex = (progress.page - 1) * pageSize;
      const targetQuestion = getOrderedReviewQuestions()[targetIndex];
      if (targetQuestion) {
        progress.index = targetIndex;
        progress.questionId = String(targetQuestion.ID);
      }
    }
    if (typeof window !== "undefined") clearTimeout(window.scrollSaveTimeout);
    progress.scrollY = 0;
    markStudyProgressChanged(progress);
    pendingReviewScrollPosition = "top";
    saveState("prefs");
    reRenderDeckReview();
  }

  function cleanup() {
    if (reviewRenderFrame !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(reviewRenderFrame);
      }
      lifecycle.clearTimeout(reviewRenderFrame);
      reviewRenderFrame = null;
    }
    if (virtualReviewScrollFrame !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(virtualReviewScrollFrame);
      }
      lifecycle.clearTimeout(virtualReviewScrollFrame);
      virtualReviewScrollFrame = null;
    }
  }

  // ===================== MODULE EXPORT =====================
  const DeckReviewCore = {
    renderDeckReview,
    reRenderDeckReview,
    updateQuestionChoices,
    updateStudyProgressIndicator,
    scheduleVirtualReviewRender,
    changeStudyLayout,
    changeStudyPageSize,
    changeStudyPage,
    changeStudyIndex,
    jumpToStudyPage,
    returnFromStudyMode,
    cleanup,
    renderDeckReviewImplementation,
    // Expose state accessors
    getCurrentReviewSubject: () => currentReviewSubject,
    getCurrentReviewQuestions: () => currentReviewQuestions,
  };

  globalScope.LifecycleUtils?.registerCleanup(cleanup);

  // Export to global scope
  globalScope.DeckReviewCore = DeckReviewCore;

  // Export individual functions for backward compatibility
  globalScope.renderDeckReview = renderDeckReview;
  globalScope.reRenderDeckReview = reRenderDeckReview;
  globalScope.updateStudyProgressIndicator = updateStudyProgressIndicator;
  globalScope.scheduleVirtualReviewRender = scheduleVirtualReviewRender;
  globalScope.changeStudyLayout = changeStudyLayout;
  globalScope.changeStudyPageSize = changeStudyPageSize;
  globalScope.changeStudyPage = changeStudyPage;
  globalScope.changeStudyIndex = changeStudyIndex;
  globalScope.jumpToStudyPage = jumpToStudyPage;
  globalScope.returnFromStudyMode = returnFromStudyMode;

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
