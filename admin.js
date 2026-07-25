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
    
    // 1. Group subjects by their folder path
    const groupedSubjects = {};
    
    adminState.subjects.forEach((subj, index) => {
        const parts = subj.split('::');
        const deckName = parts.pop(); // The actual subject/deck name
        const folderPath = parts.length > 0 ? parts.join('::') : 'Root Level';
        
        if (!groupedSubjects[folderPath]) {
            groupedSubjects[folderPath] = [];
        }
        // Save the original index so saving still works perfectly
        groupedSubjects[folderPath].push({ originalFull: subj, deckName: deckName, index: index });
    });

    let html = '';
    let globalIndex = 0;

    // 2. Render grouped containers
    for (const [folder, subjects] of Object.entries(groupedSubjects)) {
        html += `
            <div class="mb-6 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                <h4 class="font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                    <i class="fa-solid fa-folder-open text-brand-500"></i> ${escapeHTML(folder)}
                </h4>
                <div class="space-y-3">
        `;
        
        subjects.forEach(subj => {
            html += `
                <div class="animate-card-in bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row items-center gap-4" style="animation-delay: ${globalIndex * 0.05}s">
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
            globalIndex++;
        });

        html += `</div></div>`;
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