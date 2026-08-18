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
    renderQuestion: originalRenderQuestion,
    stopVisualTimer: originalStopVisualTimer,
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
      typeof SessionCore !== "undefined" &&
      typeof SessionCore.renderQuestion === "function"
    ) {
      return SessionCore.renderQuestion();
    }

    stopVisualTimer();
    applyNavigationPosition();
    const q = state.session.questions[state.session.currentIndex];
    const userAnswer = state.session.userAnswers[state.session.currentIndex];

    const currentCard = state.session.currentIndex + 1;
    const totalCards = state.session.questions.length;
    document.getElementById("session-progress-text").innerText =
      `${currentCard} / ${totalCards}`;
    document.getElementById("session-progress").style.width =
      `${((state.session.currentIndex + 1) / totalCards) * 100}%`;

    const fullSubject = q.Subject || "General";
    document.getElementById("q-subject").innerText = getShortSubjectLabel(
      fullSubject,
      "General",
    );

    let displayId = q.ID ?? `Q-${state.session.currentIndex + 1}`;
    if (displayId.includes("::")) {
      const match = displayId.match(/::.*?\b(\d+)\s*$/);
      displayId = match ? match[1] : displayId.split("::").pop();
    }
    document.getElementById("q-id").innerText = "Question " + displayId;
    const clozeEnabled = state.prefs.clozeEnabled !== false;
    const shouldRevealCloze =
      Boolean(userAnswer) || Boolean(state.session.revealedCloze);
    document.getElementById("q-text").innerHTML = formatQuestionText(
      q.Question,
      {
        revealCloze: shouldRevealCloze && clozeEnabled,
        clozeEnabled,
      },
    );

    const imgEl = document.getElementById("q-image");
    if (q.ImageURL && q.ImageURL.trim() !== "") {
      imgEl.onload = () => imgEl.classList.remove("hidden");
      imgEl.onerror = () => {
        imgEl.removeAttribute("src");
        imgEl.classList.add("hidden");
      };
      imgEl.src = q.ImageURL;
      imgEl.alt = q.Question
        ? `Reference for: ${q.Question.substring(0, 50)}...`
        : "Question reference image";
      imgEl.classList.remove("hidden");
    } else {
      imgEl.classList.add("hidden");
    }

    const { isIdent: isPureIdent } = getQuestionTypeMode(q);
    const isForcedMCQ = state.prefs.qTypeOverride === "mcq";
    const hideABCD = state.prefs.quizHideABCD === true || isPureIdent;

    const choices = ["A", "B", "C", "D"];
    choices.forEach((ch) => {
      const choiceText = q[`Choice${ch}`];
      const btn = document.querySelector(`.choice-btn[data-choice="${ch}"]`);
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

    btnPrev.disabled = state.session.currentIndex <= 0;

    if (userAnswer) {
      if (activeRecallMask) activeRecallMask.classList.add("hidden");
      qChoicesContainer.classList.remove("hidden");
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

      btnNext.disabled = false;
      btnReveal.disabled = true;
    } else {
      expBox.classList.add("hidden");
      btnNext.disabled = false;
      btnReveal.disabled = false;

      if (isPureIdent) {
        if (activeRecallMask) activeRecallMask.classList.add("hidden");
        qChoicesContainer.classList.add("hidden");
      } else {
        const activeRecallEnabled = Boolean(state.prefs.activeRecall);
        if (activeRecallEnabled) {
          if (activeRecallMask) activeRecallMask.classList.remove("hidden");
          qChoicesContainer.classList.add("hidden");
        } else {
          if (activeRecallMask) activeRecallMask.classList.add("hidden");
          qChoicesContainer.classList.remove("hidden");
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
      typeof SessionCore !== "undefined" &&
      typeof SessionCore.showExplanation === "function"
    ) {
      return SessionCore.showExplanation(q);
    }

    const expBox = document.getElementById("q-explanation-box");

    if (q.Explanation && q.Explanation.trim() !== "") {
      document.getElementById("q-explanation-text").innerHTML =
        formatQuestionText(q.Explanation);
      expBox.classList.remove("hidden");
    } else {
      expBox.classList.add("hidden");
    }
  }

  function revealAnswer() {
    if (!state.session.active) return;

    const q = state.session.questions[state.session.currentIndex];
    state.session.userAnswers[state.session.currentIndex] = "REVEALED";
    state.session.revealedCloze = true;

    const { isIdent: isPureIdent } = getQuestionTypeMode(q);

    trackStats(q, isPureIdent);

    document.getElementById("q-choices").classList.remove("hidden");
    const activeRecallMask = document.getElementById("active-recall-mask");
    if (activeRecallMask) activeRecallMask.classList.add("hidden");

    renderQuestion();
    saveSessionProgress();
    startVisualTimer();

    if (state.session.autoNextTimeout)
      clearTimeout(state.session.autoNextTimeout);
    state.session.autoNextTimeout = setTimeout(() => {
      nextQuestion();
    }, 2000);
  }

  // ===================== VISUAL TIMER =====================
  function startVisualTimer() {
    const container = document.getElementById("auto-next-timer-container");
    const bar = document.getElementById("auto-next-timer-bar");

    container.classList.remove("hidden");

    bar.classList.remove("animate-timer-bar");
    void bar.offsetWidth;
    bar.classList.add("animate-timer-bar");
  }

  function stopVisualTimer() {
    const container = document.getElementById("auto-next-timer-container");
    const bar = document.getElementById("auto-next-timer-bar");

    container.classList.add("hidden");
    bar.classList.remove("animate-timer-bar");
  }

  // ===================== QUIZ TOGGLES =====================
  function toggleHideABCD() {
    const isHidden = document.getElementById("toggle-hide-abcd").checked;
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

    if (document.getElementById("view-practice").classList.contains("active")) {
      renderQuestion();
    }
  }

  function toggleShowWrongChoices() {
    const isChecked = document.getElementById("toggle-wrong-choices").checked;
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
