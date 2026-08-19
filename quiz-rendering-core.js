// ============================================================================
// Quiz Rendering Core - Question rendering, UI toggles, and visual timer
// Extracted from app-core.js - Phase 8
// ============================================================================

(function (globalScope) {
  // Import global dependencies
  const {
    state,
    saveState,
    saveSessionProgress,
    applyNavigationPosition,
    getShortSubjectLabel,
    formatQuestionText,
    getQuestionTypeMode,
    escapeHTML,
    submitPracticeAnswer,
    trackStats,
    nextQuestion,
    prevQuestion,
    applyTitleMode,
  } = globalScope;

  // ===================== QUESTION RENDERING =====================
  function renderQuestion() {
    if (
      globalScope.SessionCore &&
      typeof globalScope.SessionCore.renderQuestion === "function"
    ) {
      return globalScope.SessionCore.renderQuestion();
    }

    state.session = state.session || {
      active: false,
      questions: [],
      currentIndex: 0,
      userAnswers: {},
    };
    state.session.questions = Array.isArray(state.session.questions)
      ? state.session.questions
      : [];
    state.session.userAnswers =
      state.session.userAnswers && typeof state.session.userAnswers === "object"
        ? state.session.userAnswers
        : {};
    stopVisualTimer();
    if (typeof applyNavigationPosition === "function")
      applyNavigationPosition();
    const q = state.session.questions[state.session.currentIndex];
    if (!q) {
      document
        .getElementById("session-progress-text")
        ?.replaceChildren(document.createTextNode("0 / 0"));
      const progress = document.getElementById("session-progress");
      if (progress) progress.style.width = "0%";
      return false;
    }
    const userAnswer = state.session.userAnswers[state.session.currentIndex];

    const currentCard = state.session.currentIndex + 1;
    const totalCards = state.session.questions.length;
    const progressText = document.getElementById("session-progress-text");
    if (progressText)
      progressText.textContent = `${currentCard} / ${totalCards}`;
    const progress = document.getElementById("session-progress");
    if (progress)
      progress.style.width = `${totalCards ? ((state.session.currentIndex + 1) / totalCards) * 100 : 0}%`;

    const fullSubject = q.Subject || "General";
    const subjectEl = document.getElementById("q-subject");
    if (subjectEl)
      subjectEl.textContent =
        typeof getShortSubjectLabel === "function"
          ? getShortSubjectLabel(fullSubject, "General")
          : fullSubject;

    let displayId = q.ID ?? `Q-${state.session.currentIndex + 1}`;
    if (displayId.includes("::")) {
      const match = displayId.match(/::.*?\b(\d+)\s*$/);
      displayId = match ? match[1] : displayId.split("::").pop();
    }
    const idEl = document.getElementById("q-id");
    if (idEl) idEl.textContent = "Question " + displayId;
    const clozeEnabled = state.prefs.clozeEnabled !== false;
    const shouldRevealCloze =
      Boolean(userAnswer) || Boolean(state.session.revealedCloze);
    const qText = document.getElementById("q-text");
    if (qText)
      qText.innerHTML = formatQuestionText(q.Question, {
        revealCloze: shouldRevealCloze && clozeEnabled,
        clozeEnabled,
      });

    const imgEl = document.getElementById("q-image");
    if (imgEl && q.ImageURL && String(q.ImageURL).trim() !== "") {
      imgEl.onload = () => imgEl.classList.remove("hidden");
      imgEl.onerror = () => {
        imgEl.removeAttribute("src");
        imgEl.classList.add("hidden");
      };
      imgEl.src = q.ImageURL;
      imgEl.alt = q.Question
        ? `Reference for: ${String(q.Question).substring(0, 50)}...`
        : "Question reference image";
      imgEl.classList.remove("hidden");
    } else if (imgEl) {
      imgEl.onload = null;
      imgEl.onerror = null;
      imgEl.removeAttribute("src");
      imgEl.classList.add("hidden");
    }

    const { isIdent: isPureIdent } = getQuestionTypeMode(q);
    const isForcedMCQ = state.prefs.qTypeOverride === "mcq";
    const hideABCD = state.prefs.quizHideABCD === true || isPureIdent;

    const choices = ["A", "B", "C", "D"];
    choices.forEach((ch) => {
      const choiceText = q[`Choice${ch}`];
      const btn = document.querySelector(`.choice-btn[data-choice="${ch}"]`);
      if (!btn) return;
      let cleanChoice = String(choiceText ?? "").trim();

      btn.classList.remove("selected-correct", "selected-wrong", "dimmed");
      btn.onclick = null;

      if (isForcedMCQ && cleanChoice === "") {
        cleanChoice = "undefined";
      }

      if (
        !isForcedMCQ &&
        (cleanChoice === "" || cleanChoice.toLowerCase() === "undefined")
      ) {
        btn.classList.add("hidden");
      } else {
        btn.classList.remove("hidden");
        const prefixRegex = new RegExp(`^${ch}[\\.\\)\\-]\\s*`, "i");
        const displayText = cleanChoice.replace(prefixRegex, "");
        const safeDisplayText = escapeHTML(displayText);

        if (hideABCD) {
          btn.innerHTML = safeDisplayText;
        } else {
          btn.innerHTML = `<span class="choice-letter font-bold mr-2 whitespace-nowrap">${ch})</span> ${safeDisplayText}`;
        }

        if (!userAnswer) {
          btn.onclick = () => submitPracticeAnswer(ch, q.Answer);
        }
      }
    });

    const qChoicesContainer = document.getElementById("q-choices");
    const activeRecallMask = document.getElementById("active-recall-mask");
    const expBox = document.getElementById("q-explanation-box");
    const btnNext = document.getElementById("btn-next");
    const btnPrev = document.getElementById("btn-prev");
    const btnReveal = document.getElementById("btn-reveal");

    if (btnPrev) btnPrev.disabled = state.session.currentIndex <= 0;

    if (userAnswer) {
      if (activeRecallMask) activeRecallMask.classList.add("hidden");
      if (qChoicesContainer) qChoicesContainer.classList.remove("hidden");
      showExplanation(q);

      qChoicesContainer.querySelectorAll(".choice-btn").forEach((btn) => {
        btn.onclick = null;
        const choice = btn.dataset.choice;

        if (choice === q.Answer) {
          btn.classList.add("selected-correct");
          btn.classList.remove("hidden");
        } else {
          if (isPureIdent) {
            btn.classList.add("hidden");
          } else {
            if (choice === userAnswer) {
              btn.classList.add("selected-wrong");
            } else {
              btn.classList.add("dimmed");
            }
          }
        }
      });

      if (btnNext) btnNext.disabled = false;
      if (btnReveal) btnReveal.disabled = true;
    } else {
      if (expBox) expBox.classList.add("hidden");
      if (btnNext) btnNext.disabled = false;
      if (btnReveal) btnReveal.disabled = false;

      if (isPureIdent) {
        if (activeRecallMask) activeRecallMask.classList.add("hidden");
        if (qChoicesContainer) qChoicesContainer.classList.add("hidden");
      } else {
        const activeRecallEnabled = Boolean(state.prefs.activeRecall);
        if (activeRecallEnabled) {
          if (activeRecallMask) activeRecallMask.classList.remove("hidden");
          if (qChoicesContainer) qChoicesContainer.classList.add("hidden");
        } else {
          if (activeRecallMask) activeRecallMask.classList.add("hidden");
          if (qChoicesContainer) qChoicesContainer.classList.remove("hidden");
        }
      }
    }

    const favBtn = document.getElementById("btn-favorite-question");
    if (favBtn) {
      const isFavorite = Array.isArray(state.prefs.favoriteQuestions)
        ? state.prefs.favoriteQuestions.includes(q.ID)
        : false;

      favBtn.classList.toggle("text-yellow-500", isFavorite);
      favBtn.classList.toggle("text-gray-400", !isFavorite);
      favBtn.title = isFavorite ? "Remove from Favorites" : "Add to Favorites";
    }

    const activeRecallToggle = document.getElementById("toggle-active-recall");
    const shuffleChoicesToggle = document.getElementById(
      "toggle-shuffle-choices",
    );
    const hideABCDToggle = document.getElementById("toggle-quiz-hide-abcd");

    if (activeRecallToggle) {
      activeRecallToggle.disabled = isPureIdent;
      activeRecallToggle.parentElement.classList.toggle(
        "opacity-50",
        isPureIdent,
      );
      activeRecallToggle.parentElement.classList.toggle(
        "cursor-not-allowed",
        isPureIdent,
      );
      activeRecallToggle.parentElement.classList.toggle(
        "pointer-events-none",
        isPureIdent,
      );
    }

    if (shuffleChoicesToggle) {
      shuffleChoicesToggle.disabled = isPureIdent;
      shuffleChoicesToggle.parentElement.classList.toggle(
        "opacity-50",
        isPureIdent,
      );
      shuffleChoicesToggle.parentElement.classList.toggle(
        "cursor-not-allowed",
        isPureIdent,
      );
    }

    if (hideABCDToggle) {
      hideABCDToggle.disabled = isPureIdent;
      hideABCDToggle.parentElement.classList.toggle("opacity-50", isPureIdent);
      hideABCDToggle.parentElement.classList.toggle(
        "cursor-not-allowed",
        isPureIdent,
      );
      hideABCDToggle.parentElement.classList.toggle(
        "pointer-events-none",
        isPureIdent,
      );
    }

    const nextIndex = state.session.currentIndex + 1;
    const upcomingQuestions = state.session.questions.slice(
      nextIndex,
      nextIndex + 2,
    );

    upcomingQuestions.forEach((nextQ) => {
      if (nextQ && nextQ.ImageURL) {
        const imgPreload = new Image();
        imgPreload.src = nextQ.ImageURL;
      }
    });

    applyTitleMode();
  }

  // ===================== ANSWER & EXPLANATION =====================
  function showExplanation(q) {
    if (
      globalScope.SessionCore &&
      typeof globalScope.SessionCore.showExplanation === "function"
    ) {
      return globalScope.SessionCore.showExplanation(q);
    }

    const expBox = document.getElementById("q-explanation-box");

    if (q?.Explanation && String(q.Explanation).trim() !== "") {
      const expText = document.getElementById("q-explanation-text");
      if (expText) expText.innerHTML = formatQuestionText(q.Explanation);
      if (expBox) expBox.classList.remove("hidden");
    } else {
      if (expBox) expBox.classList.add("hidden");
    }
  }

  function revealAnswer() {
    if (!state.session.active) return;

    const q = state.session.questions[state.session.currentIndex];
    if (!q) return false;
    state.session.userAnswers[state.session.currentIndex] = "REVEALED";
    state.session.revealedCloze = true;

    const { isIdent: isPureIdent } = getQuestionTypeMode(q);

    trackStats(q, isPureIdent);

    document.getElementById("q-choices")?.classList.remove("hidden");
    const activeRecallMask = document.getElementById("active-recall-mask");
    if (activeRecallMask) activeRecallMask.classList.add("hidden");

    renderQuestion();
    saveSessionProgress();
    startVisualTimer();

    if (state.session.autoNextTimeout) {
      clearTimeout(state.session.autoNextTimeout);
      state.session.autoNextTimeout = null;
    }
    state.session.autoNextTimeout = setTimeout(() => {
      nextQuestion();
    }, 2000);
  }

  // ===================== VISUAL TIMER =====================
  function startVisualTimer() {
    const container = document.getElementById("auto-next-timer-container");
    const bar = document.getElementById("auto-next-timer-bar");

    if (!container || !bar) return false;
    container.classList.remove("hidden");

    bar.classList.remove("animate-timer-bar");
    void bar.offsetWidth;
    bar.classList.add("animate-timer-bar");
    return true;
  }

  function stopVisualTimer() {
    const container = document.getElementById("auto-next-timer-container");
    const bar = document.getElementById("auto-next-timer-bar");

    if (!container || !bar) return false;
    container.classList.add("hidden");
    bar.classList.remove("animate-timer-bar");
    return true;
  }

  // ===================== QUIZ TOGGLES =====================
  function toggleHideABCD() {
    const toggle = document.getElementById("toggle-hide-abcd");
    if (!toggle) return;
    const isHidden = toggle.checked;
    state.prefs.hideABCD = isHidden;
    saveState();

    if (
      typeof DeckReview !== "undefined" &&
      typeof DeckReview.reRenderDeckReview === "function"
    ) {
      DeckReview.reRenderDeckReview();
    }
  }

  function toggleQuizHideABCD() {
    const hideToggle = document.getElementById("toggle-quiz-hide-abcd");
    if (!hideToggle || hideToggle.disabled) return;

    const isHidden = hideToggle.checked;

    if (!state.prefs) state.prefs = {};
    state.prefs.quizHideABCD = isHidden;
    saveState();

    if (
      document.getElementById("view-practice")?.classList.contains("active")
    ) {
      renderQuestion();
    }
  }

  function toggleShowWrongChoices() {
    const toggle = document.getElementById("toggle-wrong-choices");
    if (!toggle) return;
    const isChecked = toggle.checked;
    state.prefs.showWrongChoices = isChecked;
    saveState();

    if (
      typeof DeckReview !== "undefined" &&
      typeof DeckReview.reRenderDeckReview === "function"
    ) {
      DeckReview.reRenderDeckReview();
    }
  }

  function toggleClozeMode(source) {
    const element = source || document.getElementById("toggle-cloze-mode");
    state.prefs.clozeEnabled = element ? Boolean(element.checked) : false;
    saveState();

    if (state.session.active) {
      renderQuestion();
    }
  }

  function toggleSrsMode(source) {
    const element = source || document.getElementById("toggle-srs-mode");
    state.prefs.srsEnabled = element ? Boolean(element.checked) : false;
    saveState();

    if (state.session.active) {
      const activeQuestions = state.session.questions || [];
      const current = activeQuestions[state.session.currentIndex] || null;
      if (current) {
        renderQuestion();
      }
    }
  }

  // ===================== MODULE EXPORT =====================
  const QuizRenderingCore = {
    renderQuestion,
    showExplanation,
    revealAnswer,
    startVisualTimer,
    stopVisualTimer,
    toggleHideABCD,
    toggleQuizHideABCD,
    toggleShowWrongChoices,
    toggleClozeMode,
    toggleSrsMode,
  };

  // Alias for backward compatibility
  const QuizRendering = QuizRenderingCore;

  // Export to global scope
  globalScope.QuizRenderingCore = QuizRenderingCore;
  globalScope.QuizRendering = QuizRendering;

  // Export individual functions for backward compatibility
  globalScope.renderQuestion = renderQuestion;
  globalScope.showExplanation = showExplanation;
  globalScope.revealAnswer = revealAnswer;
  globalScope.startVisualTimer = startVisualTimer;
  globalScope.stopVisualTimer = stopVisualTimer;
  globalScope.toggleHideABCD = toggleHideABCD;
  globalScope.toggleQuizHideABCD = toggleQuizHideABCD;
  globalScope.toggleShowWrongChoices = toggleShowWrongChoices;
  globalScope.toggleClozeMode = toggleClozeMode;
  globalScope.toggleSrsMode = toggleSrsMode;

  // For Node.js testing - export as CommonJS if in test environment
  if (typeof module !== "undefined" && module.exports) {
    module.exports = QuizRenderingCore;
  }
})(globalScope);
