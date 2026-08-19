function normalizeDiscoveryText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesFavoriteEntry(subject, search, favoriteDecks) {
  const normalizedSubject = String(subject ?? "").trim();
  const normalizedSearch = normalizeDiscoveryText(search);
  const favorites = Array.isArray(favoriteDecks) ? favoriteDecks : [];

  if (normalizedSearch && !normalizeDiscoveryText(normalizedSubject).includes(normalizedSearch)) {
    return false;
  }

  return favorites.some((favorite) => {
    const normalizedFavorite = String(favorite ?? "").trim();
    return (
      normalizedFavorite === normalizedSubject ||
      normalizedSubject.startsWith(`${normalizedFavorite}::`) ||
      normalizedFavorite.startsWith(`${normalizedSubject}::`)
    );
  });
}

function filterQuestionsByStudyPreference(questions, favoriteIds, mode) {
  const items = Array.isArray(questions) ? questions : [];
  if (mode !== "favorites") return items;
  const favorites = favoriteIds instanceof Set ? favoriteIds : new Set(favoriteIds || []);
  return items.filter((question) => favorites.has(question?.ID));
}

function buildDiscoveryViewModel(state, categorySummary) {
  const prefs = state?.prefs || {};
  const deleted = new Set(
    (Array.isArray(prefs.deletedDecks) ? prefs.deletedDecks : []).map((value) => String(value ?? "").trim()),
  );
  const summaries = Array.isArray(categorySummary) ? categorySummary : [];
  const visibleDecks = summaries.filter((deck) => {
    const subject = String(deck?.Subject ?? "").trim();
    return subject && !deleted.has(subject) && normalizeDiscoveryText(subject).includes(normalizeDiscoveryText(prefs.discoverySearch));
  });
  const favoriteDecks = (Array.isArray(prefs.favoriteDecks) ? prefs.favoriteDecks : []).filter(
    (subject) => !deleted.has(String(subject ?? "").trim()),
  );
  const recentDecks = (Array.isArray(prefs.recentDecks) ? prefs.recentDecks : []).filter(
    (subject) => !deleted.has(String(subject ?? "").trim()),
  );

  return {
    favoriteDecks,
    recentDecks,
    visibleDecks,
    hasQuickAccess: favoriteDecks.length > 0 || recentDecks.length > 0,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildDiscoveryViewModel,
    matchesFavoriteEntry,
    filterQuestionsByStudyPreference,
  };
}