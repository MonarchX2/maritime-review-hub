function normalizeDiscoverySearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesFavoriteEntry(subject, folderLabel, favoriteDecks = []) {
  const normalizedSubject = String(subject || "").trim();
  const normalizedFolder = String(folderLabel || "").trim();
  const values = Array.isArray(favoriteDecks) ? favoriteDecks : [];

  return values.some((entry) => {
    const favorite = String(entry || "").trim();
    if (!favorite) return false;
    if (favorite === normalizedSubject) return true;
    if (normalizedFolder && favorite === normalizedFolder) return true;
    return (
      normalizedSubject.startsWith(`${favorite}::`) ||
      normalizedSubject.startsWith(`${favorite}/`)
    );
  });
}

function buildDiscoveryViewModel(state = {}, categorySummary = []) {
  const prefs = state && state.prefs ? state.prefs : {};
  const deleted = new Set(
    (Array.isArray(prefs.deletedDecks) ? prefs.deletedDecks : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  );

  const favoriteDecks = (
    Array.isArray(prefs.favoriteDecks) ? prefs.favoriteDecks : []
  )
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry && !deleted.has(entry));

  const recentDecks = (
    Array.isArray(prefs.recentDecks) ? prefs.recentDecks : []
  )
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry && !deleted.has(entry));

  const searchValue = normalizeDiscoverySearch(prefs.discoverySearch);
  const visibleDecks = (Array.isArray(categorySummary) ? categorySummary : [])
    .filter((deck) => {
      const subject = String(deck && deck.Subject ? deck.Subject : "").trim();
      if (!subject || deleted.has(subject)) return false;
      if (!searchValue) return true;
      return normalizeDiscoverySearch(subject).includes(searchValue);
    })
    .map((deck) => ({ ...deck }));

  return {
    favoriteDecks: [...new Set(favoriteDecks)],
    recentDecks: [...new Set(recentDecks)],
    visibleDecks,
    hasQuickAccess: favoriteDecks.length > 0 || recentDecks.length > 0,
  };
}

function filterQuestionsByStudyPreference(
  questions = [],
  selectedSet = new Set(),
  mode = "all",
) {
  const list = Array.isArray(questions) ? questions : [];
  const selected = selectedSet instanceof Set ? selectedSet : new Set();

  if (mode === "favorites") {
    return list.filter((question) => selected.has(question && question.ID));
  }

  return list;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeDiscoverySearch,
    matchesFavoriteEntry,
    buildDiscoveryViewModel,
    filterQuestionsByStudyPreference,
  };
}
