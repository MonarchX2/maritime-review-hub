const assert = require("assert");
const {
  normalizeQuestionRecord,
  compactQuestionRecord,
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

console.log("question compatibility tests passed");
