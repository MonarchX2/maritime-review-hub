(function (globalScope) {
  function normalizeDiscoveryEntries(value, maxItems = 8) {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set();
    const normalized = [];

    source.forEach((entry) => {
      const text = String(entry || "").trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      normalized.push(text);
      if (normalized.length >= maxItems) return;
    });

    return normalized;
  }

  function addDiscoveryEntry(entries, value, maxItems = 8) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) return normalizeDiscoveryEntries(entries, maxItems);

    const nextEntries = [
      normalizedValue,
      ...normalizeDiscoveryEntries(entries, maxItems + 1),
    ];
    return nextEntries
      .filter((entry, index, allEntries) => allEntries.indexOf(entry) === index)
      .slice(0, maxItems);
  }

  function removeDiscoveryEntry(entries, value) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) return normalizeDiscoveryEntries(entries, 8);

    return normalizeDiscoveryEntries(
      (entries || []).filter(
        (entry) => String(entry || "").trim() !== normalizedValue,
      ),
      8,
    );
  }

  function toggleDiscoveryEntry(entries, value, maxItems = 8) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) return normalizeDiscoveryEntries(entries, maxItems);

    const currentEntries = normalizeDiscoveryEntries(entries, maxItems + 1);
    if (currentEntries.includes(normalizedValue)) {
      return removeDiscoveryEntry(currentEntries, normalizedValue);
    }

    return addDiscoveryEntry(currentEntries, normalizedValue, maxItems);
  }

  function normalizeQueryText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getQueryTokens(value) {
    const normalizedValue = normalizeQueryText(value);
    if (!normalizedValue) return [];

    return normalizedValue.split(" ").filter((token) => token.length >= 1);
  }

  function isDeckMatch(subject, query) {
    const normalizedQuery = normalizeQueryText(query);
    if (!normalizedQuery) return true;

    const normalizedSubject = normalizeQueryText(subject);
    const queryTokens = getQueryTokens(normalizedQuery);
    if (queryTokens.length === 0) return true;

    const subjectTokens = getQueryTokens(normalizedSubject);
    const normalizedSubjectText = subjectTokens.join(" ");

    if (normalizedSubjectText.includes(normalizedQuery)) return true;

    return queryTokens.every((token) => {
      return subjectTokens.some((subjectToken) => {
        return subjectToken.includes(token) || token.includes(subjectToken);
      });
    });
  }

  function matchesFavoriteEntry(subject, folderKey, favoriteEntries) {
    const targetSubject = String(subject || "").trim();
    const normalizedFavorites = normalizeDiscoveryEntries(favoriteEntries, 32);
    if (!targetSubject || normalizedFavorites.length === 0) return false;

    const keyText = String(folderKey || "").trim();
    const normalizedSubject = targetSubject.toLowerCase();

    return normalizedFavorites.some((entry) => {
      const favoriteText = String(entry || "").trim();
      if (!favoriteText) return false;

      const favoriteLower = favoriteText.toLowerCase();
      if (favoriteLower === normalizedSubject) return true;
      if (keyText && keyText.toLowerCase() === favoriteLower) return true;
      return (
        normalizedSubject.startsWith(favoriteLower + "::") ||
        normalizedSubject.startsWith(favoriteLower + "/")
      );
    });
  }

  function filterQuestionsByStudyPreference(questions, favoriteQuestionSet, mode = "all") {
    const sourceQuestions = Array.isArray(questions) ? questions : [];
    if (mode !== "favorites") return sourceQuestions;
    if (!favoriteQuestionSet || favoriteQuestionSet.size === 0) return [];

    return sourceQuestions.filter((question) => {
      const questionId = String(question?.ID || "").trim();
      return Boolean(questionId) && favoriteQuestionSet.has(questionId);
    });
  }

  function buildDiscoveryViewModel(state, categorySummary) {
    const deletedDecks = new Set(
      (Array.isArray(state?.prefs?.deletedDecks)
        ? state.prefs.deletedDecks
        : []
      )
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    );

    const favoriteDecks = normalizeDiscoveryEntries(
      (state?.prefs?.favoriteDecks || []).filter(
        (entry) => !deletedDecks.has(String(entry || "").trim()),
      ),
      8,
    );
    const recentDecks = normalizeDiscoveryEntries(
      (state?.prefs?.recentDecks || []).filter(
        (entry) => !deletedDecks.has(String(entry || "").trim()),
      ),
      8,
    );
    const searchQuery = String(state?.prefs?.discoverySearch || "").trim();
    const visibleDecks = (
      Array.isArray(categorySummary) ? categorySummary : []
    ).filter((cat) => {
      const subject = String(cat?.Subject || "").trim();
      if (!subject || deletedDecks.has(subject)) return false;
      return isDeckMatch(subject, searchQuery);
    });

    return {
      favoriteDecks,
      recentDecks,
      searchQuery,
      visibleDecks,
      hasQuickAccess:
        favoriteDecks.length > 0 ||
        recentDecks.length > 0 ||
        Boolean(searchQuery),
    };
  }

  const DiscoveryUtils = {
    normalizeDiscoveryEntries,
    addDiscoveryEntry,
    removeDiscoveryEntry,
    toggleDiscoveryEntry,
    normalizeQueryText,
    isDeckMatch,
    matchesFavoriteEntry,
    filterQuestionsByStudyPreference,
    buildDiscoveryViewModel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DiscoveryUtils;
  }

  globalScope.DiscoveryUtils = DiscoveryUtils;
})(typeof window !== "undefined" ? window : globalThis);
