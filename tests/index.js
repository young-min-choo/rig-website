// Entry point for the canonical command `node --test tests/`.
// On Node 26 the test runner resolves the `tests/` argument like a module path,
// which lands here (directory → index.js). Load every *.test.mjs in this folder
// so their node:test cases register and report as usual.
"use strict";
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const files = readdirSync(__dirname).filter((f) => f.endsWith(".test.mjs")).sort();
  if (files.length === 0) throw new Error("no *.test.mjs files found in tests/");
  for (const f of files) await import(pathToFileURL(join(__dirname, f)).href);
})().catch((err) => { console.error(err); process.exitCode = 1; });
