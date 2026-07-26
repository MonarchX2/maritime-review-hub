let adminState = {
    token: "",
    subjects: []
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

function loadAdminSubjects() {
    if (!state.categorySummary || state.categorySummary.length === 0) {
        document.getElementById('admin-subject-list').innerHTML = `
            <p class="text-center text-gray-500 dark:text-gray-400 py-6 animate-pulse">
                No subjects found. Please go to Settings and Sync your Database first.
            </p>`;
        return;
    }

    adminState.subjects = state.categorySummary.map(cat => cat.Subject);
    renderAdminSubjectList();
}

function renderAdminSubjectList() {
    const container = document.getElementById('admin-subject-list');
    
    // 1. Group subjects by their FULL folder path
    const groupedSubjects = {};
    
    adminState.subjects.forEach((subj, index) => {
        const parts = subj.split('::');
        const deckName = parts.pop(); // The actual subject/deck name
        
        // Grab all remaining parts to form the complete subfolder path
        const folderPath = parts.length > 0 ? parts.join(' :: ') : 'Root Level';
        
        if (!groupedSubjects[folderPath]) {
            groupedSubjects[folderPath] = [];
        }
        groupedSubjects[folderPath].push({ 
            originalFull: subj, 
            deckName: deckName, 
            index: index 
        });
    });

    let html = '';

    // 2. Render groups as collapsible <details> accordions
    for (const [folder, subjects] of Object.entries(groupedSubjects)) {
        html += `
            <details class="mb-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 group shadow-sm">
                <summary class="font-bold text-gray-700 dark:text-gray-300 p-4 cursor-pointer flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors rounded-xl outline-none list-none">
                    <span class="flex items-center gap-2">
                        <i class="fa-solid fa-folder text-brand-500"></i> ${escapeHTML(folder)}
                        <span class="bg-gray-200 dark:bg-gray-700 text-xs px-2 py-1 rounded-full text-gray-600 dark:text-gray-400 font-semibold ml-2">${subjects.length} decks</span>
                    </span>
                    <i class="fa-solid fa-chevron-down text-gray-400 transition-transform duration-300 group-open:rotate-180"></i>
                </summary>
                
                <div class="p-4 pt-0 mt-2 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-3">
        `;
        
        subjects.forEach(subj => {
            html += `
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
                                oninput="document.getElementById('char-count-${subj.index}').innerText = this.value.length + '/100'; 
                                        this.value.length >= 90 ? this.previousElementSibling.classList.add('text-red-500') : this.previousElementSibling.classList.remove('text-red-500');"
                                class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded focus:border-brand-500 focus:ring-2 outline-none transition-all">
                    </div>
                </div>
            `;
        });

        html += `</div></details>`;
    }
    
    container.innerHTML = html;
}

async function saveAdminChanges() {
    const btn = document.getElementById('btn-admin-save');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
    btn.disabled = true;

    const updates = [];
    adminState.subjects.forEach((subj, index) => {
        const newName = document.getElementById(`new-subj-${index}`).value.trim();
        if (newName !== subj && newName !== "") {
            updates.push({ oldName: subj, newName: newName });
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
            headers: { "Content-Type": "text/plain;charset=utf-8" }, // ADD THIS LINE
            body: JSON.stringify({
                type: "admin_update",
                token: adminState.token,
                updates: updates
            })
        });

        const result = await response.json();
        
        if (result.status === "success") {
            alert("Hierarchy Updated! Fetching the latest layout...");
            await syncDatabase(); 
            loadAdminSubjects();  
        } else {
            alert("Failed: " + result.message);
            if(result.message.includes("Unauthorized")) {
                document.getElementById('admin-dashboard-section').classList.add('hidden');
                document.getElementById('admin-login-section').classList.remove('hidden');
                document.getElementById('admin-login-error').classList.remove('hidden');
                adminState.token = ""; 
            }
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
                headers: { "Content-Type": "text/plain;charset=utf-8" }, // ADD THIS LINE
                body: JSON.stringify({ type: "get_reports", role: "admin", token: adminState.token })
            });
            const reports = await response.json();

            if (reports.length === 0) {
                container.innerHTML = `<div class="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl text-center text-gray-500">No reports found in the database.</div>`;
                return;
            }

            let html = '';
            reports.forEach(r => {
                if(r.status === 'Resolved') return; // Only show pending in admin dashboard to keep it clean

                html += `
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border-l-4 border-yellow-500 shadow-sm relative group">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-xs font-mono text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">ID: ${escapeHTML(r.questionId)}</span>
                            <span class="text-xs text-gray-400">${new Date(r.timestamp).toLocaleString()}</span>
                        </div>
                        <div class="text-xs text-brand-500 font-bold uppercase tracking-wider mb-1">${escapeHTML(r.subject)}</div>
                        <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-2">${escapeHTML(r.errorType)}</h4>
                        <div class="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg text-sm text-gray-700 dark:text-gray-300 mb-3 border border-gray-200 dark:border-gray-700">
                            <strong>Q:</strong> ${escapeHTML(r.questionText)}
                        </div>
                        ${r.comments ? `<p class="text-sm text-gray-600 dark:text-gray-400 mb-4 bg-yellow-50 dark:bg-yellow-900/10 p-2 rounded border border-yellow-100 dark:border-yellow-900/30"><i class="fa-solid fa-comment text-yellow-600 mr-2"></i>${escapeHTML(r.comments)}</p>` : ''}
                        
                        <div class="flex gap-2">
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