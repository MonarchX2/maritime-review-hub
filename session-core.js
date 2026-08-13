(function (globalScope) {
  function prepareSessionPool(pool) {
    let randomizedPool = [...pool];
    if (globalScope.state.prefs.shuffleQuestions !== false) {
      randomizedPool = globalScope.shuffleArray(randomizedPool);
    }
    randomizedPool.sort((a, b) => {
      const aIsMistake = globalScope.state.stats.mistakes.includes(a.ID);
      const bIsMistake = globalScope.state.stats.mistakes.includes(b.ID);
      if (aIsMistake && !bIsMistake) return Math.random() > 0.3 ? -1 : 1;
      if (!aIsMistake && bIsMistake) return Math.random() > 0.3 ? 1 : -1;
      return 0;
    });

    return randomizedPool.map((originalQ) => {
      let q = { ...originalQ };
      let validChoices = [];
      const rawChoices = [q.ChoiceA, q.ChoiceB, q.ChoiceC, q.ChoiceD];
      rawChoices.forEach((c) => {
        if (
          c !== undefined &&
          c !== null &&
          String(c).trim() !== "" &&
          String(c).trim().toLowerCase() !== "undefined"
        ) {
          validChoices.push(String(c).trim());
        }
      });

      let originalAns = String(q.Answer || "")
        .trim()
        .toUpperCase();
      let correctText = "";

      if (["A", "B", "C", "D"].includes(originalAns)) {
        correctText = String(originalQ[`Choice${originalAns}`] || "").trim();
      } else {
        correctText = String(q.Answer || "").trim();
      }

      if (validChoices.length > 0) {
        if (globalScope.state.prefs.shuffleChoices !== false) {
          validChoices = globalScope.shuffleArray(validChoices);
        }

        q.ChoiceA = validChoices[0] || "";
        q.ChoiceB = validChoices[1] || "";
        q.ChoiceC = validChoices[2] || "";
        q.ChoiceD = validChoices[3] || "";

        // Match answer with normalized comparison (case-insensitive, trimmed)
        let answerFound = false;
        const normalizedCorrect = correctText.toLowerCase();
        for (let i = 0; i < validChoices.length; i++) {
          if (validChoices[i].toLowerCase() === normalizedCorrect) {
            q.Answer = ["A", "B", "C", "D"][i];
            answerFound = true;
            break;
          }
        }
        // If answer not found through matching, default to first choice
        if (!answerFound) {
          q.Answer = "A";
        }
      }
      return q;
    });
  }

  function initSession() {
    const filterVal = document.getElementById("filter-subject").value;
    let pool = [];

    if (filterVal === "MISTAKES") {
      pool = globalScope.state.db.filter((q) =>
        globalScope.state.stats.mistakes.includes(q.ID),
      );
    } else if (filterVal.startsWith("SUBJ:")) {
      const subj = filterVal.replace("SUBJ:", "");
      pool = globalScope.getQuestionsForSubject(subj);
    } else if (filterVal.startsWith("TAG:")) {
      const tag = filterVal.replace("TAG:", "");
      pool = globalScope.state.db.filter((q) => q.Tags && q.Tags.includes(tag));
    } else {
      pool = globalScope.state.db;
    }

    if (pool.length === 0) {
      alert("No questions found for this filter.");
      return;
    }
    pool = prepareSessionPool(pool);

    clearTimeout(globalScope.state.session.autoNextTimeout);

    if (typeof globalScope.stopVisualTimer === "function") {
      globalScope.stopVisualTimer();
    }

    globalScope.state.session = {
      active: true,
      questions: pool,
      currentIndex: 0,
      userAnswers: {},
      mode: "quiz",
      revealedCloze: false,
    };

    document.getElementById("session-setup").classList.add("hidden");
    document.getElementById("session-active").classList.remove("hidden");

    globalScope.renderQuestion();
    globalScope.saveSessionProgress();
    globalScope.sendTelemetry("start_session", {
      subject: filterVal,
      poolSize: pool.length,
    });
  }

  function renderQuestion() {
    globalScope.stopVisualTimer();
    globalScope.applyNavigationPosition();
    const q =
      globalScope.state.session.questions[
        globalScope.state.session.currentIndex
      ];
    const userAnswer =
      globalScope.state.session.userAnswers[
        globalScope.state.session.currentIndex
      ];

    const currentCard = globalScope.state.session.currentIndex + 1;
    const totalCards = globalScope.state.session.questions.length;
    document.getElementById("session-progress-text").innerText =
      `${currentCard} / ${totalCards}`;
    document.getElementById("session-progress").style.width =
      `${((globalScope.state.session.currentIndex + 1) / totalCards) * 100}%`;

    const fullSubject = q.Subject || "General";
    const parts = String(fullSubject).split("::");
    document.getElementById("q-subject").innerText =
      parts.length >= 2 ? parts.slice(-2).join(" :: ") : fullSubject;

    let displayId = q.ID ?? `Q-${globalScope.state.session.currentIndex + 1}`;
    if (displayId.includes("::")) {
      const match = displayId.match(/::.*?\b(\d+)\s*$/);
      displayId = match ? match[1] : displayId.split("::").pop();
    }
    document.getElementById("q-id").innerText = "Question " + displayId;
    const clozeEnabled = globalScope.state.prefs.clozeEnabled !== false;
    const shouldRevealCloze =
      Boolean(userAnswer) || Boolean(globalScope.state.session.revealedCloze);
    document.getElementById("q-text").innerHTML =
      globalScope.formatQuestionText(q.Question, {
        revealCloze: shouldRevealCloze && clozeEnabled,
        clozeEnabled,
      });

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

    const { isIdent: isPureIdent } = globalScope.getQuestionTypeMode(q);
    const isForcedMCQ = globalScope.state.prefs.qTypeOverride === "mcq";
    const hideABCD =
      globalScope.state.prefs.quizHideABCD === true || isPureIdent;

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
        const safeDisplayText = globalScope.escapeHTML(displayText);

        if (hideABCD) {
          btn.innerHTML = safeDisplayText;
        } else {
          btn.innerHTML = `<span class="font-bold mr-2">${ch})</span> ${safeDisplayText}`;
        }

        if (!userAnswer) {
          btn.onclick = () => globalScope.submitPracticeAnswer(ch, q.Answer);
        }
      }
    });

    const qChoicesContainer = document.getElementById("q-choices");
    const activeRecallMask = document.getElementById("active-recall-mask");
    const expBox = document.getElementById("q-explanation-box");
    const btnNext = document.getElementById("btn-next");
    const btnPrev = document.getElementById("btn-prev");
    const btnReveal = document.getElementById("btn-reveal");

    btnPrev.disabled = globalScope.state.session.currentIndex <= 0;

    if (userAnswer) {
      if (activeRecallMask) activeRecallMask.classList.add("hidden");
      qChoicesContainer.classList.remove("hidden");
      globalScope.showExplanation(q);

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
        const activeRecallEnabled = Boolean(
          globalScope.state.prefs.activeRecall,
        );
        if (activeRecallEnabled) {
          if (activeRecallMask) activeRecallMask.classList.remove("hidden");
          qChoicesContainer.classList.add("hidden");
        } else {
          if (activeRecallMask) activeRecallMask.classList.add("hidden");
          qChoicesContainer.classList.remove("hidden");
        }
      }
    }

    const activeRecallToggle = document.getElementById("toggle-active-recall");
    const shuffleChoicesToggle = document.getElementById(
      "toggle-shuffle-choices",
    );

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

    const nextIndex = globalScope.state.session.currentIndex + 1;
    const upcomingQuestions = globalScope.state.session.questions.slice(
      nextIndex,
      nextIndex + 2,
    );

    upcomingQuestions.forEach((nextQ) => {
      if (nextQ && nextQ.ImageURL) {
        const imgPreload = new Image();
        imgPreload.src = nextQ.ImageURL;
      }
    });
  }

  function submitPracticeAnswer(selected, correct) {
    const q =
      globalScope.state.session.questions[
        globalScope.state.session.currentIndex
      ];
    globalScope.state.session.userAnswers[
      globalScope.state.session.currentIndex
    ] = selected;

    globalScope.trackStats(q, selected === correct);
    document
      .getElementById("q-choices")
      .querySelectorAll(".choice-btn")
      .forEach((btn) => {
        btn.onclick = null;
        if (btn.dataset.choice === correct)
          btn.classList.add("selected-correct");
        else if (btn.dataset.choice === selected)
          btn.classList.add("selected-wrong");
        else btn.classList.add("dimmed");
      });

    globalScope.showExplanation(q);

    document.getElementById("btn-next").disabled = false;
    document.getElementById("btn-reveal").disabled = true;
    document.getElementById("session-progress").style.width =
      `${((globalScope.state.session.currentIndex + 1) / globalScope.state.session.questions.length) * 100}%`;

    globalScope.startVisualTimer();
    if (globalScope.state.session.autoNextTimeout)
      clearTimeout(globalScope.state.session.autoNextTimeout);
    globalScope.state.session.autoNextTimeout = setTimeout(() => {
      globalScope.nextQuestion();
    }, 3000);
  }

  function showExplanation(q) {
    const expBox = document.getElementById("q-explanation-box");

    if (q.Explanation && q.Explanation.trim() !== "") {
      document.getElementById("q-explanation-text").innerHTML =
        globalScope.formatQuestionText(q.Explanation);
      expBox.classList.remove("hidden");
    } else {
      expBox.classList.add("hidden");
    }
  }

  function nextQuestion() {
    if (globalScope.state.session.autoNextTimeout)
      clearTimeout(globalScope.state.session.autoNextTimeout);
    globalScope.stopVisualTimer();

    if (
      globalScope.state.session.currentIndex <
      globalScope.state.session.questions.length - 1
    ) {
      const skipped =
        !globalScope.state.session.userAnswers[
          globalScope.state.session.currentIndex
        ];
      globalScope.state.session.currentIndex++;
      globalScope.renderQuestion();
      globalScope.saveSessionProgress();
      globalScope.sendTelemetry(skipped ? "skip_question" : "next_question", {
        questionIndex: globalScope.state.session.currentIndex - 1,
        nextQuestionIndex: globalScope.state.session.currentIndex,
        questionId:
          globalScope.state.session.questions[
            globalScope.state.session.currentIndex - 1
          ]?.ID,
      });
    } else {
      alert("Practice Session Complete! Great job.");
      globalScope.clearSessionProgress();
      globalScope.endSession(false);
    }
  }

  function prevQuestion() {
    if (globalScope.state.session.autoNextTimeout)
      clearTimeout(globalScope.state.session.autoNextTimeout);
    globalScope.stopVisualTimer();

    if (globalScope.state.session.currentIndex > 0) {
      globalScope.state.session.currentIndex--;
      globalScope.renderQuestion();
    }
    globalScope.saveSessionProgress();
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
    if (globalScope.state.prefs.srsEnabled !== true) return;

    const qId = q?.ID || q?.Question || "";
    if (!qId) return;

    if (!globalScope.state.stats.srsMap) globalScope.state.stats.srsMap = {};

    const existing =
      globalScope.state.stats.srsMap[qId] || getDefaultSrsEntry(qId);
    const next = {
      ...existing,
      qId,
      reps: Number(existing.reps || 0) + 1,
      lastAnsweredAt: Date.now(),
    };

    if (isCorrect) {
      next.lastScore = "correct";
      next.step = Math.max(1, Number(existing.step || 0) + 1);
      next.ease = Math.max(1.3, Number(existing.ease || 2.5) + 0.1);
      next.interval = globalScope.computeSrsInterval(next.step, next.ease);
      next.due = Date.now() + next.interval * 24 * 60 * 60 * 1000;
    } else {
      next.lastScore = "wrong";
      next.step = 0;
      next.lapses = Number(existing.lapses || 0) + 1;
      next.ease = Math.max(1.3, Number(existing.ease || 2.5) - 0.2);
      next.interval = 1;
      next.due = Date.now() + 60 * 60 * 1000;
    }

    globalScope.state.stats.srsMap[qId] = next;
  }

  function computeSrsInterval(step, ease) {
    if (step <= 0) return 1;
    if (step === 1) return 1;
    if (step === 2) return 2;
    if (step === 3) return 4;
    return Math.max(1, Math.round((step - 1) * (ease || 2.5) * 2));
  }

  function trackStats(q, isCorrect) {
    globalScope.state.stats.totalAnswered++;

    const subj = q.Subject || "General";
    if (!globalScope.state.stats.subjectAccuracy[subj])
      globalScope.state.stats.subjectAccuracy[subj] = { total: 0, correct: 0 };
    globalScope.state.stats.subjectAccuracy[subj].total++;

    if (!globalScope.state.stats.completedQs)
      globalScope.state.stats.completedQs = [];
    if (!globalScope.state.stats.completedQs.includes(q.ID)) {
      globalScope.state.stats.completedQs.push(q.ID);
    }

    if (isCorrect) {
      globalScope.state.stats.correct++;
      globalScope.state.stats.subjectAccuracy[subj].correct++;
      globalScope.state.stats.mistakes =
        globalScope.state.stats.mistakes.filter((id) => id !== q.ID);
    } else {
      if (!globalScope.state.stats.mistakes.includes(q.ID))
        globalScope.state.stats.mistakes.push(q.ID);
    }

    updateSrsForQuestion(q, isCorrect);
    globalScope.saveState();
    globalScope.sendTelemetry("answer_question", { qId: q.ID, isCorrect });
  }

  function endSession(silent = false) {
    const isLastQuestion =
      globalScope.state.session.currentIndex >=
      globalScope.state.session.questions.length - 1;
    const isAnswered =
      globalScope.state.session.userAnswers &&
      globalScope.state.session.userAnswers[
        globalScope.state.session.currentIndex
      ];

    if (isLastQuestion && isAnswered) {
      globalScope.clearSessionProgress();
    } else {
      globalScope.saveSessionProgress();
    }

    globalScope.state.session.active = false;
    if (globalScope.pendingSummaryData) {
      globalScope.applySummaryData(globalScope.pendingSummaryData);
      globalScope.pendingSummaryData = null;
      globalScope.updateSyncStatus(
        '<i class="fa-solid fa-check mr-1"></i> Database update applied after your session.',
        "success",
      );
    }
    if (!silent) globalScope.navigate("dashboard");

    globalScope.sendTelemetry("end_session", {
      totalAnswered: globalScope.state.session.currentIndex,
    });
  }

  function saveSessionProgress() {
    if (!globalScope.state.session.active) return;

    try {
      globalScope.setStoredJSON("saved_session", globalScope.state.session);
      globalScope.state.prefs.lastActivity = {
        mode: "quiz",
        subject:
          globalScope.state.session.questions[
            globalScope.state.session.currentIndex
          ]?.Subject || null,
        updatedAt: new Date().toISOString(),
      };
      globalScope.setStoredJSON("prefs", globalScope.state.prefs);
    } catch (e) {
      console.warn(
        "Storage quota exceeded. Could not save session progress.",
        e,
      );
      globalScope.showToast("Storage full. Progress won't be saved.", "error");
    }
  }

  function checkSavedSession() {
    const saved = globalScope.getStoredItem("saved_session");
    const resumeContainer = document.getElementById("resume-container");
    const activity = globalScope.state.prefs.lastActivity;
    const contextEl = document.getElementById("resume-context");

    if (contextEl && activity) {
      const modeLabel = activity.mode === "review" ? "Study" : "Quiz";
      contextEl.innerText = activity.subject
        ? `${modeLabel} mode: ${activity.subject}`
        : `${modeLabel} mode`;
    }

    if (
      (saved || (activity?.mode === "review" && activity.subject)) &&
      resumeContainer
    ) {
      try {
        const session = saved ? JSON.parse(saved) : null;
        if (!session) {
          resumeContainer.classList.remove("hidden");
          return;
        }
        const isLastQuestion =
          session.currentIndex >= session.questions.length - 1;
        const isAnswered =
          session.userAnswers && session.userAnswers[session.currentIndex];

        if (isLastQuestion && isAnswered) {
          globalScope.removeStoredItem("saved_session");
          resumeContainer.classList.add("hidden");
          return;
        }
      } catch (e) {
        console.error("Error checking session", e);
      }

      resumeContainer.classList.remove("hidden");
    } else if (resumeContainer) {
      resumeContainer.classList.add("hidden");
    }
  }

  function clearSessionProgress() {
    globalScope.removeStoredItem("saved_session");
    globalScope.state.prefs.lastActivity = null;
    globalScope.setStoredJSON("prefs", globalScope.state.prefs);
    const resumeContainer = document.getElementById("resume-container");
    if (resumeContainer) {
      resumeContainer.classList.add("hidden");
    }
  }

  function revealAnswer() {
    if (!globalScope.state.session.active) return;

    const q =
      globalScope.state.session.questions[
        globalScope.state.session.currentIndex
      ];
    globalScope.state.session.userAnswers[
      globalScope.state.session.currentIndex
    ] = "REVEALED";
    globalScope.state.session.revealedCloze = true;

    const { isIdent: isPureIdent } = globalScope.getQuestionTypeMode(q);

    globalScope.trackStats(q, isPureIdent);

    document.getElementById("q-choices").classList.remove("hidden");
    const activeRecallMask = document.getElementById("active-recall-mask");
    if (activeRecallMask) activeRecallMask.classList.add("hidden");

    globalScope.renderQuestion();
    globalScope.saveSessionProgress();
    globalScope.startVisualTimer();

    if (globalScope.state.session.autoNextTimeout)
      clearTimeout(globalScope.state.session.autoNextTimeout);
    globalScope.state.session.autoNextTimeout = setTimeout(() => {
      globalScope.nextQuestion();
    }, 3000);
  }

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

  function getQuizNavigationPosition() {
    if (globalScope.state.prefs.quizNavigationPosition !== "auto")
      return globalScope.state.prefs.quizNavigationPosition;
    return window.innerWidth <= globalScope.QUIZ_NAVIGATION_BREAKPOINT
      ? "top"
      : "bottom";
  }

  function applyNavigationPosition() {
    const navigation = document.getElementById("quiz-navigation");
    const topAnchor = document.getElementById("quiz-navigation-top");
    const bottomAnchor = document.getElementById("quiz-navigation-bottom");
    if (!navigation || !topAnchor || !bottomAnchor) return;

    const savedPosition = globalScope.state.session.active
      ? getQuizNavigationPosition()
      : globalScope.state.prefs.reviewNavigationPosition;
    const position = savedPosition === "top" ? "top" : "bottom";
    (position === "top" ? topAnchor : bottomAnchor).appendChild(navigation);
    topAnchor.classList.toggle("hidden", position !== "top");
    bottomAnchor.classList.toggle("hidden", position !== "bottom");
  }

  function changeNavigationPosition(position) {
    const normalized = position === "top" ? "top" : "bottom";
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      globalScope.state.prefs.reviewNavigationPosition = normalized;
    } else {
      globalScope.state.prefs.quizNavigationPosition = normalized;
      globalScope.state.prefs.quizNavigationMode = "manual";
    }
    globalScope.saveState();
    globalScope.applyNavigationPosition();
    const select = document.getElementById("navigation-position-select");
    if (select) select.value = normalized;
    globalScope.sendTelemetry("change_navigation_position", {
      position: normalized,
    });
  }

  function toggleNavigationPosition(source) {
    globalScope.changeNavigationPosition(source.checked ? "bottom" : "top");
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
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
})(typeof window !== "undefined" ? window : globalThis);
