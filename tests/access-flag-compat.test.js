const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("./app-core.js", "utf8");
const helperStart = source.indexOf("function normalizeAccessFlag");
const resolverStart = source.indexOf("function resolveSubjectAccess");
assert.notStrictEqual(
  helperStart,
  -1,
  "normalizeAccessFlag helper should exist",
);
assert.notStrictEqual(resolverStart, -1, "resolveSubjectAccess should exist");

const helperBlock = source.slice(
  helperStart,
  source.indexOf("function buildAccessMetadataMap", helperStart),
);
const context = {
  console,
  String,
  Number,
  Boolean,
  Array,
  Object,
};
vm.runInNewContext(
  helperBlock +
    "\n" +
    source.slice(
      resolverStart,
      source.indexOf("function buildAccessMetadataMap", resolverStart),
    ),
  context,
);

const result = context.resolveSubjectAccess(
  "Parent::Child",
  {
    Parent: { Hidden: true, Locked: false, Password: "" },
    "Parent::Child": { Hidden: false, Locked: true, Password: "" },
  },
  [{ Subject: "Parent", Hidden: false, Locked: false, Password: "" }],
);

assert.strictEqual(
  result.Hidden,
  false,
  "parent hidden state must not apply to a child with an exact-match-only check",
);
assert.strictEqual(
  result.Locked,
  true,
  "child lock state should be respected without inheriting from a parent",
);
assert.strictEqual(context.normalizeAccessFlag("TRUE"), true);
assert.strictEqual(context.normalizeAccessFlag("FALSE"), false);

console.log("access flag compatibility tests passed");
