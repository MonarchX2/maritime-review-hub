function normalizeDiscoveryText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function matchesFavoriteEntry(subject, search, favoriteDecks) {
  const normalizedSubject = String(subject ?? "").trim();
  const normalizedSearch = normalizeDiscoveryText(search);
  const subjectKey = normalizedSubject.toLocaleLowerCase();
  const favorites = Array.isArray(favoriteDecks) ? favoriteDecks : [];

  if (
    normalizedSearch &&
    !normalizeDiscoveryText(normalizedSubject).includes(normalizedSearch)
  ) {
    return false;
  }

  return favorites.some((favorite) => {
    const normalizedFavorite = String(favorite ?? "").trim();
    const favoriteKey = normalizedFavorite.toLocaleLowerCase();
    return (
      favoriteKey === subjectKey ||
      subjectKey.startsWith(`${favoriteKey}::`) ||
      favoriteKey.startsWith(`${subjectKey}::`)
    );
  });
}

function filterQuestionsByStudyPreference(questions, favoriteIds, mode) {
  const items = Array.isArray(questions) ? questions : [];
  if (mode !== "favorites") return items;
  const favorites =
    favoriteIds instanceof Set ? favoriteIds : new Set(favoriteIds || []);
  return items.filter((question) => favorites.has(question?.ID));
}

function buildDiscoveryViewModel(state, categorySummary) {
  const prefs = state?.prefs || {};
  const deleted = new Set(
    (Array.isArray(prefs.deletedDecks) ? prefs.deletedDecks : []).map((value) =>
      String(value ?? "").trim(),
    ),
  );
  const summaries = Array.isArray(categorySummary) ? categorySummary : [];
  const isDeleted = (subject) => {
    const key = String(subject ?? "").trim().toLocaleLowerCase();
    if (!key) return true;
    for (const deletedSubject of deleted) {
      const deletedKey = String(deletedSubject).toLocaleLowerCase();
      if (
        key === deletedKey ||
        key.startsWith(`${deletedKey}::`) ||
        deletedKey.startsWith(`${key}::`)
      ) {
        return true;
      }
    }
    return false;
  };

  const normalizedSearch = normalizeDiscoveryText(prefs.discoverySearch);
  const visibleDecks = summaries.filter((deck) => {
    const subject = String(deck?.Subject ?? "").trim();
    return (
      subject &&
      !isDeleted(subject) &&
      normalizeDiscoveryText(subject).includes(normalizedSearch)
    );
  });
  const favoriteDecks = (
    Array.isArray(prefs.favoriteDecks) ? prefs.favoriteDecks : []
  ).filter((subject) => !isDeleted(subject));
  const recentDecks = (
    Array.isArray(prefs.recentDecks) ? prefs.recentDecks : []
  ).filter((subject) => !isDeleted(subject));

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
