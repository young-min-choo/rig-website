// R1: noindex is scoped to the production *.pages.dev host only; regenig.com stays indexable.
// Evaluates the real _headers with a Cloudflare-style matcher (tests/lib/rules.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHeaders, headersForUrl, headerPatternRegex, PAGES_DEV_NOINDEX_PATTERNS } from "./lib/rules.mjs";

const rules = parseHeaders(readFileSync(new URL("../_headers", import.meta.url), "utf8"));
const robots = (url) => headersForUrl(rules, url)["x-robots-tag"];
const PATHS = ["/", "/about", "/partners.html", "/privacy", "/assets/css/style.css", "/assets/img/hero.jpg", "/no/such/page"];

const PAGES_DEV_HOSTS = [
  "regenig.pages.dev", "regenig-web.pages.dev", "REGENIG.pages.dev",
  // review C2-3: the unique URL of each deployment (and branch aliases) is <label>.<project>.pages.dev
  "a1b2c3d4.regenig.pages.dev", "0f9e8d7c.regenig-web.pages.dev", "main.regenig.pages.dev",
];
const NEVER_NOINDEX = [
  "regenig.com", "www.regenig.com", "regenig-preview.vercel.app", "127.0.0.1:8080",
  "pages.dev.evil.io", "regenig.pages.dev.evil.io", "a1b2.regenig.pages.dev.evil.io", "pages.dev",
];

test("pages.dev (any project name, and every per-deployment <hash>.<project> host) is served X-Robots-Tag: noindex on every path", () => {
  for (const host of PAGES_DEV_HOSTS) {
    for (const p of PATHS) assert.equal(robots(`https://${host}${p}`), "noindex", `${host}${p}`);
  }
});

test("like Cloudflare, absolute-URL rules ignore the request's protocol and port", () => {
  for (const url of ["http://regenig.pages.dev/", "https://regenig.pages.dev:8443/about", "http://a1b2c3d4.regenig.pages.dev/x"]) {
    assert.equal(robots(url), "noindex", url);
  }
  for (const url of ["http://regenig.com/", "https://regenig.com:8443/", "http://www.regenig.com/about", "http://regenig-preview.vercel.app/"]) {
    assert.equal(robots(url), undefined, url);
  }
});

test("regenig.com, www and every other host get no X-Robots-Tag (canonical site stays indexable)", () => {
  for (const host of NEVER_NOINDEX) {
    for (const p of PATHS) {
      assert.equal(robots(`https://${host}${p}`), undefined, `${host}${p}`);
      assert.equal(robots(`http://${host}${p}`), undefined, `http ${host}${p}`);
    }
  }
});

test("a host placeholder matches exactly one label", () => {
  const { regex } = headerPatternRegex("https://:version.:project.pages.dev/*");
  assert.ok(regex.test("abc.regenig.pages.dev/"));
  assert.ok(!regex.test("regenig.pages.dev/"));
  assert.ok(!regex.test("x.abc.regenig.pages.dev/"));
  assert.ok(!regex.test("abc.regenig.pages.dev.evil.io/"));
});

test("pages.dev still gets the site-wide security headers (CSP, HSTS) alongside noindex", () => {
  for (const host of ["regenig.pages.dev", "a1b2c3d4.regenig.pages.dev"]) {
    const h = headersForUrl(rules, `https://${host}/about`);
    assert.ok(h["content-security-policy"], host);
    assert.ok(h["strict-transport-security"], host);
    assert.deepEqual(headersForUrl(rules, "https://regenig.com/about")["content-security-policy"], h["content-security-policy"]);
  }
});

test("only the two R1 pages.dev rules carry noindex, each exactly once, value exactly noindex", () => {
  const withNoindex = rules.filter((r) => "x-robots-tag" in r.headers || Object.values(r.headers).some((v) => /noindex/i.test(v)));
  assert.deepEqual(withNoindex.map((r) => r.pattern), PAGES_DEV_NOINDEX_PATTERNS);
  for (const r of withNoindex) assert.deepEqual(r.headers, { "x-robots-tag": "noindex" }, r.pattern);
});
