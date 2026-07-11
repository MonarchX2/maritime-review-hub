// --- GLOBAL SEARCH FEATURE ---
function openSearch() {
    navigate('search');
}

function executeSearch() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();
    const resultsContainer = document.getElementById('search-results');
    
    if (query.length < 2) {
        resultsContainer.innerHTML = '<p class="text-gray-500">Type at least 2 characters to search...</p>';
        return;
    }

    // Search through ID, Subject, Tags, and the Question text itself
    const results = state.db.filter(q => 
        (q.ID && q.ID.toLowerCase().includes(query)) ||
        (q.Subject && q.Subject.toLowerCase().includes(query)) ||
        (q.Question && q.Question.toLowerCase().includes(query)) ||
        (q.Tags && q.Tags.toLowerCase().includes(query))
    );

    if (results.length === 0) {
        resultsContainer.innerHTML = '<p class="text-red-500 font-medium">No questions found.</p>';
        return;
    }

    // Render results
    resultsContainer.innerHTML = results.map(q => `
        <div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg border border-gray-200 dark:border-gray-600 mb-3">
            <div class="flex gap-2 mb-2">
                <span class="text-xs bg-brand-100 text-brand-800 px-2 py-1 rounded font-bold">${q.ID || 'N/A'}</span>
                <span class="text-xs bg-gray-200 text-gray-800 px-2 py-1 rounded font-bold">${q.Subject || 'General'}</span>
                <span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-bold">Ans: ${q.Answer}</span>
            </div>
            <p class="font-medium text-sm mb-2">${q.Question}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400"><b>Explanation:</b> ${q.Explanation || 'None'}</p>
        </div>
    `).join('');
}


// --- ACHIEVEMENT SYSTEM ---
const ACHIEVEMENTS = [
    { id: 'first_blood', icon: 'fa-droplet', color: 'text-red-500', name: 'First Blood', desc: 'Answer your first question.', condition: () => state.stats.totalAnswered >= 1 },
    { id: 'getting_started', icon: 'fa-thumbs-up', color: 'text-blue-500', name: 'Warming Up', desc: 'Answer 50 questions.', condition: () => state.stats.totalAnswered >= 50 },
    { id: 'century', icon: 'fa-crown', color: 'text-yellow-500', name: 'Century Mark', desc: 'Get 100 questions correct.', condition: () => state.stats.correct >= 100 },
    { id: 'streak_3', icon: 'fa-fire', color: 'text-orange-500', name: 'Consistent Cadet', desc: 'Reach a 3-day streak.', condition: () => state.stats.streak >= 3 }
];

// We hook into the existing trackStats function without rewriting index.html
const originalTrackStats = trackStats;
trackStats = function(q, isCorrect) {
    originalTrackStats(q, isCorrect); // Run original logic first
    checkAchievements(); // Then run our new logic
}

function checkAchievements() {
    if (!state.stats.achievements) state.stats.achievements = []; // Initialize if missing
    
    ACHIEVEMENTS.forEach(ach => {
        if (!state.stats.achievements.includes(ach.id) && ach.condition()) {
            state.stats.achievements.push(ach.id);
            saveState();
            alert(`🏆 ACHIEVEMENT UNLOCKED: ${ach.name}!\n${ach.desc}`);
        }
    });
}

function renderAchievements() {
    navigate('achievements');
    if (!state.stats.achievements) state.stats.achievements = [];
    
    const container = document.getElementById('achievement-grid');
    container.innerHTML = ACHIEVEMENTS.map(ach => {
        const unlocked = state.stats.achievements.includes(ach.id);
        const bgClass = unlocked ? 'bg-white dark:bg-gray-800 border-green-500' : 'bg-gray-100 dark:bg-gray-800 opacity-50 grayscale border-gray-200';
        const iconColor = unlocked ? ach.color : 'text-gray-400';
        
        return `
            <div class="${bgClass} p-4 rounded-xl shadow-sm border-2 text-center transition-all">
                <i class="fa-solid ${ach.icon} text-4xl ${iconColor} mb-3"></i>
                <h4 class="font-bold text-sm mb-1">${ach.name}</h4>
                <p class="text-xs text-gray-500">${ach.desc}</p>
                ${unlocked ? '<span class="text-[10px] uppercase font-black text-green-500 tracking-widest mt-2 block">Unlocked</span>' : '<span class="text-[10px] uppercase font-black text-gray-400 tracking-widest mt-2 block">Locked</span>'}
            </div>
        `;
    }).join('');
}