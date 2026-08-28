(function (globalScope) {
  const CHOICE_KEYS = ["A", "B", "C", "D"];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const preloadedImageUrls = new Set();

  function getElement(id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  function hasDOM() {
    return typeof document !== "undefined";
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
      let validChoices = getValidChoices(q);

      if (
        prefs.shuffleChoices !== false &&
        typeof globalScope.shuffleArray === "function"
      ) {
        validChoices = globalScope.shuffleArray(validChoices);
      }

      CHOICE_KEYS.forEach((key, index) => {
        q[`Choice${key}`] = validChoices[index] || "";
      });

      const normalizedCorrect =
        normalizeText(originalCorrectText).toLowerCase();
      const matchingIndex = validChoices.findIndex(
        (choice) => normalizeText(choice).toLowerCase() === normalizedCorrect,
      );

      if (matchingIndex >= 0 && matchingIndex < CHOICE_KEYS.length) {
        q.Answer = CHOICE_KEYS[matchingIndex];
        delete q._invalidAnswer;
      } else if (originalAnswerKey && validChoices.length === 0) {
        // Preserve a valid answer key for non-choice/identification questions.
        q.Answer = originalAnswerKey;
        delete q._invalidAnswer;
      } else if (originalAnswer && validChoices.length === 0) {
        // Non-MCQ questions may legitimately store their answer as free text.
        q.Answer = originalAnswer;
        delete q._invalidAnswer;
      } else {
        // Never silently turn corrupt answer data into a correct A answer.
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
      mode: "quiz",
      revealedCloze: false,
      autoNextTimeout: null,
    };

    getElement("session-setup")?.classList.add("hidden");
    getElement("session-active")?.classList.remove("hidden");

    renderQuestion();
    saveSessionProgress();
  }

  function renderQuestion() {
    const session = getSession();
    if (
      !session?.active ||
      !Array.isArray(session.questions) ||
      session.questions.length === 0
    )
      return;

    const totalCards = session.questions.length;
    const rawIndex = Number.isInteger(session.currentIndex)
      ? session.currentIndex
      : 0;
    session.currentIndex = Math.min(Math.max(rawIndex, 0), totalCards - 1);
    const q = getCurrentQuestion();
    if (!q) return;

    stopTimerSafely();
    if (typeof globalScope.applyNavigationPosition === "function") {
      globalScope.applyNavigationPosition();
    }

    const userAnswer = session.userAnswers?.[session.currentIndex];
    const currentCard = session.currentIndex + 1;
    const progressText = getElement("session-progress-text");
    const progressBar = getElement("session-progress");
    if (progressText)
      progressText.textContent = `${currentCard} / ${totalCards}`;
    if (progressBar)
      progressBar.style.width = `${(currentCard / totalCards) * 100}%`;

    const fullSubject = normalizeText(q.Subject) || "General";
    const parts = fullSubject
      .split("::")
      .map((part) => part.trim())
      .filter(Boolean);
    const subjectEl = getElement("q-subject");
    if (subjectEl)
      subjectEl.textContent =
        parts.length >= 2 ? parts.slice(-2).join(" :: ") : fullSubject;

    let displayId = q.ID ?? `Q-${currentCard}`;
    displayId = normalizeText(displayId);
    if (displayId.includes("::")) {
      const match = displayId.match(/::.*?\b(\d+)\s*$/);
      displayId = match ? match[1] : displayId.split("::").pop().trim();
    }
    const idEl = getElement("q-id");
    if (idEl) idEl.textContent = `Question ${displayId}`;

    const favBtn = getElement("btn-favorite-question");
    if (favBtn) {
      const favoriteQuestions = Array.isArray(getPrefs().favoriteQuestions)
        ? getPrefs().favoriteQuestions
        : [];
      const isFavorite = favoriteQuestions.includes(q.ID);
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
      imgEl.onload = null;
      imgEl.onerror = null;
      if (
        imageUrl &&
        typeof globalScope.isSafeImageURL === "function" &&
        globalScope.isSafeImageURL(imageUrl)
      ) {
        imgEl.onload = () => imgEl.classList.remove("hidden");
        imgEl.onerror = () => {
          imgEl.removeAttribute("src");
          imgEl.classList.add("hidden");
        };
        imgEl.src = imageUrl;
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

    const choiceButtons = hasDOM()
      ? [...document.querySelectorAll(".choice-btn[data-choice]")]
      : [];

    CHOICE_KEYS.forEach((choiceKey) => {
      const btn =
        choiceButtons.find((element) => element.dataset.choice === choiceKey) ||
        (hasDOM()
          ? document.querySelector(`.choice-btn[data-choice="${choiceKey}"]`)
          : null);
      if (!btn) return;

      const choiceText = q[`Choice${choiceKey}`];
      let cleanChoice = normalizeText(choiceText);
      btn.classList.remove("selected-correct", "selected-wrong", "dimmed");
      btn.onclick = null;

      if (isForcedMCQ && cleanChoice === "") cleanChoice = "undefined";
      const shouldHide =
        !isForcedMCQ &&
        (cleanChoice === "" || cleanChoice.toLowerCase() === "undefined");

      btn.classList.toggle("hidden", shouldHide);
      if (shouldHide) {
        btn.innerHTML = "";
        return;
      }

      const prefixRegex = new RegExp(`^${choiceKey}[\\.\\)\\-]\\s*`, "i");
      const displayText = cleanChoice.replace(prefixRegex, "");
      const safeDisplayText =
        typeof globalScope.escapeHTML === "function"
          ? globalScope.escapeHTML(displayText)
          : displayText.replace(
              /[&<>'"]/g,
              (char) =>
                ({
                  "&": "&amp;",
                  "<": "&lt;",
                  ">": "&gt;",
                  "'": "&#39;",
                  '"': "&quot;",
                })[char],
            );

      btn.innerHTML = hideABCD
        ? safeDisplayText
        : `<span class="choice-letter font-bold mr-2 whitespace-nowrap">${choiceKey})</span> ${safeDisplayText}`;

      if (!userAnswer && !q._invalidAnswer) {
        btn.onclick = () =>
          submitPracticeAnswer(choiceKey, normalizeAnswer(q.Answer));
      }
    });

    const qChoicesContainer = getElement("q-choices");
    const activeRecallMask = getElement("active-recall-mask");
    const expBox = getElement("q-explanation-box");
    const btnNext = getElement("btn-next");
    const btnPrev = getElement("btn-prev");
    const btnReveal = getElement("btn-reveal");

    if (btnPrev) btnPrev.disabled = session.currentIndex <= 0;

    if (userAnswer) {
      activeRecallMask?.classList.add("hidden");
      qChoicesContainer?.classList.remove("hidden");
      showExplanation(q);

      choiceButtons.forEach((btn) => {
        btn.onclick = null;
        const choice = normalizeAnswer(btn.dataset.choice);
        const correct = normalizeAnswer(q.Answer);
        if (correct && choice === correct) {
          btn.classList.add("selected-correct");
          btn.classList.remove("hidden");
        } else if (isPureIdent) {
          btn.classList.add("hidden");
        } else if (choice === normalizeAnswer(userAnswer)) {
          btn.classList.add("selected-wrong");
        } else {
          btn.classList.add("dimmed");
        }
      });

      if (btnNext) btnNext.disabled = false;
      if (btnReveal) btnReveal.disabled = true;
    } else {
      expBox?.classList.add("hidden");
      if (btnNext) btnNext.disabled = false;
      if (btnReveal) btnReveal.disabled = false;

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

    const activeRecallToggle = getElement("toggle-active-recall");
    const shuffleChoicesToggle = getElement("toggle-shuffle-choices");
    if (activeRecallToggle) {
      activeRecallToggle.disabled = isPureIdent;
      activeRecallToggle.parentElement?.classList.toggle(
        "opacity-50",
        isPureIdent,
      );
      activeRecallToggle.parentElement?.classList.toggle(
        "cursor-not-allowed",
        isPureIdent,
      );
      activeRecallToggle.parentElement?.classList.toggle(
        "pointer-events-none",
        isPureIdent,
      );
    }
    if (shuffleChoicesToggle) {
      shuffleChoicesToggle.disabled = isPureIdent;
      shuffleChoicesToggle.parentElement?.classList.toggle(
        "opacity-50",
        isPureIdent,
      );
      shuffleChoicesToggle.parentElement?.classList.toggle(
        "cursor-not-allowed",
        isPureIdent,
      );
      shuffleChoicesToggle.parentElement?.classList.toggle(
        "pointer-events-none",
        isPureIdent,
      );
    }

    const nextIndex = session.currentIndex + 1;
    const upcomingQuestions = session.questions.slice(nextIndex, nextIndex + 2);
    if (typeof Image === "function") {
      upcomingQuestions.forEach((nextQ) => {
        const nextImageUrl = normalizeText(nextQ?.ImageURL);
        if (!nextImageUrl || preloadedImageUrls.has(nextImageUrl)) return;
        preloadedImageUrls.add(nextImageUrl);
        const imgPreload = new Image();
        imgPreload.src = nextImageUrl;
      });
    }
  }

  function submitPracticeAnswer(selected, correct) {
    const session = getSession();
    const q = getCurrentQuestion();
    const selectedKey = normalizeAnswer(selected);
    const correctKey = normalizeAnswer(correct);
    if (
      !session?.active ||
      !q ||
      !selectedKey ||
      q._invalidAnswer ||
      !correctKey
    )
      return false;
    if (session.userAnswers?.[session.currentIndex]) return false;

    if (!session.userAnswers || typeof session.userAnswers !== "object")
      session.userAnswers = {};
    session.userAnswers[session.currentIndex] = selectedKey;

    trackStats(q, selectedKey === correctKey);

    const choicesContainer = getElement("q-choices");
    choicesContainer?.querySelectorAll(".choice-btn").forEach((btn) => {
      btn.onclick = null;
      const choice = normalizeAnswer(btn.dataset.choice);
      btn.classList.remove("selected-correct", "selected-wrong", "dimmed");
      if (choice === correctKey) btn.classList.add("selected-correct");
      else if (choice === selectedKey) btn.classList.add("selected-wrong");
      else btn.classList.add("dimmed");
    });

    showExplanation(q);
    const btnNext = getElement("btn-next");
    const btnReveal = getElement("btn-reveal");
    if (btnNext) btnNext.disabled = false;
    if (btnReveal) btnReveal.disabled = true;

    const progressBar = getElement("session-progress");
    if (progressBar) {
      progressBar.style.width = `${((session.currentIndex + 1) / session.questions.length) * 100}%`;
    }

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
    )
      stats.srsMap = {};

    const existing = stats.srsMap[qId] || getDefaultSrsEntry(qId);
    const reps = Math.max(0, Number(existing.reps) || 0) + 1;
    const existingEase = Number(existing.ease);
    const ease = Number.isFinite(existingEase) ? existingEase : 2.5;
    const next = {
      ...existing,
      qId,
      reps,
      lastAnsweredAt: Date.now(),
    };

    if (isCorrect) {
      next.lastScore = "correct";
      next.step = Math.max(1, (Number(existing.step) || 0) + 1);
      next.ease = Math.max(1.3, ease + 0.1);
      next.interval = computeSrsInterval(next.step, next.ease);
      next.due = Date.now() + next.interval * DAY_MS;
    } else {
      next.lastScore = "wrong";
      next.step = 0;
      next.lapses = Math.max(0, Number(existing.lapses) || 0) + 1;
      next.ease = Math.max(1.3, ease - 0.2);
      next.interval = 1;
      next.due = Date.now() + HOUR_MS;
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
    const state = getState();
    const stats = getStats();
    if (!q || typeof stats !== "object") return;

    stats.totalAnswered = Math.max(0, Number(stats.totalAnswered) || 0) + 1;
    stats.correct = Math.max(0, Number(stats.correct) || 0);
    if (!Array.isArray(stats.mistakes)) stats.mistakes = [];
    if (!Array.isArray(stats.completedQs)) stats.completedQs = [];
    if (!stats.subjectAccuracy || typeof stats.subjectAccuracy !== "object")
      stats.subjectAccuracy = {};

    const subject = normalizeText(q.Subject) || "General";
    if (
      !stats.subjectAccuracy[subject] ||
      typeof stats.subjectAccuracy[subject] !== "object"
    ) {
      stats.subjectAccuracy[subject] = { total: 0, correct: 0 };
    }
    const subjectStats = stats.subjectAccuracy[subject];
    subjectStats.total = Math.max(0, Number(subjectStats.total) || 0) + 1;
    subjectStats.correct = Math.max(0, Number(subjectStats.correct) || 0);

    const questionId = q.ID;
    if (questionId != null && !stats.completedQs.includes(questionId))
      stats.completedQs.push(questionId);

    if (isCorrect) {
      stats.correct += 1;
      subjectStats.correct += 1;
      if (questionId != null)
        stats.mistakes = stats.mistakes.filter((id) => id !== questionId);
    } else if (questionId != null && !stats.mistakes.includes(questionId)) {
      stats.mistakes.push(questionId);
    }

    updateSrsForQuestion(q, Boolean(isCorrect));
    if (typeof globalScope.saveState === "function") globalScope.saveState();
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
    else saveSessionProgress();

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

  function saveSessionProgress() {
    const session = getSession();
    const state = getState();
    const prefs = getPrefs();
    if (!session?.active || typeof globalScope.setStoredJSON !== "function")
      return false;

    try {
      globalScope.setStoredJSON("saved_session", session);
      prefs.lastActivity = {
        mode: "quiz",
        subject: session.questions?.[session.currentIndex]?.Subject || null,
        updatedAt: new Date().toISOString(),
      };
      state.prefs = prefs;
      globalScope.setStoredJSON("prefs", prefs);
      return true;
    } catch (error) {
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

    if (!session.userAnswers || typeof session.userAnswers !== "object")
      session.userAnswers = {};
    session.userAnswers[session.currentIndex] = "REVEALED";
    session.revealedCloze = true;

    // Revealing is not a user-correct response. Count it as a miss so statistics
    // and SRS do not incorrectly award credit for an answer the user did not give.
    trackStats(q, false);

    getElement("q-choices")?.classList.remove("hidden");
    getElement("active-recall-mask")?.classList.add("hidden");
    renderQuestion();
    saveSessionProgress();
    startTimerSafely();

    safeClearAutoNextTimeout();
    session.autoNextTimeout = setTimeout(() => {
      if (getSession()?.active) nextQuestion();
    }, 2000);
    return true;
  }

  function startVisualTimer() {
    const container = getElement("auto-next-timer-container");
    const bar = getElement("auto-next-timer-bar");
    if (!container || !bar) return;
    container.classList.remove("hidden");
    bar.classList.remove("animate-timer-bar");
    void bar.offsetWidth;
    bar.classList.add("animate-timer-bar");
  }

  function stopVisualTimer() {
    const container = getElement("auto-next-timer-container");
    const bar = getElement("auto-next-timer-bar");
    if (!container || !bar) return;
    container.classList.add("hidden");
    bar.classList.remove("animate-timer-bar");
  }

  function getQuizNavigationPosition() {
    const prefs = getPrefs();
    const configured = prefs.quizNavigationPosition;
    if (configured !== "auto") return configured === "top" ? "top" : "bottom";
    const breakpoint = Number(globalScope.QUIZ_NAVIGATION_BREAKPOINT);
    const threshold = Number.isFinite(breakpoint) ? breakpoint : 768;
    return typeof window !== "undefined" && window.innerWidth <= threshold
      ? "top"
      : "bottom";
  }

  function applyNavigationPosition() {
    const navigation = getElement("quiz-navigation");
    const topAnchor = getElement("quiz-navigation-top");
    const bottomAnchor = getElement("quiz-navigation-bottom");
    if (!navigation || !topAnchor || !bottomAnchor) return;

    const session = getSession();
    const prefs = getPrefs();
    const savedPosition = session?.active
      ? getQuizNavigationPosition()
      : prefs.reviewNavigationPosition;
    const position = savedPosition === "top" ? "top" : "bottom";
    (position === "top" ? topAnchor : bottomAnchor).appendChild(navigation);
    topAnchor.classList.toggle("hidden", position !== "top");
    bottomAnchor.classList.toggle("hidden", position !== "bottom");
  }

  function changeNavigationPosition(position) {
    const normalized = position === "top" ? "top" : "bottom";
    const state = getState();
    if (!state.prefs || typeof state.prefs !== "object") state.prefs = {};

    if (getElement("view-deck-review")?.classList.contains("active")) {
      state.prefs.reviewNavigationPosition = normalized;
    } else {
      state.prefs.quizNavigationPosition = normalized;
      state.prefs.quizNavigationMode = "manual";
    }

    if (typeof globalScope.saveState === "function") globalScope.saveState();
    applyNavigationPosition();
    const select = getElement("navigation-position-select");
    if (select) select.value = normalized;
  }

  function toggleNavigationPosition(source) {
    if (!source) return;
    changeNavigationPosition(source.checked ? "bottom" : "top");
    if (
      getElement("view-deck-review")?.classList.contains("active") &&
      typeof globalScope.reRenderDeckReview === "function"
    ) {
      globalScope.reRenderDeckReview();
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
    startVisualTimer,
    stopVisualTimer,
    getQuizNavigationPosition,
    applyNavigationPosition,
    changeNavigationPosition,
    toggleNavigationPosition,
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
  globalScope.startVisualTimer = startVisualTimer;
  globalScope.stopVisualTimer = stopVisualTimer;
})(typeof window !== "undefined" ? window : globalThis);
