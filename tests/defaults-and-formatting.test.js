const assert = require("assert");
const TextUtils = require("../text-utils.js");

assert.strictEqual(
  TextUtils.stripQuestionNumberPrefix("100. What is the correct answer?"),
  "What is the correct answer?",
);
assert.strictEqual(
  TextUtils.stripQuestionNumberPrefix(" 42) Why does this matter? "),
  "Why does this matter?",
);

const sorted = ["1", "10", "11", "2", "3", "4"].sort(
  TextUtils.naturalSortStrings,
);
assert.deepStrictEqual(sorted, ["1", "2", "3", "4", "10", "11"]);

console.log("defaults and formatting tests passed");
