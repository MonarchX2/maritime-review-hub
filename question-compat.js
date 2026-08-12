(function (globalScope) {
  function normalizeQuestionRecord(question, subjectOverride = null) {
    if (!question || typeof question !== "object") return {};

    const source = { ...question };
    const resolvedSubject = subjectOverride ?? source.Subject ?? source.s ?? "";

    const next = {
      Subject: resolvedSubject,
      ID: source.ID ?? source.i ?? "",
      Question: source.Question ?? source.q ?? "",
      ChoiceA: source.ChoiceA ?? source.c?.[0] ?? "",
      ChoiceB: source.ChoiceB ?? source.c?.[1] ?? "",
      ChoiceC: source.ChoiceC ?? source.c?.[2] ?? "",
      ChoiceD: source.ChoiceD ?? source.c?.[3] ?? "",
      Answer: source.Answer ?? source.a ?? "",
      Explanation: source.Explanation ?? source.e ?? "",
      ImageURL: source.ImageURL ?? source.u ?? "",
      Tags: source.Tags ?? source.t ?? "",
    };

    if (typeof next.Answer === "number") {
      next.Answer = ["A", "B", "C", "D"][next.Answer] || "";
    }

    if (next.Answer && /^[ABCDabcd]$/.test(String(next.Answer).trim())) {
      next.Answer = String(next.Answer).trim().toUpperCase();
    }

    return next;
  }

  function compactQuestionRecord(question, subjectOverride = null) {
    const normalized = normalizeQuestionRecord(question, subjectOverride);
    const choices = [
      normalized.ChoiceA || "",
      normalized.ChoiceB || "",
      normalized.ChoiceC || "",
      normalized.ChoiceD || "",
    ].filter((choice) => String(choice).trim() !== "");

    const compact = {
      s: normalized.Subject || "",
      i: normalized.ID || "",
      q: normalized.Question || "",
      c: choices,
      a: (() => {
        const answer = String(normalized.Answer || "")
          .trim()
          .toUpperCase();
        if (answer === "A") return 0;
        if (answer === "B") return 1;
        if (answer === "C") return 2;
        if (answer === "D") return 3;
        return 0;
      })(),
    };

    if (normalized.Explanation && String(normalized.Explanation).trim()) {
      compact.e = normalized.Explanation.trim();
    }
    if (normalized.ImageURL && String(normalized.ImageURL).trim()) {
      compact.u = normalized.ImageURL.trim();
    }
    if (normalized.Tags && String(normalized.Tags).trim()) {
      compact.t = normalized.Tags.trim();
    }

    Object.keys(compact).forEach((key) => {
      if (
        compact[key] === "" ||
        compact[key] === null ||
        compact[key] === undefined
      ) {
        delete compact[key];
      }
    });

    return compact;
  }

  const QuestionCompat = {
    normalizeQuestionRecord,
    compactQuestionRecord,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = QuestionCompat;
  }

  globalScope.QuestionCompat = QuestionCompat;
})(typeof window !== "undefined" ? window : globalThis);
