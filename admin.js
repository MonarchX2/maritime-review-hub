let adminState = {
  token: "",
  subjects: [],
  reports: [],
  admin_last_modified_timestamp: "", // OPTIMIZATION: For conflict detection
  hierarchyLayoutMode: "current", // "current" or "new" - for toggling Subject Hierarchy Editor layout
};

// OPTIMIZATION: Optimistic UI Lock
let adminSaveInProgress = false;
let adminInputsLocked = false;

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

function hideAdminSettingsModal() {
  const modal = document.getElementById("admin-settings-modal");
  if (!modal) return;
  const inner = modal.querySelector("div");

  modal.classList.add("opacity-0");
  if (inner) inner.classList.add("scale-95");
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
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

// CRITICAL: Listen for cache invalidation broadcasts from other tabs/admin changes
if (typeof BroadcastChannel !== "undefined") {
  try {
    const cacheChannel = new BroadcastChannel("mrh_cache_invalidation");
    cacheChannel.onmessage = (event) => {
      if (
        event.data &&
        event.data.type === "cache_invalidated" &&
        getAdminToken()
      ) {
        console.log(
          "[ADMIN] Cache invalidated, reloading subjects:",
          event.data.timestamp,
        );
        loadAdminSubjects();
      }
    };
  } catch (e) {
    console.warn("BroadcastChannel not available for cache invalidation:", e);
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
      initializeAdminUI();
      loadAdminSubjects();
      adminLoadReports(); // Fetch reports upon successful login
    } else {
      const errEl = document.getElementById("admin-login-error");
      const message =
        typeof result?.message === "string" && result.message.trim()
          ? result.message
          : "Incorrect password.";
      errEl.innerText = message;
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

function collectAdminStats() {
  const records = Array.isArray(adminState.subjects) ? adminState.subjects : [];
  let folders = 0;
  let decks = 0;
  let lockedDecks = 0;
  let hiddenDecks = 0;

  records.forEach((cat) => {
    if (!cat || !cat.Subject) return;

    const isFolder =
      cat.IsFolder === true || String(cat.IsFolder).toLowerCase() === "true";
    const hasPassword = String(cat.Password || cat.password || "").trim();
    const isHidden =
      cat.Hidden === true || String(cat.Hidden).toLowerCase() === "true";

    if (isFolder) {
      folders += 1;
      return;
    }

    decks += 1;
    if (hasPassword) lockedDecks += 1;
    if (isHidden) hiddenDecks += 1;
  });

  return {
    folders,
    decks,
    lockedDecks,
    hiddenDecks,
    publicDecks: Math.max(decks - lockedDecks, 0),
  };
}

function renderAdminSummary() {
  const container = document.getElementById("admin-summary-cards");
  if (!container) return;

  const stats = collectAdminStats();
  const cards = [
    {
      label: "Decks",
      value: stats.decks,
      icon: "fa-layer-group",
      iconClasses:
        "bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300",
    },
    {
      label: "Folders",
      value: stats.folders,
      icon: "fa-folder-tree",
      iconClasses:
        "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300",
    },
    {
      label: "Locked",
      value: stats.lockedDecks,
      icon: "fa-lock",
      iconClasses:
        "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300",
    },
    {
      label: "Hidden",
      value: stats.hiddenDecks,
      icon: "fa-eye-slash",
      iconClasses:
        "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300",
    },
  ];

  container.innerHTML = cards
    .map(
      (card) => `
        <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
          <div class="flex items-center justify-between">
            <span class="inline-flex h-10 w-10 items-center justify-center rounded-lg ${card.iconClasses}">
              <i class="fa-solid ${card.icon}"></i>
            </span>
            <span class="text-2xl font-bold text-gray-900 dark:text-white">${card.value}</span>
          </div>
          <div class="mt-3">
            <p class="text-sm font-bold uppercase tracking-[0.18em] text-gray-600 dark:text-gray-400">${card.label}</p>
          </div>
        </div>
      `,
    )
    .join("");
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
    renderAdminSummary();

    // OPTIMIZATION: Get admin_last_modified_timestamp for conflict detection
    try {
      const versionResponse = await fetch(DB_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          type: "get_cache_version",
          token: getAdminToken(),
        }),
      });
      const versionData = await parseJsonResponse(versionResponse);
      if (
        versionData &&
        typeof versionData.timestamp === "string" &&
        versionData.timestamp.trim()
      ) {
        adminState.admin_last_modified_timestamp = versionData.timestamp;
        console.log(
          "[ADMIN] Loaded timestamp for conflict detection:",
          adminState.admin_last_modified_timestamp,
        );
      }
    } catch (e) {
      console.warn("[ADMIN] Could not load admin modification timestamp:", e);
    }

    renderAdminSubjectList();
  } catch (e) {
    console.error(e);
    if (
      typeof state !== "undefined" &&
      state.categorySummary &&
      state.categorySummary.length > 0
    ) {
      adminState.subjects = state.categorySummary;
      renderAdminSummary();
      renderAdminSubjectList();
    } else {
      container.innerHTML = `<p class="text-center text-red-500 py-6">Network error. Could not load database.</p>`;
    }
  }
}

function setAdminHierarchyLayoutMode(mode) {
  const normalizedMode = mode === "new" ? "new" : "current";
  adminState.hierarchyLayoutMode = normalizedMode;

  const checkbox = document.getElementById("layout-toggle-checkbox");
  if (checkbox) checkbox.checked = normalizedMode === "new";

  const button = document.getElementById("admin-layout-toggle-button");
  const icon = document.getElementById("admin-layout-toggle-icon");
  const label = document.getElementById("admin-layout-toggle-label");
  if (button) {
    const isNew = normalizedMode === "new";
    button.setAttribute("aria-pressed", String(isNew));
    button.classList.toggle("bg-brand-600", isNew);
    button.classList.toggle("text-white", isNew);
    button.classList.toggle("bg-gray-100", !isNew);
    button.classList.toggle("text-gray-700", !isNew);
    button.classList.toggle("dark:bg-gray-700", !isNew);
    button.classList.toggle("dark:text-gray-200", !isNew);
  }
  if (icon) {
    icon.className =
      normalizedMode === "new"
        ? "fa-solid fa-table-cells mr-2"
        : "fa-solid fa-list mr-2";
  }
  if (label) {
    label.textContent = normalizedMode === "new" ? "Grid View" : "List View";
  }

  console.log(
    "[ADMIN] Layout mode changed to:",
    adminState.hierarchyLayoutMode,
  );
  renderAdminSubjectList();
}

function toggleHierarchyLayout() {
  const checkbox = document.getElementById("layout-toggle-checkbox");
  setAdminHierarchyLayoutMode(checkbox && checkbox.checked ? "new" : "current");
}

function initializeAdminUI() {
  const checkbox = document.getElementById("layout-toggle-checkbox");
  if (checkbox) {
    checkbox.checked = adminState.hierarchyLayoutMode === "new";
  }

  const button = document.getElementById("admin-layout-toggle-button");
  if (button) {
    const isNew = adminState.hierarchyLayoutMode === "new";
    button.setAttribute("aria-pressed", String(isNew));
    button.classList.toggle("bg-brand-600", isNew);
    button.classList.toggle("text-white", isNew);
    button.classList.toggle("bg-gray-100", !isNew);
    button.classList.toggle("text-gray-700", !isNew);
    button.classList.toggle("dark:bg-gray-700", !isNew);
    button.classList.toggle("dark:text-gray-200", !isNew);
  }

  const icon = document.getElementById("admin-layout-toggle-icon");
  if (icon) {
    icon.className =
      adminState.hierarchyLayoutMode === "new"
        ? "fa-solid fa-table-cells mr-2"
        : "fa-solid fa-list mr-2";
  }

  const label = document.getElementById("admin-layout-toggle-label");
  if (label) {
    label.textContent =
      adminState.hierarchyLayoutMode === "new" ? "Grid View" : "List View";
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
            UUID: "",
          };
        currentNode = currentNode.subfolders[part];
      });
      currentNode.folderPass = passString; // Assign password to the folder
      currentNode.folderHidden = hiddenStatus; // Assign hidden status to the folder
      currentNode.UUID = currentNode.UUID || cat.UUID || "";
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
      UUID: cat.UUID || "",
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

    // Folder settings section - REMOVED (now using modal)
    // Settings will be triggered via icon button in folder header

    // Render subfolders
    for (const [subName, subNode] of Object.entries(node.subfolders)) {
      innerHtml += renderNode(subNode, subName, depth + 1, fullPath);
    }

    // Render decks section with header
    if (node.decks.length > 0) {
      if (depth > 0) {
        innerHtml += `<div class="my-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <span class="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">📚 Decks in this folder</span>
                     </div>`;
      }

      node.decks
        .sort((a, b) => a.deckName.localeCompare(b.deckName))
        .forEach((subj) => {
          innerHtml += `
                <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-md transition-all mb-3" data-uuid="${escapeHTML(subj.UUID || "")}">
                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <!-- Left Column: Deck Info -->
                        <div class="lg:col-span-2">
                            <span class="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block mb-1">📖 Deck Name</span>
                            <div class="font-semibold text-gray-800 dark:text-gray-100 text-lg break-words" title="${escapeHTML(subj.originalFull)}">${escapeHTML(subj.deckName)}</div>
                            <div class="text-sm text-gray-600 dark:text-gray-400 mt-1 font-mono">Full path: ${escapeHTML(subj.originalFull)}</div>
                            
                            <!-- Path Input -->
                            <div class="mt-3">
                                <div class="flex justify-between items-center mb-2">
                                    <span class="text-sm font-bold text-brand-600 dark:text-brand-400 uppercase">New Path</span>
                                    <span class="text-sm text-gray-500 font-mono" id="char-count-${subj.index}">${subj.originalFull.length}/100</span>
                                </div>
                                <input type="text" 
                                        id="new-subj-${subj.index}" 
                                        value="${escapeHTML(subj.originalFull)}" 
                                        maxlength="100"
                                        data-uuid="${escapeHTML(subj.UUID || "")}"
                                        data-original-name="${escapeHTML(subj.originalFull)}"
                                        oninput="const countEl = document.getElementById('char-count-${subj.index}');
                                        countEl.innerText = this.value.length + '/100';
                                        this.value.length >= 90 ? countEl.classList.add('text-red-500') : countEl.classList.remove('text-red-500');"
                                        class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-base focus:border-brand-500 focus:ring-2 outline-none transition-all">
                            </div>
                        </div>
                        
                        <!-- Right Column: UUID and Controls -->
                        <div class="space-y-3 flex flex-col">
                            <!-- UUID Box -->
                            ${
                              subj.UUID
                                ? `
                            <div class="inline-flex max-w-full items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 dark:border-blue-700 dark:bg-blue-900/20">
                                <span class="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">🔑</span>
                                <span class="max-w-full truncate font-mono text-sm text-blue-800 dark:text-blue-300 select-all cursor-pointer" title="Click to select UUID">${escapeHTML(subj.UUID)}</span>
                            </div>
                            `
                                : `
                            <div class="inline-flex max-w-full items-center gap-2 rounded border border-dashed border-gray-300 bg-gray-100 px-2 py-1 dark:border-gray-600 dark:bg-gray-700">
                                <span class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">🔑</span>
                                <span class="text-xs text-gray-400 dark:text-gray-500">Will be assigned</span>
                            </div>
                            `
                            }
                            
                            <!-- Password & Hidden Status -->
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="text-sm font-bold text-red-600 dark:text-red-400 block mb-1">
                                        <i class="fa-solid fa-lock"></i> Password
                                    </label>
                                    <input type="text" 
                                            id="deck-pass-${subj.index}" 
                                            value="${escapeHTML(subj.password)}" 
                                            placeholder="Public"
                                            data-uuid="${escapeHTML(subj.UUID || "")}"
                                            class="deck-pass-input w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-base focus:border-red-500 focus:ring-2 outline-none transition-all">
                                </div>
                                <div class="flex items-end">
                                    <label class="text-sm font-bold text-purple-600 dark:text-purple-400 flex items-center gap-2 cursor-pointer p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 w-full">
                                        <input type="checkbox" 
                                            id="deck-hidden-${subj.index}"
                                            class="deck-hidden-input w-4 h-4 cursor-pointer"
                                            data-uuid="${escapeHTML(subj.UUID || "")}"
                                            data-index="${subj.index}"
                                            data-path="${escapeHTML(subj.originalFull)}"
                                            data-orig="${String(subj.hidden || false)}"
                                            ${subj.hidden ? "checked" : ""}>
                                        <i class="fa-solid fa-eye-slash text-base"></i>
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
    const folderUuid = String(node.UUID || "").trim();
    const modalId = `folder-settings-${(folderUuid || fullPath).replace(/[^a-zA-Z0-9-_]/g, "-")}`;

    return `
            <details class="${indentClass} mb-2 ${depthColor} rounded-lg border group shadow-sm">
                <summary class="font-bold text-gray-700 dark:text-gray-300 p-3 cursor-pointer flex items-center justify-between hover:bg-white/50 dark:hover:bg-gray-900/30 transition-colors outline-none list-none group-open:bg-white/50 dark:group-open:bg-gray-900/30">
                    <span class="flex items-center gap-3 flex-1">
                        <i class="fa-solid fa-folder text-brand-500 text-lg flex-shrink-0"></i>
                        <span class="font-semibold text-base">${escapeHTML(folderName)}</span>
                        <span class="bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-sm px-2 py-0.5 rounded-full font-semibold flex-shrink-0">${totalDecks}</span>
                    </span>
                    <span class="flex items-center gap-2 flex-shrink-0">
                        ${
                          folderUuid
                            ? `
                        <div class="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 dark:border-blue-700 dark:bg-blue-900/20 max-w-[200px]">
                            <span class="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">🔑</span>
                            <span class="font-mono text-xs text-blue-800 dark:text-blue-300 truncate select-all cursor-pointer" title="Click to select UUID">${escapeHTML(folderUuid)}</span>
                        </div>
                        `
                            : `
                        <div class="inline-flex items-center gap-1 rounded border border-dashed border-gray-300 bg-gray-100 px-2 py-1 dark:border-gray-600 dark:bg-gray-700 flex-shrink-0">
                            <span class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">🔑</span>
                            <span class="text-xs text-gray-400 dark:text-gray-500">Will assign</span>
                        </div>
                        `
                        }
                        <button 
                            type="button"
                            onclick="document.getElementById('${modalId}').classList.remove('hidden')"
                            class="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 p-2 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors flex-shrink-0"
                            title="Folder settings">
                            <i class="fa-solid fa-sliders text-lg"></i>
                        </button>
                        <i class="fa-solid fa-chevron-down text-gray-400 transition-transform duration-300 group-open:rotate-180 text-base flex-shrink-0"></i>
                    </span>
                </summary>
                <div class="px-4 py-3 border-t ${depthColor.includes("blue") ? "border-blue-200 dark:border-blue-800" : "border-gray-200 dark:border-gray-700"} space-y-2">
                    ${innerHtml}
                </div>
            </details>

            <!-- Folder Settings Modal -->
            <div id="${modalId}" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] hidden flex items-center justify-center p-4 overflow-y-auto">
                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 transform transition-all my-auto">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-xl font-bold text-gray-800 dark:text-gray-100">
                            <i class="fa-solid fa-sliders text-amber-600 dark:text-amber-400 mr-2"></i>${escapeHTML(folderName)} - Settings
                        </h3>
                        <button 
                            type="button"
                            onclick="document.getElementById('${modalId}').classList.add('hidden')"
                            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div class="space-y-4">
                        <div class="border-t border-gray-200 dark:border-gray-700 pt-0">
                            <label class="block text-base font-bold text-red-700 dark:text-red-400 mb-2">
                                <i class="fa-solid fa-lock mr-2"></i> Lock Folder
                            </label>
                            <input type="text" 
                                class="folder-pass-input w-full p-2 border border-red-300 dark:border-red-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-base focus:border-red-500 focus:ring-2 outline-none transition-all" 
                                placeholder="Leave blank for public folder..."
                                data-path="${escapeHTML(fullPath)}"
                                data-orig="${escapeHTML(node.folderPass || "")}"
                                value="${escapeHTML(node.folderPass || "")}">
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Password to access this folder and subfolders</p>
                        </div>

                        <div class="border-t border-gray-200 dark:border-gray-700 pt-4">
                            <label class="text-base font-bold text-purple-700 dark:text-purple-400 flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" 
                                    class="folder-hidden-input w-5 h-5 cursor-pointer"
                                    data-path="${escapeHTML(fullPath)}"
                                    data-orig="${String(node.folderHidden || false)}"
                                    ${node.folderHidden ? "checked" : ""}>
                                <i class="fa-solid fa-eye-slash"></i> Hide Entire Folder
                            </label>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">Hidden from regular users (not synced)</p>
                        </div>

                        <div class="border-t border-gray-200 dark:border-gray-700 pt-4 flex gap-2">
                            <button 
                                type="button"
                                onclick="document.getElementById('${escapeHTML(modalId)}').classList.add('hidden')"
                                class="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg font-bold hover:bg-gray-300 dark:hover:bg-gray-600 transition-all">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  container.innerHTML =
    (adminState.hierarchyLayoutMode === "new"
      ? renderGridView(tree)
      : renderNode(tree, "Root", 0)) ||
    '<p class="text-center text-gray-500 py-6">No subjects found.</p>';
  renderAdminSummary();
}

function renderGridView(tree) {
  let html =
    '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">';

  function countTotalDecksInNode(node) {
    let count = node.decks.length;
    for (const key in node.subfolders)
      count += countTotalDecksInNode(node.subfolders[key]);
    return count;
  }

  function renderGridItems(node, parentPath = "") {
    for (const [folderName, subNode] of Object.entries(node.subfolders)) {
      const folderPath = parentPath
        ? `${parentPath}::${folderName}`
        : folderName;
      const totalDecks = countTotalDecksInNode(subNode);
      const folderUuid = String(subNode.UUID || "").trim();
      const modalId = `folder-settings-${(folderUuid || folderPath).replace(/[^a-zA-Z0-9-_]/g, "-")}`;

      html += `
        <div class="group animate-card-in bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col h-full transform hover:-translate-y-1 relative">
          <div class="h-12 bg-brand-500 dark:bg-brand-700 transition-colors relative">
            <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
          </div>
          <div class="p-4 flex-1 flex flex-col justify-between">
            <div class="flex justify-between items-start w-full gap-2">
              <h3 class="font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-lg flex items-center min-w-0">
                <span class="truncate">${escapeHTML(folderName)}</span>
              </h3>
              <button
                type="button"
                onclick="document.getElementById('${modalId}').classList.remove('hidden')"
                class="text-gray-400 hover:text-brand-500 dark:hover:text-brand-400 transition-colors p-1"
                aria-label="Folder settings"
              >
                <i class="fa-solid fa-gear text-sm"></i>
              </button>
            </div>
            <div class="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400 mt-2">
              <span>${totalDecks} ${totalDecks === 1 ? "card" : "cards"}</span>
            </div>
            <button
              type="button"
              onclick="toggleGridFolder('${escapeHTML(folderPath)}')"
              class="mt-4 w-full bg-brand-600 text-white py-2 px-3 rounded-lg font-bold hover:bg-brand-700 active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300"
            >
              <i class="fa-solid fa-folder-open mr-2"></i> View Contents
            </button>
          </div>

          <div id="${modalId}" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] hidden items-center justify-center p-4 overflow-y-auto">
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 transform transition-all my-auto">
              <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-gray-800 dark:text-gray-100">
                  <i class="fa-solid fa-sliders text-amber-600 dark:text-amber-400 mr-2"></i>${escapeHTML(folderName)} Settings
                </h3>
                <button
                  type="button"
                  onclick="document.getElementById('${modalId}').classList.add('hidden')"
                  class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl"
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>

              <div class="space-y-4">
                <div class="border-t border-gray-200 dark:border-gray-700 pt-0">
                  <label class="block text-base font-bold text-red-700 dark:text-red-400 mb-2">
                    <i class="fa-solid fa-lock mr-2"></i> Lock Folder
                  </label>
                  <input type="text"
                    class="folder-pass-input w-full p-2 border border-red-300 dark:border-red-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-base focus:border-red-500 focus:ring-2 outline-none transition-all"
                    placeholder="Leave blank for public folder..."
                    data-path="${escapeHTML(folderPath)}"
                    data-orig="${escapeHTML(subNode.folderPass || "")}"
                    value="${escapeHTML(subNode.folderPass || "")}">
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Password to access this folder and subfolders</p>
                </div>

                <div class="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <label class="text-base font-bold text-purple-700 dark:text-purple-400 flex items-center gap-2 cursor-pointer">
                    <input type="checkbox"
                      class="folder-hidden-input w-5 h-5 cursor-pointer"
                      data-path="${escapeHTML(folderPath)}"
                      data-orig="${String(subNode.folderHidden || false)}"
                      ${subNode.folderHidden ? "checked" : ""}>
                    <i class="fa-solid fa-eye-slash"></i> Hide Entire Folder
                  </label>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">Hidden from regular users (not synced)</p>
                </div>

                <div class="border-t border-gray-200 dark:border-gray-700 pt-4 flex gap-2">
                  <button
                    type="button"
                    onclick="document.getElementById('${modalId}').classList.add('hidden')"
                    class="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg font-bold hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    node.decks
      .sort((a, b) => a.deckName.localeCompare(b.deckName))
      .forEach((subj) => {
        html += `
        <div class="group animate-card-in bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col h-full transform hover:-translate-y-1 relative">
          <div class="h-12 bg-purple-500 dark:bg-purple-700 transition-colors relative">
            <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
          </div>
          <div class="p-4 flex-1 flex flex-col">
            <div class="flex items-start justify-between gap-2 mb-3 min-w-0">
              <h3 class="font-bold text-gray-800 dark:text-gray-100 text-lg flex items-center min-w-0">
                <i class="fa-regular fa-file-lines text-gray-400 mr-2 text-sm flex-shrink-0"></i>
                <span class="truncate">${escapeHTML(subj.deckName)}</span>
              </h3>
              <span class="bg-gray-100 text-gray-500 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold dark:bg-gray-700 dark:text-gray-400 shadow-sm transition-colors">
                <i class="fa-solid fa-cloud mr-1"></i>
              </span>
            </div>

            <p class="text-xs text-gray-500 dark:text-gray-400 mb-3 break-all font-mono min-h-[2.5rem]">
              ${escapeHTML(subj.originalFull)}
            </p>

            ${
              subj.UUID
                ? `
              <p class="text-[10px] text-gray-500 dark:text-gray-400 mb-3 break-all font-mono">
                ${escapeHTML(subj.UUID)}
              </p>
            `
                : ""
            }

            <div class="space-y-2 mt-auto">
              <div>
                <label class="text-[10px] font-bold text-red-600 dark:text-red-400 block mb-1 uppercase tracking-wider">
                  <i class="fa-solid fa-lock mr-1"></i> Password
                </label>
                <input type="text"
                  id="deck-pass-${subj.index}"
                  value="${escapeHTML(subj.password)}"
                  placeholder="Public"
                  data-uuid="${escapeHTML(subj.UUID || "")}"
                  class="deck-pass-input w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-sm focus:border-red-500 focus:ring-2 outline-none transition-all">
              </div>

              <label class="text-[10px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-2 cursor-pointer p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
                <input type="checkbox"
                  id="deck-hidden-${subj.index}"
                  class="deck-hidden-input w-4 h-4 cursor-pointer"
                  data-uuid="${escapeHTML(subj.UUID || "")}"
                  data-index="${subj.index}"
                  data-path="${escapeHTML(subj.originalFull)}"
                  data-orig="${String(subj.hidden || false)}"
                  ${subj.hidden ? "checked" : ""}>
                <i class="fa-solid fa-eye-slash text-sm"></i>
                <span>Hidden</span>
              </label>
            </div>
          </div>
        </div>
      `;
      });
  }

  renderGridItems(tree);
  html += "</div>";
  return html;
}

function toggleGridFolder(folderPath) {
  console.log("Toggle grid folder:", folderPath);
  // Placeholder for expansion logic - can be implemented to show nested contents
}

async function adminClearAllSubjects() {
  const confirmed = window.confirm(
    "Clear every subject and folder from the hierarchy editor? This resets the admin layout and starts from scratch.",
  );
  if (!confirmed) return;

  const btn = document.getElementById("btn-admin-clear-all");
  const originalHTML = btn.innerHTML;

  btn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Clearing...';
  btn.disabled = true;

  try {
    const response = await fetch(DB_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "admin_clear_all",
        token: getAdminToken(),
      }),
    });

    const result = await parseJsonResponse(response);

    if (result.status === "success") {
      adminState.subjects = [];
      renderAdminSummary();
      renderAdminSubjectList();

      if (typeof BroadcastChannel !== "undefined") {
        try {
          const invalidationChannel = new BroadcastChannel(
            "mrh_cache_invalidation",
          );
          invalidationChannel.postMessage({
            type: "cache_invalidated",
            source: "admin-clear-all",
            timestamp: Date.now(),
          });
          invalidationChannel.close();
        } catch (e) {
          console.warn(
            "Could not broadcast cache invalidation after clear-all:",
            e,
          );
        }
      }

      alert(result.message || "Hierarchy cleared successfully.");
      return;
    }

    alert("Failed: " + (result.message || "Could not clear the hierarchy."));
  } catch (e) {
    alert("Network error: " + (e.message || "Could not clear the hierarchy."));
    console.error(e);
  } finally {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
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

    const hasNameChange = newName !== originalName;
    const hasPasswordChange = deckPass !== originalPassword;
    const hasHiddenChange = deckHidden !== originalHidden;

    if (hasNameChange || hasPasswordChange || hasHiddenChange) {
      const deckUpdate = {
        oldName: originalName,
        newName: newName,
      };

      if (hasPasswordChange) deckUpdate.password = deckPass;
      if (hasHiddenChange) deckUpdate.hidden = deckHidden;

      updates.push(deckUpdate);
    }
  });

  if (updates.length === 0) {
    alert("No changes detected.");
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    return;
  }

  // OPTIMIZATION: Optimistic UI Lock
  if (adminSaveInProgress) {
    alert("Save already in progress. Please wait...");
    return;
  }

  adminSaveInProgress = true;
  lockAdminInputs(true);
  btn.disabled = true;

  console.log("Sending updates to backend:", JSON.stringify(updates, null, 2));

  try {
    // OPTIMIZATION: Fetch fresh timestamp before saving to prevent race conditions
    try {
      const versionResponse = await fetch(DB_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          type: "get_cache_version",
          token: getAdminToken(),
        }),
      });
      const versionData = await parseJsonResponse(versionResponse);
      if (
        versionData &&
        typeof versionData.timestamp === "string" &&
        versionData.timestamp.trim()
      ) {
        adminState.admin_last_modified_timestamp = versionData.timestamp;
        console.log(
          "[ADMIN] Updated timestamp before save:",
          adminState.admin_last_modified_timestamp,
        );
      }
    } catch (e) {
      console.warn("[ADMIN] Could not refresh timestamp before save:", e);
    }

    const response = await fetch(DB_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        type: "admin_update",
        token: getAdminToken(),
        updates: updates,
        admin_last_modified_timestamp:
          adminState.admin_last_modified_timestamp || "",
        lastModifiedBy: adminState.token.substring(0, 10) + "...",
      }),
    });
    const result = await parseJsonResponse(response);

    console.log("Backend response:", result);

    if (result.status === "success") {
      btn.innerHTML = '<i class="fa-solid fa-check-circle mr-2"></i> Saved ✓';
      btn.classList.add("ring-2", "ring-green-300");

      if (result.admin_last_modified_timestamp) {
        adminState.admin_last_modified_timestamp =
          result.admin_last_modified_timestamp;
      }

      setTimeout(() => {
        loadAdminSubjects();
        btn.innerHTML = originalHTML;
        btn.classList.remove("ring-2", "ring-green-300");
      }, 400);
    } else if (result.status === "conflict") {
      console.warn(
        "[ADMIN] Conflict warning received, continuing save:",
        result,
      );
      if (result.serverTimestamp) {
        adminState.admin_last_modified_timestamp = result.serverTimestamp;
      }
      btn.innerHTML = '<i class="fa-solid fa-check-circle mr-2"></i> Saved ✓';
      btn.classList.add("ring-2", "ring-yellow-300");
      setTimeout(() => {
        loadAdminSubjects();
        btn.innerHTML = originalHTML;
        btn.classList.remove("ring-2", "ring-yellow-300");
      }, 400);
    } else {
      alert("Failed: " + result.message);
      btn.innerHTML = originalHTML;
    }
  } catch (e) {
    alert("Network error: " + e.message);
    console.error(e);
    btn.innerHTML = originalHTML;
  } finally {
    adminSaveInProgress = false;
    lockAdminInputs(false);
    btn.disabled = false;
  }
}

// OPTIMIZATION: Lock/unlock admin inputs
function lockAdminInputs(lock) {
  adminInputsLocked = lock;
  const inputs = document.querySelectorAll(
    ".folder-pass-input, .folder-hidden-input, .deck-pass-input, " +
      ".deck-hidden-input, #new-subj-input, input[id*='new-subj-'], input[id*='deck-pass-'], input[id*='deck-hidden-']",
  );
  inputs.forEach((input) => {
    if (lock) {
      input.disabled = true;
      input.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      input.disabled = false;
      input.classList.remove("opacity-50", "cursor-not-allowed");
    }
  });
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
  const folderPath = String(input.getAttribute("data-path") || "").trim();
  const pass = String(input.value || "").trim();

  let count = 0;
  adminState.subjects.forEach((subj, index) => {
    if (String(subj.Subject || "").trim() !== folderPath) return;

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
  });

  alert(
    `Applied to ${count} deck(s)! You can now customize individual decks below if needed before clicking Save.`,
  );
};

window.cascadeHidden = function (btn) {
  const checkbox = btn.previousElementSibling;
  const folderPath = String(checkbox.getAttribute("data-path") || "").trim();
  const isHidden = checkbox.checked;

  let count = 0;
  adminState.subjects.forEach((subj, index) => {
    if (String(subj.Subject || "").trim() !== folderPath) return;

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
  if (!modal) return;
  const inner = modal.querySelector("div");

  modal.classList.add("opacity-0");
  if (inner) inner.classList.add("scale-95");
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

if (typeof window !== "undefined") {
  window.adminState = adminState;
  window.adminLogin = adminLogin;
  window.getAdminToken = getAdminToken;
  window.setAdminToken = setAdminToken;
  window.clearAdminToken = clearAdminToken;
  window.hideAdminSettingsModal = hideAdminSettingsModal;
  window.loadAdminSubjects = loadAdminSubjects;
  window.renderAdminSubjectList = renderAdminSubjectList;
  window.adminClearAllSubjects = adminClearAllSubjects;
  window.saveAdminChanges = saveAdminChanges;
  window.adminLoadReports = adminLoadReports;
  window.adminActionReport = adminActionReport;
  window.openEditModal = openEditModal;
  window.closeEditModal = closeEditModal;
  window.saveEditedQuestion = saveEditedQuestion;
}
