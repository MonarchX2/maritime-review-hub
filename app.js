const DB_URL = "https://script.google.com/macros/s/AKfycbx4HFy5LmX_CFZMTOdl809OrnsgxzQvpzHDOhrMK3yk7fNZb7Gp2pImwBCS_I1Gx-D20g/exec";

let state = {
    db: [],
    categorySummary: [],
    stats: { totalAnswered: 0, correct: 0, mistakes: [], subjectAccuracy: {} },
    prefs: { darkMode: true, layoutMode: 'grid', activeRecall: true }, // Added activeRecall
    session: { active: false, questions: [], currentIndex: 0, userAnswers: {}, autoNextTimeout: null },
    currentPath: []
};

let chartInstance = null;

// Add a simple UUID generator for telemetry tracking
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

// Ensure prefs has a userId
if (!state.prefs.userId) {
    state.prefs.userId = generateUserId();
}

function sendTelemetry(action, details) {
    fetch(DB_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            type: "telemetry",
            userId: state.prefs.userId,
            action: action,
            details: details
        })
    }).catch(console.error); // Silently fail if offline so it doesn't interrupt the user
}

function escapeHTML(str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

async function loadState() {
    const savedStats = localStorage.getItem('mrh_stats');
    const savedPrefs = localStorage.getItem('mrh_prefs');

    try {
        const savedDb = await idbKeyval.get('mrh_db');
        if (savedDb) {
            // MIGRATION: Ensure all existing DB items use the new unique ID format
            state.db = savedDb.map(q => {
                if (q.ID && !q.ID.toString().includes('::')) {
                    let cleanId = q.ID.toString().replace(/^[a-zA-Z]+[-\s]?/, '');
                    q.ID = `${q.Subject}::${cleanId}`;
                }
                return q;
            });
        }
    } catch (err) {
        console.error("Error loading DB from IndexedDB", err);
    }

    if (savedStats) state.stats = JSON.parse(savedStats);
    if (savedPrefs) state.prefs = JSON.parse(savedPrefs);

    if (!state.stats.subjectAccuracy) state.stats.subjectAccuracy = {};
    if (state.prefs.darkMode) document.documentElement.classList.add('dark');

    document.getElementById('db-size-display').innerText = state.db.length;
    populateFilters();
    updateDashboard();
    updateThemeButton();
}

async function saveState() {
    localStorage.setItem('mrh_stats', JSON.stringify(state.stats));
    localStorage.setItem('mrh_prefs', JSON.stringify(state.prefs));
    updateDashboard();
}

function updateDashboard() {
    const statTotal = document.getElementById('stat-total');
    if (statTotal) statTotal.innerText = state.stats.totalAnswered;

    const statCorrect = document.getElementById('stat-correct');
    if (statCorrect) statCorrect.innerText = state.stats.correct;

    const dbSize = document.getElementById('db-size-display');
    if (dbSize) dbSize.innerText = state.db.length;

    if (typeof checkSavedSession === 'function') checkSavedSession();
    if (typeof renderCategoryProgress === 'function') renderCategoryProgress();
}

let settingsClickCount = 0;
let settingsClickTimeout = null;

function navigate(viewId) {

    if (viewId === 'settings') {
        settingsClickCount++;
        clearTimeout(settingsClickTimeout);

        // If clicked 5 times, show the button
        if (settingsClickCount >= 5) {
            const adminBtn = document.getElementById('btn-admin-nav');
            adminBtn.classList.remove('hidden');
            adminBtn.classList.add('animate-card-in'); // Adds a nice fade-in animation
            settingsClickCount = 0; // Reset counter after unlocking
        } else {
            // Reset the counter if they stop clicking for 2 seconds
            settingsClickTimeout = setTimeout(() => {
                settingsClickCount = 0;
            }, 2000);
        }
    }

    if (state.session.active && viewId !== 'practice' && !confirm("You have an active session. Do you want to pause and return? Your progress will be saved.")) return;

    if (state.session.active && viewId !== 'practice') {
        saveSessionProgress();
        state.session.active = false;
    }

    updateDashboard();

    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');

    if (viewId === 'stats') renderCharts();

    if (viewId === 'admin' && adminState.token) {
        loadAdminSubjects();
    }
}

async function syncDatabase() {
    const url = DB_URL;
    const statusEl = document.getElementById('sync-status');
    if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Fetching subjects...';
        statusEl.className = "text-sm mt-3 font-medium bg-blue-50 text-blue-600 p-3 rounded-lg animate-pulse";
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response failed");
        const summaryData = await response.json();

        if (summaryData && summaryData.length > 0) {
            state.categorySummary = summaryData;
            saveState();

            if (statusEl) {
                statusEl.innerHTML = `<i class="fa-solid fa-check-circle mr-1"></i> Success! Loaded ${summaryData.length} subjects.`;
                statusEl.className = "text-sm mt-3 font-medium bg-green-50 text-green-600 p-3 rounded-lg animate-card-in";
            }

            if (typeof populateFilters === "function") populateFilters();
            if (typeof renderCategoryProgress === "function") renderCategoryProgress();
        } else {
            if (statusEl) {
                statusEl.innerText = "Error: Connected, but no subjects found.";
                statusEl.className = "text-sm mt-3 font-medium bg-red-50 text-red-600 p-3 rounded-lg";
            }
        }
    } catch (err) {
        console.error(err);
        if (statusEl) {
            statusEl.innerText = "Connection Error. Ensure you deployed the Apps Script correctly.";
            statusEl.className = "text-sm mt-3 font-medium bg-red-50 text-red-600 p-3 rounded-lg";
        }

        const catList = document.getElementById('category-list');
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
    const select = document.getElementById('filter-subject');
    const subjects = [...new Set(state.db.map(q => q.Subject).filter(Boolean))];

    let tags = new Set();
    state.db.forEach(q => {
        if (q.Tags) {
            q.Tags.split(',').map(t => t.trim()).forEach(t => tags.add(t));
        }
    });
    tags = [...tags];

    let html = '<option value="ALL">All Subjects (Randomized)</option>';
    if (subjects.length > 0) {
        html += '<optgroup label="Subjects">';
        html += subjects.map(s => `<option value="SUBJ:${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');
        html += '</optgroup>';
    }
    if (tags.length > 0) {
        html += '<optgroup label="Tags">';
        html += tags.map(t => `<option value="TAG:${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('');
        html += '</optgroup>';
    }

    select.innerHTML = html;
}

function prepareSessionPool(pool) {
    let randomizedPool = shuffleArray([...pool]);

    // Basic SRS: Sort questions so those in the 'mistakes' array have a higher chance of appearing first
    randomizedPool.sort((a, b) => {
        const aIsMistake = state.stats.mistakes.includes(a.ID);
        const bIsMistake = state.stats.mistakes.includes(b.ID);
        // 70% chance to bump a mistake up if compared against a non-mistake
        if (aIsMistake && !bIsMistake) return Math.random() > 0.3 ? -1 : 1;
        if (!aIsMistake && bIsMistake) return Math.random() > 0.3 ? 1 : -1;
        return 0;
    });

    return randomizedPool.map(originalQ => {
        let q = { ...originalQ };
        let validChoices = [];

        // Safely extract choices, strictly ignoring undefined/empty strings
        const rawChoices = [q.ChoiceA, q.ChoiceB, q.ChoiceC, q.ChoiceD];
        rawChoices.forEach(c => {
            if (c !== undefined && c !== null && String(c).trim() !== "" && String(c).trim().toLowerCase() !== "undefined") {
                validChoices.push(String(c).trim()); // SANITIZED
            }
        });

        let originalAns = String(q.Answer || "").trim().toUpperCase();
        let correctText = "";
        if (['A', 'B', 'C', 'D'].includes(originalAns)) {
            correctText = String(originalQ[`Choice${originalAns}`] || "").trim(); // SANITIZED
        } else {
            correctText = String(q.Answer || "").trim();
        }

        if (validChoices.length > 0) {
            validChoices = shuffleArray(validChoices);

            q.ChoiceA = validChoices[0] || "";
            q.ChoiceB = validChoices[1] || "";
            q.ChoiceC = validChoices[2] || "";
            q.ChoiceD = validChoices[3] || "";

            // Re-map correct Answer using strict trim matching
            if (q.ChoiceA.trim() === correctText) q.Answer = 'A';
            else if (q.ChoiceB.trim() === correctText) q.Answer = 'B';
            else if (q.ChoiceC.trim() === correctText) q.Answer = 'C';
            else if (q.ChoiceD.trim() === correctText) q.Answer = 'D';
            else if (validChoices.length === 1) q.Answer = 'A';
        }
        return q;
    });
}

function initSession() {
    const filterVal = document.getElementById('filter-subject').value;
    let pool = [];

    if (filterVal === 'MISTAKES') {
        pool = state.db.filter(q => state.stats.mistakes.includes(q.ID));
    } else if (filterVal.startsWith('SUBJ:')) {
        const subj = filterVal.replace('SUBJ:', '');
        pool = state.db.filter(q => q.Subject === subj);
    } else if (filterVal.startsWith('TAG:')) {
        const tag = filterVal.replace('TAG:', '');
        pool = state.db.filter(q => q.Tags && q.Tags.includes(tag));
    } else {
        pool = state.db;
    }

    if (pool.length === 0) { alert("No questions found for this filter."); return; }
    pool = prepareSessionPool(pool);

    state.session = {
        active: true, questions: pool,
        currentIndex: 0, userAnswers: {}
    };

    document.getElementById('session-setup').classList.add('hidden');
    document.getElementById('session-active').classList.remove('hidden');

    renderQuestion();
    saveSessionProgress();
}

function renderQuestion() {
    stopVisualTimer();
    const q = state.session.questions[state.session.currentIndex];
    const userAnswer = state.session.userAnswers[state.session.currentIndex];

    const currentCard = state.session.currentIndex + 1;
    const totalCards = state.session.questions.length;
    document.getElementById('session-progress-text').innerText = `${currentCard} / ${totalCards}`;
    document.getElementById('session-progress').style.width = `${((state.session.currentIndex) / totalCards) * 100}%`;

    // --- NEW SUBJECT TRIMMING LOGIC ---
    const fullSubject = q.Subject || 'General';
    const parts = fullSubject.split("::");
    document.getElementById('q-subject').innerText = parts.slice(-2).join("::");
    // ----------------------------------

    let displayId = q.ID || `Q-${state.session.currentIndex}`;
    if (displayId.includes('::')) {
        displayId = displayId.split('::').pop();
    }
    document.getElementById('q-id').innerText = displayId;

    document.getElementById('q-text').innerText = q.Question;

    const imgEl = document.getElementById('q-image');
    if (q.ImageURL && q.ImageURL.trim() !== "") {
        imgEl.src = q.ImageURL;
        imgEl.alt = q.Question ? `Reference for: ${q.Question.substring(0, 50)}...` : "Question reference image";
        imgEl.classList.remove('hidden');
    } else {
        imgEl.classList.add('hidden');
    }

    const choices = ['A', 'B', 'C', 'D'];
    let validChoicesCount = 0;

    // Count valid choices
    choices.forEach(ch => {
        const choiceText = q[`Choice${ch}`];
        if (choiceText && choiceText.trim() !== "" && choiceText.toLowerCase() !== "undefined") {
            validChoicesCount++;
        }
    });

    // Render choice buttons (Removed the misplaced active recall logic from here)
    choices.forEach(ch => {
        const choiceText = q[`Choice${ch}`];
        const btn = document.querySelector(`.choice-btn[data-choice="${ch}"]`);

        if (!choiceText || choiceText.trim() === "" || choiceText.toLowerCase() === "undefined") {
            btn.classList.add('hidden');
        } else {
            btn.classList.remove('hidden');
            document.getElementById(`choice-${ch.toLowerCase()}-text`).innerText = choiceText;

            btn.onclick = () => submitPracticeAnswer(ch, q.Answer);
            btn.className = "choice-btn text-left p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 font-medium";
        }
    });

    // Grab elements AFTER the loop
    const qChoicesContainer = document.getElementById('q-choices');
    const activeRecallMask = document.getElementById('active-recall-mask');
    const expBox = document.getElementById('q-explanation-box');
    const btnNext = document.getElementById('btn-next');
    const btnPrev = document.getElementById('btn-prev');
    const btnReveal = document.getElementById('btn-reveal');

    btnPrev.disabled = state.session.currentIndex === 0;

    // Apply Active Recall / Answered State logic ONCE at the end
    if (userAnswer) {
        if (activeRecallMask) activeRecallMask.classList.add('hidden');
        qChoicesContainer.classList.remove('hidden');

        showExplanation(q);
        btnNext.disabled = false;
        btnReveal.disabled = true;

        // --- RESTORE THIS MISSING LOGIC BLOCK ---
        document.querySelectorAll('.choice-btn').forEach(btn => {
            btn.onclick = null; // Prevent changing answers
            const choice = btn.dataset.choice;

            if (choice === q.Answer) {
                btn.classList.add('selected-correct');
            } else if (choice === userAnswer) {
                btn.classList.add('selected-wrong');
            } else {
                btn.classList.add('dimmed');
            }
        });
        // ----------------------------------------

    } else {
        expBox.classList.add('hidden');
        btnNext.disabled = true;
        btnReveal.disabled = false;
        // ... (keep the rest of your else block identical)

        if (validChoicesCount <= 1) {
            // It's a flashcard (no choices to hide)
            if (activeRecallMask) activeRecallMask.classList.add('hidden');
            qChoicesContainer.classList.add('hidden');
        } else {
            // It's multiple choice: Check Active Recall Preference
            if (state.prefs.activeRecall !== false) {
                if (activeRecallMask) activeRecallMask.classList.remove('hidden');
                qChoicesContainer.classList.add('hidden');
            } else {
                if (activeRecallMask) activeRecallMask.classList.add('hidden');
                qChoicesContainer.classList.remove('hidden');
            }
        }
    }
}

function enterFolder(folderName) {
    if (!state.currentPath) state.currentPath = [];
    state.currentPath.push(folderName);
    renderCategoryProgress();
}

function goToPath(index) {
    if (!state.currentPath) state.currentPath = [];
    if (index === -1) {
        state.currentPath = []; // Go to Root/Home
    } else {
        state.currentPath = state.currentPath.slice(0, index + 1); // Go to specific breadcrumb
    }
    renderCategoryProgress();
}

function renderCategoryProgress() {
    const container = document.getElementById('category-list');
    const isGrid = state.prefs.layoutMode === 'grid';

    // Update toggle button UI
    const layoutIcon = document.getElementById('layout-icon');
    const layoutText = document.getElementById('layout-text');
    if (layoutIcon && layoutText) {
        layoutIcon.className = isGrid ? 'fa-solid fa-list text-brand-500' : 'fa-solid fa-table-cells text-brand-500';
        layoutText.innerText = isGrid ? 'List View' : 'Grid View';
    }

    // --- 1. BUILD THE HIERARCHY TREE ---
    let tree = {};
    if (state.categorySummary && state.categorySummary.length > 0) {
        state.categorySummary.forEach(cat => {
            const parts = cat.Subject.split('::');
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

    // --- 2. TRAVERSE TO CURRENT PATH ---
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

    // --- 3. HELPER FOR FOLDER CARD STATS ---
    function getFolderStats(node) {
        let total = 0;
        if (node._data) total += node._data.QuestionCount || 0;
        for (let k in node._children) {
            total += getFolderStats(node._children[k]);
        }
        return total;
    }

    // --- 4. RENDER BREADCRUMBS ---
    let html = `
        <div class="flex items-center gap-2 mb-6 text-sm font-medium text-gray-600 dark:text-gray-400 overflow-x-auto pb-2 bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
            <button onclick="goToPath(-1)" class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors flex items-center gap-2">
                <i class="fa-solid fa-folder-open text-brand-500"></i> Home
            </button>
            ${state.currentPath.map((dir, i) => `
                <i class="fa-solid fa-chevron-right text-xs text-gray-400"></i>
                <button onclick="goToPath(${i})" class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors whitespace-nowrap">${escapeHTML(dir)}</button>
            `).join('')}
        </div>`;

    const layoutClass = isGrid
        ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 lg:gap-8'
        : 'flex flex-col space-y-4';

    html += `<div class="${layoutClass}">`;

    // --- 5. RENDER CURRENT LEVEL ITEMS ---
    const keys = Object.keys(currentNode).sort();

    if (keys.length === 0) {
        html += `<div class="col-span-full text-center py-10 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">No decks found in this folder.</div>`;
    }

    function generateCardHTML(cat, displayName, delay = 0) {
        const subj = cat.Subject;
        const safeSubj = escapeHTML(subj); 
        const safeName = escapeHTML(displayName);
        const totalQuestionsInDb = cat.QuestionCount; 
        const data = state.stats.subjectAccuracy[subj] || { total: 0, correct: 0 }; 
        
        const dbQsForSubj = state.db.filter(q => q.Subject === subj).map(q => q.ID);
        const completedCount = state.stats.completedQs ? state.stats.completedQs.filter(id => dbQsForSubj.includes(id)).length : 0;
        const mistakesCount = state.stats.mistakes ? state.stats.mistakes.filter(id => dbQsForSubj.includes(id)).length : 0;
        
        const progressPercent = totalQuestionsInDb > 0 ? Math.min(100, Math.round((completedCount / totalQuestionsInDb) * 100)) : 0;
        const isCompleted = totalQuestionsInDb > 0 && completedCount >= totalQuestionsInDb;
        const cardClasses = isCompleted ? 'bg-green-50 dark:bg-green-900/30 border-green-300' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700';

        const isDownloaded = state.db.some(q => q.Subject === subj);
        const statusBadge = isDownloaded 
            ? `<span class="bg-green-100 text-green-800 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold dark:bg-green-900/40 dark:text-green-400 shadow-sm transition-colors"><i class="fa-solid fa-hard-drive mr-1"></i></span>`
            : `<span class="bg-gray-100 text-gray-500 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold dark:bg-gray-700 dark:text-gray-400 shadow-sm transition-colors"><i class="fa-solid fa-cloud mr-1"></i></span>`;

        // Dynamic UI and Theme syncing based on the global mode
        const isReview = currentAppMode === 'review';
        
        // Button Logic
        const primaryActionText = isReview ? 'Review Deck' : (completedCount === 0 ? 'Start Quiz' : 'Continue Quiz');
        const primaryActionIcon = isReview ? 'fa-eye' : 'fa-play';
        const primaryActionColor = isReview ? 'bg-purple-600 hover:bg-purple-700' : 'bg-brand-600 hover:bg-brand-700';

        // Deck Color Logic (Syncing hover shadows, progress bar, text colors)
        const themeColorText = isReview ? 'text-purple-600 dark:text-purple-400' : 'text-brand-600 dark:text-brand-400';
        const themeColorBg = isReview ? 'bg-purple-500' : 'bg-brand-500';
        const themeShadowHover = isReview ? 'hover:shadow-purple-500/10' : 'hover:shadow-brand-500/10';
        const loaderColor = isReview ? 'text-purple-500' : 'text-brand-500';

        // Notice the 'h-full flex flex-col' in the main div, and 'mt-auto' on the button container
        return `
            <div onclick="handleDeckClick('${safeSubj}')" class="cursor-pointer animate-card-in ${cardClasses} p-5 rounded-xl shadow-sm hover:shadow-lg hover:-translate-y-1 ${themeShadowHover} active:scale-[0.99] border transition-all duration-400 relative w-full h-full flex flex-col" style="animation-delay: ${delay}s;">
                <div id="loading-${safeSubj}" class="hidden absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-10 rounded-xl flex flex-col items-center justify-center transition-opacity">
                    <i class="fa-solid fa-spinner fa-spin text-3xl ${loaderColor} mb-2"></i>
                    <span class="text-sm font-bold text-gray-700 dark:text-gray-200">Fetching Latest...</span>
                </div>

                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-2">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <h3 class="font-bold text-lg text-gray-800 dark:text-gray-100 flex items-center transition-colors">
                                <i class="fa-regular fa-file-lines text-gray-400 mr-2 text-sm"></i>
                                ${safeName}
                            </h3>
                            ${statusBadge}
                        </div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 transition-colors">Accuracy: ${data.total > 0 ? Math.round((data.correct/data.total)*100) : 0}%</p>
                    </div>
                    <div class="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                        ${isDownloaded 
                            ? `<button onclick="event.stopPropagation(); deleteSubjectData('${safeSubj}')" class="text-gray-400 hover:text-red-500 hover:scale-125 hover:rotate-12 transition-all duration-300" title="Delete Downloaded Data">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>` 
                            : ``}
                        <span class="text-sm font-black ${themeColorText} transition-colors">${completedCount} / ${totalQuestionsInDb}</span>
                    </div>
                </div>
                
                <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-4 overflow-hidden">
                    <div class="${themeColorBg} h-full rounded-full transition-all duration-700 ease-out" style="width: ${progressPercent}%"></div>
                </div>
                
                <div class="flex gap-2 mt-auto w-full" onclick="event.stopPropagation()">
                    <!-- Primary Action Button -->
                    <button onclick="handleDeckClick('${safeSubj}')" class="flex-1 ${primaryActionColor} text-white py-2 px-2 rounded-lg font-bold active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="${primaryActionText}">
                        <i class="fa-solid ${primaryActionIcon} mr-1 sm:mr-2 group-hover:scale-125 transition-transform"></i> <span class="truncate">${primaryActionText.split(' ')[0]}</span>
                    </button>
                    
                    <!-- Review Mistakes Button (Only shows if mistakes exist) -->
                    ${mistakesCount > 0 ? `
                        <button onclick="handleDeckClick('${safeSubj}', 'mistakes')" class="flex-1 bg-yellow-500 text-white py-2 px-2 rounded-lg font-bold hover:bg-yellow-600 active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="Review Mistakes">
                            <i class="fa-solid fa-triangle-exclamation mr-1 sm:mr-2 group-hover:scale-125 transition-transform"></i> <span class="truncate">Review (${mistakesCount})</span>
                        </button>
                    ` : ''}

                    <!-- Reset Button (Always visible, stays small) -->
                    <button onclick="resetCategory('${safeSubj}')" class="w-10 sm:w-12 shrink-0 bg-red-50 text-red-600 dark:bg-red-900/20 py-2 px-1 rounded-lg font-bold hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-90 transition-all duration-300 text-xs sm:text-sm border border-red-100 dark:border-red-800 flex items-center justify-center" title="Reset Progress">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>
                </div>
            </div>
        `;
    }

    keys.forEach((key, index) => {
        const item = currentNode[key];
        const hasChildren = Object.keys(item._children).length > 0;
        const hasData = item._data !== null;
        const delay = index * 0.05;

        if (hasChildren && !hasData) {
            const totalCards = getFolderStats(item);
            const folderClass = isGrid ? 'h-full min-h-[140px]' : 'h-auto';

            // Sync folder colors based on Quiz/Review Mode
            const isReview = currentAppMode === 'review';
            const folderColorClass = isReview 
                ? 'bg-purple-500 dark:bg-purple-700 group-hover:bg-purple-600 dark:group-hover:bg-purple-600' 
                : 'bg-brand-500 dark:bg-brand-700 group-hover:bg-brand-600 dark:group-hover:bg-brand-600';
            const folderTextHover = isReview
                ? 'group-hover:text-purple-600 dark:group-hover:text-purple-400'
                : 'group-hover:text-brand-600 dark:group-hover:text-brand-400';

            html += `
                <div onclick="enterFolder('${escapeHTML(key)}')" class="cursor-pointer group animate-card-in bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col ${folderClass} transform hover:-translate-y-1" style="animation-delay: ${delay}s;">
                    <div class="h-12 ${folderColorClass} transition-colors relative">                        
                        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
                    </div>
                    <div class="p-4 flex-1 flex flex-col justify-between">
                        <h3 class="font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide ${folderTextHover} transition-colors text-lg">${escapeHTML(key)}</h3>
                        <div class="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400 mt-2">
                            <span>${totalCards} cards</span>
                            <span class="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full text-xs font-semibold">Subdeck</span>
                        </div>
                    </div>
                </div>`;
        } else if (hasData) {
            html += generateCardHTML(item._data, key, delay);
        }
    });

    html += `</div>`;
    container.className = "transition-all duration-500";
    container.innerHTML = html;
}

async function fetchAndStartCategory(subject, mode) {
    const loader = document.getElementById(`loading-${subject}`);
    if (loader) loader.classList.remove('hidden');

    let validQuestions = [];

    try {
        const response = await fetch(`${DB_URL}?subject=${encodeURIComponent(subject)}`);
        const newQuestions = await response.json();

        if (newQuestions.error) throw new Error(newQuestions.error);

        validQuestions = newQuestions.filter(q =>
            q.Question && q.Question.trim() !== "" &&
            q.ChoiceA && q.ChoiceA.trim() !== "" &&
            q.ChoiceB && q.ChoiceB.trim() !== ""
        ).map(q => {
            // NEW: Enforce unique IDs and strip prefix strings (e.g., "BSM-", "NAV-")
            let cleanId = q.ID ? q.ID.toString().replace(/^[a-zA-Z]+[-\s]?/, '') : Math.random().toString(36).substr(2, 6);
            // Combine subject and ID so there are never duplicates across folders
            q.ID = `${q.Subject}::${cleanId}`;
            return q;
        });

        const otherQuestions = state.db.filter(q => q.Subject !== subject);
        state.db = [...otherQuestions, ...validQuestions];

        await idbKeyval.set('mrh_db', state.db);

    } catch (err) {
        console.warn("Network request failed. Falling back to local cache.", err);
        validQuestions = state.db.filter(q => q.Subject === subject);

        if (validQuestions.length === 0) {
            alert(`Cannot start session. You are offline and "${subject}" has not been downloaded to your device yet.`);
            if (loader) loader.classList.add('hidden');
            return;
        }
    }

    if (!state.stats.completedQs) state.stats.completedQs = [];

    let pool = [];
    if (mode === 'continue') {
        pool = validQuestions.filter(q => !state.stats.completedQs.includes(q.ID));
        if (pool.length === 0) {
            alert(`You have answered all available questions for ${subject}! Reset the category to start over.`);
            if (loader) loader.classList.add('hidden');
            return;
        }
    } else if (mode === 'mistakes') {
        pool = validQuestions.filter(q => state.stats.mistakes.includes(q.ID));
        if (pool.length === 0) {
            alert(`No mistakes to review for ${subject}! Great job.`);
            if (loader) loader.classList.add('hidden');
            return;
        }
    }

    if (loader) loader.classList.add('hidden');
    startCustomSession(pool);
}

function startCustomSession(pool) {
    navigate('practice');
    document.getElementById('session-setup').classList.add('hidden');
    document.getElementById('session-active').classList.remove('hidden');

    pool = prepareSessionPool(pool);

    state.session = {
        active: true, questions: pool,
        currentIndex: 0, userAnswers: {}
    };

    renderQuestion();
    saveSessionProgress();
}

function resetCategory(subject) {
    if (confirm(`Are you sure you want to reset your accuracy and progress statistics for "${subject}"? This cannot be undone.`)) {
        if (state.stats.subjectAccuracy[subject]) {
            state.stats.subjectAccuracy[subject] = { total: 0, correct: 0 };
        }

        const subjectQIDs = state.db.filter(q => q.Subject === subject).map(q => q.ID);

        if (state.stats.completedQs) {
            state.stats.completedQs = state.stats.completedQs.filter(id => !subjectQIDs.includes(id));
        }

        if (state.stats.mistakes) {
            state.stats.mistakes = state.stats.mistakes.filter(id => !subjectQIDs.includes(id));
        }

        saveState();
        renderCategoryProgress();
        if (chartInstance) renderCharts();
    }
}

async function deleteSubjectData(subject) {
    if (confirm(`Are you sure you want to delete the downloaded questions for "${subject}"? Your accuracy and progress stats will remain, but the app will remove the local data to save space.`)) {
        state.db = state.db.filter(q => q.Subject !== subject);
        await idbKeyval.set('mrh_db', state.db);

        const saved = localStorage.getItem('mrh_saved_session');
        if (saved) {
            try {
                const sessionObj = JSON.parse(saved);
                const hasDeletedQuestions = sessionObj.questions.some(q => q.Subject === subject);

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
                        state.session = { active: false, questions: [], currentIndex: 0, userAnswers: {} };
                    } else {
                        sessionObj.questions = newQuestions;
                        sessionObj.userAnswers = newUserAnswers;
                        sessionObj.currentIndex = Math.min(keptBeforeCurrent, newQuestions.length - 1);
                        localStorage.setItem('mrh_saved_session', JSON.stringify(sessionObj));

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

async function reviewDeck(subject) {
    const loader = document.getElementById(`loading-${subject}`);
    if (loader) loader.classList.remove('hidden');

    let validQuestions = [];

    try {
        // First check if the questions are already saved in the local IndexedDB
        validQuestions = state.db.filter(q => q.Subject === subject);

        // If not, fetch them from Google Sheets
        if (validQuestions.length === 0) {
            const response = await fetch(`${DB_URL}?subject=${encodeURIComponent(subject)}`);
            const newQuestions = await response.json();

            if (newQuestions.error) throw new Error(newQuestions.error);

            validQuestions = newQuestions.filter(q =>
                q.Question && q.Question.trim() !== ""
            ).map(q => {
                let cleanId = q.ID ? q.ID.toString().replace(/^[a-zA-Z]+[-\s]?/, '') : Math.random().toString(36).substr(2, 6);
                q.ID = `${q.Subject}::${cleanId}`;
                return q;
            });

            // Update local DB to avoid re-fetching later
            const otherQuestions = state.db.filter(q => q.Subject !== subject);
            state.db = [...otherQuestions, ...validQuestions];
            await idbKeyval.set('mrh_db', state.db);
        }
    } catch (err) {
        console.warn("Network request failed.", err);
        if (validQuestions.length === 0) {
            alert(`Cannot review deck. You are offline and "${subject}" has not been downloaded yet.`);
            if (loader) loader.classList.add('hidden');
            return;
        }
    }

    if (loader) loader.classList.add('hidden');
    renderDeckReview(subject, validQuestions);
}

// --- DECK REVIEW LOGIC ---
let currentReviewSubject = "";
let currentReviewQuestions = [];

function reRenderDeckReview() {
    // Triggers when the toggle switch is clicked
    renderDeckReview(currentReviewSubject, currentReviewQuestions);
}

function renderDeckReview(subject, questions) {
    currentReviewSubject = subject;
    currentReviewQuestions = questions;

    const container = document.getElementById('deck-review-list');
    document.getElementById('deck-review-title').innerText = subject;

    // Check if the toggle exists and is checked
    const toggleEl = document.getElementById('toggle-wrong-choices');
    const showWrong = toggleEl ? toggleEl.checked : false;

    let html = '';

    if (questions.length === 0) {
        html = `<div class="text-center p-8 text-gray-500">No questions found for this deck.</div>`;
    } else {
        questions.forEach((q, index) => {
            // Safely parse the answer, preventing "undefined" literals
            let ansStr = q.Answer ? String(q.Answer).trim() : "";
            let isMultipleChoice = ['A', 'B', 'C', 'D'].includes(ansStr.toUpperCase());

            let correctText = ansStr;
            if (isMultipleChoice) {
                correctText = q[`Choice${ansStr.toUpperCase()}`] || ansStr;
            }

            if (!correctText || correctText.toLowerCase() === "undefined") {
                correctText = "Answer missing from database";
            }

            // Generate HTML for the choices
            let choicesHTML = "";
            if (isMultipleChoice && showWrong) {
                const letters = ['A', 'B', 'C', 'D'];
                choicesHTML = `<div class="mt-4 flex flex-col gap-2">`;

                letters.forEach(letter => {
                    let choiceText = q[`Choice${letter}`];
                    if (choiceText) {
                        let isCorrect = (letter === ansStr.toUpperCase());
                        if (isCorrect) {
                            choicesHTML += `
                                    <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-3 rounded-r-lg">
                                        <p class="text-sm font-bold text-green-700 dark:text-green-400">
                                            <i class="fa-solid fa-check-circle mr-2"></i> ${letter}. ${escapeHTML(choiceText)}
                                        </p>
                                    </div>
                                `;
                        } else {
                            choicesHTML += `
                                    <div class="bg-gray-50 dark:bg-gray-800/50 border-l-4 border-gray-300 dark:border-gray-600 p-3 rounded-r-lg opacity-70">
                                        <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
                                            <i class="fa-solid fa-times mr-2 opacity-50"></i> ${letter}. ${escapeHTML(choiceText)}
                                        </p>
                                    </div>
                                `;
                        }
                    }
                });
                choicesHTML += `</div>`;
            } else {
                // Default view (Only correct answer OR Identification question)
                choicesHTML = `
                        <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-3 rounded-r-lg mt-4">
                            <p class="text-sm font-bold text-green-700 dark:text-green-400">
                                <i class="fa-solid fa-check-circle mr-2"></i> ${isMultipleChoice ? `${ansStr.toUpperCase()}. ` : ''}${escapeHTML(correctText)}
                            </p>
                        </div>
                    `;
            }

            html += `
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 animate-card-in" style="animation-delay: ${index * 0.02}s;">
                        <div class="flex gap-2 mb-3">
                            <span class="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded font-bold dark:bg-gray-700 dark:text-gray-300">Question ${index + 1}</span>
                        </div>
                        <p class="font-medium text-gray-800 dark:text-gray-100 mb-2 text-lg">${escapeHTML(q.Question)}</p>
                        
                        ${q.ImageURL ? `<img src="${q.ImageURL}" alt="Reference" class="w-full max-w-sm rounded-lg mt-4 border dark:border-gray-600 shadow-sm">` : ''}
                        
                        ${choicesHTML}
                        
                        ${q.Explanation && q.Explanation.trim() !== "" ? `
                            <div class="mt-4 text-sm text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-gray-900/50 p-3 rounded-lg border border-blue-100 dark:border-gray-700">
                                <strong class="text-blue-800 dark:text-blue-400"><i class="fa-solid fa-lightbulb mr-1"></i> Explanation:</strong> ${escapeHTML(q.Explanation)}
                            </div>
                        ` : ''}
                    </div>
                `;
        });
    }

    container.innerHTML = html;
    navigate('deck-review');
}

function submitPracticeAnswer(selected, correct) {
    const q = state.session.questions[state.session.currentIndex];
    state.session.userAnswers[state.session.currentIndex] = selected;

    trackStats(q, selected === correct);

    document.querySelectorAll('.choice-btn').forEach(btn => {
        btn.onclick = null;
        if (btn.dataset.choice === correct) btn.classList.add('selected-correct');
        else if (btn.dataset.choice === selected) btn.classList.add('selected-wrong');
        else btn.classList.add('dimmed');
    });

    showExplanation(q);

    document.getElementById('btn-next').disabled = false;
    document.getElementById('btn-reveal').disabled = true;
    document.getElementById('session-progress').style.width = `${((state.session.currentIndex + 1) / state.session.questions.length) * 100}%`;

    startVisualTimer();
    if (state.session.autoNextTimeout) clearTimeout(state.session.autoNextTimeout);
    state.session.autoNextTimeout = setTimeout(() => {
        nextQuestion();
    }, 3000);
}

function showExplanation(q) {
    const expBox = document.getElementById('q-explanation-box');

    if (q.Explanation && q.Explanation.trim() !== "") {
        document.getElementById('q-explanation-text').innerText = q.Explanation;
        expBox.classList.remove('hidden');
    } else {
        expBox.classList.add('hidden');
    }
}

function nextQuestion() {
    if (state.session.autoNextTimeout) clearTimeout(state.session.autoNextTimeout);
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
    if (state.session.autoNextTimeout) clearTimeout(state.session.autoNextTimeout);
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
    if (!state.stats.subjectAccuracy[subj]) state.stats.subjectAccuracy[subj] = { total: 0, correct: 0 };
    state.stats.subjectAccuracy[subj].total++;

    if (!state.stats.completedQs) state.stats.completedQs = [];
    if (!state.stats.completedQs.includes(q.ID)) {
        state.stats.completedQs.push(q.ID);
    }

    if (isCorrect) {
        state.stats.correct++;
        state.stats.subjectAccuracy[subj].correct++;
        state.stats.mistakes = state.stats.mistakes.filter(id => id !== q.ID);
    } else {
        if (!state.stats.mistakes.includes(q.ID)) state.stats.mistakes.push(q.ID);
    }
    saveState();
}

function endSession(silent = false) {
    const isLastQuestion = state.session.currentIndex >= state.session.questions.length - 1;
    const isAnswered = state.session.userAnswers && state.session.userAnswers[state.session.currentIndex];

    if (isLastQuestion && isAnswered) {
        clearSessionProgress();
    } else {
        saveSessionProgress();
    }

    state.session.active = false;
    if (!silent) navigate('dashboard');
}

function renderCharts() {
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js is still loading...");
        setTimeout(renderCharts, 500); // Retry after 500ms
        return;
    }

    if (chartInstance) chartInstance.destroy();

    const ctx = document.getElementById('chart-accuracy').getContext('2d');
    let labels = Object.keys(state.stats.subjectAccuracy);
    let data = [];

    if (labels.length === 0) {
        // Use local placeholder arrays instead of mutating the global state
        labels = ["COLREG", "Navigation", "Meteorology"];
        data = [0, 0, 0]; // 0% accuracy for placeholders
    } else {
        // Map actual data
        data = labels.map(s => {
            const d = state.stats.subjectAccuracy[s];
            return d.total === 0 ? 0 : Math.round((d.correct / d.total) * 100);
        });
    }

    chartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Accuracy %',
                data: data,
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderColor: 'rgba(59, 130, 246, 1)',
                pointBackgroundColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 20 } } },
            plugins: { legend: { display: false } },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            }
        }
    });
}

function toggleTheme() {
    state.prefs.darkMode = !state.prefs.darkMode;
    document.documentElement.classList.toggle('dark', state.prefs.darkMode);
    saveState();
    updateThemeButton();
}

function updateThemeButton() {
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
        btn.innerHTML = state.prefs.darkMode
            ? '<i class="fa-solid fa-sun mr-1 transition-transform transform hover:rotate-180 duration-500"></i> Switch to Light Mode'
            : '<i class="fa-solid fa-moon mr-1 transition-transform transform hover:rotate-12 duration-300"></i> Switch to Dark Mode';
    }
}

function resetProgress() {
    if (confirm("Are you sure? This deletes mistakes, all statistics, and your current saved session.")) {
        state.stats = { totalAnswered: 0, correct: 0, mistakes: [], subjectAccuracy: {}, completedQs: [] };
        state.session = { active: false, questions: [], currentIndex: 0, userAnswers: {} };

        clearSessionProgress();
        saveState();
        alert("Progress Reset.");

        if (document.getElementById('view-stats').classList.contains('active')) renderCharts();
    }
}

async function clearDatabase() {
    if (confirm("WARNING: Are you sure you want to clear the locally saved database? You will need an active internet connection to sync the questions again. The app will reload to apply changes.")) {
        await idbKeyval.del('mrh_db');
        state.db = [];
        clearSessionProgress();
        window.location.reload();
    }
}

function exportData() {
    const jsonStr = JSON.stringify(state);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", url);
    dlAnchorElem.setAttribute("download", "mrh_backup.json");
    document.body.appendChild(dlAnchorElem); // Required for Firefox
    dlAnchorElem.click();

    document.body.removeChild(dlAnchorElem);
    URL.revokeObjectURL(url); // Clean up memory
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const importedState = JSON.parse(e.target.result);
            // Stricter validation
            if (importedState && typeof importedState.stats === 'object' && Array.isArray(importedState.db)) {
                state = importedState;
                saveState();
                await idbKeyval.set('mrh_db', state.db);
                showToast("Data successfully restored!", "success");
                setTimeout(() => window.location.reload(), 1500);
            } else {
                showToast("Invalid backup file format.", "error");
            }
        } catch (err) {
            showToast("Error reading JSON file.", "error");
        }
    };
    reader.readAsText(file);
}

document.addEventListener('keydown', (e) => {
    if (!state.session.active || document.getElementById('report-modal').classList.contains('hidden') === false) return;

    const key = e.key.toUpperCase();
    const isAnswered = state.session.userAnswers[state.session.currentIndex];

    if (!isAnswered) {
        if (['1', 'A'].includes(key)) document.querySelector('.choice-btn[data-choice="A"]')?.click();
        if (['2', 'B'].includes(key)) document.querySelector('.choice-btn[data-choice="B"]')?.click();
        if (['3', 'C'].includes(key)) document.querySelector('.choice-btn[data-choice="C"]')?.click();
        if (['4', 'D'].includes(key)) document.querySelector('.choice-btn[data-choice="D"]')?.click();
        if (e.code === 'Space') { e.preventDefault(); revealAnswer(); }
    } else {
        if (e.code === 'Space' || e.code === 'ArrowRight') { e.preventDefault(); nextQuestion(); }
        if (e.code === 'ArrowLeft') { e.preventDefault(); prevQuestion(); }
    }
});

window.onload = () => {
    loadState();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').then(registration => {
            registration.update();
        });
    }
    syncDatabase();
};

function saveSessionProgress() {
    if (!state.session.active) return;
    localStorage.setItem('mrh_saved_session', JSON.stringify(state.session));
}

function checkSavedSession() {
    const saved = localStorage.getItem('mrh_saved_session');
    const resumeContainer = document.getElementById('resume-container');

    if (saved && resumeContainer) {
        try {
            const session = JSON.parse(saved);
            const isLastQuestion = session.currentIndex >= session.questions.length - 1;
            const isAnswered = session.userAnswers && session.userAnswers[session.currentIndex];

            if (isLastQuestion && isAnswered) {
                localStorage.removeItem('mrh_saved_session');
                resumeContainer.classList.add('hidden');
                return;
            }
        } catch (e) {
            console.error("Error checking session", e);
        }

        resumeContainer.classList.remove('hidden');
    } else if (resumeContainer) {
        resumeContainer.classList.add('hidden');
    }
}

function resumeSession() {
    const saved = localStorage.getItem('mrh_saved_session');
    if (!saved) return;

    state.session = JSON.parse(saved);

    state.session.questions = state.session.questions.map((savedQ, index) => {

        // MIGRATION HELPER: Ensure session resumer works with the freshly updated IDs
        let searchId = savedQ.ID;
        if (searchId && !searchId.toString().includes('::')) {
            let cleanId = searchId.toString().replace(/^[a-zA-Z]+[-\s]?/, '');
            searchId = `${savedQ.Subject}::${cleanId}`;
        }

        const freshQ = state.db.find(dbQ => dbQ.ID === searchId || dbQ.ID === savedQ.ID);

        if (freshQ) {
            savedQ.Question = freshQ.Question;
            savedQ.Explanation = freshQ.Explanation;

            const realCorrectText = freshQ[`Choice${freshQ.Answer}`];

            if (savedQ.ChoiceA === realCorrectText) savedQ.Answer = 'A';
            else if (savedQ.ChoiceB === realCorrectText) savedQ.Answer = 'B';
            else if (savedQ.ChoiceC === realCorrectText) savedQ.Answer = 'C';
            else if (savedQ.ChoiceD === realCorrectText) savedQ.Answer = 'D';
            else {
                const freshShuffled = prepareSessionPool([freshQ])[0];
                savedQ.ChoiceA = freshShuffled.ChoiceA;
                savedQ.ChoiceB = freshShuffled.ChoiceB;
                savedQ.ChoiceC = freshShuffled.ChoiceC;
                savedQ.ChoiceD = freshShuffled.ChoiceD;
                savedQ.Answer = freshShuffled.Answer;

                if (state.session.userAnswers[index]) {
                    delete state.session.userAnswers[index];
                }
            }
        }
        return savedQ;
    });

    navigate('practice');
    document.getElementById('session-setup').classList.add('hidden');
    document.getElementById('session-active').classList.remove('hidden');

    renderQuestion();
}

function clearSessionProgress() {
    localStorage.removeItem('mrh_saved_session');
    const resumeContainer = document.getElementById('resume-container');
    if (resumeContainer) {
        resumeContainer.classList.add('hidden');
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
    document.getElementById('active-recall-mask').classList.add('hidden');
    document.getElementById('q-choices').classList.remove('hidden');
}

function revealAnswer() {
    if (!state.session.active) return;

    const q = state.session.questions[state.session.currentIndex];
    state.session.userAnswers[state.session.currentIndex] = "REVEALED";

    // Count choices to determine if it's a flashcard
    let validChoicesCount = 0;
    ['A', 'B', 'C', 'D'].forEach(ch => {
        const choiceText = q[`Choice${ch}`];
        if (choiceText && choiceText.trim() !== "" && choiceText.toLowerCase() !== "undefined") {
            validChoicesCount++;
        }
    });

    // Only mark as incorrect if it's a multiple-choice question
    if (validChoicesCount > 1) {
        trackStats(q, false);
    }

    document.getElementById('q-choices').classList.remove('hidden');
    const activeRecallMask = document.getElementById('active-recall-mask');
    if (activeRecallMask) activeRecallMask.classList.add('hidden');

    renderQuestion();
    saveSessionProgress();
    startVisualTimer();

    if (state.session.autoNextTimeout) clearTimeout(state.session.autoNextTimeout);
    state.session.autoNextTimeout = setTimeout(() => {
        nextQuestion();
    }, 3000);
}

function startVisualTimer() {
    const container = document.getElementById('auto-next-timer-container');
    const bar = document.getElementById('auto-next-timer-bar');

    container.classList.remove('hidden');

    bar.classList.remove('animate-timer-bar');
    void bar.offsetWidth;
    bar.classList.add('animate-timer-bar');
}

function stopVisualTimer() {
    const container = document.getElementById('auto-next-timer-container');
    const bar = document.getElementById('auto-next-timer-bar');

    container.classList.add('hidden');
    bar.classList.remove('animate-timer-bar');
}

function toggleLayout() {
    state.prefs.layoutMode = state.prefs.layoutMode === 'grid' ? 'list' : 'grid';
    saveState();
    renderCategoryProgress();
}

// ==========================================
// REPORTING SYSTEM LOGIC
// ==========================================
function openReportModal() {
    const q = state.session.questions[state.session.currentIndex];
    const reportedQs = JSON.parse(localStorage.getItem('mrh_reported_qs') || '[]');

    if (reportedQs.includes(q.ID)) {
        alert("You have already reported this question. Thank you for your feedback!");
        return;
    }

    document.getElementById('report-type').value = "";
    document.getElementById('report-comments').value = "";

    const modal = document.getElementById('report-modal');
    const inner = modal.querySelector('div');
    modal.classList.remove('hidden');

    // Slight delay for animation
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        inner.classList.remove('scale-95', 'opacity-0');
    }, 10);
}

function closeReportModal() {
    const modal = document.getElementById('report-modal');
    const inner = modal.querySelector('div');
    modal.classList.add('opacity-0');
    inner.classList.add('scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300); // Matches Tailwind transition duration
}

async function submitReport() {
    const typeEl = document.getElementById('report-type');
    const comments = document.getElementById('report-comments').value.trim();

    if (!typeEl.value) {
        alert("Please select an Error Type.");
        return;
    }

    const btn = document.getElementById('btn-submit-report');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Sending...';
    btn.disabled = true;

    const q = state.session.questions[state.session.currentIndex];

    try {
        const response = await fetch(DB_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" }, // ADDED HEADER
            body: JSON.stringify({
                type: "submit_report",
                questionId: q.ID,
                subject: q.Subject,
                questionText: q.Question,
                errorType: typeEl.value,
                comments: comments
            })
        });

        const result = await response.json();

        if (result.status === "success") {
            const reportedQs = JSON.parse(localStorage.getItem('mrh_reported_qs') || '[]');
            reportedQs.push(q.ID);
            localStorage.setItem('mrh_reported_qs', JSON.stringify(reportedQs));

            btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i> Report Submitted!';
            btn.classList.replace('bg-red-500', 'bg-green-500');
            btn.classList.replace('hover:bg-red-600', 'hover:bg-green-600');

            setTimeout(() => {
                closeReportModal();
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    btn.classList.replace('bg-green-500', 'bg-red-500');
                    btn.classList.replace('hover:bg-green-600', 'hover:bg-red-600');
                }, 500);

                if (state.session.userAnswers[state.session.currentIndex]) {
                    nextQuestion();
                } else {
                    revealAnswer();
                }
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
    const container = document.getElementById('public-reports-list');
    container.innerHTML = `<div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-3xl text-brand-500"></i><p class="mt-2 text-gray-500">Fetching community reports...</p></div>`;

    try {
        const response = await fetch(DB_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" }, // ADDED HEADER
            body: JSON.stringify({ type: "get_reports", role: "user" })
        });
        const reports = await response.json();

        if (reports.length === 0) {
            container.innerHTML = `<div class="bg-white dark:bg-gray-800 p-8 rounded-xl border border-gray-100 dark:border-gray-700 text-center text-gray-500"><i class="fa-solid fa-check-circle text-4xl text-green-500 mb-3"></i><p>No active issues. The database is clean!</p></div>`;
            return;
        }

        let html = '';
        reports.forEach(r => {
            const isResolved = r.status === 'Resolved';
            const statusBadge = isResolved
                ? `<span class="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide"><i class="fa-solid fa-check mr-1"></i> Resolved</span>`
                : `<span class="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide"><i class="fa-solid fa-clock mr-1"></i> Pending</span>`;

            html += `
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm animate-card-in">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">${escapeHTML(r.questionId)}</span>
                        ${statusBadge}
                    </div>
                    <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-1">${escapeHTML(r.errorType)}</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 italic border-l-2 border-brand-500 pl-3 my-2">"${escapeHTML(r.questionText)}"</p>
                    ${r.comments ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-2 bg-gray-50 dark:bg-gray-900/50 p-2 rounded"><i class="fa-solid fa-comment-dots mr-1"></i> ${escapeHTML(r.comments)}</p>` : ''}
                    <div class="text-xs text-gray-400 mt-3 text-right">Reported: ${new Date(r.timestamp).toLocaleDateString()}</div>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<div class="text-red-500 text-center p-4">Failed to load reports. Check your connection.</div>`;
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const colors = type === 'error' ? 'bg-red-500 text-white' : 'bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900';
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';

    toast.className = `toast-enter ${colors} px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 font-medium text-sm`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${escapeHTML(message)}`;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function openSessionSettingsModal() {
    // Sync the toggle visually with the saved preference
    document.getElementById('toggle-active-recall').checked = state.prefs.activeRecall !== false;

    const modal = document.getElementById('session-settings-modal');
    const inner = modal.querySelector('div');
    modal.classList.remove('hidden');

    setTimeout(() => {
        modal.classList.remove('opacity-0');
        inner.classList.remove('scale-95');
    }, 10);
}

function closeSessionSettingsModal() {
    const modal = document.getElementById('session-settings-modal');
    const inner = modal.querySelector('div');
    modal.classList.add('opacity-0');
    inner.classList.add('scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

function toggleActiveRecall() {
    const isChecked = document.getElementById('toggle-active-recall').checked;
    state.prefs.activeRecall = isChecked;
    saveState(); // Saves the preference to localStorage

    // Re-render immediately so changes take effect without going to the next question
    if (state.session.active) {
        renderQuestion();
    }
}

// --- MODE SELECT HUB LOGIC ---
let activeHubSubject = "";

function openModeSelect(subject) {
    activeHubSubject = subject;
    document.getElementById('mode-select-deck-title').innerText = subject;
    navigate('mode-select');
}

function proceedToReview() {
    // Calls your existing review function with the selected subject
    reviewDeck(activeHubSubject);
}

function proceedToQuiz() {
    // Replace 'startQuiz(activeHubSubject)' with whatever function name your app uses to launch a quiz session for a subject
    if (typeof startQuiz === 'function') {
        startQuiz(activeHubSubject);
    } else {
        console.warn("Quiz start function not found. Please connect your app's quiz initialization function here.");
        alert(`Starting quiz for: ${activeHubSubject}`);
    }
}

// 1. Initialize global state (defaults to quiz mode)
let currentAppMode = 'quiz'; 

// 2. Handle the toggle switch
function toggleAppMode() {
    const toggleElement = document.getElementById('globalModeToggle');
    const modeLabel = document.getElementById('modeLabel');
    
    // Update global state
    currentAppMode = toggleElement.checked ? 'review' : 'quiz';
    
    // Update the label text
    modeLabel.innerText = currentAppMode === 'review' ? 'Study' : 'Quiz';
    
    // Re-render the dashboard cards instantly to reflect the new mode
    renderCategoryProgress(); 
}

// 3. Centralized click handler for the deck
function handleDeckClick(subj, action = 'continue') {
    if (currentAppMode === 'review') {
        reviewDeck(subj);
    } else {
        fetchAndStartCategory(subj, action);
    }
}

// NOTE: Don't forget to delete the old handleGlobalSearch() function if you haven't already!