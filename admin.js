let adminState = {
    token: "",
    subjects: [],
    reports: []
};

async function adminLogin() {
    const pass = document.getElementById('admin-password').value;
    if(!pass) return;

    const btn = document.getElementById('btn-admin-login');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Verifying...';
    btn.disabled = true;

    try {
        const response = await fetch(DB_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                type: "verify_admin",
                token: pass
            })
        });

        const result = await response.json();

        if (result.status === "success") {
            adminState.token = pass;
            document.getElementById('admin-login-error').classList.add('hidden');
            document.getElementById('admin-login-section').classList.add('hidden');
            document.getElementById('admin-dashboard-section').classList.remove('hidden');
            loadAdminSubjects();
            adminLoadReports(); // Fetch reports upon successful login
        } else {
            const errEl = document.getElementById('admin-login-error');
            errEl.innerText = "Incorrect password.";
            errEl.classList.remove('hidden');
        }
    } catch(e) {
        alert("Network error while verifying password.");
        console.error(e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function loadAdminSubjects() {
    const container = document.getElementById('admin-subject-list');
    container.innerHTML = `<p class="text-center text-brand-500 py-6"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Fetching secure database...</p>`;

    try {
        // Fetch the secure list (including passwords) using the admin token
        const response = await fetch(DB_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ 
                type: "admin_get_subjects", 
                token: adminState.token 
            })
        });

        const secureSubjects = await response.json();

        // Check if the backend explicitly returned an error or if the response is completely missing
        if (secureSubjects.status === "error" || !Array.isArray(secureSubjects)) {
            container.innerHTML = `<p class="text-center text-red-500 py-6">Failed to load secure subjects. Check backend configuration.</p>`;
            return;
        }

        // If it's an empty array, it will safely pass through and your renderer will show "No subjects found."

        adminState.subjects = secureSubjects; 
        renderAdminSubjectList();
        
    } catch (e) {
        console.error(e);
        // Fallback to public cache if the network fails
        if (state.categorySummary && state.categorySummary.length > 0) {
            adminState.subjects = state.categorySummary;
            renderAdminSubjectList();
        } else {
            container.innerHTML = `<p class="text-center text-red-500 py-6">Network error. Could not load database.</p>`;
        }
    }
}

function renderAdminSubjectList() {
    const container = document.getElementById('admin-subject-list');
    const tree = { subfolders: {}, decks: [], folderPass: '' }; // Added folderPass state
    
    adminState.subjects.forEach((cat, index) => {
        const subjString = cat.Subject;
        const passString = cat.Password || cat.password || ""; 
        const parts = subjString.split('::').map(s => s.trim());
        
        // Handle true folder locks
        if (cat.IsFolder) {
            let currentNode = tree;
            parts.forEach(part => {
                if (!currentNode.subfolders[part]) currentNode.subfolders[part] = { subfolders: {}, decks: [], folderPass: '' };
                currentNode = currentNode.subfolders[part];
            });
            currentNode.folderPass = passString; // Assign password to the folder
            return; // Stop here, it's not a deck
        }

        const deckName = parts.pop(); 
        
        let currentNode = tree;
        parts.forEach(part => {
            if (!currentNode.subfolders[part]) currentNode.subfolders[part] = { subfolders: {}, decks: [], folderPass: '' };
            currentNode = currentNode.subfolders[part];
        });
        
        currentNode.decks.push({ 
            originalFull: subjString, 
            deckName: deckName, 
            index: index,
            password: passString 
        });
    });

    function countTotalDecks(node) {
        let count = node.decks.length;
        for (const key in node.subfolders) count += countTotalDecks(node.subfolders[key]);
        return count;
    }

    function renderNode(node, folderName, depth = 0, currentPath = '') {
        let innerHtml = '';
        const fullPath = depth === 0 ? '' : (currentPath ? `${currentPath}::${folderName}` : folderName);

        // TRUE FOLDER LOCK UI
        if (depth > 0 && (Object.keys(node.subfolders).length > 0 || node.decks.length > 0)) {
            innerHtml += `
                <div class="mb-4 p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg shadow-sm">
                    <label class="text-sm font-bold text-red-700 dark:text-red-400 block mb-2">
                        <i class="fa-solid fa-lock mr-1"></i> Lock Entire '${escapeHTML(folderName)}' Folder
                    </label>
                    <p class="text-xs text-red-600 dark:text-red-300 mb-2">Setting a password here locks the folder itself. Users cannot open it to see subfolders or decks without this password.</p>
                    
                    <input type="text" 
                        class="folder-pass-input w-full p-2 border border-red-300 dark:border-red-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded focus:border-red-500 focus:ring-2 outline-none transition-all" 
                        placeholder="Leave blank for public folder..."
                        data-path="${escapeHTML(fullPath)}"
                        data-orig="${escapeHTML(node.folderPass || '')}"
                        value="${escapeHTML(node.folderPass || '')}">
                    
                    <!-- ADDED THE MISSING BUTTON -->
                    <button onclick="cascadePassword(this)" class="mt-3 w-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 py-2 rounded font-bold hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors shadow-sm active:scale-95 text-sm flex items-center justify-center">
                        <i class="fa-solid fa-angles-down mr-2"></i> Apply to all nested decks
                    </button>
                </div>
            `;
        }
        
        for (const [subName, subNode] of Object.entries(node.subfolders)) {
            innerHtml += renderNode(subNode, subName, depth + 1, fullPath);
        }
        
        node.decks.forEach(subj => {
            innerHtml += `
                <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row items-center gap-4 mt-3">
                    <div class="w-full md:w-1/3">
                        <span class="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Deck Name</span>
                        <div class="font-medium text-gray-700 dark:text-gray-200 truncate" title="${escapeHTML(subj.originalFull)}">${escapeHTML(subj.deckName)}</div>
                    </div>
                    <i class="fa-solid fa-arrow-right text-gray-400 hidden md:block"></i>
                    <i class="fa-solid fa-arrow-down text-gray-400 block md:hidden"></i>
                    <div class="w-full md:w-2/3">
                        <div class="flex justify-between items-end mb-1">
                            <span class="text-xs font-bold text-brand-600 dark:text-brand-400 uppercase tracking-wider">New Full Path</span>
                            <span class="text-xs text-gray-400 font-mono" id="char-count-${subj.index}">${subj.originalFull.length}/100</span>
                        </div>
                        <input type="text" 
                                id="new-subj-${subj.index}" 
                                value="${escapeHTML(subj.originalFull)}" 
                                maxlength="100"
                                oninput="const countEl = document.getElementById('char-count-${subj.index}');
                                countEl.innerText = this.value.length + '/100';
                                this.value.length >= 90 ? countEl.classList.add('text-red-500') : countEl.classList.remove('text-red-500');"
                                class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded focus:border-brand-500 focus:ring-2 outline-none transition-all">
                        
                        <div class="flex justify-between items-end mt-3 mb-1">
                            <span class="text-xs font-bold text-red-500 uppercase tracking-wider"><i class="fa-solid fa-lock mr-1"></i> Deck Password</span>
                        </div>
                        <input type="text" 
                                id="deck-pass-${subj.index}" 
                                value="${escapeHTML(subj.password)}" 
                                placeholder="Leave blank for public access"
                                class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded focus:border-red-500 focus:ring-2 outline-none transition-all">
                    </div>
                </div>
            `;
        });

        if (depth === 0) return innerHtml;

        const totalDecks = countTotalDecks(node);
        const indentClass = depth > 1 ? 'ml-4 md:ml-8' : '';

        return `
            <details class="${indentClass} mb-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 group shadow-sm">
                <summary class="font-bold text-gray-700 dark:text-gray-300 p-4 cursor-pointer flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors rounded-xl outline-none list-none">
                    <span class="flex items-center gap-2">
                        <i class="fa-solid fa-folder text-brand-500"></i> ${escapeHTML(folderName)}
                        <span class="bg-gray-200 dark:bg-gray-700 text-xs px-2 py-1 rounded-full text-gray-600 dark:text-gray-400 font-semibold ml-2">${totalDecks} deck${totalDecks !== 1 ? 's' : ''}</span>
                    </span>
                    <i class="fa-solid fa-chevron-down text-gray-400 transition-transform duration-300 group-open:rotate-180"></i>
                </summary>
                <div class="p-4 pt-0 mt-2 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-3">
                    ${innerHtml}
                </div>
            </details>
        `;
    }
    
    container.innerHTML = renderNode(tree, 'Root', 0) || '<p class="text-center text-gray-500 py-6">No subjects found.</p>';
}

async function saveAdminChanges() {
    const btn = document.getElementById('btn-admin-save');
    const originalHTML = btn.innerHTML;
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
    btn.disabled = true;

    const updates = [];
    
    // 1. Gather Folder Passwords
    document.querySelectorAll('.folder-pass-input').forEach(input => {
        const path = input.getAttribute('data-path');
        const pass = input.value.trim();
        const orig = input.getAttribute('data-orig');
        
        if (pass !== orig) {
            updates.push({ oldName: path, newName: path, password: pass });
        }
    });

    // 2. Gather Deck Passwords
    adminState.subjects.forEach((cat, index) => {
        if (cat.IsFolder) return; // Handled above

        const originalName = cat.Subject;
        const originalPass = cat.Password || cat.password || "";
        
        const newNameInput = document.getElementById(`new-subj-${index}`);
        const deckPassInput = document.getElementById(`deck-pass-${index}`);

        if (!newNameInput || !deckPassInput) return;

        const newName = newNameInput.value.trim() || originalName; 
        const deckPass = deckPassInput.value.trim();

        if (newName !== originalName || deckPass !== originalPass) {
            updates.push({ 
                oldName: originalName, 
                newName: newName, 
                password: deckPass 
            });
        }
    });

    if (updates.length === 0) {
        alert("No changes detected.");
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        return;
    }

    try {
        const response = await fetch(DB_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ type: "admin_update", token: adminState.token, updates: updates })
        });
        const result = await response.json();
        
        if (result.status === "success") {
            alert("Changes saved! Refreshing secure layout...");
            await loadAdminSubjects(); 
        } else {
            alert("Failed: " + result.message);
        }
    } catch(e) {
        alert("Network error.");
        console.error(e);
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

async function adminLoadReports() {
    const container = document.getElementById('admin-reports-list');
    container.innerHTML = `<p class="text-center text-gray-500 py-4"><i class="fa-solid fa-spinner fa-spin"></i> Loading reports...</p>`;
    
    try {
        const response = await fetch(DB_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ type: "get_reports", role: "admin", token: adminState.token })
        });
        const reports = await response.json();

        if (reports.length === 0) {
            container.innerHTML = `<div class="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl text-center text-gray-500">No reports found in the database.</div>`;
            return;
        }

        // Store reports in state so we can access full details in the modal
        adminState.reports = reports; 

        let html = '';
        reports.forEach(r => {
            if(r.status === 'Resolved') return;

            html += `
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border-l-4 border-yellow-500 shadow-sm relative group mb-4">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-xs font-mono text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">ID: ${escapeHTML(r.questionId)}</span>
                        <span class="text-xs text-gray-400">${new Date(r.timestamp).toLocaleString()}</span>
                    </div>
                    <div class="text-xs text-brand-500 font-bold uppercase tracking-wider mb-1">${escapeHTML(r.subject)}</div>
                    <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-2">${escapeHTML(r.errorType)}</h4>
                    
                    <!-- UPDATED: Question Context with Choices and Answer -->
                    <div class="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-sm text-gray-700 dark:text-gray-300 mb-3 border border-gray-200 dark:border-gray-700">
                        <div class="mb-3">
                            <strong class="text-gray-900 dark:text-white">Q:</strong> ${escapeHTML(r.questionText || 'N/A')}
                        </div>
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 py-3 border-t border-gray-200 dark:border-gray-700 text-xs">
                            <div class="truncate" title="${escapeHTML(r.optionA || '')}"><strong class="text-gray-500 mr-1">A:</strong> ${escapeHTML(r.optionA || 'N/A')}</div>
                            <div class="truncate" title="${escapeHTML(r.optionB || '')}"><strong class="text-gray-500 mr-1">B:</strong> ${escapeHTML(r.optionB || 'N/A')}</div>
                            <div class="truncate" title="${escapeHTML(r.optionC || '')}"><strong class="text-gray-500 mr-1">C:</strong> ${escapeHTML(r.optionC || 'N/A')}</div>
                            <div class="truncate" title="${escapeHTML(r.optionD || '')}"><strong class="text-gray-500 mr-1">D:</strong> ${escapeHTML(r.optionD || 'N/A')}</div>
                        </div>

                        <div class="pt-3 border-t border-gray-200 dark:border-gray-700">
                            <strong class="text-green-600 dark:text-green-400 mr-1">Answer:</strong> ${escapeHTML(r.correctAnswer || 'N/A')}
                        </div>
                    </div>

                    ${r.comments ? `<p class="text-sm text-gray-600 dark:text-gray-400 mb-4 bg-yellow-50 dark:bg-yellow-900/10 p-2 rounded border border-yellow-100 dark:border-yellow-900/30"><i class="fa-solid fa-comment text-yellow-600 mr-2"></i>${escapeHTML(r.comments)}</p>` : ''}
                    
                    <div class="flex gap-2 flex-wrap">
                        <button onclick="openEditModal('${r.id}')" class="flex-1 bg-blue-500 text-white px-4 py-2 rounded font-bold hover:bg-blue-600 shadow-sm active:scale-95 transition-all"><i class="fa-solid fa-pen mr-2"></i> Edit Data</button>
                        <button onclick="adminActionReport('${r.id}', 'resolve')" class="flex-1 bg-green-500 text-white px-4 py-2 rounded font-bold hover:bg-green-600 shadow-sm active:scale-95 transition-all"><i class="fa-solid fa-check mr-2"></i> Mark Resolved</button>
                        <button onclick="adminActionReport('${r.id}', 'delete')" class="bg-red-100 text-red-600 px-4 py-2 rounded font-bold hover:bg-red-200 shadow-sm active:scale-95 transition-all" title="Hard Delete from Sheet"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html || `<div class="text-center text-green-500 py-4 font-bold"><i class="fa-solid fa-check-circle mr-2"></i>All caught up! No pending reports.</div>`;
    } catch (e) {
        container.innerHTML = `<div class="text-red-500 text-center">Failed to fetch admin reports.</div>`;
    }
}

async function adminActionReport(reportId, action) {
    if (action === 'delete' && !confirm("Are you sure you want to permanently delete this report from Google Sheets? (Users will not see it as 'Resolved')")) return;
    
    try {
        const response = await fetch(DB_URL, {
            method: 'POST',
            headers: { "Content-Type": "text/plain;charset=utf-8" }, // ADD THIS LINE
            body: JSON.stringify({
                type: "admin_resolve_report",
                token: adminState.token,
                reportId: reportId,
                action: action
            })
        });
        
        const result = await response.json();
        if (result.status === "success") {
            alert(action === 'resolve' ? "Report marked as resolved! Users will see this status for 24 hours." : "Report permanently deleted.");
            adminLoadReports(); // Refresh the list
        } else {
            alert("Failed: " + result.message);
        }
    } catch (e) {
        alert("Network error.");
    }
}

window.cascadePassword = function(btn) {
    // Find the input box right next to the button
    const input = btn.previousElementSibling;
    const folderPath = input.getAttribute('data-path');
    const pass = input.value;

    let count = 0;
    
    // Find all decks that belong to this folder and update their textboxes visually
    adminState.subjects.forEach((subj, index) => {
        if (subj.Subject.startsWith(folderPath + '::') || subj.Subject === folderPath) {
            const deckInput = document.getElementById(`deck-pass-${index}`);
            if (deckInput) {
                deckInput.value = pass;
                // Highlight the box briefly so the admin sees it changed
                deckInput.classList.add('bg-red-100', 'dark:bg-red-900/30');
                setTimeout(() => deckInput.classList.remove('bg-red-100', 'dark:bg-red-900/30'), 1000);
                count++;
            }
        }
    });
    
    alert(`Applied to ${count} deck(s)! You can now customize individual decks below if needed before clicking Save.`);
};

function openEditModal(reportId) {
    const report = adminState.reports.find(r => r.id === reportId);
    if (!report) return;

    document.getElementById('edit-report-id').value = report.id;
    document.getElementById('edit-question-id').value = report.questionId;
    
    document.getElementById('edit-q-text').value = report.questionText || "";
    document.getElementById('edit-q-optA').value = report.optionA || "";
    document.getElementById('edit-q-optB').value = report.optionB || "";
    document.getElementById('edit-q-optC').value = report.optionC || "";
    document.getElementById('edit-q-optD').value = report.optionD || "";
    document.getElementById('edit-q-answer').value = report.correctAnswer || "";

    // Handle your custom Tailwind animations
    const modal = document.getElementById('admin-edit-modal');
    const inner = modal.querySelector('div');
    
    modal.classList.remove('hidden');
    // small delay allows the display:block to register before applying opacity
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        inner.classList.remove('scale-95');
    }, 10);
}

function closeEditModal() {
    const modal = document.getElementById('admin-edit-modal');
    const inner = modal.querySelector('div');
    
    modal.classList.add('opacity-0');
    inner.classList.add('scale-95');
    
    // Wait for the 300ms transition duration to finish before hiding it from the DOM
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

async function saveEditedQuestion() {
    const reportId = document.getElementById('edit-report-id').value;
    const questionId = document.getElementById('edit-question-id').value;
    
    const report = adminState.reports.find(r => r.id === reportId);
    if (!report) {
        alert("Report reference not found.");
        return;
    }

    const saveBtn = document.getElementById('btn-save-edit');
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...`;
    saveBtn.disabled = true;

    const payload = {
        type: "admin_edit_question",
        token: adminState.token,
        subject: report.subject,
        questionId: questionId,
        questionText: document.getElementById('edit-q-text').value,
        optionA: document.getElementById('edit-q-optA').value,
        optionB: document.getElementById('edit-q-optB').value,
        optionC: document.getElementById('edit-q-optC').value,
        optionD: document.getElementById('edit-q-optD').value,
        correctAnswer: document.getElementById('edit-q-answer').value
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (result.status === "success") {
            alert("Question updated and cache rebuilt successfully!");
            closeEditModal();
            
            // Optionally auto-resolve the report after updating
            if (typeof resolveReport === "function") {
                resolveReport(reportId, 'resolve');
            }
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