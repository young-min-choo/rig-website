#!/usr/bin/env node
// Static checks for the RIG site. Run from the repo root: node tests/static-check.mjs
// No dependencies; parses the (hand-written, regular) HTML with small regexes.
//
// Checks: internal links/anchors resolve · one <h1> per page · <img alt> ·
// canonical + og:url + absolute og:image on real pages, noindex on the rest ·
// sitemap ⇔ real pages ⇔ canonicals · robots.txt · `_headers` CSP parses, is the
// required policy, and the markup needs nothing beyond it (no inline script/style,
// no third-party URLs) · security headers · `_redirects` ⇔ v1 stubs · form wiring
// matches functions/api/enquiry.js (fields, honeypot, endpoint).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { SITE, REAL_PAGES, STATUS_PAGES, STUBS, REQUIRED_CSP, parseHeaders, parseCsp, headersForUrl, PAGES_DEV_NOINDEX_PATTERNS,
  EDITIONS, TRANSLATED, STATUS_NAMES, editionOf, bannedTermsIn, BANNED_TERMS } from "./lib/rules.mjs";



let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; return true; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function tags(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(attrs(m[1]));
  return out;
}
function attrs(s) {
  const a = {};
  const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return a;
}
function decode(s) { return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function meta(html, key, attr = "property") {
  const t = tags(html, "meta").find((x) => x[attr] === key);
  return t ? t.content : undefined;
}
function ids(html) { return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])); }

// English at the root; each translated edition in its folder (zh/, ar/).
const htmlFiles = Object.values(EDITIONS).flatMap(({ folder }) =>
  existsSync(join(ROOT, folder || ".")) ? readdirSync(join(ROOT, folder || ".")).filter((f) => f.endsWith(".html")).map((f) => folder + f) : []).sort();
const pages = Object.fromEntries(htmlFiles.map((f) => [f, stripComments(read(f))]));

// ---------- inventory ----------
for (const f of [...Object.keys(REAL_PAGES), ...STATUS_PAGES, ...STUBS]) check(`exists: ${f}`, existsSync(join(ROOT, f)));
for (const f of htmlFiles) {
  check(`known page: ${f}`, f in REAL_PAGES || STATUS_PAGES.includes(f) || STUBS.includes(f), "add it to REAL_PAGES / STATUS_PAGES / STUBS");
}

// ---------- links ----------
function resolveRef(fromFile, ref) {
  // returns { file, hash } relative to ROOT, or null for non-internal refs
  if (/^(mailto:|tel:|data:|javascript:)/i.test(ref)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) return { external: ref };
  const [pathPart, hash = ""] = decode(ref).split("#");
  const clean = pathPart.split("?")[0];
  let target;
  if (clean === "") target = fromFile;
  else if (clean.startsWith("/")) target = clean.slice(1);
  else target = posix.normalize(posix.join(posix.dirname(fromFile), clean));
  if (target === "" || target.endsWith("/")) target += "index.html";
  return { file: target, hash };
}
const isFunctionRoute = (file) => existsSync(join(ROOT, "functions", file.replace(/\.html$/, "") + ".js"));

const REF_TAGS = [["a", "href"], ["link", "href"], ["script", "src"], ["img", "src"], ["source", "src"], ["video", "src"], ["form", "action"], ["iframe", "src"]];
for (const [file, html] of Object.entries(pages)) {
  const myIds = ids(html);
  for (const [tag, attr] of REF_TAGS) {
    for (const t of tags(html, tag)) {
      const ref = t[attr];
      if (ref === undefined || ref === "") continue;
      if (tag === "link" && ["canonical", "alternate"].includes(t.rel)) continue; // absolute by design, checked below
      const r = resolveRef(file, ref);
      if (!r) {
        if (/^javascript:/i.test(ref)) check(`${file}: no javascript: URLs`, false, ref);
        if (/^data:/i.test(ref) && !(tag === "link" && t.rel === "icon") && tag !== "img") check(`${file}: data: only for images`, false, `${tag} ${ref.slice(0, 40)}`);
        continue;
      }
      if (r.external) {
        // Navigating away is allowed (a href); loading anything from elsewhere is not.
        check(`${file}: no third-party ${tag}[${attr}]`, tag === "a", r.external);
        continue;
      }
      const exists = existsSync(join(ROOT, r.file)) && statSync(join(ROOT, r.file)).isFile();
      const route = !exists && tag === "form" && isFunctionRoute(r.file);
      if (!check(`${file}: ${tag}[${attr}]="${ref}" resolves`, exists || route)) continue;
      if (r.hash && r.file.endsWith(".html")) {
        const targetIds = r.file === file ? myIds : ids(pages[r.file] ?? stripComments(read(r.file)));
        check(`${file}: anchor ${ref} exists`, targetIds.has(r.hash));
      }
    }
  }
  // meta refresh targets
  const refresh = tags(html, "meta").find((t) => (t["http-equiv"] || "").toLowerCase() === "refresh");
  if (refresh) {
    const url = (refresh.content.match(/url=(.+)$/i) || [])[1];
    const r = url && resolveRef(file, url.trim());
    check(`${file}: meta refresh resolves`, !!(r && !r.external && existsSync(join(ROOT, r.file))), url);
    if (r && r.hash && pages[r.file]) check(`${file}: refresh anchor exists`, ids(pages[r.file]).has(r.hash), url);
  }
}
// CSS url() references
for (const css of readdirSync(join(ROOT, "assets/css")).filter((f) => f.endsWith(".css"))) {
  const text = read(`assets/css/${css}`);
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const ref = m[1];
    if (ref.startsWith("data:")) continue;
    check(`${css}: url(${ref}) is same-origin`, !/^([a-z]+:)?\/\//i.test(ref));
    check(`${css}: url(${ref}) resolves`, existsSync(join(ROOT, "assets/css", ref)));
  }
  check(`${css}: no @import of remote CSS`, !/@import\s+(url\()?['"]?(https?:)?\/\//i.test(text));
}

// ---------- headings, images, labels ----------
for (const [file, html] of Object.entries(pages)) {
  const h1 = (html.match(/<h1\b/gi) || []).length;
  if (STUBS.includes(file)) {
    // Redirect stubs never render for long (0 s meta refresh; 301 on Cloudflare). Skip the h1 rule.
    check(`${file}: stub has no more than one h1`, h1 <= 1);
  } else {
    check(`${file}: exactly one <h1>`, h1 === 1, `found ${h1}`);
  }
  for (const img of tags(html, "img")) check(`${file}: <img src="${img.src}"> has alt`, "alt" in img);
  const ed = EDITIONS[editionOf(file)];
  const htmlTag = attrs((html.match(/<html\b([^>]*)>/) || [])[1] || "");
  check(`${file}: html lang="${ed.lang}"`, htmlTag.lang === ed.lang, htmlTag.lang);
  check(`${file}: html dir="${ed.dir}"`, htmlTag.dir === ed.dir, htmlTag.dir);
  check(`${file}: <title>`, /<title>[^<]+<\/title>/.test(html));
  for (const input of [...tags(html, "input"), ...tags(html, "textarea"), ...tags(html, "select")]) {
    if (input.type === "hidden") continue;
    const labelled = "aria-label" in input || "aria-labelledby" in input ||
      (input.id && new RegExp(`<label\\b[^>]*\\bfor="${input.id}"`).test(html));
    check(`${file}: input #${input.id || input.name} has a label`, labelled);
  }
}

// ---------- canonical / og / robots meta ----------
for (const [file, url] of Object.entries(REAL_PAGES)) {
  const html = pages[file];
  const canon = tags(html, "link").find((t) => t.rel === "canonical");
  check(`${file}: canonical = ${url}`, canon && canon.href === url, canon && canon.href);
  check(`${file}: og:url = ${url}`, meta(html, "og:url") === url, meta(html, "og:url"));
  const img = meta(html, "og:image") || "";
  check(`${file}: og:image absolute on ${SITE}`, img.startsWith(`${SITE}/`), img);
  if (img.startsWith(`${SITE}/`)) check(`${file}: og:image file exists`, existsSync(join(ROOT, img.slice(SITE.length + 1))));
  check(`${file}: indexable (no noindex)`, !/noindex/i.test(meta(html, "robots", "name") || ""));
}
for (const file of [...STATUS_PAGES, ...STUBS]) {
  check(`${file}: noindex`, /noindex/i.test(meta(pages[file] || "", "robots", "name") || ""));
  check(`${file}: no og:url (not a real page)`, meta(pages[file] || "", "og:url") === undefined);
}
for (const nf of htmlFiles.filter((f) => f.endsWith("404.html"))) {
  check(`${nf}: only root-relative internal URLs (served at any path)`,
    ![...tags(pages[nf], "a"), ...tags(pages[nf], "link"), ...tags(pages[nf], "script")]
      .some((t) => { const v = t.href ?? t.src ?? ""; return v && !/^(\/|#|mailto:|data:|https?:)/.test(v); }));
}

// ---------- sitemap + robots ----------
{
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const expected = Object.values(REAL_PAGES);
  check("sitemap.xml: urlset namespace", xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
  check("sitemap.xml: URLs = real pages", JSON.stringify([...locs].sort()) === JSON.stringify([...expected].sort()), locs.join(", "));
  check("sitemap.xml: no duplicates", new Set(locs).size === locs.length);
  const robots = read("robots.txt");
  check("robots.txt: allows all", /User-agent:\s*\*/i.test(robots) && !/^Disallow:\s*\/\s*$/im.test(robots));
  check("robots.txt: Sitemap line", /^Sitemap:\s*https:\/\/regenig\.com\/sitemap\.xml\s*$/m.test(robots));
}

// ---------- _headers + CSP ----------
{
  let rules = [];
  try { rules = parseHeaders(read("_headers")); check("_headers parses", true); } catch (e) { check("_headers parses", false, e.message); }
  const all = rules.find((r) => r.pattern === "/*");
  check("_headers: has a /* rule", !!all);
  const h = all ? all.headers : {};
  const cspValue = h["content-security-policy"];
  if (check("_headers: Content-Security-Policy on /*", !!cspValue)) {
    let csp = {};
    try { csp = parseCsp(cspValue); check("CSP parses", true); } catch (e) { check("CSP parses", false, e.message); }
    for (const [d, vals] of Object.entries(REQUIRED_CSP)) {
      check(`CSP ${d} = ${vals.join(" ")}`, JSON.stringify(csp[d]) === JSON.stringify(vals), (csp[d] || ["(missing)"]).join(" "));
    }
    const extra = Object.keys(csp).filter((d) => !(d in REQUIRED_CSP));
    check("CSP has no extra directives", extra.length === 0, extra.join(", "));
    check("CSP has no unsafe-* / wildcard", !/unsafe-|\*|https?:/.test(cspValue));
  }
  check("HSTS", /max-age=\d{7,}/.test(h["strict-transport-security"] || ""));
  check("X-Content-Type-Options nosniff", h["x-content-type-options"] === "nosniff");
  check("Referrer-Policy", h["referrer-policy"] === "strict-origin-when-cross-origin");
  const pp = h["permissions-policy"] || "";
  for (const f of ["camera=()", "microphone=()", "geolocation=()"]) check(`Permissions-Policy ${f}`, pp.includes(f));
  const cache = rules.filter((r) => r.pattern.startsWith("/assets/") && /max-age=(\d+)/.test(r.headers["cache-control"] || ""));
  const longest = Math.max(0, ...cache.map((r) => Number(r.headers["cache-control"].match(/max-age=(\d+)/)[1])));
  check("long cache rule(s) under /assets/", longest >= 31536000, `max ${longest}`);
  for (const dir of ["img", "fonts"]) check(`/assets/${dir}/* cached a year`, cache.some((r) => r.pattern === `/assets/${dir}/*` && /max-age=31536000/.test(r.headers["cache-control"])));
  // R1: noindex only on the production *.pages.dev hosts (<project> and <hash>.<project>); never on a
  // path rule (those apply to regenig.com too) or on any other absolute-URL rule. The Vercel preview's
  // noindex is added at deploy time.
  const noindexRules = rules.filter((r) => "x-robots-tag" in r.headers || Object.values(r.headers).some((v) => /noindex/i.test(v)));
  for (const r of noindexRules) {
    check(`_headers: noindex only on the pages.dev rules (found on "${r.pattern}")`, PAGES_DEV_NOINDEX_PATTERNS.includes(r.pattern));
  }
  for (const pattern of PAGES_DEV_NOINDEX_PATTERNS) {
    const pd = rules.filter((r) => r.pattern === pattern);
    check(`_headers: R1 rule "${pattern}" present once`, pd.length === 1, `${pd.length}`);
    check(`_headers: R1 rule "${pattern}" sets X-Robots-Tag: noindex`, pd.length === 1 && /^noindex$/i.test((pd[0].headers["x-robots-tag"] || "").trim()), pd[0] && pd[0].headers["x-robots-tag"]);
  }
  check("_headers: no header rule targets regenig.com by absolute URL", !rules.some((r) => /^https?:\/\/([^/]*\.)?regenig\.com/i.test(r.pattern)));
  for (const url of [`${SITE}/`, `${SITE}/about`, "https://www.regenig.com/", "http://regenig.com/", "https://regenig-preview.vercel.app/"]) {
    const h = headersForUrl(rules, url);
    check(`_headers: ${url} resolves to no X-Robots-Tag`, !("x-robots-tag" in h), h["x-robots-tag"]);
  }
  for (const url of ["https://regenig.pages.dev/", "https://a1b2c3d4.regenig.pages.dev/", "http://regenig.pages.dev/about"]) {
    check(`_headers: ${url} resolves to X-Robots-Tag noindex`, headersForUrl(rules, url)["x-robots-tag"] === "noindex", headersForUrl(rules, url)["x-robots-tag"]);
  }
}

// What the markup would need beyond the CSP: inline script/style/handlers, remote origins.
for (const [file, html] of Object.entries(pages)) {
  check(`${file}: no style="" attributes (CSP style-src 'self')`, !/\sstyle\s*=/i.test(html));
  check(`${file}: no <style> blocks`, !/<style\b/i.test(html));
  check(`${file}: no inline <script>`, tags(html, "script").every((t) => t.src) && !/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html));
  check(`${file}: no on*="" handlers`, !/\son[a-z]+\s*=/i.test(html));
  check(`${file}: no <iframe>/<embed>/<object>`, !/<(iframe|embed|object)\b/i.test(html));
  check(`${file}: no <base>`, !/<base\b/i.test(html));
}
for (const js of readdirSync(join(ROOT, "assets/js"))) {
  const text = read(`assets/js/${js}`);
  check(`${js}: no eval/new Function`, !/\beval\s*\(|new Function\s*\(/.test(text));
  check(`${js}: no setAttribute("style")`, !/setAttribute\(\s*['"]style/.test(text));
  check(`${js}: no remote URLs`, !/https?:\/\//.test(text));
}

// ---------- _redirects ⇔ stubs ----------
{
  const lines = read("_redirects").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const map = {};
  for (const l of lines) {
    const [from, to, code, ...rest] = l.trim().split(/\s+/);
    check(`_redirects: "${l.trim()}" well formed`, from && to && code === "301" && rest.length === 0);
    map[from] = to;
  }
  const clean = (u) => u.replace(/^(\.\/)?/, "/").replace(/^\/index\.html/, "/").replace(/\.html(?=#|$)/, "");
  for (const stub of STUBS) {
    const refresh = tags(pages[stub], "meta").find((t) => (t["http-equiv"] || "").toLowerCase() === "refresh");
    const url = refresh && (refresh.content.match(/url=(.+)$/i) || [])[1];
    const want = url && clean(url.trim());
    const base = "/" + stub.replace(/\.html$/, "");
    check(`_redirects ${base}.html → ${want}`, map[`${base}.html`] === want, map[`${base}.html`]);
    check(`_redirects ${base} → ${want}`, map[base] === want, map[base]);
  }
}

// ---------- forms ⇔ function ----------
{
  const fn = await import(pathToFileURL(join(ROOT, "functions/api/enquiry.js")).href);
  const formPages = Object.values(EDITIONS).flatMap(({ folder }) => [[folder + "index.html", "private-enquiry"], [folder + "partners.html", "partner-enquiry"]]);
  for (const [file, type] of formPages) {
    const html = pages[file];
    // i18n: the hidden lang field names the edition (the function maps it to that edition's outcome pages)
    const langField = tags(html, "input").find((t) => t.name === "lang");
    check(`${file}: hidden lang=${editionOf(file)}`, !!langField && langField.type === "hidden" && langField.value === editionOf(file) && Object.hasOwn(fn.LANGS, langField.value), langField && langField.value);
    const formTag = tags(html, "form")[0] || {};
    check(`${file}: form action=/api/enquiry`, formTag.action === "/api/enquiry");
    check(`${file}: form data-endpoint=/api/enquiry`, formTag["data-endpoint"] === "/api/enquiry");
    check(`${file}: form method=post`, (formTag.method || "").toLowerCase() === "post");
    const hidden = tags(html, "input").find((t) => t.name === "form");
    check(`${file}: hidden form=${type}`, hidden && hidden.value === type && type in fn.FORMS);
    const spec = fn.FORMS[type];
    const named = (n) => [...tags(html, "input"), ...tags(html, "textarea")].find((t) => t.name === n);
    for (const f of spec.required) {
      const el = named(f);
      check(`${file}: required field "${f}" present + required`, el && "required" in el);
    }
    for (const f of spec.optional) check(`${file}: optional field "${f}" present`, !!named(f));
    // review C2-4: short fields stop at the server's cap, so a long entry is never refused after typing
    for (const f of [...spec.required, ...spec.optional].filter((x) => x !== "message")) {
      const el = named(f);
      check(`${file}: ${f} maxlength = server cap ${fn.LIMITS[f]}`, el && el.maxlength === String(fn.LIMITS[f]), el && el.maxlength);
    }
    // ruling R2 (review C3-1): the message is never cut off silently. No maxlength; site.js counts
    // against data-maxchars, which must be the server's cap.
    const msgEl = named("message");
    check(`${file}: message has no maxlength (no silent truncation)`, msgEl && !("maxlength" in msgEl), msgEl && msgEl.maxlength);
    check(`${file}: message data-maxchars = server cap ${fn.LIMITS.message}`, msgEl && msgEl["data-maxchars"] === String(fn.LIMITS.message), msgEl && msgEl["data-maxchars"]);
    const consent = named("consent");
    check(`${file}: consent checkbox required, value=yes`, consent && consent.type === "checkbox" && "required" in consent && consent.value === "yes");
    const extraFields = [...tags(html, "input"), ...tags(html, "textarea")].map((t) => t.name).filter(Boolean)
      .filter((n) => !["form", "lang", "consent", fn.HONEYPOT_FIELD, ...spec.required, ...spec.optional].includes(n));
    check(`${file}: no fields the function would drop`, extraFields.length === 0, extraFields.join(", "));
    const hp = named(fn.HONEYPOT_FIELD);
    check(`${file}: honeypot "${fn.HONEYPOT_FIELD}" present`, !!hp);
    if (hp) {
      check(`${file}: honeypot tabindex=-1`, hp.tabindex === "-1");
      check(`${file}: honeypot autocomplete=off`, hp.autocomplete === "off");
      check(`${file}: honeypot not required`, !("required" in hp));
      const wrap = html.match(new RegExp(`<div\\b([^>]*)>\\s*<label[^>]*for="${hp.id}"`));
      const w = wrap ? attrs(wrap[1]) : {};
      check(`${file}: honeypot wrapper aria-hidden + .hp`, w["aria-hidden"] === "true" && /\bhp\b/.test(w.class || ""));
    }
  }
  // ruling R2: the no-JS outcome pages the function redirects to exist; the too-long page names the limit
  for (const lang of Object.keys(fn.LANGS)) {
    for (const [k, loc] of Object.entries(fn.pagesFor(lang))) {
      check(`function page ${lang} ${k} → ${loc} exists`, existsSync(join(ROOT, loc.slice(1))));
      check(`function page ${lang} ${k} → ${loc} is in the ${lang} edition`, editionOf(loc.slice(1)) === lang && STATUS_PAGES.includes(loc.slice(1)));
    }
  }
  check("function LANGS = the site's editions", JSON.stringify(Object.keys(fn.LANGS)) === JSON.stringify(Object.keys(EDITIONS)));
  const limitText = `${fn.LIMITS.message.toLocaleString("en-US")} characters`;
  const tooLong = pages[(fn.PAGES.tooLong || "").slice(1)] || "";
  check(`too-long page says messages are limited to ${limitText}`, new RegExp(`Messages are limited to ${limitText}`).test(tooLong));
  for (const lang of Object.keys(fn.LANGS)) {
    const page = pages[fn.pagesFor(lang).tooLong.slice(1)] || "";
    const main = (page.match(/<main[\s\S]*<\/main>/) || [""])[0];
    check(`${lang} too-long page names the limit (${fn.LIMITS.message.toLocaleString("en-US")}, Western digits)`, main.includes(fn.LIMITS.message.toLocaleString("en-US")));
    check(`${lang} too-long page offers info@regenig.com`, /href="mailto:info@regenig\.com"/.test(main));
  }
  const siteJs = read("assets/js/site.js");
  check("site.js: message counter reads data-maxchars", /textarea\[data-maxchars\]/.test(siteJs) && /getAttribute\("data-maxchars"\)/.test(siteJs));
  check("site.js: counter is announced politely", /setAttribute\("aria-live", "polite"\)/.test(siteJs));
  const css = read("assets/css/style.css");
  const hpRule = (css.match(/\.hp\s*\{([^}]*)\}/) || [])[1] || "";
  check("style.css: .hp is visually hidden", /position:\s*absolute/.test(hpRule) && /(clip-path|clip)\s*:/.test(hpRule));
}

// ---------- launch runbook gates (review cycle 1: F1, N3, N6, N7) ----------
{
  const rb = read("docs/LAUNCH-RUNBOOK.md");
  const section = (start, end) => { const i = rb.indexOf(start); if (i < 0) return ""; const j = rb.indexOf(end, i + start.length); return rb.slice(i, j < 0 ? undefined : j); };
  const s4d = section("### 4d.", "\n## ");
  const s5 = section("## 5. Rollback", "\n## ");
  const s6 = section("## 6. Post-launch checks", "\n## ");
  const after = section("Afterwards (owner decisions", "\n## ");
  // F1 / R1
  check("runbook §6: pages.dev X-Robots-Tag noindex check", /curl -sI "https:\/\/\$PROJECT\.pages\.dev\/" \| grep -i '\^x-robots-tag'\s+# noindex/.test(s6));
  check("runbook §6: regenig.com has no X-Robots-Tag check", /curl -sI https:\/\/regenig\.com\/ \| grep -ic '\^x-robots-tag'\s+# 0/.test(s6));
  check("runbook Afterwards: pages.dev described as noindex, not just canonical", /pages\.dev` stays reachable but is not indexable/.test(after) && /X-Robots-Tag: noindex/.test(after));
  // N3
  check("runbook 4d: one Free-plan rate limiting rule on /api/enquiry", /Rate limiting rules/.test(s4d) && /URI Path[^\n]*\n?[^\n]*`\/api\/enquiry`/.test(s4d) && /\*\*Block\*\*/.test(s4d));
  // review C2-6: counters are approximate and per data centre, so loop 20 and ask for at least one 429
  check("runbook §6: rate limit verified (≥20 requests, at least one 429)", /seq 1 20[^\n]*\/api\/enquiry[^\n]*at least one 429/.test(s6));
  check("runbook §6: no-429 run is not a pass (manual Security → Events check)", /Do not\s+count a run with no `429` as a pass/.test(s6) && /Security → Events/.test(s6));
  // N6: privacy gate is a pre-flight, i.e. before step 1 of 4d
  const gate = s4d.indexOf("Final Privacy Policy published"), step1 = s4d.indexOf("\n1. Workers & Pages");
  check("runbook 4d: final Privacy Policy pre-flight before the cutover steps", gate > 0 && step1 > gate);
  check("runbook 4d: privacy gate names Cloudflare + Resend", /Final Privacy Policy published[\s\S]*\*\*Cloudflare\*\*[\s\S]*\*\*Resend\*\*/.test(s4d.slice(0, step1 > 0 ? step1 : undefined)));
  // review C2-1: pages.dev forms cannot deliver before the final Privacy Policy, and close after the 4c.5 test
  const s33 = section("3.3 Environment variables", "\n3.4 ");
  const s34 = section("3.4 Check the function", "\n## ");
  const s4c = section("### 4c.", "\n### 4d.");
  const s4a = section("### 4a.", "\n### 4b.");
  check("runbook 3.3: RESEND_API_KEY left unset until 4c.4 (function answers 503)", /`RESEND_API_KEY` \| \*\*Secret\*\* \| \*\*leave unset now\.\*\*/.test(s33) && /503 to every POST before it reads the\s+body/.test(s33));
  check("runbook 3.4: 503 is the expected answer until 4c.4", /expected answer until step 4c\.4/.test(s34));
  const keyAt = s4c.indexOf("secret put RESEND_API_KEY"), gate4c = s4c.indexOf("Final Privacy Policy published");
  check("runbook 4c.4: final Privacy Policy pre-flight before RESEND_API_KEY is set", gate4c > 0 && keyAt > gate4c);
  const close = s4c.indexOf("Close the pages.dev forms");
  check("runbook 4c.5: pages.dev removed from ALLOWED_ORIGINS before 4d", close > s4c.indexOf("4c.5") && /`ALLOWED_ORIGINS` to\s+`https:\/\/regenig\.com,https:\/\/www\.regenig\.com`[^\n]*remove the pages\.dev/.test(s4c.slice(close)) && /"error":"forbidden"/.test(s4c.slice(close)));
  check("runbook 3.3: pages.dev entry dropped at the end of 4c.5", /drop the pages\.dev entry at the end of step 4c\.5/.test(s33));
  check("runbook 4d.5: only confirms ALLOWED_ORIGINS (no longer opens the window)", /Confirm `ALLOWED_ORIGINS`/.test(s4d));
  // review C2-2: DNSSEC health check during the 4a wait; re-enable after rollback only after 48 h + dnscheck
  check("runbook 4a: MX/A Status health check during the wait", /type=MX' \| jq \.Status\s+# must print 0/.test(s4a) && /SERVFAIL/.test(s4a));
  check("runbook 5.1: DNSSEC back on only after 48 h and dnscheck shows nsa1-4 alone", /DNSSEC back on at Squarespace \*\*only after 48 h\*\*[\s\S]*only\s+when `dnscheck` shows `nsa1`–`nsa4\.squarespacedns\.com` alone/.test(s5));
  check("runbook 5.1: no unconditional \"once things are stable\"", !/once things are stable/.test(s5));
  // review C2-3: the per-deployment URL is checked too
  check("runbook §6: per-deployment <hash>.<project>.pages.dev noindex check", /deployment URL printed by 3\.2[^\n]*x-robots-tag[^\n]*# noindex/.test(s6));
  // N7
  for (const rec of ["_dmarc", "resend._domainkey.send", "send.send"]) check(`runbook §5 rollback: re-add Cloudflare-only record ${rec}`, s5.includes(`\`${rec}\``));
  check("runbook: ALLOWED_ORIGINS uses <project>.pages.dev", /\| `ALLOWED_ORIGINS` \|[^\n]*https:\/\/<project>\.pages\.dev/.test(rb));
  check("runbook: no hard-coded regenig.pages.dev / --project-name regenig", !/regenig\.pages\.dev|--project-name regenig\b/.test(rb));
}

// ---------- ruling R3: Choo's RIG address is youngmin@regenig.com ----------
{
  const files = ["README.md", "assets/team/README.md", ...readdirSync(join(ROOT, "docs")).map((f) => `docs/${f}`), ...htmlFiles];
  const stale = files.filter((f) => /\bchoo@regenig\.com\b|\(or choo@\)/i.test(read(f)));
  check("R3: no choo@regenig.com left in docs, README or pages (use youngmin@regenig.com)", stale.length === 0, stale.join(", "));
}

// ---------- i18n: zh-Hans + ar editions ----------
{
  const LEGAL = {
    en: { treatment: "Treatment is provided solely by licensed physicians at our partner clinics.", notMedical: "We do not provide medical treatment or medical advice." },
    zh: { treatment: "所有治疗均仅由合作诊所的持牌医师提供。", notMedical: "我们不提供医疗诊治，也不提供医疗建议。", englishOnly: "隐私政策与免责声明目前仅提供英文版。" },
    ar: { treatment: "يقدّم العلاج حصراً أطباء مرخّصون في العيادات الشريكة لنا.", notMedical: "لا نقدّم علاجاً طبياً ولا مشورة طبية.", englishOnly: "سياسة الخصوصية وإخلاء المسؤولية متاحتان حالياً باللغة الإنجليزية فقط." },
  };
  const I18N_KEYS = ["required", "sending", "sent", "failed", "closed", "too-long", "too-long-plain", "left", "over", "unit"];
  const PLACEHOLDERS = { "too-long": ["{limit}", "{over}"], "too-long-plain": ["{limit}"], left: ["{n}"], over: ["{n}", "{limit}"] };
  const visibleText = (html) => {
    const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
    const attrText = [...body.matchAll(/\s(?:alt|aria-label|title|content|data-i18n-[a-z-]+)="([^"]*)"/g)].map((m) => decode(m[1]));
    return [body.replace(/<[^>]+>/g, " "), ...attrText].join(" ");
  };
  const nonStub = htmlFiles.filter((f) => !STUBS.includes(f));

  // the banned-term scanner is not vacuous
  check("banned-term scan catches zh superlatives", bannedTermsIn("这是最好的诊所，顶级服务", "zh").length === 2);
  check("banned-term scan catches ar superlatives (prefix, diacritics, alef forms)", ["نحن الأفضل", "والأفضل", "الأفضلُ", "الافضل", "عيادة رائدة", "نتائج مضمونة", "قبل وبعد"].every((x) => bannedTermsIn(x, "ar").length > 0));
  check("banned-term scan leaves ordinary ar words alone", bannedTermsIn("أولى تخصّصاتنا، من أول حديث حتى المتابعة", "ar").length === 0);

  for (const file of nonStub) {
    const ed = editionOf(file);
    const raw = read(file);
    const html = pages[file];
    const legal = LEGAL[ed];
    // compliance lines on every page, in its language
    const treat = tags(html, "p").length && (html.match(/<p class="treatment">([^<]*)<\/p>/) || [])[1];
    check(`${file}: footer treatment line (${ed})`, treat === legal.treatment, treat);
    check(`${file}: "we do not provide medical treatment or advice" (${ed})`, html.includes(legal.notMedical));
    if (ed === "en") continue;
    check(`${file}: TRANSLATION comment at the top`, raw.split("\n").slice(0, 3).some((l) => l.trim() === "<!-- TRANSLATION: AI draft (2026-11), pending native review -->"));
    check(`${file}: legal text noted as English-only`, html.includes(legal.englishOnly));
    // legal pages are not translated: links go to the English files and say so with hreflang="en"
    for (const a of tags(html, "a").filter((t) => /(^|\/)(privacy|disclaimer)\.html$/.test(t.href || ""))) {
      const r = resolveRef(file, a.href);
      check(`${file}: ${a.href} → English legal page`, r && ["privacy.html", "disclaimer.html"].includes(r.file) && a.hreflang === "en", a.href);
    }
    const consentLabel = (html.match(/<label for="p[ef]-consent">([\s\S]*?)<\/label>/) || [])[1];
    if (consentLabel !== undefined) check(`${file}: consent label links the English Privacy Policy`, /href="(\.\.\/|\/)privacy\.html" hreflang="en"/.test(consentLabel));
    // content rules in the page's language
    const hits = bannedTermsIn(visibleText(html), ed);
    check(`${file}: no banned terms (${ed}: ${BANNED_TERMS[ed].length} terms)`, hits.length === 0, hits.join(", "));
    check(`${file}: Western digits only (no Arabic-Indic numerals)`, !/[\u0660-\u0669\u06F0-\u06F9]/.test(visibleText(html)));
    // localised form text
    for (const form of tags(html, "form")) {
      for (const k of I18N_KEYS) {
        const v = form[`data-i18n-${k}`];
        check(`${file}: form data-i18n-${k} present`, typeof v === "string" && v.trim() !== "");
        for (const ph of PLACEHOLDERS[k] || []) check(`${file}: data-i18n-${k} has ${ph}`, typeof v === "string" && v.includes(ph));
        check(`${file}: data-i18n-${k} is translated (no English sentence)`, typeof v === "string" && !/\b(the|your|please|characters?|message)\b/i.test(v), v);
      }
    }
  }
  for (const file of formPages(htmlFiles).filter((f) => editionOf(f) === "en")) {
    check(`${file}: English form uses site.js defaults (no data-i18n-*)`, !tags(pages[file], "form").some((f) => Object.keys(f).some((k) => k.startsWith("data-i18n-"))));
  }
  function formPages(files) { return files.filter((f) => /(^|\/)(index|partners)\.html$/.test(f)); }

  // language switcher: real links, one per edition, aria-current on the page's own language
  const SAME = new Set([...TRANSLATED, ...STATUS_NAMES.filter((n) => n !== "404.html")]);
  for (const file of nonStub) {
    const ed = editionOf(file);
    const li = (pages[file].match(/<li class="lang"[^>]*>([\s\S]*?)<\/li>/) || [])[1];
    if (!check(`${file}: language switcher present`, !!li)) continue;
    check(`${file}: switcher has no "coming soon" placeholders`, !/pending|Coming soon/i.test(li));
    const links = tags(li, "a");
    check(`${file}: switcher = EN | 中文 | العربية links`, JSON.stringify(links.map((a) => a.hreflang)) === JSON.stringify(Object.values(EDITIONS).map((e) => e.lang)), links.map((a) => a.hreflang).join(","));
    const current = links.filter((a) => a["aria-current"] === "true");
    check(`${file}: aria-current on the active language only`, current.length === 1 && current[0].hreflang === EDITIONS[ed].lang, current.map((a) => a.hreflang).join(","));
    for (const [code, e] of Object.entries(EDITIONS)) {
      const a = links.find((x) => x.hreflang === e.lang);
      if (!a) continue;
      check(`${file}: switcher ${code} link has lang="${e.lang}"`, a.lang === e.lang);
      const r = resolveRef(file, a.href);
      const base = file.split("/").pop();
      // 404s point every language at its home; English-only pages (legal) at the other editions' home
      const want = base === "404.html" ? e.folder + "index.html" : code === ed ? file : e.folder + (SAME.has(base) ? base : "index.html");
      check(`${file}: switcher ${code} → ${want}`, r && !r.external && r.file === want, r && r.file);
    }
  }

  // hreflang alternates: complete, self-referencing, reciprocal, x-default = English
  const alts = (file) => Object.fromEntries(tags(pages[file] || "", "link").filter((t) => t.rel === "alternate").map((t) => [t.hreflang, t.href]));
  const urlToFile = Object.fromEntries(Object.entries(REAL_PAGES).map(([f, u]) => [u, f]));
  for (const page of TRANSLATED) {
    for (const [code, e] of Object.entries(EDITIONS)) {
      const file = e.folder + page;
      const a = alts(file);
      const want = Object.fromEntries([...Object.values(EDITIONS).map((x) => [x.lang, REAL_PAGES[x.folder + page]]), ["x-default", REAL_PAGES[page]]]);
      check(`${file}: hreflang alternates en/zh-Hans/ar/x-default`, JSON.stringify(a) === JSON.stringify(want), JSON.stringify(a));
      check(`${file}: canonical is its own hreflang URL`, tags(pages[file], "link").find((t) => t.rel === "canonical")?.href === a[e.lang]);
      for (const [hl, url] of Object.entries(a)) {
        const target = urlToFile[url];
        check(`${file}: hreflang ${hl} → a real page`, !!target, url);
        if (target) check(`${file}: hreflang ${hl} is reciprocal (${target} lists ${file})`, JSON.stringify(alts(target)) === JSON.stringify(a));
      }
    }
  }
  for (const file of htmlFiles.filter((f) => !TRANSLATED.includes(f.replace(/^(zh|ar)\//, "")))) {
    check(`${file}: no hreflang alternates (English-only or noindex page)`, Object.keys(alts(file)).length === 0);
  }

  // sitemap: every edition's URL with its xhtml:link alternates
  {
    const xml = read("sitemap.xml");
    check("sitemap.xml: xhtml namespace for alternates", xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
    const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
    for (const b of blocks) {
      const loc = (b.match(/<loc>([^<]+)<\/loc>/) || [])[1];
      const file = urlToFile[loc];
      const links = Object.fromEntries([...b.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\s*\/>/g)].map((m) => [m[1], m[2]]));
      check(`sitemap.xml: ${loc} alternates = the page's hreflang links`, !!file && JSON.stringify(links) === JSON.stringify(alts(file)), JSON.stringify(links));
    }
  }

  // fonts: one small self-hosted Arabic face (OFL), Chinese on system fonts only
  {
    const AR_FONT = "assets/fonts/noto-naskh-arabic-variable.woff2";
    const size = existsSync(join(ROOT, AR_FONT)) ? statSync(join(ROOT, AR_FONT)).size : 0;
    check(`Arabic font ${AR_FONT} present and ≤ 150 KB`, size > 10000 && size <= 150 * 1024, `${size} bytes`);
    check("Arabic font licence (OFL) shipped beside it", existsSync(join(ROOT, "assets/fonts/OFL-NotoNaskhArabic.txt")) && /SIL Open Font License/.test(read("assets/fonts/OFL-NotoNaskhArabic.txt")));
    const fontsCss = read("assets/css/fonts.css");
    const face = (fontsCss.match(/@font-face\s*\{[^}]*Noto Naskh Arabic[^}]*\}/) || [""])[0];
    check("fonts.css: Noto Naskh Arabic @font-face → the local file", face.includes("../fonts/noto-naskh-arabic-variable.woff2"));
    check("fonts.css: Arabic face is Arabic-only (unicode-range starts at U+0600, no Latin)", /unicode-range:\s*U\+0600/.test(face) && !/U\+0000/.test(face));
    check("no CJK font shipped (system fonts only)", !/U\+4E00|U\+3000|CJK|Han|Hei|Song/i.test(fontsCss.replace(/\/\*[\s\S]*?\*\//g, "")) &&
      readdirSync(join(ROOT, "assets/fonts")).filter((f) => /\.(woff2?|ttf|otf)$/.test(f)).length === 4);
    const css = read("assets/css/style.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const arBlock = (css.match(/html:lang\(ar\)\s*\{[^}]*\}/) || [""])[0];
    check("style.css: Arabic face named only in the html:lang(ar) stacks (EN/zh never download it)", arBlock.includes("Noto Naskh Arabic") && css.split("Noto Naskh Arabic").length - 1 === arBlock.split("Noto Naskh Arabic").length - 1);
    const zhBlock = (css.match(/html:lang\(zh\)\s*\{[^}]*\}/) || [""])[0];
    check("style.css: zh system CJK stack", ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"].every((f) => zhBlock.includes(f)));
    check("style.css: no letter-spacing on Arabic labels", /html:lang\(ar\)\s*:is\([^)]*\.eyebrow[^)]*\)\s*\{[^}]*letter-spacing:\s*0;/.test(css));
  }
}

// ---------- report ----------
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`static-check: ${passed} passed, ${failures.length} failed (${htmlFiles.length} HTML files, root ${relative(process.cwd(), ROOT) || "."})`);
process.exit(failures.length ? 1 : 0);
