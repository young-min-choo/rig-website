// i18n lane: the form's `lang` field picks the no-JS outcome page from a fixed allow-list,
// and the email to info@ (always English) says which edition sent it. Never touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handle, HONEYPOT_FIELD, LANGS, PAGES, pickLang, pagesFor } from "../functions/api/enquiry.js";

console.log = () => {};

const ORIGIN = "https://regenig.com";
const ENV = Object.freeze({
  RESEND_API_KEY: "re_test_key",
  MAIL_TO: "info@regenig.com",
  MAIL_FROM: "Regenesis Website <website@send.regenig.com>",
  ALLOWED_ORIGINS: "https://regenig.com",
  RESEND_API_URL: "http://resend.invalid/emails",
});
const PRIVATE = Object.freeze({
  form: "private-enquiry", name: "王 小明", email: "wang@example.com", whatsapp: "",
  message: "您好，我想了解在东京的咨询安排。", consent: "yes", [HONEYPOT_FIELD]: "",
});
const PARTNER = Object.freeze({
  form: "partner-enquiry", name: "د. سارة", position: "مديرة", organisation: "عيادة الخليج",
  country: "الإمارات", email: "sara@example.com", message: "نود مناقشة شراكة.", consent: "yes", [HONEYPOT_FIELD]: "",
});

function fakeFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response("{}", { status }); };
  fn.calls = calls;
  return fn;
}
function noJs(fields, { origin = ORIGIN, referer, encoding = "urlencoded" } = {}) {
  const h = new Headers({ accept: "text/html,application/xhtml+xml" });
  if (origin) h.set("origin", origin);
  if (referer) h.set("referer", referer);
  let body;
  if (encoding === "multipart") {
    const b = "----rigi18nboundary";
    body = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("") + `--${b}--\r\n`;
    h.set("content-type", `multipart/form-data; boundary=${b}`);
  } else {
    body = new URLSearchParams(fields).toString();
    h.set("content-type", "application/x-www-form-urlencoded");
  }
  return new Request(`${ORIGIN}/api/enquiry`, { method: "POST", headers: h, body });
}
const loc = (res) => res.headers.get("location");
const ALLOWED_LOCATIONS = new Set(Object.values(LANGS).flatMap((p) => Object.values(PAGES).map((x) => p + x)));

test("LANGS is the fixed allow-list en / zh / ar (static-check verifies every outcome page exists)", () => {
  assert.deepEqual(Object.keys(LANGS), ["en", "zh", "ar"]);
  assert.ok(Object.isFrozen(LANGS));
  assert.deepEqual(pagesFor("zh"), { sent: "/zh/thanks.html", error: "/zh/enquiry-error.html", tooLong: "/zh/enquiry-too-long.html" });
  assert.deepEqual(pagesFor("ar"), { sent: "/ar/thanks.html", error: "/ar/enquiry-error.html", tooLong: "/ar/enquiry-too-long.html" });
  assert.deepEqual(pagesFor("en"), PAGES);
});

test("no-JS success lands on the form's language (zh, ar, en)", async () => {
  for (const [lang, want] of [["zh", "/zh/thanks.html"], ["ar", "/ar/thanks.html"], ["en", "/thanks.html"], [" ZH ", "/zh/thanks.html"]]) {
    for (const encoding of ["urlencoded", "multipart"]) {
      const res = await handle(noJs({ ...PRIVATE, lang }, { encoding }), ENV, fakeFetch());
      assert.equal(res.status, 303, `${lang} ${encoding}`);
      assert.equal(loc(res), want, `${lang} ${encoding}`);
    }
  }
});

test("no-JS error and too-long pages follow the form's language", async () => {
  const bad = await handle(noJs({ ...PARTNER, lang: "ar", consent: "" }), ENV, fakeFetch());
  assert.equal(loc(bad), "/ar/enquiry-error.html");
  const upstream = await handle(noJs({ ...PRIVATE, lang: "zh" }), ENV, fakeFetch(500));
  assert.equal(loc(upstream), "/zh/enquiry-error.html");
  const long = await handle(noJs({ ...PRIVATE, lang: "zh", message: "长".repeat(5001) }), ENV, fakeFetch());
  assert.equal(loc(long), "/zh/enquiry-too-long.html");
  const longAr = await handle(noJs({ ...PARTNER, lang: "ar", message: "م".repeat(5001) }), ENV, fakeFetch());
  assert.equal(loc(longAr), "/ar/enquiry-too-long.html");
  const honeypot = await handle(noJs({ ...PRIVATE, lang: "ar", [HONEYPOT_FIELD]: "bot" }), ENV, fakeFetch());
  assert.equal(loc(honeypot), "/ar/thanks.html");
});

test("unknown, missing or hostile lang values fall back to English and are never reflected", async () => {
  const hostile = [
    undefined, "", "fr", "zh-Hans", "zh-CN", "arabic", "en-GB",
    "zh\r\nSet-Cookie: x=1", "zh%0d%0aLocation:%20https://evil.example", "ar\nX-Injected: 1",
    "/zh", "//evil.example", "https://evil.example/", "../zh", "zh/../../etc", "zh/thanks.html",
    "__proto__", "constructor", "toString", "hasOwnProperty", "a".repeat(5000),
  ];
  for (const lang of hostile) {
    const fields = lang === undefined ? { ...PRIVATE } : { ...PRIVATE, lang };
    for (const [env, f, want] of [[ENV, fakeFetch(), "/thanks.html"], [ENV, fakeFetch(500), "/enquiry-error.html"]]) {
      const res = await handle(noJs(fields), env, f);
      assert.equal(res.status, 303, JSON.stringify(lang));
      assert.equal(loc(res), want, JSON.stringify(lang));
      assert.ok(ALLOWED_LOCATIONS.has(loc(res)));
      for (const [k, v] of res.headers) assert.ok(!/[\r\n]/.test(v) && !/evil|injected|set-cookie/i.test(`${k}:${v}`), `${k}: ${v}`);
    }
    if (lang !== undefined) assert.equal(pickLang(lang), lang.trim().toLowerCase() === "zh" ? "zh" : "en", JSON.stringify(lang));
  }
});

test("before the body is read, the Referer's first path segment picks the page (allow-list only)", async () => {
  const off = { ...ENV, RESEND_API_KEY: "" }; // 503 before the body is read
  const cases = [
    ["https://regenig.com/zh/partners", "/zh/enquiry-error.html"],
    ["https://regenig.com/ar/", "/ar/enquiry-error.html"],
    ["https://regenig.com/partners", "/enquiry-error.html"],
    ["https://regenig.com/fr/", "/enquiry-error.html"],
    ["https://regenig.com/zhx/", "/enquiry-error.html"],
    ["https://regenig.com/%0d%0aSet-Cookie:x/", "/enquiry-error.html"],
    ["not a url", "/enquiry-error.html"],
    [undefined, "/enquiry-error.html"],
  ];
  for (const [referer, want] of cases) {
    const res = await handle(noJs({ ...PRIVATE }, { referer }), off, fakeFetch());
    assert.equal(loc(res), want, String(referer));
  }
  // bad origin (refused before the body) and an over-cap body follow the Referer too
  const origin = await handle(noJs(PRIVATE, { origin: "https://evil.example", referer: "https://regenig.com/ar/partners" }), ENV, fakeFetch());
  assert.equal(loc(origin), "/ar/enquiry-error.html");
  const huge = await handle(noJs({ ...PRIVATE, message: "z".repeat(70 * 1024) }, { referer: "https://regenig.com/zh/" }), ENV, fakeFetch());
  assert.equal(loc(huge), "/zh/enquiry-too-long.html");
  // once the body is read, the form's own field wins (missing → English)
  const read = await handle(noJs({ ...PRIVATE }, { referer: "https://regenig.com/zh/" }), ENV, fakeFetch());
  assert.equal(loc(read), "/thanks.html");
});

test("the JSON path is unchanged by lang (status + error code only)", async () => {
  const h = new Headers({ accept: "application/json", origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" });
  const res = await handle(new Request(`${ORIGIN}/api/enquiry`, { method: "POST", headers: h, body: new URLSearchParams({ ...PRIVATE, lang: "zh" }).toString() }), ENV, fakeFetch());
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(await res.text()), { ok: true });
  assert.equal(res.headers.get("location"), null);
});

test("the email stays English and carries a Language line (en when missing or unknown)", async () => {
  for (const [lang, want] of [["zh", "zh"], ["ar", "ar"], ["en", "en"], [undefined, "en"], ["xx\r\nBcc: a@b.c", "en"]]) {
    for (const base of [PRIVATE, PARTNER]) {
      const f = fakeFetch();
      const fields = lang === undefined ? { ...base } : { ...base, lang };
      await handle(noJs(fields), ENV, f);
      assert.equal(f.calls.length, 1);
      const mail = f.calls[0];
      const lines = mail.text.split("\n");
      assert.equal(lines.filter((l) => l.startsWith("Language: ")).length, 1);
      assert.ok(lines.includes(`Language: ${want}`), `${lang} → ${want}`);
      assert.ok(!/Bcc/.test(mail.text));
      assert.match(mail.subject, /^\[Website\] (Private|Partner) enquiry — /);
      assert.match(lines[0], /^(Private|Partner) enquiry from the website\.$/);
    }
  }
});

test("site.js: data-i18n-* templates replace the English text; missing attributes keep English", () => {
  const src = readFileSync(new URL("../assets/js/site.js", import.meta.url), "utf8");
  const m = src.match(/function say\(form, key, english, vars\) \{[\s\S]*?\n  \}/);
  assert.ok(m, "site.js defines say(form, key, english, vars)");
  const say = new Function(`${m[0]}; return say;`)();
  const form = (attrs) => ({ getAttribute: (n) => (Object.hasOwn(attrs, n) ? attrs[n] : null) });
  const zh = form({ "data-i18n-left": "还可输入 {n} 个字符。", "data-i18n-over": "超出 {limit} 字上限 {n} 字。", "data-i18n-sent": "谢谢。" });
  assert.equal(say(zh, "left", "400 characters left.", { n: "400", limit: "5,000" }), "还可输入 400 个字符。");
  assert.equal(say(zh, "over", "x", { n: "1,000", limit: "5,000" }), "超出 5,000 字上限 1,000 字。");
  assert.equal(say(zh, "sent", "Thank you."), "谢谢。");
  assert.equal(say(zh, "failed", "English fallback."), "English fallback.");
  assert.equal(say(form({}), "left", "400 characters left.", { n: "400" }), "400 characters left.");
  // unknown placeholders stay as written; prototype keys are not looked up
  assert.equal(say(form({ "data-i18n-x": "{n} {constructor} {zzz}" }), "x", "", { n: "1" }), "1 {constructor} {zzz}");
  // every status the forms can show goes through say()
  for (const key of ["required", "sending", "sent", "failed", "closed", "too-long", "too-long-plain", "left", "over", "unit"]) {
    assert.ok(src.includes(`"${key}"`), key);
  }
});
