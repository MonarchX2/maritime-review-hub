const assert = require("assert");
const {
  normalizeQuestionRecord,
  compactQuestionRecord,
  normalizeDeckRecord,
  normalizeCategorySummary,
} = require("../question-compat.js");

const compactQuestion = {
  s: "Biology::Cells",
  i: "CEL-1",
  q: "What is the powerhouse of the cell?",
  c: ["Nucleus", "Mitochondria", "Ribosome", "Golgi Body"],
  a: 1,
  e: "",
  u: "",
};

const legacyQuestion = {
  Subject: "Biology::Cells",
  ID: "CEL-1",
  Question: "What is the powerhouse of the cell?",
  ChoiceA: "Nucleus",
  ChoiceB: "Mitochondria",
  ChoiceC: "Ribosome",
  ChoiceD: "Golgi Body",
  Answer: "B",
  Explanation: "",
  ImageURL: "",
};

const normCompact = normalizeQuestionRecord(compactQuestion);
assert.strictEqual(normCompact.Subject, "Biology::Cells");
assert.strictEqual(normCompact.Question, "What is the powerhouse of the cell?");
assert.strictEqual(normCompact.ChoiceB, "Mitochondria");
assert.strictEqual(normCompact.Answer, "B");

const normLegacy = normalizeQuestionRecord(legacyQuestion);
assert.strictEqual(normLegacy.ChoiceB, "Mitochondria");
assert.strictEqual(normLegacy.Answer, "B");

const compacted = compactQuestionRecord(normLegacy);
assert.strictEqual(compacted.s, "Biology::Cells");
assert.deepStrictEqual(compacted.c, [
  "Nucleus",
  "Mitochondria",
  "Ribosome",
  "Golgi Body",
]);
assert.strictEqual(compacted.a, 1);

const legacyWithBlanks = {
  Subject: "Biology::Cells",
  ID: "CEL-2",
  Question: "Which organelle is the powerhouse?",
  ChoiceA: "",
  ChoiceB: "Mitochondria",
  ChoiceC: "",
  ChoiceD: "Golgi Body",
  Answer: "D",
};
const compactedWithBlanks = compactQuestionRecord(legacyWithBlanks);
assert.deepStrictEqual(compactedWithBlanks.c, ["Mitochondria", "Golgi Body"]);
assert.strictEqual(compactedWithBlanks.a, 1);

const compactWithoutSubject = {
  i: "CEL-2",
  q: "Which organelle makes proteins?",
  c: ["Ribosome", "Nucleus", "Golgi", "Mitochondria"],
  a: 0,
};
const normalizedWithOverride = normalizeQuestionRecord(
  compactWithoutSubject,
  "Biology::Cells",
);
assert.strictEqual(normalizedWithOverride.Subject, "Biology::Cells");
assert.strictEqual(
  normalizedWithOverride.Question,
  "Which organelle makes proteins?",
);

const hierarchicalDeck = {
  id: "deck-101",
  name: "Basic Fire Fighting",
  subject: "Safety::Fire::Basic",
  category: "Safety",
  subCategory: "Fire",
  module: "Basic Fire Fighting",
  version: "2024.1",
  questionCount: 42,
  hidden: false,
};
const normalizedDeck = normalizeDeckRecord(hierarchicalDeck);
assert.strictEqual(normalizedDeck.id, "deck-101");
assert.strictEqual(normalizedDeck.Subject, "Safety::Fire::Basic");
assert.strictEqual(normalizedDeck.category, "Safety");
assert.strictEqual(normalizedDeck.subCategory, "Fire");
assert.strictEqual(normalizedDeck.module, "Basic Fire Fighting");
assert.strictEqual(normalizedDeck.version, "2024.1");
assert.strictEqual(normalizedDeck.QuestionCount, 42);

const nestedSummary = {
  id: "root",
  name: "Root",
  children: [
    {
      id: "safety",
      name: "Safety",
      children: [
        {
          id: "fire",
          name: "Fire",
          deck: {
            id: "deck-201",
            name: "Basic Fire Fighting",
            questionCount: 12,
          },
        },
      ],
    },
  ],
};
const flattened = normalizeCategorySummary(nestedSummary);
assert.strictEqual(flattened.length, 1);
assert.strictEqual(flattened[0].Subject, "Safety::Fire");
assert.strictEqual(flattened[0].name, "Basic Fire Fighting");
assert.strictEqual(flattened[0].module, "Basic Fire Fighting");
assert.strictEqual(flattened[0].id, "deck-201");

console.log("question compatibility tests passed");
