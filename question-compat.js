(function (globalScope) {
  function firstAvailableValue(...values) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      return value;
    }
    return "";
  }

  function toBoolean(value, fallback = false) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "n", "off", ""].includes(normalized))
        return false;
    }
    return fallback;
  }

  function normalizeSubjectFromPath(parts) {
    return (Array.isArray(parts) ? parts : [])
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join("::");
  }

  function normalizeQuestionRecord(question, subjectOverride = null) {
    if (!question || typeof question !== "object") return {};

    const source = { ...question };

    const next = {
      Subject: firstAvailableValue(
        subjectOverride,
        source.Subject,
        source.subject,
        source.s,
        source.subjectName,
      ),
      ID: firstAvailableValue(source.ID, source.id, source.i),
      Question: firstAvailableValue(source.Question, source.question, source.q),
      ChoiceA: firstAvailableValue(
        source.ChoiceA,
        source.choiceA,
        source.c?.[0],
      ),
      ChoiceB: firstAvailableValue(
        source.ChoiceB,
        source.choiceB,
        source.c?.[1],
      ),
      ChoiceC: firstAvailableValue(
        source.ChoiceC,
        source.choiceC,
        source.c?.[2],
      ),
      ChoiceD: firstAvailableValue(
        source.ChoiceD,
        source.choiceD,
        source.c?.[3],
      ),
      Answer: firstAvailableValue(source.Answer, source.answer, source.a),
      Explanation: firstAvailableValue(
        source.Explanation,
        source.explanation,
        source.e,
      ),
      ImageURL: firstAvailableValue(
        source.ImageURL,
        source.imageURL,
        source.imageUrl,
        source.u,
      ),
      Tags: firstAvailableValue(source.Tags, source.tags, source.t),
    };

    if (typeof next.Answer === "number") {
      next.Answer = ["A", "B", "C", "D"][next.Answer] || "";
    }

    if (next.Answer && /^[ABCDabcd]$/.test(String(next.Answer).trim())) {
      next.Answer = String(next.Answer).trim().toUpperCase();
    }

    return next;
  }

  function normalizeDeckRecord(deck, subjectOverride = null) {
    if (!deck || typeof deck !== "object") return {};

    const source = { ...deck };
    const metadata =
      source.metadata && typeof source.metadata === "object"
        ? source.metadata
        : {};

    const category = firstAvailableValue(
      source.category,
      source.Category,
      source.categoryName,
      metadata.category,
      metadata.Category,
    );
    const subCategory = firstAvailableValue(
      source.subCategory,
      source.subcategory,
      source.SubCategory,
      metadata.subCategory,
      metadata.subcategory,
    );
    const moduleName = firstAvailableValue(
      source.module,
      source.Module,
      source.moduleName,
      source.name,
      source.Name,
      source.title,
      source.Title,
      metadata.module,
      metadata.Module,
    );
    const version = firstAvailableValue(
      source.version,
      source.Version,
      source.courseVersion,
      source.courseVersionName,
      metadata.version,
      metadata.courseVersion,
    );

    let subject = firstAvailableValue(
      subjectOverride,
      source.subject,
      source.Subject,
      source.s,
      source.subjectPath,
      source.path,
      Array.isArray(source.path) ? normalizeSubjectFromPath(source.path) : null,
    );

    const subjectParts = [];
    if (typeof category === "string" && category.trim())
      subjectParts.push(category.trim());
    if (typeof subCategory === "string" && subCategory.trim())
      subjectParts.push(subCategory.trim());
    if (typeof moduleName === "string" && moduleName.trim())
      subjectParts.push(moduleName.trim());
    if (!subject && subjectParts.length > 0) {
      subject = normalizeSubjectFromPath(subjectParts);
    }
    if (typeof subject === "string") {
      subject = subject.trim();
    }

    const questionCountValue = firstAvailableValue(
      source.questionCount,
      source.QuestionCount,
      source.count,
      source.totalQuestions,
      source.totalQuestionsCount,
      source.questionsCount,
      source.questions?.length,
      metadata.questionCount,
      metadata.QuestionCount,
    );
    const normalizedQuestionCount = Number(questionCountValue || 0);

    const password = firstAvailableValue(
      source.password,
      source.Password,
      source.pass,
      metadata.password,
      metadata.Password,
    );
    const hidden = toBoolean(
      firstAvailableValue(
        source.hidden,
        source.Hidden,
        source.isHidden,
        metadata.hidden,
        metadata.Hidden,
      ),
      false,
    );
    const locked = toBoolean(
      firstAvailableValue(
        source.locked,
        source.Locked,
        source.isLocked,
        password && String(password).trim() !== "",
        metadata.locked,
        metadata.Locked,
      ),
      Boolean(password && String(password).trim() !== ""),
    );

    const idValue = firstAvailableValue(
      source.id,
      source.ID,
      source.uuid,
      source.uuidValue,
      source._id,
      source.guid,
      source.identifier,
      metadata.id,
      metadata.ID,
    );

    const record = {
      id: idValue || "",
      ID: idValue || "",
      subject: subject || "",
      Subject: subject || "",
      name: firstAvailableValue(
        source.name,
        source.Name,
        source.title,
        source.Title,
        moduleName,
        subject && String(subject).includes("::")
          ? String(subject).split("::").pop()
          : "",
      ),
      category:
        category ||
        (subject && String(subject).includes("::")
          ? String(subject).split("::")[0]
          : ""),
      subCategory:
        subCategory ||
        (subject && String(subject).split("::").length > 2
          ? String(subject).split("::")[1]
          : ""),
      module:
        moduleName ||
        (subject && String(subject).includes("::")
          ? String(subject).split("::").slice(-1)[0]
          : ""),
      version: version || "",
      courseVersion: version || "",
      questionCount: Number.isFinite(normalizedQuestionCount)
        ? normalizedQuestionCount
        : 0,
      QuestionCount: Number.isFinite(normalizedQuestionCount)
        ? normalizedQuestionCount
        : 0,
      hidden,
      Hidden: hidden,
      password: String(password || "").trim(),
      Password: String(password || "").trim(),
      locked,
      Locked: locked,
      metadata: {
        category: category || "",
        subCategory: subCategory || "",
        module: moduleName || "",
        version: version || "",
        courseVersion: version || "",
      },
    };

    if (!record.id && record.Subject) {
      record.id =
        String(record.Subject)
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .toLowerCase() || "deck";
    }
    if (!record.id && record.name) {
      record.id =
        String(record.name)
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .toLowerCase() || "deck";
    }

    if (!record.Subject && record.name) {
      record.Subject = record.name;
      record.subject = record.name;
    }

    return record;
  }

  function normalizeCategorySummary(summaryValue) {
    const flattened = [];

    function isDeckLikeNode(node) {
      if (!node || typeof node !== "object") return false;
      if (node.deck && typeof node.deck === "object") return true;
      return (
        node.questionCount !== undefined ||
        node.QuestionCount !== undefined ||
        node.totalQuestions !== undefined ||
        node.totalQuestionsCount !== undefined ||
        node.subject !== undefined ||
        node.Subject !== undefined ||
        node.password !== undefined ||
        node.Password !== undefined ||
        node.hidden !== undefined ||
        node.Hidden !== undefined ||
        node.locked !== undefined ||
        node.Locked !== undefined
      );
    }

    function walk(node, inheritedPath = []) {
      if (!node || typeof node !== "object") return;

      const inheritedParts = Array.isArray(inheritedPath)
        ? inheritedPath
        : String(inheritedPath || "")
            .split("::")
            .filter(Boolean);

      const directName = firstAvailableValue(
        node.name,
        node.Name,
        node.title,
        node.Title,
      );

      const nextPath = [...inheritedParts];
      const safeDirectName = directName ? String(directName).trim() : "";
      const shouldSkipRootContainer =
        inheritedParts.length === 0 &&
        (safeDirectName === "" ||
          /^root$/i.test(safeDirectName) ||
          /^home$/i.test(safeDirectName));
      if (safeDirectName && !shouldSkipRootContainer) {
        if (!nextPath.includes(safeDirectName)) {
          nextPath.push(safeDirectName);
        }
      }
      const nextSubject = normalizeSubjectFromPath(nextPath);

      if (node.deck && typeof node.deck === "object") {
        const deck = normalizeDeckRecord(
          node.deck,
          nextSubject || node.Subject || node.subject || "",
        );
        if (deck.Subject || deck.name || deck.id) flattened.push(deck);
      } else if (isDeckLikeNode(node)) {
        const deck = normalizeDeckRecord(
          node,
          nextSubject || node.Subject || node.subject || "",
        );
        if (deck.Subject || deck.name || deck.id) flattened.push(deck);
      }

      const children = [];
      if (Array.isArray(node.children)) children.push(...node.children);
      if (Array.isArray(node.categories)) children.push(...node.categories);
      if (Array.isArray(node.subCategories))
        children.push(...node.subCategories);
      if (Array.isArray(node.items)) children.push(...node.items);
      if (Array.isArray(node.decks)) children.push(...node.decks);
      children.forEach((child) => walk(child, nextPath));
    }

    if (Array.isArray(summaryValue)) {
      summaryValue.forEach((entry) => {
        if (
          entry &&
          typeof entry === "object" &&
          entry.deck &&
          typeof entry.deck === "object"
        ) {
          const normalized = normalizeDeckRecord(
            entry.deck,
            entry.subject || entry.Subject || "",
          );
          if (normalized.Subject || normalized.name || normalized.id)
            flattened.push(normalized);
          return;
        }
        if (isDeckLikeNode(entry)) {
          const normalized = normalizeDeckRecord(
            entry,
            entry.subject || entry.Subject || "",
          );
          if (normalized.Subject || normalized.name || normalized.id)
            flattened.push(normalized);
        }
      });
      return flattened;
    }

    if (summaryValue && typeof summaryValue === "object") {
      walk(summaryValue, []);
      return flattened;
    }

    return [];
  }

  function compactQuestionRecord(question, subjectOverride = null) {
    const normalized = normalizeQuestionRecord(question, subjectOverride);
    const rawChoices = [
      normalized.ChoiceA || "",
      normalized.ChoiceB || "",
      normalized.ChoiceC || "",
      normalized.ChoiceD || "",
    ];

    const answerLetter = String(normalized.Answer || "")
      .trim()
      .toUpperCase();
    const answerOrder = ["A", "B", "C", "D"];
    const choices = [];
    let answerIndex = 0;

    rawChoices.forEach((choice, choiceIndex) => {
      const trimmedChoice = String(choice).trim();
      if (trimmedChoice === "") return;

      const compactIndex = choices.length;
      if (answerOrder[choiceIndex] === answerLetter) {
        answerIndex = compactIndex;
      }

      choices.push(trimmedChoice);
    });

    const compact = {
      s: normalized.Subject || "",
      i: normalized.ID || "",
      q: normalized.Question || "",
      c: choices,
      a: answerIndex,
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
    firstAvailableValue,
    toBoolean,
    normalizeSubjectFromPath,
    normalizeQuestionRecord,
    normalizeDeckRecord,
    normalizeCategorySummary,
    compactQuestionRecord,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = QuestionCompat;
  }

  globalScope.QuestionCompat = QuestionCompat;
})(typeof window !== "undefined" ? window : globalThis);
