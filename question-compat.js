(function (globalScope) {
  "use strict";

  const ANSWER_LETTERS = ["A", "B", "C", "D"];

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

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
    if (typeof value === "number")
      return Number.isFinite(value) ? value !== 0 : fallback;

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "n", "off", ""].includes(normalized))
        return false;
    }

    return fallback;
  }

  function toTrimmedString(value, fallback = "") {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
  }

  function normalizeSubjectFromPath(parts) {
    let source = parts;

    if (typeof source === "string") {
      source = source.split("::");
    }

    if (!Array.isArray(source)) return "";

    const result = [];
    const seen = new Set();

    for (const part of source) {
      const text = toTrimmedString(part);
      if (!text) continue;

      const key = text.toLocaleLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      result.push(text);
    }

    return result.join("::");
  }

  function normalizeAnswerValue(value) {
    if (value === null || value === undefined || value === "") return "";

    if (typeof value === "number") {
      return Number.isInteger(value) &&
        value >= 0 &&
        value < ANSWER_LETTERS.length
        ? ANSWER_LETTERS[value]
        : "";
    }

    const normalized = String(value).trim().toUpperCase();

    if (/^[ABCD]$/.test(normalized)) return normalized;
    if (/^[0-3]$/.test(normalized)) return ANSWER_LETTERS[Number(normalized)];

    return "";
  }

  function normalizeQuestionRecord(question, subjectOverride = null) {
    if (
      globalScope.AppState &&
      typeof globalScope.AppState.normalizeQuestionRecord === "function"
    ) {
      return globalScope.AppState.normalizeQuestionRecord(
        question,
        subjectOverride,
      );
    }

    if (!isObject(question) || Array.isArray(question)) return {};

    const source = question;
    const choices = Array.isArray(source.c) ? source.c : [];

    const subjectOverrideValue = Array.isArray(subjectOverride)
      ? normalizeSubjectFromPath(subjectOverride)
      : toTrimmedString(subjectOverride);

    return {
      Subject: firstAvailableValue(
        subjectOverrideValue,
        source.Subject,
        source.subject,
        source.s,
        source.subjectName,
      ),
      ID: firstAvailableValue(source.ID, source.id, source.i),
      Question: firstAvailableValue(source.Question, source.question, source.q),
      ChoiceA: firstAvailableValue(source.ChoiceA, source.choiceA, choices[0]),
      ChoiceB: firstAvailableValue(source.ChoiceB, source.choiceB, choices[1]),
      ChoiceC: firstAvailableValue(source.ChoiceC, source.choiceC, choices[2]),
      ChoiceD: firstAvailableValue(source.ChoiceD, source.choiceD, choices[3]),
      Answer: normalizeAnswerValue(
        firstAvailableValue(source.Answer, source.answer, source.a),
      ),
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
  }

  function normalizeQuestionCount(value) {
    if (value === null || value === undefined || value === "") return 0;

    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function slugify(value, fallback = "deck") {
    const slug = toTrimmedString(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();

    return slug || fallback;
  }

  function getPathParts(subject) {
    if (Array.isArray(subject)) {
      return normalizeSubjectFromPath(subject).split("::").filter(Boolean);
    }

    const text = toTrimmedString(subject);
    return text
      ? text
          .split("::")
          .map((part) => part.trim())
          .filter(Boolean)
      : [];
  }

  function normalizeDeckRecord(deck, subjectOverride = null) {
    if (!isObject(deck) || Array.isArray(deck)) return {};

    const source = deck;
    const metadata =
      isObject(source.metadata) && !Array.isArray(source.metadata)
        ? source.metadata
        : {};

    const category = toTrimmedString(
      firstAvailableValue(
        source.category,
        source.Category,
        source.categoryName,
        metadata.category,
        metadata.Category,
      ),
    );

    const subCategory = toTrimmedString(
      firstAvailableValue(
        source.subCategory,
        source.subcategory,
        source.SubCategory,
        metadata.subCategory,
        metadata.subcategory,
      ),
    );

    const moduleName = toTrimmedString(
      firstAvailableValue(
        source.module,
        source.Module,
        source.moduleName,
        source.name,
        source.Name,
        source.title,
        source.Title,
        metadata.module,
        metadata.Module,
      ),
    );

    const version = toTrimmedString(
      firstAvailableValue(
        source.version,
        source.Version,
        source.courseVersion,
        source.courseVersionName,
        metadata.version,
        metadata.courseVersion,
      ),
    );

    let subject = "";

    if (
      subjectOverride !== null &&
      subjectOverride !== undefined &&
      subjectOverride !== ""
    ) {
      subject = normalizeSubjectFromPath(subjectOverride);
    }

    if (!subject) {
      const directSubject = firstAvailableValue(
        source.subject,
        source.Subject,
        source.s,
        source.subjectPath,
      );

      subject = normalizeSubjectFromPath(directSubject);
    }

    if (!subject && Array.isArray(source.path)) {
      subject = normalizeSubjectFromPath(source.path);
    } else if (!subject && typeof source.path === "string") {
      subject = normalizeSubjectFromPath(source.path);
    }

    if (!subject) {
      subject = normalizeSubjectFromPath([category, subCategory, moduleName]);
    }

    const subjectParts = getPathParts(subject);
    const derivedCategory = subjectParts[0] || "";
    const derivedSubCategory = subjectParts.length > 2 ? subjectParts[1] : "";
    const derivedModule =
      subjectParts.length > 1 ? subjectParts[subjectParts.length - 1] : "";

    const questionCountValue = firstAvailableValue(
      source.questionCount,
      source.QuestionCount,
      source.count,
      source.totalQuestions,
      source.totalQuestionsCount,
      source.questionsCount,
      Array.isArray(source.questions) ? source.questions.length : null,
      metadata.questionCount,
      metadata.QuestionCount,
    );
    const questionCount = normalizeQuestionCount(questionCountValue);

    const password = toTrimmedString(
      firstAvailableValue(
        source.password,
        source.Password,
        source.pass,
        metadata.password,
        metadata.Password,
      ),
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

    const explicitLocked = firstAvailableValue(
      source.locked,
      source.Locked,
      source.isLocked,
      metadata.locked,
      metadata.Locked,
    );

    const locked =
      explicitLocked === ""
        ? password.length > 0
        : toBoolean(explicitLocked, password.length > 0);

    const idValue = toTrimmedString(
      firstAvailableValue(
        source.id,
        source.ID,
        source.uuid,
        source.uuidValue,
        source._id,
        source.guid,
        source.identifier,
        metadata.id,
        metadata.ID,
      ),
    );

    const name = toTrimmedString(
      firstAvailableValue(
        source.name,
        source.Name,
        source.title,
        source.Title,
        moduleName,
        subjectParts.length > 0 ? subjectParts[subjectParts.length - 1] : "",
      ),
    );

    const normalizedCategory = category || derivedCategory;
    const normalizedSubCategory = subCategory || derivedSubCategory;
    const normalizedModule = moduleName || derivedModule;
    const normalizedSubject = subject || name;

    const generatedId = slugify(
      normalizedSubject || name || normalizedModule || "deck",
    );
    const id = idValue || generatedId;

    const record = {
      id,
      ID: id,
      subject: normalizedSubject,
      Subject: normalizedSubject,
      name,
      category: normalizedCategory,
      subCategory: normalizedSubCategory,
      module: normalizedModule,
      version,
      courseVersion: version,
      questionCount: questionCount,
      QuestionCount: questionCount,
      hidden,
      Hidden: hidden,
      password,
      Password: password,
      locked,
      Locked: locked,
      metadata: {
        category: normalizedCategory,
        subCategory: normalizedSubCategory,
        module: normalizedModule,
        version,
        courseVersion: version,
      },
    };

    return record;
  }

  function isDeckLikeNode(node) {
    if (!isObject(node) || Array.isArray(node)) return false;
    if (isObject(node.deck) && !Array.isArray(node.deck)) return true;

    const hasQuestionCount = [
      "questionCount",
      "QuestionCount",
      "totalQuestions",
      "totalQuestionsCount",
    ].some(
      (key) =>
        node[key] !== undefined && node[key] !== null && node[key] !== "",
    );

    const hasLockState = [
      "password",
      "Password",
      "locked",
      "Locked",
      "isLocked",
    ].some(
      (key) =>
        node[key] !== undefined && node[key] !== null && node[key] !== "",
    );

    const hasSubject = ["subject", "Subject", "s", "subjectPath"].some(
      (key) =>
        node[key] !== undefined && node[key] !== null && node[key] !== "",
    );

    const hasIdentity = [
      "id",
      "ID",
      "uuid",
      "uuidValue",
      "_id",
      "guid",
      "identifier",
    ].some(
      (key) =>
        node[key] !== undefined && node[key] !== null && node[key] !== "",
    );

    const hasName = ["name", "Name", "title", "Title", "module", "Module"].some(
      (key) => typeof node[key] === "string" && node[key].trim(),
    );

    return (
      hasQuestionCount ||
      hasLockState ||
      (hasSubject && (hasIdentity || hasName))
    );
  }

  function collectChildren(node) {
    const children = [];
    const seenArrays = new Set();

    const keys = ["children", "categories", "subCategories", "items", "decks"];
    for (const key of keys) {
      const value = node[key];
      if (!Array.isArray(value) || seenArrays.has(value)) continue;
      seenArrays.add(value);
      children.push(...value);
    }

    return children;
  }

  function createDeckKey(deck) {
    const id = toTrimmedString(deck.id || deck.ID);
    const subject = toTrimmedString(deck.subject || deck.Subject);
    const name = toTrimmedString(deck.name);

    return [id, subject, name].filter(Boolean).join("|").toLocaleLowerCase();
  }

  function normalizeCategorySummary(summaryValue) {
    const flattened = [];
    const seenDecks = new Set();

    function pushDeck(deck) {
      if (!isObject(deck) || Array.isArray(deck)) return;

      const normalized = normalizeDeckRecord(deck);
      if (!(normalized.Subject || normalized.name || normalized.id)) return;

      const key = createDeckKey(normalized);
      if (key && seenDecks.has(key)) return;

      if (key) seenDecks.add(key);
      flattened.push(normalized);
    }

    function walk(node, inheritedPath = []) {
      if (Array.isArray(node)) {
        node.forEach((child) => walk(child, inheritedPath));
        return;
      }

      if (!isObject(node)) return;

      const inheritedParts = Array.isArray(inheritedPath)
        ? inheritedPath
        : normalizeSubjectFromPath(inheritedPath).split("::").filter(Boolean);

      const directName = toTrimmedString(
        firstAvailableValue(node.name, node.Name, node.title, node.Title),
      );

      const nextPath = [...inheritedParts];
      const isRootContainer =
        inheritedParts.length === 0 &&
        (directName === "" ||
          /^root$/i.test(directName) ||
          /^home$/i.test(directName));

      if (directName && !isRootContainer) {
        const lowerName = directName.toLocaleLowerCase();
        const alreadyPresent = nextPath.some(
          (part) => part.toLocaleLowerCase() === lowerName,
        );
        if (!alreadyPresent) nextPath.push(directName);
      }

      const nextSubject = normalizeSubjectFromPath(nextPath);

      if (isObject(node.deck) && !Array.isArray(node.deck)) {
        const deckSubject = nextSubject || node.Subject || node.subject || "";
        const normalized = normalizeDeckRecord(node.deck, deckSubject);
        pushDeck(normalized);
      } else if (isDeckLikeNode(node)) {
        const deckSubject = nextSubject || node.Subject || node.subject || "";
        const normalized = normalizeDeckRecord(node, deckSubject);
        pushDeck(normalized);
      }

      for (const child of collectChildren(node)) {
        walk(child, nextPath);
      }
    }

    if (!Array.isArray(summaryValue) && !isObject(summaryValue)) return [];

    walk(summaryValue, []);
    return flattened;
  }

  function compactQuestionRecord(question, subjectOverride = null) {
    const normalized = normalizeQuestionRecord(question, subjectOverride);
    const rawChoices = [
      normalized.ChoiceA,
      normalized.ChoiceB,
      normalized.ChoiceC,
      normalized.ChoiceD,
    ];

    const answerLetter = normalizeAnswerValue(normalized.Answer);
    const choices = [];
    let answerIndex = -1;

    rawChoices.forEach((choice, choiceIndex) => {
      const trimmedChoice = toTrimmedString(choice);
      if (!trimmedChoice) return;

      const compactIndex = choices.length;
      if (ANSWER_LETTERS[choiceIndex] === answerLetter) {
        answerIndex = compactIndex;
      }

      choices.push(trimmedChoice);
    });

    const compact = {
      s: toTrimmedString(normalized.Subject),
      i: toTrimmedString(normalized.ID),
      q: toTrimmedString(normalized.Question),
      c: choices,
    };

    if (answerIndex >= 0) compact.a = answerIndex;

    const explanation = toTrimmedString(normalized.Explanation);
    const imageURL = toTrimmedString(normalized.ImageURL);
    const tags = toTrimmedString(normalized.Tags);

    if (explanation) compact.e = explanation;
    if (imageURL) compact.u = imageURL;
    if (tags) compact.t = tags;

    return compact;
  }

  const QuestionCompat = Object.freeze({
    firstAvailableValue,
    toBoolean,
    normalizeSubjectFromPath,
    normalizeQuestionRecord,
    normalizeDeckRecord,
    normalizeCategorySummary,
    compactQuestionRecord,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = QuestionCompat;
  }

  if (globalScope) {
    globalScope.QuestionCompat = QuestionCompat;
  }
})(typeof window !== "undefined" ? window : globalThis);
