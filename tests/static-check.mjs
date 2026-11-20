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
const SITE = "https://regenig.com";

export const REAL_PAGES = {
  "index.html": `${SITE}/`,
  "about.html": `${SITE}/about`,
  "partners.html": `${SITE}/partners`,
  "privacy.html": `${SITE}/privacy`,
  "disclaimer.html": `${SITE}/disclaimer`,
};
export const STATUS_PAGES = ["thanks.html", "enquiry-error.html", "404.html"];
export const STUBS = ["services.html", "process.html", "network.html", "team.html", "contact.html"];

export const REQUIRED_CSP = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
};

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

const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort();
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
      if (tag === "link" && ["canonical"].includes(t.rel)) continue; // absolute by design, checked below
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
  check(`${file}: html lang`, /<html\b[^>]*\blang="en"/.test(html));
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
check("404.html: only root-relative internal URLs (served at any path)",
  ![...tags(pages["404.html"], "a"), ...tags(pages["404.html"], "link"), ...tags(pages["404.html"], "script")]
    .some((t) => { const v = t.href ?? t.src ?? ""; return v && !/^(\/|#|mailto:|data:|https?:)/.test(v); }));

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
export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), headers: {} }; rules.push(cur); continue; }
    const m = raw.trim().match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (!m || !cur) throw new Error(`_headers: cannot parse line: ${raw}`);
    cur.headers[m[1].toLowerCase()] = m[2];
  }
  return rules;
}
export function parseCsp(value) {
  const map = {};
  for (const part of value.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [name, ...vals] = part.split(/\s+/);
    if (map[name.toLowerCase()]) throw new Error(`duplicate CSP directive ${name}`);
    map[name.toLowerCase()] = vals;
  }
  return map;
}
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
  check("no noindex in _headers (preview noindex is added at deploy time)", !/noindex/i.test(read("_headers")));
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
  const formPages = { "index.html": "private-enquiry", "partners.html": "partner-enquiry" };
  for (const [file, type] of Object.entries(formPages)) {
    const html = pages[file];
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
      if (el && fn.LIMITS[f]) check(`${file}: ${f} within server cap`, !el.maxlength || Number(el.maxlength) <= fn.LIMITS[f]);
    }
    for (const f of spec.optional) check(`${file}: optional field "${f}" present`, !!named(f));
    const consent = named("consent");
    check(`${file}: consent checkbox required, value=yes`, consent && consent.type === "checkbox" && "required" in consent && consent.value === "yes");
    const extraFields = [...tags(html, "input"), ...tags(html, "textarea")].map((t) => t.name).filter(Boolean)
      .filter((n) => !["form", "consent", fn.HONEYPOT_FIELD, ...spec.required, ...spec.optional].includes(n));
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
  const css = read("assets/css/style.css");
  const hpRule = (css.match(/\.hp\s*\{([^}]*)\}/) || [])[1] || "";
  check("style.css: .hp is visually hidden", /position:\s*absolute/.test(hpRule) && /(clip-path|clip)\s*:/.test(hpRule));
}

// ---------- report ----------
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`static-check: ${passed} passed, ${failures.length} failed (${htmlFiles.length} HTML files, root ${relative(process.cwd(), ROOT) || "."})`);
process.exit(failures.length ? 1 : 0);
