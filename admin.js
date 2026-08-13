let adminState = {
  token: "",
  subjects: [],
  reports: [],
};

adminState.token = getAdminToken();

function getAdminToken() {
  if (typeof sessionStorage !== "undefined") {
    const candidate = sessionStorage.getItem("mrh_admin_token");
    if (candidate) return candidate;
  }
  return "";
}

function setAdminToken(token) {
  const sanitized = typeof token === "string" ? token.trim() : "";
  if (typeof sessionStorage !== "undefined") {
    if (sanitized) {
      sessionStorage.setItem("mrh_admin_token", sanitized);
    } else {
      sessionStorage.removeItem("mrh_admin_token");
    }
  }
  adminState.token = sanitized;
}

function clearAdminToken() {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem("mrh_admin_token");
  }
  adminState.token = "";
}

async function parseJsonResponse(response) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = `Backend request failed (${response.status})`;
    try {
      const json = JSON.parse(text);
      if (json && typeof json.message === "string") message = json.message;
    } catch (ignore) {}
    throw new Error(message);
  }
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid JSON response from backend: ${text.slice(0, 200)}`,
    );
  }
}

async function adminLogin() {
  const pass = document.getElementById("admin-password").value;
  if (!pass) return;

  const btn = document.getElementById("btn-admin-login");
  const originalText = btn.innerHTML;
  btn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Verifying...';
  btn.disabled = true;

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "verify_admin",
        token: pass,
      }),
    });

    const result = await parseJsonResponse(response);

    if (result.status === "success") {
      setAdminToken(pass);
      document.getElementById("admin-login-error").classList.add("hidden");
      document.getElementById("admin-login-section").classList.add("hidden");
      document
        .getElementById("admin-dashboard-section")
        .classList.remove("hidden");
      loadAdminSubjects();
      adminLoadReports(); // Fetch reports upon successful login
    } else {
      const errEl = document.getElementById("admin-login-error");
      errEl.innerText = "Incorrect password.";
      errEl.classList.remove("hidden");
    }
  } catch (e) {
    alert("Network error while verifying password.");
    console.error(e);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function loadAdminSubjects() {
  const container = document.getElementById("admin-subject-list");
  container.innerHTML = `<p class="text-center text-brand-500 py-6"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Fetching secure database...</p>`;

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "admin_get_subjects",
        token: getAdminToken(),
      }),
    });

    const secureSubjects = await parseJsonResponse(response);
    if (secureSubjects.status === "error") {
      container.innerHTML = `<p class="text-center text-red-500 py-6">Failed to load secure subjects: ${escapeHTML(
        secureSubjects.message || "Backend rejected the request",
      )}</p>`;
      return;
    }
    if (!Array.isArray(secureSubjects)) {
      container.innerHTML = `<p class="text-center text-red-500 py-6">Unexpected response from the backend. Please check server configuration.</p>`;
      return;
    }

    adminState.subjects = secureSubjects;
    renderAdminSubjectList();
  } catch (e) {
    console.error(e);
    if (
      typeof state !== "undefined" &&
      state.categorySummary &&
      state.categorySummary.length > 0
    ) {
      adminState.subjects = state.categorySummary;
      renderAdminSubjectList();
    } else {
      container.innerHTML = `<p class="text-center text-red-500 py-6">Network error. Could not load database.</p>`;
    }
  }
}

function renderAdminSubjectList() {
  const container = document.getElementById("admin-subject-list");
  const tree = {
    subfolders: {},
    decks: [],
    folderPass: "",
    folderHidden: false,
  }; // Added folderPass and folderHidden state

  adminState.subjects.forEach((cat, index) => {
    const subjString = cat.Subject;
    const passString = String(cat.Password || cat.password || "").trim();
    const hiddenStatus =
      cat.Hidden === true || String(cat.Hidden).toLowerCase() === "true";

    console.log(
      `[Render] Subject: ${subjString}, Hidden: ${cat.Hidden}, Parsed: ${hiddenStatus}`,
    );

    const parts = subjString.split("::").map((s) => s.trim());
    if (
      cat.IsFolder === true ||
      String(cat.IsFolder).toLowerCase() === "true"
    ) {
      let currentNode = tree;
      parts.forEach((part) => {
        if (!currentNode.subfolders[part])
          currentNode.subfolders[part] = {
            subfolders: {},
            decks: [],
            folderPass: "",
            folderHidden: false,
          };
        currentNode = currentNode.subfolders[part];
      });
      currentNode.folderPass = passString; // Assign password to the folder
      currentNode.folderHidden = hiddenStatus; // Assign hidden status to the folder
      return; // Stop here, it's not a deck
    }

    const deckName = parts.pop();

    let currentNode = tree;
    parts.forEach((part) => {
      if (!currentNode.subfolders[part])
        currentNode.subfolders[part] = {
          subfolders: {},
          decks: [],
          folderPass: "",
          folderHidden: false,
        };
      currentNode = currentNode.subfolders[part];
    });

    currentNode.decks.push({
      originalFull: subjString,
      deckName: deckName,
      index: index,
      password: passString,
      hidden: hiddenStatus,
    });

    console.log(`[Add Deck] ${deckName}, hidden=${hiddenStatus}`);
  });

  function countTotalDecks(node) {
    let count = node.decks.length;
    for (const key in node.subfolders)
      count += countTotalDecks(node.subfolders[key]);
    return count;
  }

  function renderNode(node, folderName, depth = 0, currentPath = "") {
    let innerHtml = "";
    const fullPath =
      depth === 0
        ? ""
        : currentPath
          ? `${currentPath}::${folderName}`
          : folderName;

    // Folder settings section (collapsible)
    if (
      depth > 0 &&
      (Object.keys(node.subfolders).length > 0 || node.decks.length > 0)
    ) {
      innerHtml += `
                <details class="mb-4 bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden group">
                    <summary class="cursor-pointer p-3 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between text-sm font-bold text-gray-700 dark:text-gray-300 outline-none list-none">
                        <span class="flex items-center gap-2">
                            <i class="fa-solid fa-sliders text-amber-600 dark:text-amber-500"></i>
                            Folder Settings
                        </span>
                        <i class="fa-solid fa-chevron-right text-gray-400 transition-transform duration-200 group-open:rotate-90"></i>
                    </summary>
                    <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 space-y-4 bg-white dark:bg-gray-900/50">
                        <div class="space-y-2">
                            <label class="text-sm font-bold text-red-700 dark:text-red-400 flex items-center gap-2">
                                <i class="fa-solid fa-lock"></i> Lock Folder
                            </label>
                            <p class="text-xs text-red-600 dark:text-red-300 mb-2">Password to access this folder and subfolders</p>
                            <input type="text" 
                                class="folder-pass-input w-full p-2 border border-red-300 dark:border-red-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded focus:border-red-500 focus:ring-2 outline-none transition-all text-sm" 
                                placeholder="Leave blank for public folder..."
                                data-path="${escapeHTML(fullPath)}"
                                data-orig="${escapeHTML(node.folderPass || "")}"
                                value="${escapeHTML(node.folderPass || "")}">
                            <button onclick="cascadePassword(this)" class="w-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 py-2 rounded font-semibold hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors active:scale-95 text-xs flex items-center justify-center gap-2 mt-2">
                                <i class="fa-solid fa-angles-down"></i> Apply to all nested decks
                            </button>
                        </div>
                        
                        <div class="border-t border-gray-200 dark:border-gray-700 pt-3">
                            <label class="text-sm font-bold text-purple-700 dark:text-purple-400 flex items-center gap-2 cursor-pointer mb-2">
                                <input type="checkbox" 
                                    class="folder-hidden-input w-4 h-4 cursor-pointer"
                                    data-path="${escapeHTML(fullPath)}"
                                    data-orig="${String(node.folderHidden || false)}"
                                    ${node.folderHidden ? "checked" : ""}>
                                <i class="fa-solid fa-eye-slash"></i> Hide Entire Folder
                            </label>
                            <p class="text-xs text-purple-600 dark:text-purple-300 mb-2">Hidden from regular users (not synced)</p>
                            <button onclick="cascadeHidden(this)" class="w-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 py-2 rounded font-semibold hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors active:scale-95 text-xs flex items-center justify-center gap-2">
                                <i class="fa-solid fa-angles-down"></i> Hide all nested decks
                            </button>
                        </div>
                    </div>
                </details>
            `;
    }

    // Render subfolders
    for (const [subName, subNode] of Object.entries(node.subfolders)) {
      innerHtml += renderNode(subNode, subName, depth + 1, fullPath);
    }

    // Render decks section with header
    if (node.decks.length > 0) {
      if (depth > 0) {
        innerHtml += `<div class="my-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <span class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">📚 Decks in this folder</span>
                     </div>`;
      }

      node.decks.forEach((subj) => {
        innerHtml += `
                <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-md transition-all">
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <!-- Left Column: Deck Info -->
                        <div>
                            <span class="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">📖 Deck Name</span>
                            <div class="font-semibold text-gray-800 dark:text-gray-100 text-sm break-words" title="${escapeHTML(subj.originalFull)}">${escapeHTML(subj.deckName)}</div>
                            <div class="text-xs text-gray-500 dark:text-gray-400 mt-2 font-mono">Full path: ${escapeHTML(subj.originalFull)}</div>
                        </div>
                        
                        <!-- Right Column: Controls -->
                        <div class="space-y-3">
                            <!-- Path Input -->
                            <div>
                                <div class="flex justify-between items-center mb-1">
                                    <span class="text-xs font-bold text-brand-600 dark:text-brand-400 uppercase">New Path</span>
                                    <span class="text-xs text-gray-400 font-mono" id="char-count-${subj.index}">${subj.originalFull.length}/100</span>
                                </div>
                                <input type="text" 
                                        id="new-subj-${subj.index}" 
                                        value="${escapeHTML(subj.originalFull)}" 
                                        maxlength="100"
                                        oninput="const countEl = document.getElementById('char-count-${subj.index}');
                                        countEl.innerText = this.value.length + '/100';
                                        this.value.length >= 90 ? countEl.classList.add('text-red-500') : countEl.classList.remove('text-red-500');"
                                        class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-sm focus:border-brand-500 focus:ring-2 outline-none transition-all">
                            </div>
                            
                            <!-- Password & Hidden Status (Inline) -->
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="text-xs font-bold text-red-600 dark:text-red-400 block mb-1">
                                        <i class="fa-solid fa-lock"></i> Password
                                    </label>
                                    <input type="text" 
                                            id="deck-pass-${subj.index}" 
                                            value="${escapeHTML(subj.password)}" 
                                            placeholder="Public"
                                            class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-sm focus:border-red-500 focus:ring-2 outline-none transition-all">
                                </div>
                                <div class="flex items-end">
                                    <label class="text-xs font-bold text-purple-600 dark:text-purple-400 flex items-center gap-2 cursor-pointer p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 w-full">
                                        <input type="checkbox" 
                                            id="deck-hidden-${subj.index}"
                                            class="deck-hidden-input w-4 h-4 cursor-pointer"
                                            data-index="${subj.index}"
                                            ${subj.hidden ? "checked" : ""}>
                                        <i class="fa-solid fa-eye-slash text-sm"></i>
                                        <span>Hidden</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
      });
    }

    if (depth === 0) return innerHtml;

    const totalDecks = countTotalDecks(node);
    const depthColor =
      depth === 1
        ? "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"
        : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700";

    const indentClass = depth > 1 ? "ml-2 md:ml-4" : "";

    return `
            <details class="${indentClass} mb-3 ${depthColor} rounded-lg border group shadow-sm">
                <summary class="font-bold text-gray-700 dark:text-gray-300 p-4 cursor-pointer flex items-center justify-between hover:bg-white/50 dark:hover:bg-gray-900/30 transition-colors outline-none list-none group-open:bg-white/50 dark:group-open:bg-gray-900/30">
                    <span class="flex items-center gap-3">
                        <i class="fa-solid fa-folder text-brand-500 text-lg"></i>
                        <span class="font-semibold">${escapeHTML(folderName)}</span>
                        <span class="bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-xs px-2 py-1 rounded-full font-semibold">${totalDecks} deck${totalDecks !== 1 ? "s" : ""}</span>
                    </span>
                    <i class="fa-solid fa-chevron-down text-gray-400 transition-transform duration-300 group-open:rotate-180"></i>
                </summary>
                <div class="px-4 py-3 border-t ${depthColor.includes("blue") ? "border-blue-200 dark:border-blue-800" : "border-gray-200 dark:border-gray-700"} space-y-3">
                    ${innerHtml}
                </div>
            </details>
        `;
  }

  container.innerHTML =
    renderNode(tree, "Root", 0) ||
    '<p class="text-center text-gray-500 py-6">No subjects found.</p>';
}

async function saveAdminChanges() {
  const btn = document.getElementById("btn-admin-save");
  const originalHTML = btn.innerHTML;

  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
  btn.disabled = true;

  const updates = [];

  // Handle folder password and hidden status
  document.querySelectorAll(".folder-pass-input").forEach((input) => {
    const path = input.getAttribute("data-path");
    const pass = String(input.value || "").trim();
    const orig = String(input.getAttribute("data-orig") || "").trim();

    if (pass !== orig) {
      updates.push({ oldName: path, newName: path, password: pass });
    }
  });

  // Handle folder hidden status
  document.querySelectorAll(".folder-hidden-input").forEach((checkbox) => {
    const path = checkbox.getAttribute("data-path");
    const isHidden = checkbox.checked;
    const origHidden =
      String(checkbox.getAttribute("data-orig") || "false") === "true";

    if (isHidden !== origHidden) {
      updates.push({ oldName: path, newName: path, hidden: isHidden });
    }
  });

  // Handle deck edits
  adminState.subjects.forEach((cat, index) => {
    if (cat.IsFolder) return; // Handled above

    const originalName = cat.Subject;
    const originalPass = cat.Password || cat.password || "";
    const originalHidden =
      cat.Hidden === true || String(cat.Hidden).toLowerCase() === "true";

    const newNameInput = document.getElementById(`new-subj-${index}`);
    const deckPassInput = document.getElementById(`deck-pass-${index}`);
    const deckHiddenInput = document.getElementById(`deck-hidden-${index}`);

    if (!newNameInput || !deckPassInput) return;

    const newName = newNameInput.value.trim() || originalName;
    const deckPass = String(deckPassInput.value || "").trim();
    const deckHidden = deckHiddenInput
      ? deckHiddenInput.checked
      : originalHidden;
    const originalPassword = String(originalPass || "").trim();

    console.log(
      `[Compare] ${originalName}: name=${newName !== originalName}, pass=${deckPass !== originalPassword}, hidden=${deckHidden}!==${originalHidden}=${deckHidden !== originalHidden}`,
    );

    if (
      newName !== originalName ||
      deckPass !== originalPassword ||
      deckHidden !== originalHidden
    ) {
      updates.push({
        oldName: originalName,
        newName: newName,
        password: deckPass,
        hidden: deckHidden,
      });
    }
  });

  if (updates.length === 0) {
    alert("No changes detected.");
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    return;
  }

  console.log("Sending updates to backend:", JSON.stringify(updates, null, 2));

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "admin_update",
        token: getAdminToken(),
        updates: updates,
      }),
    });
    const result = await parseJsonResponse(response);

    console.log("Backend response:", result);

    if (result.status === "success") {
      alert("Changes saved! Refreshing secure layout...");
      await loadAdminSubjects();
    } else {
      alert("Failed: " + result.message);
    }
  } catch (e) {
    alert("Network error.");
    console.error(e);
  } finally {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
}

async function adminLoadReports() {
  const container = document.getElementById("admin-reports-list");
  container.innerHTML = `<p class="text-center text-gray-500 py-4"><i class="fa-solid fa-spinner fa-spin"></i> Loading reports...</p>`;

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "get_reports",
        role: "admin",
        token: getAdminToken(),
      }),
    });
    const reports = await parseJsonResponse(response);

    if (reports && reports.status === "error") {
      container.innerHTML = `<div class="text-red-500 text-center py-6">${escapeHTML(
        reports.message || "Failed to load reports.",
      )}</div>`;
      return;
    }
    if (!Array.isArray(reports) || reports.length === 0) {
      container.innerHTML = `<div class="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl text-center text-gray-500">No reports found in the database.</div>`;
      adminState.reports = [];
      return;
    }
    adminState.reports = reports;

    let html = "";
    reports.forEach((r) => {
      const choices = [r.optionA, r.optionB, r.optionC, r.optionD].filter(
        (choice) => choice && String(choice).trim(),
      );
      const questionType = choices.length <= 1 ? "Identification" : "MCQ";

      html += `
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border-l-4 border-yellow-500 shadow-sm relative group mb-4">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-xs font-mono text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">ID: ${escapeHTML(r.questionId)}</span>
                        <span class="text-xs text-gray-400">${new Date(r.timestamp).toLocaleString()}</span>
                    </div>
                    <div class="text-xs text-brand-500 font-bold uppercase tracking-wider mb-1">${escapeHTML(r.subject)}</div>
                    ${r.lesson ? `<div class="text-sm text-gray-600 dark:text-gray-300 mb-2"><strong>Lesson / Topic:</strong> ${escapeHTML(r.lesson)}</div>` : ""}
                    <div class="text-xs text-brand-600 dark:text-brand-400 font-bold uppercase mb-2">Question Type: ${questionType}</div>
                    <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-2">${escapeHTML(r.errorType)}</h4>
                    
                    <!-- UPDATED: Question Context with Choices and Answer -->
                    <div class="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-sm text-gray-700 dark:text-gray-300 mb-3 border border-gray-200 dark:border-gray-700">
                        <div class="mb-3">
                            <strong class="text-gray-900 dark:text-white">Q:</strong> ${escapeHTML(r.questionText || "N/A")}
                        </div>
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 py-3 border-t border-gray-200 dark:border-gray-700 text-xs">
                            <div class="truncate" title="${escapeHTML(r.optionA || "")}"><strong class="text-gray-500 mr-1">A:</strong> ${escapeHTML(r.optionA || "N/A")}</div>
                            <div class="truncate" title="${escapeHTML(r.optionB || "")}"><strong class="text-gray-500 mr-1">B:</strong> ${escapeHTML(r.optionB || "N/A")}</div>
                            <div class="truncate" title="${escapeHTML(r.optionC || "")}"><strong class="text-gray-500 mr-1">C:</strong> ${escapeHTML(r.optionC || "N/A")}</div>
                            <div class="truncate" title="${escapeHTML(r.optionD || "")}"><strong class="text-gray-500 mr-1">D:</strong> ${escapeHTML(r.optionD || "N/A")}</div>
                        </div>

                        <div class="pt-3 border-t border-gray-200 dark:border-gray-700">
                            <strong class="text-green-600 dark:text-green-400 mr-1">Answer:</strong> ${escapeHTML(r.correctAnswer || "N/A")}
                        </div>
                    </div>

                    ${r.comments ? `<p class="text-sm text-gray-600 dark:text-gray-400 mb-4 bg-yellow-50 dark:bg-yellow-900/10 p-2 rounded border border-yellow-100 dark:border-yellow-900/30"><i class="fa-solid fa-comment text-yellow-600 mr-2"></i>${escapeHTML(r.comments)}</p>` : ""}
                    
                    <div class="flex gap-2 flex-wrap">
                        <button onclick="openEditModal('${r.id}')" class="flex-1 bg-blue-500 text-white px-4 py-2 rounded font-bold hover:bg-blue-600 shadow-sm active:scale-95 transition-all"><i class="fa-solid fa-pen mr-2"></i> Edit Data</button>
                        ${r.status === "Resolved" ? "" : `<button onclick="adminActionReport('${r.id}', 'resolve')" class="flex-1 bg-green-500 text-white px-4 py-2 rounded font-bold hover:bg-green-600 shadow-sm active:scale-95 transition-all"><i class="fa-solid fa-check mr-2"></i> Mark Resolved</button>`}
                        <button onclick="adminActionReport('${r.id}', 'delete')" class="bg-red-100 text-red-600 px-4 py-2 rounded font-bold hover:bg-red-200 shadow-sm active:scale-95 transition-all" title="Hard Delete from Sheet"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            `;
    });

    container.innerHTML =
      html ||
      `<div class="text-center text-green-500 py-4 font-bold"><i class="fa-solid fa-check-circle mr-2"></i>No reports found.</div>`;
  } catch (e) {
    container.innerHTML = `<div class="text-red-500 text-center">Failed to fetch admin reports.</div>`;
  }
}

async function adminActionReport(reportId, action) {
  if (
    action === "delete" &&
    !(await requestConfirmation(
      "Are you sure you want to permanently delete this report from Google Sheets? (Users will not see it as 'Resolved')",
      "Delete Report",
    ))
  )
    return;

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "admin_resolve_report",
        token: getAdminToken(),
        reportId: reportId,
        action: action,
      }),
    });

    const result = await parseJsonResponse(response);
    if (result.status === "success") {
      alert(
        action === "resolve"
          ? "Report marked as resolved! Users will see this status for 24 hours."
          : "Report permanently deleted.",
      );
      adminLoadReports(); // Refresh the list
    } else {
      alert("Failed: " + result.message);
    }
  } catch (e) {
    alert("Network error.");
  }
}

window.cascadePassword = function (btn) {
  const input = btn.previousElementSibling;
  const folderPath = input.getAttribute("data-path");
  const pass = String(input.value || "").trim();

  let count = 0;
  adminState.subjects.forEach((subj, index) => {
    if (
      subj.Subject.startsWith(folderPath + "::") ||
      subj.Subject === folderPath
    ) {
      const deckInput = document.getElementById(`deck-pass-${index}`);
      if (deckInput) {
        deckInput.value = pass;
        deckInput.classList.add("bg-red-100", "dark:bg-red-900/30");
        setTimeout(
          () => deckInput.classList.remove("bg-red-100", "dark:bg-red-900/30"),
          1000,
        );
        count++;
      }
    }
  });

  alert(
    `Applied to ${count} deck(s)! You can now customize individual decks below if needed before clicking Save.`,
  );
};

window.cascadeHidden = function (btn) {
  const checkbox = btn.previousElementSibling;
  const folderPath = checkbox.getAttribute("data-path");
  const isHidden = checkbox.checked;

  let count = 0;
  adminState.subjects.forEach((subj, index) => {
    if (
      subj.Subject.startsWith(folderPath + "::") ||
      subj.Subject === folderPath
    ) {
      const deckCheckbox = document.getElementById(`deck-hidden-${index}`);
      if (deckCheckbox) {
        deckCheckbox.checked = isHidden;
        deckCheckbox.parentElement.parentElement.classList.add(
          "bg-purple-100",
          "dark:bg-purple-900/30",
        );
        setTimeout(
          () =>
            deckCheckbox.parentElement.parentElement.classList.remove(
              "bg-purple-100",
              "dark:bg-purple-900/30",
            ),
          1000,
        );
        count++;
      }
    }
  });

  alert(
    `${isHidden ? "Hidden" : "Shown"} ${count} deck(s)! You can now customize individual decks below if needed before clicking Save.`,
  );
};

function openEditModal(reportId) {
  const report = adminState.reports.find(
    (r) => String(r.id) === String(reportId),
  );
  if (!report) return;

  document.getElementById("edit-report-id").value = String(report.id);
  document.getElementById("edit-question-id").value = report.questionId;

  document.getElementById("edit-q-text").value = report.questionText || "";
  document.getElementById("edit-q-optA").value = report.optionA || "";
  document.getElementById("edit-q-optB").value = report.optionB || "";
  document.getElementById("edit-q-optC").value = report.optionC || "";
  document.getElementById("edit-q-optD").value = report.optionD || "";
  document.getElementById("edit-q-answer").value = report.correctAnswer || "";
  const modal = document.getElementById("admin-edit-modal");
  const inner = modal.querySelector("div");

  modal.classList.remove("hidden");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    inner.classList.remove("scale-95");
  }, 10);
}

function closeEditModal() {
  const modal = document.getElementById("admin-edit-modal");
  const inner = modal.querySelector("div");

  modal.classList.add("opacity-0");
  inner.classList.add("scale-95");
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
}

async function saveEditedQuestion() {
  const reportId = document.getElementById("edit-report-id").value;
  const questionId = document.getElementById("edit-question-id").value;

  const report = adminState.reports.find(
    (r) => String(r.id) === String(reportId),
  );
  if (!report) {
    alert("Report reference not found.");
    return;
  }

  const saveBtn = document.getElementById("btn-save-edit");
  const originalText = saveBtn.innerHTML;
  saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...`;
  saveBtn.disabled = true;

  const payload = {
    type: "admin_edit_question",
    token: getAdminToken(),
    subject: report.subject,
    questionId: questionId,
    questionText: document.getElementById("edit-q-text").value,
    optionA: document.getElementById("edit-q-optA").value,
    optionB: document.getElementById("edit-q-optB").value,
    optionC: document.getElementById("edit-q-optC").value,
    optionD: document.getElementById("edit-q-optD").value,
    correctAnswer: document.getElementById("edit-q-answer").value,
  };

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    const result = await parseJsonResponse(response);

    if (result.status === "success") {
      alert("Question updated and cache rebuilt successfully!");
      closeEditModal();
      await adminActionReport(reportId, "resolve");
    } else {
      alert("Error: " + (result.message || "Failed to update question."));
    }
  } catch (err) {
    console.error("Save error:", err);
    alert("Network error while trying to save question changes.");
  } finally {
    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
  }
}
