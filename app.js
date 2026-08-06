const DB_URL =
  "https://script.google.com/macros/s/AKfycbx4HFy5LmX_CFZMTOdl809OrnsgxzQvpzHDOhrMK3yk7fNZb7Gp2pImwBCS_I1Gx-D20g/exec";

const CHOICES_ARRAY = ["A", "B", "C", "D"];

let state = {
  db: [],
  categorySummary: [],
  stats: { totalAnswered: 0, correct: 0, mistakes: [], subjectAccuracy: {} },
  prefs: {
    darkMode: true,
    layoutMode: "grid",
    activeRecall: true,
    shuffleChoices: true,
    shuffleQuestions: true,
    hideABCD: false,
    quizHideABCD: false,
    showWrongChoices: false,
    archivedDecks: [],
  },
  session: {
    active: false,
    questions: [],
    currentIndex: 0,
    userAnswers: {},
    autoNextTimeout: null,
  },
  currentPath: [],
  reportQuestion: null,
};

let chartInstance = null;
let syncAbortController = null;

function generateUserId() {
  if (window.crypto && window.crypto.randomUUID) {
    return "user_" + crypto.randomUUID();
  }

  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return (
      "user_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
    );
  }
  return "user_" + Math.random().toString(36).substring(2, 15);
}

if (!state.prefs.userId) {
  state.prefs.userId = generateUserId();
}

function sendTelemetry(action, details) {
  const payload = JSON.stringify({
    type: "telemetry",
    userId: state.prefs.userId,
    action,
    details,
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    navigator.sendBeacon(DB_URL, blob);
  } else {
    fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}

function escapeHTML(value) {
  if (value === null || value === undefined) return "";

  return String(value).replace(
    /[&<>'"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[c],
  );
}

async function loadState() {
  const savedStats = localStorage.getItem("mrh_stats");
  const savedPrefs = localStorage.getItem("mrh_prefs");
  const savedSummary = localStorage.getItem("mrh_summary");

  try {
    if (typeof idbKeyval !== "undefined") {
      const savedDb = await idbKeyval.get("mrh_db");
      if (savedDb) {
        state.db = savedDb.map((q) => {
          if (q.ID && !q.ID.toString().includes("::")) {
            let cleanId = q.ID.toString().replace(/^[a-zA-Z]+[-\s]?/, "");
            q.ID = `${q.Subject}::${cleanId}`;
          }
          return q;
        });
      }
    } else {
      console.warn("idbKeyval library not loaded.");
    }
  } catch (err) {
    console.error("Error loading DB from IndexedDB", err);
  }

  if (savedSummary) {
    try {
      state.categorySummary = JSON.parse(savedSummary);
    } catch (e) {
      console.error("Summary corrupted, resetting.", e);
      state.categorySummary = [];
    }
  }

  if (savedStats) {
    try {
      state.stats = JSON.parse(savedStats);
    } catch (e) {
      console.error("Stats corrupted, resetting to default.", e);
      state.stats = {
        totalAnswered: 0,
        correct: 0,
        mistakes: [],
        subjectAccuracy: {},
      };
    }
  }

  if (savedPrefs) {
    try {
      const prefs = JSON.parse(savedPrefs);
      state.prefs = {
        ...state.prefs,
        ...prefs,
      };
    } catch (e) {
      console.error("Invalid preferences.", e);
    }
  }

  if (!state.stats.subjectAccuracy) state.stats.subjectAccuracy = {};
  if (state.prefs?.darkMode) document.documentElement.classList.add("dark");

  const dbSizeEl = document.getElementById("db-size-display");
  if (dbSizeEl) {
    dbSizeEl.innerText = state.db ? state.db.length : 0;
  }

  populateFilters();
  updateDashboard();
  updateThemeButton();
}

async function saveState() {
  try {
    localStorage.setItem("mrh_stats", JSON.stringify(state.stats));
    localStorage.setItem("mrh_prefs", JSON.stringify(state.prefs));
    localStorage.setItem("mrh_summary", JSON.stringify(state.categorySummary));
  } catch (e) {
    console.error(e);
  }

  updateDashboard();
}

async function safeIdbSet(key, value) {
  if (typeof idbKeyval !== "undefined") {
    await idbKeyval.set(key, value);
  }
}

async function safeIdbDel(key) {
  if (typeof idbKeyval !== "undefined") {
    await idbKeyval.del(key);
  }
}

function updateDashboard() {
  const statTotal = document.getElementById("stat-total");
  if (statTotal) statTotal.innerText = state.stats.totalAnswered;

  const statCorrect = document.getElementById("stat-correct");
  if (statCorrect) statCorrect.innerText = state.stats.correct;

  const dbSize = document.getElementById("db-size-display");
  if (dbSize) dbSize.innerText = state.db.length;

  if (typeof checkSavedSession === "function") checkSavedSession();
  if (typeof renderCategoryProgress === "function") renderCategoryProgress();
}

let settingsClickCount = 0;
let settingsClickTimeout = null;

function navigate(viewId) {
  if (viewId === "settings") {
    settingsClickCount++;
    clearTimeout(settingsClickTimeout);
    if (settingsClickCount >= 5) {
      const adminBtn = document.getElementById("btn-admin-nav");
      adminBtn.classList.remove("hidden");
      adminBtn.classList.add("animate-card-in");
      settingsClickCount = 0;
    } else {
      settingsClickTimeout = setTimeout(() => {
        settingsClickCount = 0;
      }, 2000);
    }
  }

  if (
    state.session.active &&
    viewId !== "practice" &&
    !confirm(
      "You have an active session. Do you want to pause and return? Your progress will be saved.",
    )
  )
    return;

  if (state.session.active && viewId !== "practice") {
    saveSessionProgress();
    state.session.active = false;
  }

  updateDashboard();

  document
    .querySelectorAll(".view-section")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(`view-${viewId}`).classList.add("active");

  if (viewId === "stats") renderCharts();

  // FIXED: Safely check if adminState is defined globally
  if (
    viewId === "admin" &&
    typeof adminState !== "undefined" &&
    adminState.token
  ) {
    if (typeof loadAdminSubjects === "function") {
      loadAdminSubjects();
    }
  }

  sendTelemetry("navigate", { view: viewId });
}

async function syncDatabase() {
  if (syncAbortController) {
    syncAbortController.abort();
  }

  syncAbortController = new AbortController();
  const timeoutId = setTimeout(() => syncAbortController.abort(), 20000);

  const url = DB_URL;
  const statusEl = document.getElementById("sync-status");

  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Fetching subjects...';
    statusEl.className =
      "text-sm mt-3 font-medium bg-blue-50 text-blue-600 p-3 rounded-lg animate-pulse";
  }

  try {
    const response = await fetch(url, {
      signal: syncAbortController.signal,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error("Network response failed");
    const summaryData = await response.json();

    if (summaryData && summaryData.length > 0) {
      state.categorySummary = summaryData;
      saveState();

      if (statusEl) {
        statusEl.innerHTML = `<i class="fa-solid fa-check-circle mr-1"></i> Success! Loaded ${summaryData.length} subjects.`;
        statusEl.className =
          "text-sm mt-3 font-medium bg-green-50 text-green-600 p-3 rounded-lg animate-card-in";
      }

      if (typeof populateFilters === "function") populateFilters();
      if (typeof renderCategoryProgress === "function")
        renderCategoryProgress();
    } else {
      if (statusEl) {
        statusEl.innerText = "Error: Connected, but no subjects found.";
        statusEl.className =
          "text-sm mt-3 font-medium bg-red-50 text-red-600 p-3 rounded-lg";
      }
    }
  } catch (err) {
    console.error(err);
    if (statusEl) {
      if (err.name === "AbortError") {
        statusEl.innerText = "Sync timed out. Using cached offline data.";
        statusEl.className =
          "text-sm mt-3 font-medium bg-yellow-50 text-yellow-700 p-3 rounded-lg";
      } else {
        statusEl.innerText =
          "Connection Error. Ensure you deployed the Apps Script correctly.";
        statusEl.className =
          "text-sm mt-3 font-medium bg-red-50 text-red-600 p-3 rounded-lg";
      }
    }

    const catList = document.getElementById("category-list");
    if (catList && state.categorySummary.length === 0) {
      catList.innerHTML = `
                    <div class="text-center py-10 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 animate-card-in">
                        <i class="fa-solid fa-triangle-exclamation text-3xl text-red-500 mb-3 hover:scale-110 transition-transform"></i>
                        <h3 class="font-bold text-red-700 dark:text-red-400">Database Connection Failed</h3>
                        <p class="text-sm text-red-600 dark:text-red-300 mt-1">Please check your internet connection or go to Settings to try syncing again.</p>
                    </div>`;
    }
  }
}

function populateFilters() {
  const select = document.getElementById("filter-subject");
  const subjects = [...new Set(state.db.map((q) => q.Subject).filter(Boolean))];

  let tags = new Set();
  state.db.forEach((q) => {
    if (q.Tags) {
      q.Tags.split(",")
        .map((t) => t.trim())
        .forEach((t) => tags.add(t));
    }
  });
  tags = [...tags];

  let html = '<option value="ALL">All Subjects (Randomized)</option>';
  if (subjects.length > 0) {
    html += '<optgroup label="Subjects">';
    html += subjects
      .map(
        (s) =>
          `<option value="SUBJ:${escapeHTML(s)}">${escapeHTML(s)}</option>`,
      )
      .join("");
    html += "</optgroup>";
  }
  if (tags.length > 0) {
    html += '<optgroup label="Tags">';
    html += tags
      .map(
        (t) => `<option value="TAG:${escapeHTML(t)}">${escapeHTML(t)}</option>`,
      )
      .join("");
    html += "</optgroup>";
  }

  select.innerHTML = html;
}

function prepareSessionPool(pool) {
  let randomizedPool = [...pool];
  if (state.prefs.shuffleQuestions !== false) {
    randomizedPool = shuffleArray(randomizedPool);
  }
  randomizedPool.sort((a, b) => {
    const aIsMistake = state.stats.mistakes.includes(a.ID);
    const bIsMistake = state.stats.mistakes.includes(b.ID);
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
      correctText = String(originalQ[`Choice${originalAns}`] || "")
        .trim()
        .toLowerCase();
    } else {
      correctText = String(q.Answer || "")
        .trim()
        .toLowerCase();
    }

    if (validChoices.length > 0) {
      if (state.prefs.shuffleChoices !== false) {
        validChoices = shuffleArray(validChoices);
      }

      q.ChoiceA = validChoices[0] || "";
      q.ChoiceB = validChoices[1] || "";
      q.ChoiceC = validChoices[2] || "";
      q.ChoiceD = validChoices[3] || "";

      if (q.ChoiceA.trim().toLowerCase() === correctText) q.Answer = "A";
      else if (q.ChoiceB.trim().toLowerCase() === correctText) q.Answer = "B";
      else if (q.ChoiceC.trim().toLowerCase() === correctText) q.Answer = "C";
      else if (q.ChoiceD.trim().toLowerCase() === correctText) q.Answer = "D";
      else if (validChoices.length === 1) q.Answer = "A";
      else q.Answer = "A";
    }
    return q;
  });
}

function initSession() {
  const filterVal = document.getElementById("filter-subject").value;
  let pool = [];

  if (filterVal === "MISTAKES") {
    pool = state.db.filter((q) => state.stats.mistakes.includes(q.ID));
  } else if (filterVal.startsWith("SUBJ:")) {
    const subj = filterVal.replace("SUBJ:", "");
    pool = state.db.filter((q) => q.Subject === subj);
  } else if (filterVal.startsWith("TAG:")) {
    const tag = filterVal.replace("TAG:", "");
    pool = state.db.filter((q) => q.Tags && q.Tags.includes(tag));
  } else {
    pool = state.db;
  }

  if (pool.length === 0) {
    alert("No questions found for this filter.");
    return;
  }
  pool = prepareSessionPool(pool);

  clearTimeout(state.session.autoNextTimeout);

  if (typeof stopVisualTimer === "function") {
    stopVisualTimer();
  }

  state.session = {
    active: true,
    questions: pool,
    currentIndex: 0,
    userAnswers: {},
  };

  document.getElementById("session-setup").classList.add("hidden");
  document.getElementById("session-active").classList.remove("hidden");

  renderQuestion();
  saveSessionProgress();
  sendTelemetry("start_session", { subject: filterVal, poolSize: pool.length });
}

function renderQuestion() {
  stopVisualTimer();
  const q = state.session.questions[state.session.currentIndex];
  const userAnswer = state.session.userAnswers[state.session.currentIndex];

  const currentCard = state.session.currentIndex + 1;
  const totalCards = state.session.questions.length;
  document.getElementById("session-progress-text").innerText =
    `${currentCard} / ${totalCards}`;
  document.getElementById("session-progress").style.width =
    `${((state.session.currentIndex + 1) / totalCards) * 100}%`;

  const fullSubject = q.Subject || "General";
  const parts = String(fullSubject).split("::");
  document.getElementById("q-subject").innerText =
    parts.length >= 2 ? parts.slice(-2).join(" :: ") : fullSubject;

  let displayId = q.ID ?? `Q-${state.session.currentIndex + 1}`;
  if (displayId.includes("::")) {
    const match = displayId.match(/::.*?\b(\d+)\s*$/);
    displayId = match ? match[1] : displayId.split("::").pop();
  }
  document.getElementById("q-id").innerText = "Question " + displayId;
  document.getElementById("q-text").innerHTML = formatQuestionText(q.Question);

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
        btn.innerHTML = `<span class="font-bold mr-2">${ch})</span> ${safeDisplayText}`;
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
    btnNext.disabled = true;
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
}

function enterFolder(folderName, isLockedFolder) {
  const fullPath =
    state.currentPath && state.currentPath.length > 0
      ? state.currentPath.join("::") + "::" + folderName
      : folderName;

  if (isLockedFolder) {
    openFolderPasswordModal(fullPath, folderName);
    return;
  }

  if (!state.currentPath) state.currentPath = [];
  state.currentPath.push(folderName);
  renderCategoryProgress();
}

function goToPath(index) {
  if (!state.currentPath) state.currentPath = [];
  if (index === -1) {
    state.currentPath = [];
  } else {
    state.currentPath = state.currentPath.slice(0, index + 1);
  }
  renderCategoryProgress();
}

function renderCategoryProgress() {
  const container = document.getElementById("category-list");
  const isGrid = state.prefs.layoutMode === "grid";
  const layoutIcon = document.getElementById("layout-icon");
  const layoutText = document.getElementById("layout-text");
  if (layoutIcon && layoutText) {
    layoutIcon.className = isGrid
      ? "fa-solid fa-list text-brand-500"
      : "fa-solid fa-table-cells text-brand-500";
    layoutText.innerText = isGrid ? "List View" : "Grid View";
  }
  let tree = {};
  if (state.categorySummary && state.categorySummary.length > 0) {
    state.categorySummary.forEach((cat) => {
      const parts = cat.Subject.split("::");
      let currentLevel = tree;

      parts.forEach((part, index) => {
        part = part.trim();
        if (!currentLevel[part]) {
          currentLevel[part] = { _children: {}, _data: null };
        }
        if (index === parts.length - 1) {
          currentLevel[part]._data = cat;
        }
        currentLevel = currentLevel[part]._children;
      });
    });
  }
  if (!state.currentPath) state.currentPath = [];
  let currentNode = tree;
  let pathValid = true;

  for (let dir of state.currentPath) {
    if (currentNode[dir]) {
      currentNode = currentNode[dir]._children;
    } else {
      pathValid = false;
      break;
    }
  }

  if (!pathValid) {
    state.currentPath = [];
    currentNode = tree;
  }
  function getFolderStats(node) {
    let total = 0;
    if (node._data) total += node._data.QuestionCount || 0;
    for (let k in node._children) {
      total += getFolderStats(node._children[k]);
    }
    return total;
  }
  let html = `
        <div class="flex items-center gap-2 mb-6 text-sm font-medium text-gray-600 dark:text-gray-400 overflow-x-auto pb-2 bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
            <button onclick="goToPath(-1)" class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors flex items-center gap-2">
                <i class="fa-solid fa-folder-open text-brand-500"></i> Home
            </button>
            ${state.currentPath
              .map(
                (dir, i) => `
                <i class="fa-solid fa-chevron-right text-xs text-gray-400"></i>
                <button onclick="goToPath(${i})" class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors whitespace-nowrap">${escapeHTML(dir)}</button>
            `,
              )
              .join("")}
        </div>`;

  const layoutClass = isGrid
    ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 lg:gap-8"
    : "flex flex-col space-y-4";

  html += `<div class="${layoutClass}">`;
  const keys = Object.keys(currentNode).sort();
  const sourceFilter =
    document.getElementById("deck-source-filter")?.value || "all";

  // CHANGED: Added currentKey and deep folder archive checks
  function nodeMatchesFilter(node, filter, currentKey = null) {
    const archivedDecks = state.prefs?.archivedDecks || [];
    let isArchived = false;

    // Check if the specific node/deck is archived
    if (
      node._data &&
      node._data.Subject &&
      archivedDecks.includes(node._data.Subject)
    ) {
      isArchived = true;
    }
    // Check if the top-level root folder of this node is archived
    if (node._data && node._data.Subject) {
      const topLevel = node._data.Subject.split("::")[0];
      if (archivedDecks.includes(topLevel)) {
        isArchived = true;
      }
    }
    // Check if the folder itself is archived while rendering the home view
    if (currentKey && (!state.currentPath || state.currentPath.length === 0)) {
      if (archivedDecks.includes(currentKey)) {
        isArchived = true;
      }
    }
    // Inherit archive state if we are inside a folder whose root is archived
    if (
      state.currentPath &&
      state.currentPath.length > 0 &&
      archivedDecks.includes(state.currentPath[0])
    ) {
      isArchived = true;
    }

    if (filter === "archived") return isArchived;
    if (isArchived) return false;

    if (filter === "all") return true;

    if (
      node._data !== null &&
      node._data !== undefined &&
      !node._data.IsFolder
    ) {
      const isDownloaded = (state.db || []).some(
        (q) => q.Subject === node._data.Subject,
      );
      if (filter === "downloaded") return isDownloaded;
      if (filter === "cloud") return !isDownloaded;
    }

    const childKeys = Object.keys(node._children || {});
    if (childKeys.length > 0) {
      return childKeys.some((childKey) =>
        nodeMatchesFilter(node._children[childKey], filter, childKey),
      );
    }

    return false;
  }

  // CHANGED: Pass the current key for folder evaluation
  let visibleKeys = keys.filter((key) => {
    return nodeMatchesFilter(currentNode[key], sourceFilter, key);
  });

  if (visibleKeys.length === 0) {
    html += `<div class="col-span-full text-center py-10 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">No decks match your filter.</div>`;
  }

  function generateCardHTML(cat, displayName, delay = 0) {
    const subj = cat.Subject;
    const safeSubj = escapeHTML(subj);
    const safeName = escapeHTML(displayName);
    const totalQuestionsInDb = cat.QuestionCount;

    // CHANGED: Restrict Archive Icon to Root Path only
    const isRoot = !state.currentPath || state.currentPath.length === 0;
    const isArchived = (state.prefs?.archivedDecks || []).includes(subj);
    const archiveIconColor = isArchived
      ? "text-amber-500 hover:text-amber-600"
      : "text-gray-400 hover:text-brand-500";

    let archiveBtnHTML = "";
    if (isRoot) {
      archiveBtnHTML = `
                <button onclick="event.stopPropagation(); toggleArchiveDeck('${safeSubj}')" 
                        class="transition-all transform hover:scale-110 active:scale-90 ${archiveIconColor} p-1" 
                        title="${isArchived ? "Unarchive Deck" : "Archive Deck"}">
                    <i class="fa-solid fa-box-archive"></i>
                </button>
            `;
    }

    const data = state.stats.subjectAccuracy[subj] || { total: 0, correct: 0 };
    const dbQsForSubj = state.db
      .filter((q) => q.Subject === subj)
      .map((q) => q.ID);
    const completedCount = state.stats.completedQs
      ? state.stats.completedQs.filter((id) => dbQsForSubj.includes(id)).length
      : 0;
    const mistakesCount = state.stats.mistakes
      ? state.stats.mistakes.filter((id) => dbQsForSubj.includes(id)).length
      : 0;
    const progressPercent =
      totalQuestionsInDb > 0
        ? Math.min(100, Math.round((completedCount / totalQuestionsInDb) * 100))
        : 0;
    const isCompleted =
      totalQuestionsInDb > 0 && completedCount >= totalQuestionsInDb;
    const cardClasses = isCompleted
      ? "bg-green-50 dark:bg-green-900/30 border-green-300"
      : "bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700";
    const isDownloaded = state.db.some((q) => q.Subject === subj);
    const statusBadge = isDownloaded
      ? `<span class="bg-green-100 text-green-800 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold dark:bg-green-900/40 dark:text-green-400 shadow-sm transition-colors"><i class="fa-solid fa-hard-drive mr-1"></i></span>`
      : `<span class="bg-gray-100 text-gray-500 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold dark:bg-gray-700 dark:text-gray-400 shadow-sm transition-colors"><i class="fa-solid fa-cloud mr-1"></i></span>`;
    const isReview = currentAppMode === "review";
    const primaryActionText = isReview
      ? "Review Deck"
      : completedCount === 0
        ? "Start Quiz"
        : "Continue Quiz";
    const primaryActionIcon = isReview ? "fa-eye" : "fa-play";
    const primaryActionColor = isReview
      ? "bg-purple-600 hover:bg-purple-700"
      : "bg-brand-600 hover:bg-brand-700";
    const themeColorText = isReview
      ? "text-purple-600 dark:text-purple-400"
      : "text-brand-600 dark:text-brand-400";
    const themeColorBg = isReview ? "bg-purple-500" : "bg-brand-500";
    const themeShadowHover = isReview
      ? "hover:shadow-purple-500/10"
      : "hover:shadow-brand-500/10";
    const loaderColor = isReview ? "text-purple-500" : "text-brand-500";
    const isLocked = cat.Locked === true;
    const lockIcon = isLocked
      ? `<i class="fa-solid fa-lock text-red-500 ml-2" title="Password Protected"></i>`
      : "";

    let statsHTML = "";
    let progressBarHTML = "";
    let countBadgeHTML = "";
    let resetBtnHTML = "";

    if (!isReview) {
      // statsHTML = `<p class="text-xs text-gray-500 dark:text-gray-400 transition-colors">Accuracy: ${data.total > 0 ? Math.round((data.correct/data.total)*100) : 0}%</p>`;
      countBadgeHTML = `
                <div class="flex items-center gap-2 flex-shrink-0 pt-1">
                    ${archiveBtnHTML}
                    ${isDownloaded ? `<button onclick="event.stopPropagation(); deleteSubjectData('${safeSubj}')" class="text-gray-400 hover:text-red-500 hover:scale-125 hover:rotate-12 transition-all duration-300 p-1" title="Delete Downloaded Data"><i class="fa-solid fa-trash-can"></i></button>` : ``}
                    <span class="text-sm font-black ${themeColorText} transition-colors">${completedCount} / ${totalQuestionsInDb}</span>
                </div>`;
      progressBarHTML = `
                <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-4 overflow-hidden">
                    <div class="${themeColorBg} h-full rounded-full transition-all duration-700 ease-out" style="width: ${progressPercent}%"></div>
                </div>`;

      if (completedCount > 0 || mistakesCount > 0) {
        resetBtnHTML = `
                    <button onclick="resetCategory('${safeSubj}')" class="w-10 sm:w-12 shrink-0 bg-red-50 text-red-600 dark:bg-red-900/20 py-2 px-1 rounded-lg font-bold hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-90 transition-all duration-300 text-xs sm:text-sm border border-red-100 dark:border-red-800 flex items-center justify-center" title="Reset Progress">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>`;
      }
    } else {
      countBadgeHTML = `
                <div class="flex items-center gap-2 flex-shrink-0 pt-1">
                    ${archiveBtnHTML}
                    ${isDownloaded ? `<button onclick="event.stopPropagation(); deleteSubjectData('${safeSubj}')" class="text-gray-400 hover:text-red-500 hover:scale-125 hover:rotate-12 transition-all duration-300 p-1" title="Delete Downloaded Data"><i class="fa-solid fa-trash-can"></i></button>` : ``}
                </div>`;
    }

    return `
        <div onclick="handleDeckClick('${safeSubj}')" class="cursor-pointer animate-card-in ${cardClasses} p-5 rounded-xl shadow-sm hover:shadow-lg hover:-translate-y-1 ${themeShadowHover} active:scale-[0.99] border transition-all duration-400 relative w-full h-full flex flex-col" style="animation-delay: ${delay}s;">
                <div id="loading-${safeSubj}" class="hidden absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-10 rounded-xl flex flex-col items-center justify-center transition-opacity">
                    <i class="fa-solid fa-spinner fa-spin text-3xl ${loaderColor} mb-2"></i>
                    <span class="text-sm font-bold text-gray-700 dark:text-gray-200">Fetching Latest...</span>
                </div>

                <!-- Card Header -->
                <div class="flex items-start justify-between mb-4 gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 mb-1 min-w-0">
                            <h3 class="font-bold text-lg text-gray-800 dark:text-gray-100 flex items-center transition-colors truncate min-w-0">
                                <i class="fa-regular fa-file-lines text-gray-400 mr-2 text-sm flex-shrink-0"></i>
                                <span class="truncate">${safeName}</span> ${lockIcon}
                            </h3>
                            <div class="flex-shrink-0">
                                ${statusBadge}
                            </div>
                        </div>
                        ${statsHTML}
                    </div>
                    ${countBadgeHTML}
                </div>
                
                ${progressBarHTML}
                
                <div class="flex gap-2 mt-auto w-full" onclick="event.stopPropagation()">
                    <!-- Primary Action Button -->
                    <button onclick="handleDeckClick('${safeSubj}')" class="flex-1 ${primaryActionColor} text-white py-2 px-2 rounded-lg font-bold active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="${primaryActionText}">
                        <i class="fa-solid ${primaryActionIcon} mr-1 sm:mr-2 group-hover:scale-125 transition-transform flex-shrink-0"></i> 
                        <span class="truncate">${primaryActionText}</span>
                    </button>
                    
                    <!-- Review Mistakes Button -->
                    ${
                      !isReview && mistakesCount > 0
                        ? `
                        <button onclick="handleDeckClick('${safeSubj}', 'mistakes')" class="flex-1 bg-yellow-500 text-white py-2 px-2 rounded-lg font-bold hover:bg-yellow-600 active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="Review Mistakes">
                            <i class="fa-solid fa-triangle-exclamation mr-1 sm:mr-2 group-hover:scale-125 transition-transform flex-shrink-0"></i> 
                            <span class="truncate">Review (${mistakesCount})</span>
                        </button>
                    `
                        : ""
                    }

                    <!-- Reset Button -->
                    ${resetBtnHTML}
                </div>
            </div>
        `;
  }

  visibleKeys.forEach((key, index) => {
    const item = currentNode[key];
    const hasChildren = Object.keys(item._children).length > 0;
    const hasData = item._data !== null;

    const isExplicitFolder = hasData && item._data.IsFolder === true;
    const delay = index * 0.05;

    if (hasChildren || isExplicitFolder) {
      const totalCards = getFolderStats(item);
      const folderClass = isGrid ? "h-full min-h-[140px]" : "h-auto";

      const isReview = currentAppMode === "review";
      const folderColorClass = isReview
        ? "bg-purple-500 dark:bg-purple-700 group-hover:bg-purple-600 dark:group-hover:bg-purple-600"
        : "bg-brand-500 dark:bg-brand-700 group-hover:bg-brand-600 dark:group-hover:bg-brand-600";
      const folderTextHover = isReview
        ? "group-hover:text-purple-600 dark:group-hover:text-purple-400"
        : "group-hover:text-brand-600 dark:group-hover:text-brand-400";

      const isLocked = hasData && item._data.Locked === true;
      const lockIcon = isLocked
        ? `<i class="fa-solid fa-lock text-red-500 ml-2" title="Password Protected Folder"></i>`
        : "";

      // CHANGED: Support Archiving Folders at the Root layer
      const isRoot = !state.currentPath || state.currentPath.length === 0;
      let archiveBtnHtml = "";

      if (isRoot) {
        const isArchived = (state.prefs?.archivedDecks || []).includes(key);
        // Changed colors since it is now placed on a white/gray background
        const archiveIconColor = isArchived
          ? "text-amber-500 hover:text-amber-600"
          : "text-gray-400 hover:text-brand-500";
        archiveBtnHtml = `
                    <button onclick="event.stopPropagation(); toggleArchiveDeck('${escapeHTML(key)}')"
                            class="transition-all transform hover:scale-110 active:scale-90 ${archiveIconColor} p-1 z-10"
                            title="${isArchived ? "Unarchive Folder" : "Archive Folder"}">
                        <i class="fa-solid fa-box-archive text-lg"></i>
                    </button>
                `;
      }

      html += `
                <div onclick="enterFolder('${escapeHTML(key)}', ${isLocked})" class="cursor-pointer group animate-card-in bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col ${folderClass} transform hover:-translate-y-1 relative" style="animation-delay: ${delay}s;">
                    <div class="h-12 ${folderColorClass} transition-colors relative">                        
                        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
                    </div>
                    <div class="p-4 flex-1 flex flex-col justify-between">
                        <div class="flex justify-between items-start w-full gap-2">
                            <h3 class="font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide ${folderTextHover} transition-colors text-lg flex items-center min-w-0">
                                <span class="truncate">${escapeHTML(key)}</span> ${lockIcon}
                            </h3>
                            ${archiveBtnHtml}
                        </div>
                        <div class="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400 mt-2">
                            <span>${totalCards} cards</span>
                            <span class="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full text-xs font-semibold">Deck</span>
                        </div>
                    </div>
                </div>`;
    } else if (hasData && !isExplicitFolder) {
      html += generateCardHTML(item._data, key, delay);
    }
  });

  html += `</div>`;
  container.className = "transition-all duration-500";
  container.innerHTML = html;
}

async function fetchAndStartCategory(subject, mode, pass = null) {
  const loader = document.getElementById(`loading-${subject}`);

  // Define strict MCQ filter condition conditionally based on user preference
  const isForcedMCQ = state.prefs.qTypeOverride === "mcq";
  const customFilter = isForcedMCQ
    ? (q) =>
        q.ChoiceA &&
        q.ChoiceA.trim() !== "" &&
        q.ChoiceB &&
        q.ChoiceB.trim() !== ""
    : null;

  // Always attempt to fetch fresh data for gameplay sessions
  let validQuestions = await fetchDeckQuestions(
    subject,
    pass,
    loader,
    customFilter,
  );

  // Fallback check if offline and fetch returned empty
  if (validQuestions.length === 0) {
    alert(
      `Cannot start session. You are offline and "${subject}" has not been downloaded to your device yet.`,
    );
    return;
  }

  if (!state.stats.completedQs) state.stats.completedQs = [];

  let pool = [];
  if (mode === "continue") {
    pool = validQuestions.filter(
      (q) => !state.stats.completedQs.includes(q.ID),
    );
    if (pool.length === 0) {
      alert(
        `You have answered all available questions for ${subject}! Reset the category to start over.`,
      );
      return;
    }
  } else if (mode === "mistakes") {
    pool = validQuestions.filter((q) => state.stats.mistakes.includes(q.ID));
    if (pool.length === 0) {
      alert(`No mistakes to review for ${subject}! Great job.`);
      return;
    }
  }

  startCustomSession(pool);
}

function startCustomSession(pool) {
  navigate("practice");
  document.getElementById("session-setup").classList.add("hidden");
  document.getElementById("session-active").classList.remove("hidden");

  pool = prepareSessionPool(pool);

  state.session = {
    active: true,
    questions: pool,
    currentIndex: 0,
    userAnswers: {},
  };

  renderQuestion();
  saveSessionProgress();
}

function resetCategory(subject) {
  if (
    confirm(
      `Are you sure you want to reset your accuracy and progress statistics for "${subject}"? This cannot be undone.`,
    )
  ) {
    if (state.stats.subjectAccuracy[subject]) {
      state.stats.subjectAccuracy[subject] = { total: 0, correct: 0 };
    }

    const subjectQIDs = state.db
      .filter((q) => q.Subject === subject)
      .map((q) => q.ID);

    if (state.stats.completedQs) {
      state.stats.completedQs = state.stats.completedQs.filter(
        (id) => !subjectQIDs.includes(id),
      );
    }

    if (state.stats.mistakes) {
      state.stats.mistakes = state.stats.mistakes.filter(
        (id) => !subjectQIDs.includes(id),
      );
    }

    saveState();
    renderCategoryProgress();
    if (chartInstance) renderCharts();
  }
}

async function deleteSubjectData(subject) {
  if (
    confirm(
      `Are you sure you want to delete the downloaded questions for "${subject}"? Your accuracy and progress stats will remain, but the app will remove the local data to save space.`,
    )
  ) {
    state.db = state.db.filter((q) => q.Subject !== subject);
    await safeIdbSet("mrh_db", state.db);

    const saved = localStorage.getItem("mrh_saved_session");
    if (saved) {
      try {
        const sessionObj = JSON.parse(saved);
        const hasDeletedQuestions = sessionObj.questions.some(
          (q) => q.Subject === subject,
        );

        if (hasDeletedQuestions) {
          let newQuestions = [];
          let newUserAnswers = {};
          let keptBeforeCurrent = 0;

          let newIdx = 0;
          for (let i = 0; i < sessionObj.questions.length; i++) {
            if (sessionObj.questions[i].Subject !== subject) {
              newQuestions.push(sessionObj.questions[i]);

              if (sessionObj.userAnswers[i]) {
                newUserAnswers[newIdx] = sessionObj.userAnswers[i];
              }

              if (i < sessionObj.currentIndex) {
                keptBeforeCurrent++;
              }

              newIdx++;
            }
          }

          if (newQuestions.length === 0) {
            clearSessionProgress();
            state.session = {
              active: false,
              questions: [],
              currentIndex: 0,
              userAnswers: {},
            };
          } else {
            sessionObj.questions = newQuestions;
            sessionObj.userAnswers = newUserAnswers;
            sessionObj.currentIndex = Math.min(
              keptBeforeCurrent,
              newQuestions.length - 1,
            );
            localStorage.setItem(
              "mrh_saved_session",
              JSON.stringify(sessionObj),
            );

            if (state.session.active) {
              state.session = sessionObj;
            }
          }
        }
      } catch (e) {
        console.error("Error parsing saved session during deletion.", e);
      }
    }
    updateDashboard();
  }
}

async function fetchDeckQuestions(
  subject,
  pass = null,
  loaderElement = null,
  customFilter = null,
) {
  let cachedQuestions = state.db.filter((q) => q.Subject === subject);
  if (typeof customFilter === "function") {
    cachedQuestions = cachedQuestions.filter(customFilter);
  }

  if (cachedQuestions.length > 0 && !pass) {
    fetchDeckQuestionsFromNetwork(subject, pass, customFilter).catch(() => {});
    return cachedQuestions;
  }

  return await fetchDeckQuestionsFromNetwork(
    subject,
    pass,
    customFilter,
    loaderElement,
  );
}

async function fetchDeckQuestionsFromNetwork(
  subject,
  pass,
  customFilter,
  loaderElement = null,
) {
  if (loaderElement) loaderElement.classList.remove("hidden");
  try {
    let fetchUrl = `${DB_URL}?subject=${encodeURIComponent(subject)}`;
    if (pass) fetchUrl += `&password=${encodeURIComponent(pass)}`;

    const response = await fetch(fetchUrl);
    const newQuestions = await response.json();
    if (newQuestions.error) throw new Error(newQuestions.error);

    let validQuestions = newQuestions.filter(
      (q) => q.Question && q.Question.trim() !== "",
    );
    if (typeof customFilter === "function")
      validQuestions = validQuestions.filter(customFilter);

    validQuestions = validQuestions.map((q) => {
      let cleanId = q.ID
        ? q.ID.toString().replace(/^[a-zA-Z]+[-\s]?/, "")
        : Math.random().toString(36).substr(2, 6);
      q.ID = `${q.Subject}::${cleanId}`;
      return q;
    });

    const otherQuestions = state.db.filter((q) => q.Subject !== subject);
    state.db = [...otherQuestions, ...validQuestions];
    await safeIdbSet("mrh_db", state.db);

    return validQuestions;
  } catch (err) {
    console.warn("Network fetch failed.", err);
    return state.db.filter((q) => q.Subject === subject);
  } finally {
    if (loaderElement) loaderElement.classList.add("hidden");
  }
}

async function reviewDeck(subject, pass = null) {
  const loader = document.getElementById(`loading-${subject}`);

  // Check local cache first if no password is provided
  let validQuestions = [];
  if (!pass) {
    validQuestions = state.db.filter((q) => q.Subject === subject);
  }

  // Fetch if cache is empty or password is required
  if (validQuestions.length === 0 || pass) {
    validQuestions = await fetchDeckQuestions(subject, pass, loader);
  }

  if (validQuestions.length === 0) {
    alert(
      `Cannot review deck. You are offline and "${subject}" has not been downloaded yet.`,
    );
    if (loader) loader.classList.add("hidden");
    return;
  }

  if (loader) loader.classList.add("hidden");
  renderDeckReview(subject, validQuestions);
}

let currentReviewSubject = "";
let currentReviewQuestions = [];

function reRenderDeckReview() {
  renderDeckReview(currentReviewSubject, currentReviewQuestions);
}

function renderDeckReview(subject, questions) {
  currentReviewSubject = subject;
  currentReviewQuestions = questions;

  const container = document.getElementById("deck-review-list");
  document.getElementById("deck-review-title").innerText = subject;

  const globalShowWrong = state.prefs.showWrongChoices !== false;
  const hideABCD = state.prefs.hideABCD === true;
  let layout = state.prefs.studyLayout || "scroll";
  let pageSize = state.prefs.studyPageSize || 50;

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

  let html = `
    <details class="group bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6 transition-all duration-300">
        <summary class="p-4 cursor-pointer font-bold text-gray-700 dark:text-gray-200 flex justify-between items-center select-none">
            <span><i class="fa-solid fa-sliders mr-2"></i> Study Settings</span>
            <i class="fa-solid fa-chevron-down transition-transform group-open:rotate-180"></i>
        </summary>
        <div class="p-4 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-4 bg-gray-50 dark:bg-gray-800/50">
            
            <div class="flex flex-col gap-1 w-full sm:w-auto">
                <label class="text-xs font-bold text-gray-500 uppercase">Layout</label>
                <select class="..." onchange="changeStudyLayout(this.value)">
                    <option value="scroll" ${layout === "scroll" ? "selected" : ""}>Scroll List</option>
                    <option value="single" ${layout === "single" ? "selected" : ""}>Single Flashcard</option>
                </select>
            </div>

            ${
              layout === "scroll"
                ? `
            <div class="flex flex-col gap-1 w-full sm:w-auto">
                <label class="text-xs font-bold text-gray-500 uppercase">Per Page</label>
                <select class="..." onchange="changeStudyPageSize(this.value)">
                    ${[5, 10, 15, 25, 50, 100, "All"].map((size) => `<option value="${size}" ${pageSize == size ? "selected" : ""}>${size}</option>`).join("")}
                </select>
            </div>`
                : ""
            }
        </div>
    </details>
`;

  if (questions.length === 0) {
    container.innerHTML =
      html +
      `<div class="text-center p-8 text-gray-500">No questions found for this deck.</div>`;
    navigate("deck-review");
    return;
  }

  let displayQuestions = [];
  let totalPages = 1;

  if (layout === "single") {
    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= questions.length) currentIndex = questions.length - 1;
    progress.index = currentIndex;

    displayQuestions = [questions[currentIndex]];
  } else {
    if (pageSize === "All") {
      displayQuestions = questions;
    } else {
      totalPages = Math.ceil(questions.length / pageSize);
      if (currentPage < 1) currentPage = 1;
      if (currentPage > totalPages) currentPage = totalPages;
      progress.page = currentPage;

      let start = (currentPage - 1) * pageSize;
      displayQuestions = questions.slice(start, start + pageSize);
    }
  }

  if (layout === "single") {
    html += `
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
    html += `
            <div class="flex justify-between items-center mt-6 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 sticky bottom-4 z-10 gap-2">
                <button onclick="changeStudyPage(-1)" ${currentPage === 1 ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                    <i class="fa-solid fa-arrow-left"></i> <span class="hidden sm:inline ml-1">Prev</span>
                </button>
                <span class="text-sm font-bold text-gray-600 dark:text-gray-300 flex-1 text-center">Page ${currentPage} / ${totalPages}</span>
                <button onclick="changeStudyPage(1)" ${currentPage === totalPages ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                    <span class="hidden sm:inline mr-1">Next</span> <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        `;
  }

  displayQuestions.forEach((q) => {
    let originalIndex = questions.indexOf(q);

    let rawQuestionText = q.Question ? String(q.Question) : "";
    let cleanQuestionText = rawQuestionText.replace(/^\s*\d+\.\s*/, "");

    let ansStr = q.Answer ? String(q.Answer).trim() : "";
    let isMultipleChoice = ["A", "B", "C", "D"].includes(ansStr.toUpperCase());

    let correctText = ansStr;
    if (isMultipleChoice) {
      correctText = q[`Choice${ansStr.toUpperCase()}`] || ansStr;
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
                                    <i class="fa-solid fa-check-circle mr-2"></i> ${prefix}${escapeHTML(choiceText)}
                                </p>
                            </div>`;
          } else {
            choicesHTML += `
                            <div class="bg-gray-50 dark:bg-gray-800/50 border-l-4 border-gray-300 dark:border-gray-600 p-3 rounded-r-lg opacity-70">
                                <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    <i class="fa-solid fa-times mr-2 opacity-50"></i> ${prefix}${escapeHTML(choiceText)}
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

    let reportClass = globallyReportedQs.has(q.ID)
      ? "text-red-500 bg-red-50 dark:bg-red-900/30"
      : "text-gray-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500";

    html += `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6 animate-card-in">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
                    <span class="bg-brand-50 text-brand-600 text-xs px-2 py-1 rounded font-bold dark:bg-brand-900/30 dark:text-brand-400">Question ${originalIndex + 1}</span>
                    
                    <div class="flex gap-2">
                        <!-- Feature 16: Individual Toggle Button -->
                        <button onclick="toggleSpecificChoices('${q.ID}')" class="text-xs font-bold px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors">
                            ${showWrongForThisQ ? '<i class="fa-solid fa-eye-slash mr-1"></i> Hide Choices' : '<i class="fa-solid fa-eye mr-1"></i> Show Choices'}
                        </button>

                        <button onclick="openReportModalFromStudy('${q.ID}')" class="${reportClass} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm active:scale-95 transition-all" title="${globallyReportedQs.has(q.ID) ? "Active Community Report" : "Report Issue"}">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </button>
                    </div>
                </div>
                
                <p class="font-medium text-gray-800 dark:text-gray-100 mb-2 text-lg">${formatQuestionText(cleanQuestionText)}</p>
                
                ${q.ImageURL ? `<img src="${escapeHTML(q.ImageURL)}" alt="Reference" class="w-full max-w-md mx-auto rounded-lg mb-4 shadow-sm border transition-all duration-500">` : ""}                        
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

  container.innerHTML = html;
  navigate("deck-review");

  setTimeout(() => {
    const scrollContainer = document.querySelector("main");
    if (scrollContainer && layout === "scroll") {
      scrollContainer.scrollTop = progress.scrollY || 0;
    }
  }, 100);

  sendTelemetry("start_review", {
    subject: subject,
    poolSize: questions.length,
  });
}

function toggleHideABCD() {
  const isHidden = document.getElementById("toggle-hide-abcd").checked;
  state.prefs.hideABCD = isHidden;
  saveState();

  reRenderDeckReview();
}

function toggleQuizHideABCD() {
  const isHidden = document.getElementById("toggle-quiz-hide-abcd").checked;

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
  reRenderDeckReview();
}

function toggleArchiveDeck(subjectId) {
  if (!state.prefs.archivedDecks) {
    state.prefs.archivedDecks = [];
  }

  const index = state.prefs.archivedDecks.indexOf(subjectId);

  if (index > -1) {
    state.prefs.archivedDecks.splice(index, 1);
    showToast("Deck unarchived");
  } else {
    if (!confirm(`Are you sure you want to archive "${subjectId}"?`)) {
      return;
    }
    state.prefs.archivedDecks.push(subjectId);
    showToast("Deck archived");
  }

  saveState();

  // Refresh the dashboard to instantly hide/show the deck based on the current filter
  renderCategoryProgress();
}

function submitPracticeAnswer(selected, correct) {
  const q = state.session.questions[state.session.currentIndex];
  state.session.userAnswers[state.session.currentIndex] = selected;

  trackStats(q, selected === correct);
  document
    .getElementById("q-choices")
    .querySelectorAll(".choice-btn")
    .forEach((btn) => {
      btn.onclick = null;
      if (btn.dataset.choice === correct) btn.classList.add("selected-correct");
      else if (btn.dataset.choice === selected)
        btn.classList.add("selected-wrong");
      else btn.classList.add("dimmed");
    });

  showExplanation(q);

  document.getElementById("btn-next").disabled = false;
  document.getElementById("btn-reveal").disabled = true;
  document.getElementById("session-progress").style.width =
    `${((state.session.currentIndex + 1) / state.session.questions.length) * 100}%`;

  startVisualTimer();
  if (state.session.autoNextTimeout)
    clearTimeout(state.session.autoNextTimeout);
  state.session.autoNextTimeout = setTimeout(() => {
    nextQuestion();
  }, 3000);
}

function showExplanation(q) {
  const expBox = document.getElementById("q-explanation-box");

  if (q.Explanation && q.Explanation.trim() !== "") {
    document.getElementById("q-explanation-text").innerHTML =
      formatQuestionText(q.Explanation);
    expBox.classList.remove("hidden");
  } else {
    expBox.classList.add("hidden");
  }
}

function nextQuestion() {
  if (state.session.autoNextTimeout)
    clearTimeout(state.session.autoNextTimeout);
  stopVisualTimer();

  if (state.session.currentIndex < state.session.questions.length - 1) {
    state.session.currentIndex++;
    renderQuestion();
    saveSessionProgress();
  } else {
    alert("Practice Session Complete! Great job.");
    clearSessionProgress();
    endSession(false);
  }
}

function prevQuestion() {
  if (state.session.autoNextTimeout)
    clearTimeout(state.session.autoNextTimeout);
  stopVisualTimer();

  if (state.session.currentIndex > 0) {
    state.session.currentIndex--;
    renderQuestion();
  }
  saveSessionProgress();
}

function trackStats(q, isCorrect) {
  state.stats.totalAnswered++;

  const subj = q.Subject || "General";
  if (!state.stats.subjectAccuracy[subj])
    state.stats.subjectAccuracy[subj] = { total: 0, correct: 0 };
  state.stats.subjectAccuracy[subj].total++;

  if (!state.stats.completedQs) state.stats.completedQs = [];
  if (!state.stats.completedQs.includes(q.ID)) {
    state.stats.completedQs.push(q.ID);
  }

  if (isCorrect) {
    state.stats.correct++;
    state.stats.subjectAccuracy[subj].correct++;
    state.stats.mistakes = state.stats.mistakes.filter((id) => id !== q.ID);
  } else {
    if (!state.stats.mistakes.includes(q.ID)) state.stats.mistakes.push(q.ID);
  }
  saveState();
  sendTelemetry("answer_question", { qId: q.ID, isCorrect });
}

function endSession(silent = false) {
  const isLastQuestion =
    state.session.currentIndex >= state.session.questions.length - 1;
  const isAnswered =
    state.session.userAnswers &&
    state.session.userAnswers[state.session.currentIndex];

  if (isLastQuestion && isAnswered) {
    clearSessionProgress();
  } else {
    saveSessionProgress();
  }

  state.session.active = false;
  if (!silent) navigate("dashboard");

  sendTelemetry("end_session", { totalAnswered: state.session.currentIndex });
}

let chartRetryCount = 0;

function renderCharts() {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js is still loading...");
    if (chartRetryCount < 10) {
      // Retries every 500ms for up to 5 seconds
      chartRetryCount++;
      setTimeout(renderCharts, 500);
    } else {
      console.error("Chart.js failed to load entirely.");
    }
    return;
  }

  chartRetryCount = 0; // Reset counter on successful load

  const canvas = document.getElementById("chart-accuracy");
  if (!canvas) return; // Guard against running when element is missing

  if (typeof chartInstance !== "undefined" && chartInstance) {
    chartInstance.destroy();
  }

  const ctx = canvas.getContext("2d");
  const accuracyMap = state.stats?.subjectAccuracy || {};
  let labels = Object.keys(accuracyMap);
  let data = [];

  if (labels.length === 0) {
    labels = ["COLREG", "Navigation", "Meteorology"];
    data = [0, 0, 0];
  } else {
    data = labels.map((s) => {
      const d = accuracyMap[s];
      if (!d || !d.total) return 0;
      return Math.round((d.correct / d.total) * 100);
    });
  }

  chartInstance = new Chart(ctx, {
    type: "radar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Accuracy %",
          data: data,
          backgroundColor: "rgba(59, 130, 246, 0.2)",
          borderColor: "rgba(59, 130, 246, 1)",
          pointBackgroundColor: "rgba(59, 130, 246, 1)",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 20 } } },
      plugins: { legend: { display: false } },
      animation: {
        duration: 1500,
        easing: "easeOutQuart",
      },
    },
  });
}

function toggleTheme() {
  state.prefs.darkMode = !state.prefs.darkMode;
  document.documentElement.classList.toggle("dark", state.prefs.darkMode);
  saveState();
  updateThemeButton();
}

function updateThemeButton() {
  const btn = document.getElementById("btn-theme-toggle");
  if (btn) {
    btn.innerHTML = state.prefs.darkMode
      ? '<i class="fa-solid fa-sun mr-1 transition-transform transform hover:rotate-180 duration-500"></i> Light Mode'
      : '<i class="fa-solid fa-moon mr-1 transition-transform transform hover:rotate-12 duration-300"></i> Dark Mode';
  }
}

function resetProgress() {
  if (
    confirm(
      "Are you sure? This deletes mistakes, all statistics, and your current saved session.",
    )
  ) {
    state.stats = {
      totalAnswered: 0,
      correct: 0,
      mistakes: [],
      subjectAccuracy: {},
      completedQs: [],
    };
    state.session = {
      active: false,
      questions: [],
      currentIndex: 0,
      userAnswers: {},
    };

    state.prefs.studyProgress = {};
    state.prefs.qToggles = {};

    clearSessionProgress();
    saveState();
    alert("Progress Reset.");

    if (document.getElementById("view-stats").classList.contains("active"))
      renderCharts();
  }
}

async function clearDatabase() {
  if (
    confirm(
      "WARNING: Are you sure you want to clear the locally saved database? You will need an active internet connection to sync the questions again. The app will reload to apply changes.",
    )
  ) {
    await safeIdbDel("mrh_db");
    state.db = [];
    clearSessionProgress();
    window.location.reload();
  }
}

document.addEventListener("keydown", (e) => {
  const reportModal = document.getElementById("report-modal");
  const settingsModal = document.getElementById("session-settings-modal");

  const isReportModalOpen =
    reportModal && !reportModal.classList.contains("hidden");
  const isSettingsModalOpen =
    settingsModal && !settingsModal.classList.contains("hidden");

  if (!state.session.active || isReportModalOpen || isSettingsModalOpen) return;

  const key = e.key.toUpperCase();
  const isAnswered = state.session.userAnswers[state.session.currentIndex];

  if (!isAnswered) {
    if (["1", "A"].includes(key))
      document.querySelector('.choice-btn[data-choice="A"]')?.click();
    if (["2", "B"].includes(key))
      document.querySelector('.choice-btn[data-choice="B"]')?.click();
    if (["3", "C"].includes(key))
      document.querySelector('.choice-btn[data-choice="C"]')?.click();
    if (["4", "D"].includes(key))
      document.querySelector('.choice-btn[data-choice="D"]')?.click();
    if (e.code === "Space") {
      e.preventDefault();
      revealAnswer();
    }
  } else {
    if (e.code === "Space" || e.code === "ArrowRight") {
      e.preventDefault();
      nextQuestion();
    }
    if (e.code === "ArrowLeft") {
      e.preventDefault();
      prevQuestion();
    }
  }
});

let globallyReportedQs = new Set();

async function fetchGlobalReports() {
  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ type: "get_reports", role: "user" }),
    });
    const reports = await response.json();
    if (Array.isArray(reports))
      globallyReportedQs = new Set(reports.map((r) => r.questionId));
  } catch (e) {}
}

window.onload = async () => {
  await loadState();

  const toggleElement = document.getElementById("globalModeToggle");
  if (toggleElement) {
    currentAppMode = toggleElement.checked ? "review" : "quiz";
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => reg.update());
  }
  syncDatabase();
  fetchGlobalReports();
};

function saveSessionProgress() {
  if (!state.session.active) return;

  try {
    localStorage.setItem("mrh_saved_session", JSON.stringify(state.session));
  } catch (e) {
    console.warn("Storage quota exceeded. Could not save session progress.", e);
    showToast("Storage full. Progress won't be saved.", "error");
  }
}

function checkSavedSession() {
  const saved = localStorage.getItem("mrh_saved_session");
  const resumeContainer = document.getElementById("resume-container");

  if (saved && resumeContainer) {
    try {
      const session = JSON.parse(saved);
      const isLastQuestion =
        session.currentIndex >= session.questions.length - 1;
      const isAnswered =
        session.userAnswers && session.userAnswers[session.currentIndex];

      if (isLastQuestion && isAnswered) {
        localStorage.removeItem("mrh_saved_session");
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

function resumeSession() {
  const saved = localStorage.getItem("mrh_saved_session");
  if (!saved) return;

  state.session = JSON.parse(saved);

  state.session.questions = state.session.questions.map((savedQ, index) => {
    let searchId = savedQ.ID;
    if (searchId && !searchId.toString().includes("::")) {
      let cleanId = searchId.toString().replace(/^[a-zA-Z]+[-\s]?/, "");
      searchId = `${savedQ.Subject}::${cleanId}`;
    }

    const freshQ = (state.db || []).find(
      (dbQ) => dbQ.ID === searchId || dbQ.ID === savedQ.ID,
    );

    if (freshQ) {
      savedQ.Question = freshQ.Question;
      savedQ.Explanation = freshQ.Explanation;

      const realCorrectText = freshQ[`Choice${freshQ.Answer}`];

      if (savedQ.ChoiceA === realCorrectText) savedQ.Answer = "A";
      else if (savedQ.ChoiceB === realCorrectText) savedQ.Answer = "B";
      else if (savedQ.ChoiceC === realCorrectText) savedQ.Answer = "C";
      else if (savedQ.ChoiceD === realCorrectText) savedQ.Answer = "D";
      else {
        const freshShuffled = prepareSessionPool([freshQ])[0];
        savedQ.ChoiceA = freshShuffled.ChoiceA;
        savedQ.ChoiceB = freshShuffled.ChoiceB;
        savedQ.ChoiceC = freshShuffled.ChoiceC;
        savedQ.ChoiceD = freshShuffled.ChoiceD;
        savedQ.Answer = freshShuffled.Answer;

        if (state.session.userAnswers[index]) {
          // FIXED: Replaced 'delete' with setting to null
          // to prevent array/object indexing bugs
          state.session.userAnswers[index] = null;
        }
      }
    } else {
      console.warn(
        `Question ${searchId || savedQ.ID} not found in DB. Falling back to saved session data.`,
      );
    }
    return savedQ;
  });

  navigate("practice");
  document.getElementById("session-setup").classList.add("hidden");
  document.getElementById("session-active").classList.remove("hidden");

  renderQuestion();
}

function clearSessionProgress() {
  localStorage.removeItem("mrh_saved_session");
  const resumeContainer = document.getElementById("resume-container");
  if (resumeContainer) {
    resumeContainer.classList.add("hidden");
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function showMCQOptions() {
  document.getElementById("active-recall-mask").classList.add("hidden");
  document.getElementById("q-choices").classList.remove("hidden");
}

function revealAnswer() {
  if (!state.session.active) return;

  const q = state.session.questions[state.session.currentIndex];
  state.session.userAnswers[state.session.currentIndex] = "REVEALED";

  // Use the helper function here too!
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

function toggleLayout() {
  state.prefs.layoutMode = state.prefs.layoutMode === "grid" ? "list" : "grid";
  saveState();
  renderCategoryProgress();
}

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

function openReportModal() {
  const q = state.session?.questions?.[state.session?.currentIndex];
  if (!q) return;

  let reportedQs = [];
  try {
    reportedQs = JSON.parse(localStorage.getItem("mrh_reported_qs") || "[]");
  } catch (e) {
    console.warn("Reported QS array corrupted. Resetting.", e);
    localStorage.setItem("mrh_reported_qs", "[]");
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

function closeReportModal() {
  state.reportQuestion = null;
  toggleModal("report-modal", false);
}
function openSessionSettingsModal() {
  const recallToggle = document.getElementById("toggle-active-recall");
  if (recallToggle) recallToggle.checked = state.prefs.activeRecall !== false;

  const choicesToggle = document.getElementById("toggle-shuffle-choices");
  if (choicesToggle)
    choicesToggle.checked = state.prefs.shuffleChoices !== false;

  const questionsToggle = document.getElementById("toggle-shuffle-questions");
  if (questionsToggle)
    questionsToggle.checked = state.prefs.shuffleQuestions !== false;

  const quizHideToggle = document.getElementById("toggle-quiz-hide-abcd");
  if (quizHideToggle)
    quizHideToggle.checked = state.prefs.quizHideABCD === true;

  const qTypeSelect = document.getElementById("toggle-question-type");
  if (qTypeSelect) qTypeSelect.value = state.prefs.qTypeOverride || "auto";

  toggleModal("session-settings-modal", true);
}

function closeSessionSettingsModal() {
  toggleModal("session-settings-modal", false);
}

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

function openDeckPasswordModal(subject, action) {
  pendingDeckSubject = subject;
  pendingDeckAction = action;

  const messageEl = document.getElementById("deck-password-message");
  if (messageEl) {
    const shortName = subject.split("::").pop();
    messageEl.innerText = `The deck "${escapeHTML(shortName)}" requires a password.`;
  }

  toggleModal("deck-password-modal", true);
}

function closeDeckPasswordModal() {
  toggleModal("deck-password-modal", false);
  const inputEl = document.getElementById("deck-password-input");
  if (inputEl) inputEl.value = "";
}

function openReportModalFromStudy(questionId) {
  const q = (state.db || []).find((item) => item.ID === questionId);
  if (!q) return;

  let reportedQs = [];
  try {
    reportedQs = JSON.parse(localStorage.getItem("mrh_reported_qs") || "[]");
  } catch (e) {
    console.warn("Reported QS array corrupted. Resetting.", e);
    localStorage.setItem("mrh_reported_qs", "[]");
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

function openGeneralFeedbackModal() {
  const feedbackComments = document.getElementById("feedback-comments");
  if (feedbackComments) feedbackComments.value = "";
  toggleModal("feedback-modal", true);
}

function closeGeneralFeedbackModal() {
  toggleModal("feedback-modal", false);
}

async function submitReport() {
  const typeEl = document.getElementById("report-type");
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

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "submit_report",
        questionId: q.ID,
        subject: q.Subject,
        questionText: q.Question,
        errorType: typeEl.value,
        comments: comments,
        choices: { A: q.ChoiceA, B: q.ChoiceB, C: q.ChoiceC, D: q.ChoiceD },
        correctAnswer: q.Answer,
      }),
    });

    const result = await response.json();

    if (result.status === "success") {
      const reportedQs = JSON.parse(
        localStorage.getItem("mrh_reported_qs") || "[]",
      );
      reportedQs.push(q.ID);
      localStorage.setItem("mrh_reported_qs", JSON.stringify(reportedQs));

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
            nextQuestion();
          } else {
            revealAnswer();
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

async function loadReports() {
  const container = document.getElementById("public-reports-list");
  container.innerHTML = `<div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-3xl text-brand-500"></i><p class="mt-2 text-gray-500">Fetching community reports...</p></div>`;

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ type: "get_reports", role: "user" }),
    });
    const reports = await response.json();

    if (reports.length === 0) {
      container.innerHTML = `<div class="bg-white dark:bg-gray-800 p-8 rounded-xl border border-gray-100 dark:border-gray-700 text-center text-gray-500"><i class="fa-solid fa-check-circle text-4xl text-green-500 mb-3"></i><p>No active issues. The database is clean!</p></div>`;
      return;
    }

    let html = "";
    reports.forEach((r) => {
      const isResolved = r.status === "Resolved";
      const statusBadge = isResolved
        ? `<span class="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide"><i class="fa-solid fa-check mr-1"></i> Resolved</span>`
        : `<span class="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide"><i class="fa-solid fa-clock mr-1"></i> Pending</span>`;
      const phtDate = new Date(r.timestamp).toLocaleString("en-US", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      html += `
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm animate-card-in">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">${escapeHTML(r.questionId)}</span>
                        ${statusBadge}
                    </div>
                    <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-1">${escapeHTML(r.errorType)}</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 italic border-l-2 border-brand-500 pl-3 my-2">"${escapeHTML(r.questionText)}"</p>
                    ${r.comments ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-2 bg-gray-50 dark:bg-gray-900/50 p-2 rounded"><i class="fa-solid fa-comment-dots mr-1"></i> ${escapeHTML(r.comments)}</p>` : ""}
                    <div class="text-xs text-gray-400 mt-3 text-right">Reported: ${phtDate}</div>
                </div>
            `;
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="text-red-500 text-center p-4">Failed to load reports. Check your connection.</div>`;
  }
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  const colors =
    type === "error"
      ? "bg-red-500 text-white"
      : "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900";
  const icon = type === "error" ? "fa-circle-exclamation" : "fa-circle-check";

  toast.className = `toast-enter ${colors} px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 font-medium text-sm`;
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${escapeHTML(message)}`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function toggleActiveRecall() {
  const isChecked = document.getElementById("toggle-active-recall").checked;
  state.prefs.activeRecall = isChecked;
  saveState();

  if (state.session.active) {
    renderQuestion();
  }
}

let activeHubSubject = "";

function openModeSelect(subject) {
  activeHubSubject = subject;
  document.getElementById("mode-select-deck-title").innerText = subject;
  navigate("mode-select");
}

function proceedToReview() {
  reviewDeck(activeHubSubject);
}

function proceedToQuiz() {
  if (activeHubSubject) {
    fetchAndStartCategory(activeHubSubject, "continue");
  }
}

let currentAppMode = "quiz";

function toggleAppMode() {
  const toggleElement = document.getElementById("globalModeToggle");
  const modeLabel = document.getElementById("modeLabel");

  if (!toggleElement) return;

  currentAppMode = toggleElement.checked ? "review" : "quiz";

  if (modeLabel) {
    modeLabel.innerText = currentAppMode === "review" ? "Study" : "Quiz";
  }

  renderCategoryProgress();
  sendTelemetry("toggle_mode", { mode: currentAppMode });
}

let pendingDeckSubject = null;
let pendingDeckAction = null;

function handleDeckClick(subj, action = "continue") {
  const deckInfo = state.categorySummary.find((c) => c.Subject === subj);
  if (deckInfo && deckInfo.Locked) {
    openDeckPasswordModal(subj, action);
    return;
  }
  if (currentAppMode === "review") {
    reviewDeck(subj, null);
  } else {
    fetchAndStartCategory(subj, action, null);
  }
}

function toggleShuffleChoices() {
  const isChecked = document.getElementById("toggle-shuffle-choices").checked;
  state.prefs.shuffleChoices = isChecked;
  saveState();

  if (state.session.active) {
    const remainingQuestions = state.session.questions.slice(
      state.session.currentIndex,
    );
    const reprepared = prepareSessionPool(remainingQuestions);
    state.session.questions.splice(
      state.session.currentIndex,
      reprepared.length,
      ...reprepared,
    );
    renderQuestion();
  }
}

function toggleShuffleQuestions() {
  const isChecked = document.getElementById("toggle-shuffle-questions").checked;
  state.prefs.shuffleQuestions = isChecked;
  saveState();
}

async function autoSaveDeckPassword(deckPath, newPassword) {
  const safeToken = typeof adminState !== "undefined" ? adminState.token : null;

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "admin_update_password",
        token: safeToken,
        deck: deckPath,
        password: newPassword,
      }),
    });

    const result = await response.json();

    if (result.status === "success") {
      console.log(`Password for ${deckPath} updated successfully.`);
    } else {
      alert("Failed to update password: " + result.message);
    }
  } catch (e) {
    alert("Network error while auto-saving password.");
    console.error(e);
  }
}

let userState = {
  username: "",
  isLoggedIn: false,
};

async function userLogin(username, password) {
  const btn = document.getElementById("btn-user-login");
  if (btn) {
    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Verifying...';
    btn.disabled = true;
  }

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "verify_user",
        username: username,
        password: password,
      }),
    });

    const result = await response.json();

    if (result.status === "success") {
      userState.username = username;
      userState.isLoggedIn = true;
      alert("Login successful!");
    } else {
      alert("Incorrect username or password.");
    }
  } catch (e) {
    alert("Network error while verifying user.");
    console.error(e);
  } finally {
    if (btn) {
      btn.innerHTML = "Login";
      btn.disabled = false;
    }
  }
}

document
  .getElementById("btn-submit-folder-password")
  .addEventListener("click", async () => {
    const pass = document.getElementById("folder-password-input").value;
    const btn = document.getElementById("btn-submit-folder-password");

    if (!pass) {
      alert("Please enter a password.");
      return;
    }

    btn.innerText = "Verifying...";
    btn.disabled = true;

    try {
      const response = await fetch(
        `${DB_URL}?subject=${encodeURIComponent(pendingLockedFolderPath)}&password=${encodeURIComponent(pass)}`,
      );
      const result = await response.json();
      if (result.error) {
        alert(result.error);
      } else {
        closeFolderPasswordModal();
        if (!state.currentPath) state.currentPath = [];
        state.currentPath.push(pendingLockedFolderName);
        renderCategoryProgress();
      }
    } catch (error) {
      console.error("Verification failed", error);
      alert("Network error while verifying the folder password.");
    } finally {
      btn.innerText = "Unlock Folder";
      btn.disabled = false;
    }
  });

const btnSubmitDeckPassword = document.getElementById(
  "btn-submit-deck-password",
);

if (btnSubmitDeckPassword) {
  btnSubmitDeckPassword.addEventListener("click", () => {
    const pass = document.getElementById("deck-password-input").value;

    if (!pass) {
      alert("Please enter a password.");
      return;
    }
    closeDeckPasswordModal();
    if (currentAppMode === "review") {
      reviewDeck(pendingDeckSubject, pass);
    } else {
      fetchAndStartCategory(pendingDeckSubject, pendingDeckAction, pass);
    }
  });
}

function togglePasswordVisibility(inputId, btnElement) {
  const input = document.getElementById(inputId);
  const icon = btnElement.querySelector("i");

  if (input.type === "password") {
    input.type = "text";
    icon.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    input.type = "password";
    icon.classList.replace("fa-eye-slash", "fa-eye");
  }
}

function formatQuestionText(text) {
  if (!text) return "";
  let formatted = escapeHTML(text);

  const listRegex = /(?:\s|^)((?:\d+|[A-Za-z]|[IVXLCDMivxlcdm]{1,4})\.)\s/g;

  formatted = formatted.replace(listRegex, "<br><br>");

  if (formatted.startsWith("<br><br>")) {
    formatted = formatted.substring(8);
  }

  return formatted;
}

if (!state.prefs.studyLayout) state.prefs.studyLayout = "scroll";
if (!state.prefs.studyPageSize) state.prefs.studyPageSize = 50;
if (!state.prefs.studyProgress) state.prefs.studyProgress = {};
if (!state.prefs.qToggles) state.prefs.qToggles = {};

function changeStudyLayout(layout) {
  state.prefs.studyLayout = layout;
  saveState();
  reRenderDeckReview();
}

function changeStudyPageSize(size) {
  state.prefs.studyPageSize = size === "All" ? "All" : parseInt(size);
  let subject = currentReviewSubject;
  if (!state.prefs.studyProgress[subject])
    state.prefs.studyProgress[subject] = { page: 1, index: 0, scrollY: 0 };
  state.prefs.studyProgress[subject].page = 1;
  saveState();
  reRenderDeckReview();
}

function changeStudyPage(delta) {
  let subject = currentReviewSubject;
  state.prefs.studyProgress[subject].page += delta;
  saveState();
  reRenderDeckReview();
  const scrollContainer = document.querySelector("main");
  if (scrollContainer) scrollContainer.scrollTop = 0;
}

function changeStudyIndex(delta) {
  let subject = currentReviewSubject;
  state.prefs.studyProgress[subject].index += delta;
  saveState();
  reRenderDeckReview();
}

function toggleSpecificChoices(qId) {
  if (!state.prefs.qToggles) state.prefs.qToggles = {};
  let currentState = state.prefs.qToggles[qId];
  if (currentState === undefined) {
    currentState = state.prefs.showWrongChoices !== false;
  }

  state.prefs.qToggles[qId] = !currentState;
  saveState();
  reRenderDeckReview();
}

function toggleStudyFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.warn(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

if (!state.prefs.qTypeOverride) state.prefs.qTypeOverride = "auto";

function getQuestionTypeMode(q) {
  let validChoicesCount = 0;
  ["A", "B", "C", "D"].forEach((ch) => {
    const choiceText = q[`Choice${ch}`];
    if (
      choiceText &&
      String(choiceText).trim() !== "" &&
      String(choiceText).toLowerCase() !== "undefined"
    ) {
      validChoicesCount++;
    }
  });

  const isForcedIdent = state.prefs.qTypeOverride === "ident";
  const isForcedMCQ = state.prefs.qTypeOverride === "mcq";

  let isPureIdent;
  if (isForcedIdent) {
    isPureIdent = true;
  } else if (isForcedMCQ) {
    isPureIdent = false;
  } else {
    isPureIdent = validChoicesCount <= 1;
  }

  return { isIdent: isPureIdent, validChoicesCount };
}

function changeQuestionTypeMode(mode) {
  if (state.prefs.qTypeOverride === mode) return;

  const userConfirmed = confirm(
    `Are you sure you want to switch to ${mode.toUpperCase()} mode?`,
  );

  if (!userConfirmed) {
    return;
  }

  if (mode === "ident") {
    alert(
      "Warning: Strict Identification mode enabled. You are hiding choices for MCQs. (This is an experimental feature)",
    );
  } else if (mode === "mcq") {
    alert(
      "Warning: Strict MCQ mode enabled. Choices WILL return undefined if there are no other choices present in the database. (This is an experimental feature)",
    );
  }

  state.prefs.qTypeOverride = mode;
  saveState();
  if (state.session.active) renderQuestion();
}

async function submitGeneralFeedback() {
  const comments = document.getElementById("feedback-comments").value.trim();
  if (!comments) return alert("Please enter your feedback.");
  const btn = document.getElementById("btn-submit-feedback");
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Sending...';
  btn.disabled = true;

  try {
    await fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "submit_feedback",
        comments: comments,
        userId: state.prefs.userId,
      }),
    });
    btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i> Sent!';
    btn.classList.remove("bg-brand-500", "hover:bg-brand-600");
    btn.classList.add("bg-green-500", "hover:bg-green-600");
    setTimeout(() => {
      closeGeneralFeedbackModal();
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.classList.remove("bg-green-500", "hover:bg-green-600");
        btn.classList.add("bg-brand-500", "hover:bg-brand-600");
      }, 500);
    }, 1500);
  } catch (err) {
    alert("Network error.");
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

let lastScrollTop = 0;
let isTicking = false;

window.addEventListener("DOMContentLoaded", () => {
  const mainEl = document.querySelector("main");
  const headerEl = document.querySelector("header");
  if (headerEl) headerEl.classList.add("transition-transform", "duration-300");

  if (mainEl && headerEl) {
    mainEl.addEventListener("scroll", (e) => {
      if (!isTicking) {
        window.requestAnimationFrame(() => {
          const currentScroll = e.target.scrollTop;

          if (currentScroll > lastScrollTop && currentScroll > 50) {
            headerEl.classList.add("-translate-y-full");
          } else {
            headerEl.classList.remove("-translate-y-full");
          }
          lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;

          if (
            document
              .getElementById("view-deck-review")
              .classList.contains("active") &&
            currentReviewSubject
          ) {
            if (!state.prefs.studyProgress) state.prefs.studyProgress = {};
            if (!state.prefs.studyProgress[currentReviewSubject]) {
              state.prefs.studyProgress[currentReviewSubject] = {
                page: 1,
                index: 0,
                scrollY: 0,
              };
            }
            state.prefs.studyProgress[currentReviewSubject].scrollY =
              currentScroll;
            clearTimeout(window.scrollSaveTimeout);
            window.scrollSaveTimeout = setTimeout(() => saveState(), 1000);
          }

          isTicking = false;
        });

        isTicking = true;
      }
    });
  }
});
