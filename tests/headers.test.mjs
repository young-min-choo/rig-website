// R1: noindex is scoped to the production *.pages.dev host only; regenig.com stays indexable.
// Evaluates the real _headers with a Cloudflare-style matcher (tests/lib/rules.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHeaders, headersForUrl, PAGES_DEV_NOINDEX_PATTERN } from "./lib/rules.mjs";

const rules = parseHeaders(readFileSync(new URL("../_headers", import.meta.url), "utf8"));
const robots = (url) => headersForUrl(rules, url)["x-robots-tag"];
const PATHS = ["/", "/about", "/partners.html", "/privacy", "/assets/css/style.css", "/assets/img/hero.jpg", "/no/such/page"];

test("pages.dev (any project name) is served X-Robots-Tag: noindex on every path", () => {
  for (const host of ["regenig.pages.dev", "regenig-web.pages.dev", "REGENIG.pages.dev"]) {
    for (const p of PATHS) assert.match(robots(`https://${host}${p}`) || "", /\bnoindex\b/i, `${host}${p}`);
  }
});

test("regenig.com, www and every other host get no X-Robots-Tag (canonical site stays indexable)", () => {
  for (const host of ["regenig.com", "www.regenig.com", "regenig-preview.vercel.app", "127.0.0.1:8080", "pages.dev.evil.io", "regenig.pages.dev.evil.io"]) {
    for (const p of PATHS) assert.equal(robots(`https://${host}${p}`), undefined, `${host}${p}`);
  }
});

test("pages.dev still gets the site-wide security headers (CSP, HSTS) alongside noindex", () => {
  const h = headersForUrl(rules, "https://regenig.pages.dev/about");
  assert.ok(h["content-security-policy"]);
  assert.ok(h["strict-transport-security"]);
  assert.deepEqual(headersForUrl(rules, "https://regenig.com/about")["content-security-policy"], h["content-security-policy"]);
});

test("exactly one rule carries noindex and it is the R1 pages.dev rule", () => {
  const withNoindex = rules.filter((r) => Object.values(r.headers).some((v) => /noindex/i.test(v)));
  assert.deepEqual(withNoindex.map((r) => r.pattern), [PAGES_DEV_NOINDEX_PATTERN]);
});
