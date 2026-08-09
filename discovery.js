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

  function isDeckMatch(subject, query) {
    const normalizedQuery = normalizeQueryText(query);
    if (!normalizedQuery) return true;

    const normalizedSubject = normalizeQueryText(subject);
    return normalizedSubject.includes(normalizedQuery);
  }

  function buildDiscoveryViewModel(state, categorySummary) {
    const favoriteDecks = normalizeDiscoveryEntries(
      state?.prefs?.favoriteDecks,
      8,
    );
    const recentDecks = normalizeDiscoveryEntries(state?.prefs?.recentDecks, 8);
    const searchQuery = String(state?.prefs?.discoverySearch || "").trim();
    const visibleDecks = (
      Array.isArray(categorySummary) ? categorySummary : []
    ).filter((cat) => {
      const subject = String(cat?.Subject || "").trim();
      return subject && isDeckMatch(subject, searchQuery);
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
    buildDiscoveryViewModel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DiscoveryUtils;
  }

  globalScope.DiscoveryUtils = DiscoveryUtils;
})(typeof window !== "undefined" ? window : globalThis);
