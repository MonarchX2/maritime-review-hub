(function (globalScope) {
  const CHOICE_KEYS = ["A", "B", "C", "D"];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const preloadedImageUrls = new Set();
  const elementCache = new Map();
  let choiceButtonsCache = null;
  let choiceHandlerBoundTo = null;
  let timerAnimationFrame = 0;
  let sessionSaveTimer = 0;
  let sessionSaveRequested = false;

  function getElement(id) {
    if (typeof document === "undefined") return null;
    const cached = elementCache.get(id);
    if (cached && cached.isConnected) return cached;

    const element = document.getElementById(id);
    if (element) elementCache.set(id, element);
    else elementCache.delete(id);
    return element;
  }

  function hasDOM() {
    return typeof document !== "undefined";
  }

  function getChoiceButtons() {
    if (!hasDOM()) return [];
    if (
      choiceButtonsCache &&
      choiceButtonsCache.length > 0 &&
      choiceButtonsCache.every((button) => button.isConnected)
    ) {
      return choiceButtonsCache;
    }
    choiceButtonsCache = Array.from(
      document.querySelectorAll(".choice-btn[data-choice]"),
    );
    return choiceButtonsCache;
  }

  function ensureChoiceHandler() {
    const container = getElement("q-choices");
    if (!container) return;
    if (choiceHandlerBoundTo === container) return;

    choiceHandlerBoundTo?.removeEventListener(
      "click",
      handleChoiceContainerClick,
    );
    choiceHandlerBoundTo = container;
    container.addEventListener("click", handleChoiceContainerClick);
  }

  function handleChoiceContainerClick(event) {
    const button = event.target?.closest?.(".choice-btn[data-choice]");
    if (!button || !choiceHandlerBoundTo?.contains(button)) return;

    const session = getSession();
    if (!session?.active) return;

    const q = getCurrentQuestion();
    const selectedKey = normalizeAnswer(button.dataset.choice);
    const correctKey = normalizeAnswer(q?.Answer);
    submitPracticeAnswer(selectedKey, correctKey);
  }

  function getState() {
    return globalScope.state || {};
  }

  function getPrefs() {
    const state = getState();
    return state.prefs || {};
  }

  function getStats() {
    const state = getState();
    return state.stats || {};
  }

  function getSession() {
    const state = getState();
    return state.session || null;
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function normalizeAnswer(value) {
    const answer = normalizeText(value).toUpperCase();
    return CHOICE_KEYS.includes(answer) ? answer : "";
  }

  function isUsableChoice(value) {
    const text = normalizeText(value);
    return (
      text !== "" &&
      text.toLowerCase() !== "undefined" &&
      text.toLowerCase() !== "null"
    );
  }

  function getValidChoices(question) {
    return CHOICE_KEYS.map((key) => question?.[`Choice${key}`])
      .filter(isUsableChoice)
      .map(normalizeText);
  }

  function getChoiceText(question, answer) {
    const key = normalizeAnswer(answer);
    return key ? normalizeText(question?.[`Choice${key}`]) : "";
  }

  function getCurrentQuestion() {
    const session = getSession();
    if (!session || !Array.isArray(session.questions)) return null;
    const index = Number.isInteger(session.currentIndex)
      ? session.currentIndex
      : -1;
    return index >= 0 && index < session.questions.length
      ? session.questions[index]
      : null;
  }

  function safeClearAutoNextTimeout() {
    const session = getSession();
    if (session?.autoNextTimeout) {
      clearTimeout(session.autoNextTimeout);
      session.autoNextTimeout = null;
    }
  }

  function stopTimerSafely() {
    if (typeof globalScope.stopVisualTimer === "function") {
      globalScope.stopVisualTimer();
    }
  }

  function startTimerSafely() {
    if (typeof globalScope.startVisualTimer === "function") {
      globalScope.startVisualTimer();
    }
  }

  function prepareSessionPool(pool) {
    const sourcePool = Array.isArray(pool) ? pool.filter(Boolean) : [];
    const prefs = getPrefs();
    const stats = getStats();
    const mistakes = Array.isArray(stats.mistakes) ? stats.mistakes : [];
    let randomizedPool = [...sourcePool];

    if (
      prefs.shuffleQuestions !== false &&
      typeof globalScope.shuffleArray === "function"
    ) {
      randomizedPool = globalScope.shuffleArray(randomizedPool);
    }

    // Do not use Math.random() inside Array.sort(): a non-deterministic comparator
    // violates the comparator contract and can produce inconsistent ordering.
    // Keep the existing random order, then move mistakes ahead in one stable pass.
    const mistakeSet = new Set(mistakes);
    const mistakesFirst = [];
    const others = [];
    randomizedPool.forEach((question) => {
      if (mistakeSet.has(question?.ID)) mistakesFirst.push(question);
      else others.push(question);
    });
    randomizedPool = mistakesFirst.concat(others);

    return randomizedPool.map((originalQ) => {
      const q = { ...originalQ };
      const originalAnswer = normalizeText(originalQ?.Answer);
      const originalAnswerKey = normalizeAnswer(originalAnswer);
      const originalCorrectText = originalAnswerKey
        ? getChoiceText(originalQ, originalAnswerKey)
        : originalAnswer;
      let validChoices = getValidChoices(originalQ);

      if (
        prefs.shuffleChoices !== false &&
        typeof globalScope.shuffleArray === "function"
      ) {
        validChoices = globalScope.shuffleArray(validChoices);
      }

      for (let i = 0; i < CHOICE_KEYS.length; i++) {
        q[`Choice${CHOICE_KEYS[i]}`] = validChoices[i] || "";
      }

      const normalizedCorrect =
        normalizeText(originalCorrectText).toLowerCase();
      let matchingIndex = -1;
      if (normalizedCorrect) {
        for (let i = 0; i < validChoices.length; i++) {
          if (
            normalizeText(validChoices[i]).toLowerCase() === normalizedCorrect
          ) {
            matchingIndex = i;
            break;
          }
        }
      }

      if (matchingIndex >= 0 && matchingIndex < CHOICE_KEYS.length) {
        q.Answer = CHOICE_KEYS[matchingIndex];
        delete q._invalidAnswer;
      } else if (originalAnswerKey && validChoices.length === 0) {
        q.Answer = originalAnswerKey;
        delete q._invalidAnswer;
      } else if (originalAnswer && validChoices.length === 0) {
        q.Answer = originalAnswer;
        delete q._invalidAnswer;
      } else {
        q.Answer = "";
        q._invalidAnswer = true;
      }

      return q;
    });
  }

  function initSession() {
    const filterEl = getElement("filter-subject");
    const state = getState();
    const stats = getStats();
    if (!filterEl || !Array.isArray(state.db)) {
      console.error(
        "Cannot start session: quiz filter or question database is unavailable.",
      );
      return;
    }

    const filterVal = normalizeText(filterEl.value);
    let pool;
    const mistakes = Array.isArray(stats.mistakes) ? stats.mistakes : [];

    if (filterVal === "MISTAKES") {
      const mistakeSet = new Set(mistakes);
      pool = state.db.filter((q) => mistakeSet.has(q?.ID));
    } else if (filterVal.startsWith("SUBJ:")) {
      const subj = filterVal.slice(5);
      pool =
        typeof globalScope.getQuestionsForSubject === "function"
          ? globalScope.getQuestionsForSubject(subj)
          : state.db.filter((q) => q?.Subject === subj);
    } else if (filterVal.startsWith("TAG:")) {
      const tag = filterVal.slice(4);
      pool = state.db.filter((q) => {
        if (Array.isArray(q?.Tags)) return q.Tags.includes(tag);
        return normalizeText(q?.Tags)
          .split(",")
          .map((item) => item.trim())
          .includes(tag);
      });
    } else {
      pool = state.db;
    }

    if (!Array.isArray(pool) || pool.length === 0) {
      if (typeof alert === "function")
        alert("No questions found for this filter.");
      return;
    }

    const preparedPool = prepareSessionPool(pool);
    if (preparedPool.length === 0) {
      if (typeof alert === "function")
        alert("No usable questions found for this filter.");
      return;
    }

    safeClearAutoNextTimeout();
    stopTimerSafely();

    state.session = {
      active: true,
      questions: preparedPool,
      currentIndex: 0,
      userAnswers: {},
      identificationRatings: {},
      mode: "quiz",
      revealedCloze: false,
      autoNextTimeout: null,
    };

    getElement("session-setup")?.classList.add("hidden");
    getElement("session-active")?.classList.remove("hidden");

    renderQuestion();
    saveSessionProgress(true);
  }

  function renderQuestion() {
    const session = getSession();
    if (
      !session?.active ||
      !Array.isArray(session.questions) ||
      session.questions.length === 0
    ) {
      return;
    }

    const totalCards = session.questions.length;
    const rawIndex = Number.isInteger(session.currentIndex)
      ? session.currentIndex
      : 0;
    session.currentIndex = Math.min(Math.max(rawIndex, 0), totalCards - 1);

    const q = session.questions[session.currentIndex];
    if (!q) return;

    stopTimerSafely();
    if (typeof globalScope.applyNavigationPosition === "function") {
      globalScope.applyNavigationPosition();
    }

    ensureChoiceHandler();

    const userAnswer = session.userAnswers?.[session.currentIndex];
    const hasIdentificationRating = Object.prototype.hasOwnProperty.call(
      session.identificationRatings || {},
      session.currentIndex,
    );
    const userAnswerKey = normalizeAnswer(userAnswer);
    const correctKey = normalizeAnswer(q.Answer);
    const currentCard = session.currentIndex + 1;

    const progressText = getElement("session-progress-text");
    const progressBar = getElement("session-progress");
    if (progressText)
      progressText.textContent = `${currentCard} / ${totalCards}`;
    if (progressBar) {
      progressBar.style.width = `${(currentCard / totalCards) * 100}%`;
    }

    const fullSubject = normalizeText(q.Subject) || "General";
    const parts = fullSubject.split("::");
    const subjectEl = getElement("q-subject");
    if (subjectEl) {
      subjectEl.textContent =
        parts.length >= 2
          ? `${normalizeText(parts[parts.length - 2])} :: ${normalizeText(parts[parts.length - 1])}`
          : fullSubject;
    }

    let displayId = normalizeText(q.ID ?? `Q-${currentCard}`);
    if (displayId.includes("::")) {
      const match = displayId.match(/::.*?\b(\d+)\s*$/);
      displayId = match ? match[1] : displayId.split("::").pop().trim();
    }
    const idEl = getElement("q-id");
    if (idEl) idEl.textContent = `Question ${displayId}`;

    const typeEl = getElement("q-type");
    if (typeEl) {
      let qType = "MC";
      if (q.QuestionType) {
        qType =
          q.QuestionType === "ID"
            ? "ID"
            : q.QuestionType === "MX"
              ? "MX"
              : "MC";
      } else {
        let validChoicesCount = 0;
        for (const key of CHOICE_KEYS) {
          const choiceText = q[`Choice${key}`];
          if (
            choiceText &&
            String(choiceText).trim() !== "" &&
            String(choiceText).toLowerCase() !== "undefined"
          ) {
            validChoicesCount++;
          }
        }
        qType = validChoicesCount <= 1 ? "ID" : "MC";
      }
      typeEl.textContent = qType;
    }

    const favoriteQuestions = getPrefs().favoriteQuestions;
    const favBtn = getElement("btn-favorite-question");
    if (favBtn) {
      const isFavorite =
        Array.isArray(favoriteQuestions) && favoriteQuestions.includes(q.ID);
      favBtn.classList.toggle("text-yellow-500", isFavorite);
      favBtn.classList.toggle("text-gray-400", !isFavorite);
      favBtn.title = isFavorite ? "Remove from Favorites" : "Add to Favorites";
    }

    const lessonEl = getElement("q-lesson");
    if (lessonEl) {
      const lessonIdValue =
        q.Lesson ??
        q.LessonID ??
        q.lesson ??
        q.lessonId ??
        q.Unit ??
        q.Topic ??
        "";
      const normalizedLesson = normalizeText(lessonIdValue);
      lessonEl.textContent = normalizedLesson
        ? `Lesson ${normalizedLesson}`
        : "";
      lessonEl.classList.toggle("hidden", !normalizedLesson);
    }

    const prefs = getPrefs();
    const clozeEnabled = prefs.clozeEnabled !== false;
    const shouldRevealCloze =
      Boolean(userAnswer) || Boolean(session.revealedCloze);
    const qTextEl = getElement("q-text");
    if (qTextEl && typeof globalScope.formatQuestionText === "function") {
      qTextEl.innerHTML = globalScope.formatQuestionText(
        normalizeText(q.Question),
        {
          revealCloze: shouldRevealCloze && clozeEnabled,
          clozeEnabled,
        },
      );
    }

    const imgEl = getElement("q-image");
    const imageUrl = normalizeText(q.ImageURL);
    if (imgEl) {
      if (!imgEl.dataset.mrhHandlersBound) {
        imgEl.onload = () => imgEl.classList.remove("hidden");
        imgEl.onerror = () => {
          imgEl.removeAttribute("src");
          imgEl.classList.add("hidden");
        };
        imgEl.dataset.mrhHandlersBound = "1";
        imgEl.decoding = "async";
      }

      if (
        imageUrl &&
        typeof globalScope.isSafeImageURL === "function" &&
        globalScope.isSafeImageURL(imageUrl)
      ) {
        if (imgEl.getAttribute("src") !== imageUrl) {
          imgEl.src = imageUrl;
        }
        const questionText = normalizeText(q.Question);
        imgEl.alt = questionText
          ? `Reference for: ${questionText.slice(0, 50)}${questionText.length > 50 ? "..." : ""}`
          : "Question reference image";
        imgEl.classList.remove("hidden");
      } else {
        imgEl.removeAttribute("src");
        imgEl.classList.add("hidden");
      }
    }

    const typeMode =
      typeof globalScope.getQuestionTypeMode === "function"
        ? globalScope.getQuestionTypeMode(q) || {}
        : {};
    const isPureIdent = typeMode.isIdent === true;
    const isForcedMCQ = prefs.qTypeOverride === "mcq";
    const hideABCD = prefs.quizHideABCD === true || isPureIdent;

    const choiceButtons = getChoiceButtons();

    for (const btn of choiceButtons) {
      const choiceKey = normalizeAnswer(btn.dataset.choice);
      if (!choiceKey) continue;

      const choiceText = q[`Choice${choiceKey}`];
      let cleanChoice = normalizeText(choiceText);
      if (isForcedMCQ && cleanChoice === "") cleanChoice = "undefined";

      const shouldHide =
        !isForcedMCQ &&
        (cleanChoice === "" || cleanChoice.toLowerCase() === "undefined");

      btn.classList.remove("selected-correct", "selected-wrong", "dimmed");
      btn.classList.toggle("hidden", shouldHide);

      if (shouldHide) {
        btn.replaceChildren();
        continue;
      }

      const prefixRegex = new RegExp(`^${choiceKey}[\.\)\-]\s*`, "i");
      const displayText = cleanChoice.replace(prefixRegex, "");

      // Use text nodes rather than HTML parsing for choice text. The previous
      // implementation escaped HTML and then reparsed it with innerHTML.
      btn.replaceChildren();
      if (hideABCD) {
        btn.textContent = displayText;
      } else {
        const label = document.createElement("span");
        label.className = "choice-letter font-bold mr-2 whitespace-nowrap";
        label.textContent = `${choiceKey})`;
        btn.append(label, document.createTextNode(` ${displayText}`));
      }

      if (userAnswer) {
        if (correctKey && choiceKey === correctKey) {
          btn.classList.add("selected-correct");
          btn.classList.remove("hidden");
        } else if (isPureIdent) {
          btn.classList.add("hidden");
        } else if (choiceKey === userAnswerKey) {
          btn.classList.add("selected-wrong");
        } else {
          btn.classList.add("dimmed");
        }
      }
    }

    const qChoicesContainer = getElement("q-choices");
    const activeRecallMask = getElement("active-recall-mask");
    const expBox = getElement("q-explanation-box");
    const btnNext = getElement("btn-next");
    const btnPrev = getElement("btn-prev");
    const btnReveal = getElement("btn-reveal");
    const answerRating = getElement("answer-rating");
    const awaitingIdentificationRating =
      isPureIdent && userAnswer === "REVEALED" && !hasIdentificationRating;

    if (userAnswer) {
      activeRecallMask?.classList.add("hidden");
      qChoicesContainer?.classList.remove("hidden");
      showExplanation(q);
      if (btnNext) btnNext.disabled = awaitingIdentificationRating;
      if (btnReveal) btnReveal.disabled = true;
      answerRating?.classList.toggle("hidden", !awaitingIdentificationRating);
      answerRating?.classList.toggle("flex", awaitingIdentificationRating);
    } else {
      expBox?.classList.add("hidden");
      if (btnNext) btnNext.disabled = false;
      if (btnReveal) btnReveal.disabled = false;
      answerRating?.classList.add("hidden");
      answerRating?.classList.remove("flex");

      if (isPureIdent) {
        activeRecallMask?.classList.add("hidden");
        qChoicesContainer?.classList.add("hidden");
      } else if (Boolean(prefs.activeRecall)) {
        activeRecallMask?.classList.remove("hidden");
        qChoicesContainer?.classList.add("hidden");
      } else {
        activeRecallMask?.classList.add("hidden");
        qChoicesContainer?.classList.remove("hidden");
      }
    }

    if (btnPrev)
      btnPrev.disabled =
        session.currentIndex <= 0 || awaitingIdentificationRating;
    const activeRecallToggle = getElement("toggle-active-recall");
    const shuffleChoicesToggle = getElement("toggle-shuffle-choices");
    for (const [control, disabled] of [
      [activeRecallToggle, isPureIdent],
      [shuffleChoicesToggle, isPureIdent],
    ]) {
      if (!control) continue;
      control.disabled = disabled;
      const parent = control.parentElement;
      parent?.classList.toggle("opacity-50", disabled);
      parent?.classList.toggle("cursor-not-allowed", disabled);
      parent?.classList.toggle("pointer-events-none", disabled);
    }

    if (typeof Image === "function") {
      const nextIndex = session.currentIndex + 1;
      const limit = Math.min(session.questions.length, nextIndex + 2);
      for (let i = nextIndex; i < limit; i++) {
        const nextImageUrl = normalizeText(session.questions[i]?.ImageURL);
        if (!nextImageUrl || preloadedImageUrls.has(nextImageUrl)) continue;
        preloadedImageUrls.add(nextImageUrl);
        const imgPreload = new Image();
        imgPreload.decoding = "async";
        imgPreload.src = nextImageUrl;
      }
    }
  }

  function submitPracticeAnswer(selected, correct) {
    const session = getSession();
    const q = getCurrentQuestion();
    const selectedKey = normalizeAnswer(selected);
    const correctKey = normalizeAnswer(correct ?? q?.Answer);

    if (
      !session?.active ||
      !q ||
      !selectedKey ||
      q._invalidAnswer ||
      !correctKey
    ) {
      return false;
    }
    if (session.userAnswers?.[session.currentIndex]) return false;

    if (!session.userAnswers || typeof session.userAnswers !== "object") {
      session.userAnswers = {};
    }
    session.userAnswers[session.currentIndex] = selectedKey;

    trackStats(q, selectedKey === correctKey);

    for (const btn of getChoiceButtons()) {
      const choice = normalizeAnswer(btn.dataset.choice);
      btn.classList.remove("selected-correct", "selected-wrong", "dimmed");
      if (choice === correctKey) btn.classList.add("selected-correct");
      else if (choice === selectedKey) btn.classList.add("selected-wrong");
      else btn.classList.add("dimmed");
    }

    showExplanation(q);

    const btnNext = getElement("btn-next");
    const btnReveal = getElement("btn-reveal");
    if (btnNext) btnNext.disabled = false;
    if (btnReveal) btnReveal.disabled = true;

    const progressBar = getElement("session-progress");
    if (progressBar) {
      progressBar.style.width = `${((session.currentIndex + 1) / session.questions.length) * 100}%`;
    }

    saveSessionProgress();
    startTimerSafely();
    safeClearAutoNextTimeout();
    session.autoNextTimeout = setTimeout(() => {
      if (getSession()?.active) nextQuestion();
    }, 2000);
    return true;
  }

  function showExplanation(q) {
    const expBox = getElement("q-explanation-box");
    if (!expBox) return;
    const explanation = normalizeText(q?.Explanation);
    const textEl = getElement("q-explanation-text");

    if (explanation) {
      if (textEl && typeof globalScope.formatQuestionText === "function") {
        textEl.innerHTML = globalScope.formatQuestionText(explanation);
      } else if (textEl) {
        textEl.textContent = explanation;
      }
      expBox.classList.remove("hidden");
    } else {
      if (textEl) textEl.textContent = "";
      expBox.classList.add("hidden");
    }
  }

  function nextQuestion() {
    const session = getSession();
    if (
      !session?.active ||
      !Array.isArray(session.questions) ||
      session.questions.length === 0
    )
      return;

    safeClearAutoNextTimeout();
    stopTimerSafely();

    if (session.currentIndex < session.questions.length - 1) {
      session.currentIndex += 1;
      session.revealedCloze = false;
      renderQuestion();
      saveSessionProgress();
      return;
    }

    if (typeof alert === "function")
      alert("Practice Session Complete! Great job.");
    endSession(true);
    if (typeof globalScope.navigate === "function")
      globalScope.navigate("dashboard");
  }

  function prevQuestion() {
    const session = getSession();
    if (!session?.active || !Array.isArray(session.questions)) return;

    safeClearAutoNextTimeout();
    stopTimerSafely();

    if (session.currentIndex > 0) {
      session.currentIndex -= 1;
      session.revealedCloze = false;
      renderQuestion();
      saveSessionProgress();
    }
  }

  function getDefaultSrsEntry(qId) {
    return {
      qId,
      ease: 2.5,
      interval: 0,
      due: 0,
      reps: 0,
      lapses: 0,
      step: 0,
      lastScore: null,
      lastAnsweredAt: 0,
    };
  }

  function updateSrsForQuestion(q, isCorrect) {
    const prefs = getPrefs();
    const stats = getStats();
    if (prefs.srsEnabled !== true || !q) return;

    const qId = normalizeText(q.ID) || normalizeText(q.Question);
    if (!qId) return;

    if (
      !stats.srsMap ||
      typeof stats.srsMap !== "object" ||
      Array.isArray(stats.srsMap)
    ) {
      stats.srsMap = {};
    }

    const existing = stats.srsMap[qId] || getDefaultSrsEntry(qId);
    const reps = Math.max(0, Number(existing.reps) || 0) + 1;
    const existingEase = Number(existing.ease);
    const ease = Number.isFinite(existingEase) ? existingEase : 2.5;
    const now = Date.now();

    const next = {
      ...existing,
      qId,
      reps,
      lastAnsweredAt: now,
    };

    if (isCorrect) {
      next.lastScore = "correct";
      next.step = Math.max(1, (Number(existing.step) || 0) + 1);
      next.ease = Math.max(1.3, ease + 0.1);
      next.interval = computeSrsInterval(next.step, next.ease);
      next.due = now + next.interval * DAY_MS;
    } else {
      next.lastScore = "wrong";
      next.step = 0;
      next.lapses = Math.max(0, Number(existing.lapses) || 0) + 1;
      next.ease = Math.max(1.3, ease - 0.2);
      next.interval = 1;
      next.due = now + HOUR_MS;
    }

    stats.srsMap[qId] = next;
  }

  function computeSrsInterval(step, ease) {
    const normalizedStep = Math.max(0, Number(step) || 0);
    const normalizedEase = Number.isFinite(Number(ease)) ? Number(ease) : 2.5;
    if (normalizedStep <= 1) return 1;
    if (normalizedStep === 2) return 2;
    if (normalizedStep === 3) return 4;
    return Math.max(1, Math.round((normalizedStep - 1) * normalizedEase * 2));
  }

  function trackStats(q, isCorrect) {
    const stats = getStats();
    if (!q || typeof stats !== "object") return;

    stats.totalAnswered = Math.max(0, Number(stats.totalAnswered) || 0) + 1;
    stats.correct = Math.max(0, Number(stats.correct) || 0);
    if (!Array.isArray(stats.mistakes)) stats.mistakes = [];
    if (!Array.isArray(stats.completedQs)) stats.completedQs = [];
    if (!stats.subjectAccuracy || typeof stats.subjectAccuracy !== "object") {
      stats.subjectAccuracy = {};
    }

    const subject = normalizeText(q.Subject) || "General";
    let subjectStats = stats.subjectAccuracy[subject];
    if (!subjectStats || typeof subjectStats !== "object") {
      subjectStats = { total: 0, correct: 0 };
      stats.subjectAccuracy[subject] = subjectStats;
    }

    subjectStats.total = Math.max(0, Number(subjectStats.total) || 0) + 1;
    subjectStats.correct = Math.max(0, Number(subjectStats.correct) || 0);

    const questionId = q.ID;
    if (questionId != null && !stats.completedQs.includes(questionId)) {
      stats.completedQs.push(questionId);
    }

    if (isCorrect) {
      stats.correct += 1;
      subjectStats.correct += 1;

      if (questionId != null) {
        const mistakeIndex = stats.mistakes.indexOf(questionId);
        if (mistakeIndex !== -1) stats.mistakes.splice(mistakeIndex, 1);
      }
    } else if (questionId != null && !stats.mistakes.includes(questionId)) {
      stats.mistakes.push(questionId);
    }

    updateSrsForQuestion(q, Boolean(isCorrect));

    if (typeof globalScope.renderCategoryProgress === "function") {
      globalScope.renderCategoryProgress();
    }

    if (typeof globalScope.saveState === "function") {
      globalScope.saveState("stats");
    }
  }

  function endSession(silent = false) {
    const session = getSession();
    if (!session) return;

    safeClearAutoNextTimeout();
    stopTimerSafely();

    const hasValidIndex =
      session.currentIndex >= 0 &&
      session.currentIndex < (session.questions?.length || 0);
    const isLastQuestion =
      hasValidIndex && session.currentIndex === session.questions.length - 1;
    const isAnswered =
      hasValidIndex && Boolean(session.userAnswers?.[session.currentIndex]);
    const shouldClearSaved = isLastQuestion && isAnswered;

    if (shouldClearSaved) clearSessionProgress();
    else saveSessionProgress(true);

    session.active = false;

    if (globalScope.pendingSummaryData) {
      if (typeof globalScope.applySummaryData === "function") {
        globalScope.applySummaryData(globalScope.pendingSummaryData);
      }
      globalScope.pendingSummaryData = null;
      if (typeof globalScope.updateSyncStatus === "function") {
        globalScope.updateSyncStatus(
          '<i class="fa-solid fa-check mr-1"></i> Database update applied after your session.',
          "success",
        );
      }
    }

    if (!silent && typeof globalScope.navigate === "function")
      globalScope.navigate("dashboard");
  }

  function writeSessionProgressNow() {
    const session = getSession();
    const state = getState();
    const prefs = getPrefs();

    if (!session?.active || typeof globalScope.setStoredJSON !== "function") {
      sessionSaveRequested = false;
      return false;
    }

    try {
      globalScope.setStoredJSON("saved_session", session);
      prefs.lastActivity = {
        mode: "quiz",
        subject: session.questions?.[session.currentIndex]?.Subject || null,
        updatedAt: new Date().toISOString(),
      };
      state.prefs = prefs;
      globalScope.setStoredJSON("prefs", prefs);
      sessionSaveRequested = false;
      return true;
    } catch (error) {
      sessionSaveRequested = false;
      console.warn(
        "Storage quota exceeded. Could not save session progress.",
        error,
      );
      if (typeof globalScope.showToast === "function") {
        globalScope.showToast(
          "Storage full. Progress won't be saved.",
          "error",
        );
      }
      return false;
    }
  }

  function saveSessionProgress(immediate = false) {
    const session = getSession();
    if (!session?.active || typeof globalScope.setStoredJSON !== "function") {
      return false;
    }

    sessionSaveRequested = true;

    if (immediate) {
      if (sessionSaveTimer) {
        clearTimeout(sessionSaveTimer);
        sessionSaveTimer = 0;
      }
      return writeSessionProgressNow();
    }

    if (!sessionSaveTimer) {
      sessionSaveTimer = setTimeout(() => {
        sessionSaveTimer = 0;
        if (sessionSaveRequested) writeSessionProgressNow();
      }, 100);
    }

    return true;
  }

  function checkSavedSession() {
    const prefs = getPrefs();
    const saved =
      typeof globalScope.getStoredItem === "function"
        ? globalScope.getStoredItem("saved_session")
        : null;
    const resumeContainer = getElement("resume-container");
    const contextEl = getElement("resume-context");
    const activity = prefs.lastActivity;

    if (contextEl && activity) {
      const modeLabel = activity.mode === "review" ? "Study" : "Quiz";
      const subject = normalizeText(activity.subject);
      contextEl.textContent = subject
        ? `${modeLabel} mode: ${subject}`
        : `${modeLabel} mode`;
    }

    if (!resumeContainer) return;

    let validSavedSession = false;
    if (saved) {
      try {
        const session = JSON.parse(saved);
        validSavedSession = Boolean(
          session?.active &&
          Array.isArray(session.questions) &&
          session.questions.length > 0 &&
          Number.isInteger(session.currentIndex) &&
          session.currentIndex >= 0 &&
          session.currentIndex < session.questions.length &&
          session.userAnswers &&
          typeof session.userAnswers === "object",
        );

        if (validSavedSession) {
          const isLastQuestion =
            session.currentIndex === session.questions.length - 1;
          const isAnswered = Boolean(session.userAnswers[session.currentIndex]);
          if (
            isLastQuestion &&
            isAnswered &&
            typeof globalScope.removeStoredItem === "function"
          ) {
            globalScope.removeStoredItem("saved_session");
            validSavedSession = false;
          }
        } else if (typeof globalScope.removeStoredItem === "function") {
          globalScope.removeStoredItem("saved_session");
        }
      } catch (error) {
        console.error("Error checking saved session:", error);
        if (typeof globalScope.removeStoredItem === "function")
          globalScope.removeStoredItem("saved_session");
      }
    }

    const hasReviewActivity =
      activity?.mode === "review" && Boolean(normalizeText(activity.subject));
    resumeContainer.classList.toggle(
      "hidden",
      !(validSavedSession || hasReviewActivity),
    );
  }

  function clearSessionProgress() {
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer);
      sessionSaveTimer = 0;
    }
    sessionSaveRequested = false;
    if (typeof globalScope.removeStoredItem === "function")
      globalScope.removeStoredItem("saved_session");
    const state = getState();
    if (!state.prefs || typeof state.prefs !== "object") state.prefs = {};
    state.prefs.lastActivity = null;
    if (typeof globalScope.setStoredJSON === "function")
      globalScope.setStoredJSON("prefs", state.prefs);
    getElement("resume-container")?.classList.add("hidden");
  }

  function revealAnswer() {
    const session = getSession();
    const q = getCurrentQuestion();
    if (!session?.active || !q || session.userAnswers?.[session.currentIndex])
      return false;

    const typeMode =
      typeof globalScope.getQuestionTypeMode === "function"
        ? globalScope.getQuestionTypeMode(q) || {}
        : {};
    const isPureIdent = typeMode.isIdent === true;

    if (!session.userAnswers || typeof session.userAnswers !== "object")
      session.userAnswers = {};
    session.userAnswers[session.currentIndex] = "REVEALED";
    session.revealedCloze = true;

    if (!isPureIdent) {
      // Revealing is not a user-correct response. Count it as a miss so statistics
      // and SRS do not incorrectly award credit for an answer the user did not give.
      trackStats(q, false);
    }

    getElement("q-choices")?.classList.remove("hidden");
    getElement("active-recall-mask")?.classList.add("hidden");
    renderQuestion();
    saveSessionProgress();
    if (!isPureIdent) startTimerSafely();

    if (!isPureIdent) {
      safeClearAutoNextTimeout();
      session.autoNextTimeout = setTimeout(() => {
        if (getSession()?.active) nextQuestion();
      }, 2000);
    }
    return true;
  }

  function rateIdentificationAnswer(isCorrect) {
    const session = getSession();
    const q = getCurrentQuestion();
    const typeMode =
      typeof globalScope.getQuestionTypeMode === "function"
        ? globalScope.getQuestionTypeMode(q) || {}
        : {};

    if (
      !session?.active ||
      !q ||
      typeMode.isIdent !== true ||
      session.userAnswers?.[session.currentIndex] !== "REVEALED"
    ) {
      return false;
    }

    if (
      !session.identificationRatings ||
      typeof session.identificationRatings !== "object"
    ) {
      session.identificationRatings = {};
    }
    session.identificationRatings[session.currentIndex] = Boolean(isCorrect);
    trackStats(q, Boolean(isCorrect));
    nextQuestion();
    return true;
  }

  function startVisualTimer() {
    const container = getElement("auto-next-timer-container");
    const bar = getElement("auto-next-timer-bar");
    if (!container || !bar) return;

    container.classList.remove("hidden");

    if (timerAnimationFrame) {
      cancelAnimationFrame(timerAnimationFrame);
      timerAnimationFrame = 0;
    }

    bar.classList.remove("animate-timer-bar");
    if (typeof bar.getAnimations === "function") {
      bar.getAnimations().forEach((animation) => animation.cancel());
    }

    timerAnimationFrame = requestAnimationFrame(() => {
      timerAnimationFrame = 0;
      if (bar.isConnected) bar.classList.add("animate-timer-bar");
    });
  }

  function stopVisualTimer() {
    const container = getElement("auto-next-timer-container");
    const bar = getElement("auto-next-timer-bar");
    if (!container || !bar) return;

    if (timerAnimationFrame) {
      cancelAnimationFrame(timerAnimationFrame);
      timerAnimationFrame = 0;
    }

    container.classList.add("hidden");
    bar.classList.remove("animate-timer-bar");
    if (typeof bar.getAnimations === "function") {
      bar.getAnimations().forEach((animation) => animation.cancel());
    }
  }

  const SessionCore = {
    prepareSessionPool,
    initSession,
    renderQuestion,
    submitPracticeAnswer,
    showExplanation,
    nextQuestion,
    prevQuestion,
    getDefaultSrsEntry,
    updateSrsForQuestion,
    computeSrsInterval,
    trackStats,
    endSession,
    saveSessionProgress,
    checkSavedSession,
    clearSessionProgress,
    revealAnswer,
    rateIdentificationAnswer,
    startVisualTimer,
    stopVisualTimer,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SessionCore;
  }

  globalScope.SessionCore = SessionCore;
  globalScope.prepareSessionPool = prepareSessionPool;
  globalScope.initSession = initSession;
  globalScope.renderQuestion = renderQuestion;
  globalScope.submitPracticeAnswer = submitPracticeAnswer;
  globalScope.showExplanation = showExplanation;
  globalScope.nextQuestion = nextQuestion;
  globalScope.prevQuestion = prevQuestion;
  globalScope.endSession = endSession;
  globalScope.saveSessionProgress = saveSessionProgress;
  globalScope.checkSavedSession = checkSavedSession;
  globalScope.clearSessionProgress = clearSessionProgress;
  globalScope.revealAnswer = revealAnswer;
  globalScope.rateIdentificationAnswer = rateIdentificationAnswer;
  globalScope.startVisualTimer = startVisualTimer;
  globalScope.stopVisualTimer = stopVisualTimer;
})(typeof window !== "undefined" ? window : globalThis);
