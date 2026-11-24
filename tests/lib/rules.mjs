// Shared site rules for tests/static-check.mjs and tests/qa.mjs.
export const SITE = "https://regenig.com";

// Site editions. English lives at the root; each translation in its own folder with the same
// page names. `lang` = the <html lang> and hreflang value; `code` = the form's hidden lang field.
export const EDITIONS = {
  en: { folder: "", lang: "en", dir: "ltr" },
  zh: { folder: "zh/", lang: "zh-Hans", dir: "ltr" },
  ar: { folder: "ar/", lang: "ar", dir: "rtl" },
};
export const TRANSLATED = ["index.html", "about.html", "partners.html"]; // indexable, with hreflang alternates
export const STATUS_NAMES = ["thanks.html", "enquiry-error.html", "enquiry-too-long.html", "404.html"];
const clean = (folder, page) => `${SITE}/${folder}${page === "index.html" ? "" : page.replace(/\.html$/, "")}`;

export const REAL_PAGES = {
  "index.html": `${SITE}/`,
  "about.html": `${SITE}/about`,
  "partners.html": `${SITE}/partners`,
  "privacy.html": `${SITE}/privacy`,
  "disclaimer.html": `${SITE}/disclaimer`,
};
for (const { folder } of Object.values(EDITIONS)) {
  if (folder) for (const page of TRANSLATED) REAL_PAGES[folder + page] = clean(folder, page);
}
export const STATUS_PAGES = Object.values(EDITIONS).flatMap(({ folder }) => STATUS_NAMES.map((p) => folder + p));
export const STUBS = ["services.html", "process.html", "network.html", "team.html", "contact.html"];

/** The edition a repo-relative page path belongs to ("zh/about.html" → "zh"). */
export function editionOf(file) {
  const m = /^([a-z]+)\//.exec(file);
  return m && Object.hasOwn(EDITIONS, m[1]) && m[1] !== "en" ? m[1] : "en";
}

// Content rules in every language (README "Content rules"; i18n brief §4): no superlatives or
// their equivalents, no cure / guarantee / success-rate / testimonial / before-after language.
// zh: substring match (no word breaks in Chinese); 最 alone is the superlative marker.
// ar: whole-word match after removing diacritics/tatweel and folding alef forms, also with a
// one-letter conjunction/preposition prefix (و ف ب ك ل); phrases match as written.
export const BANNED_TERMS = {
  zh: ["最", "顶级", "顶尖", "第一", "首屈一指", "无与伦比", "领先", "一流", "权威", "独一无二",
    "治愈", "根治", "包治", "痊愈", "保证", "担保", "确保疗效", "成功率", "有效率", "疗效显著", "前后对比", "术前术后",
    "见证", "好评", "患者评价", "逆转衰老", "返老还童", "抗衰老奇迹"],
  ar: ["الأفضل", "أفضل", "أحسن", "الأحسن", "الأكثر ثقة", "الأكثر تقدما", "الأكثر تقدماً", "الأول", "الرائد", "الرائدة", "رائد", "رائدة",
    "الأرقى", "الأفخم", "الأمثل", "الأعلى", "الأقوى", "الأشهر", "الأوحد", "لا مثيل", "الأحدث", "الأمهر",
    "علاج نهائي", "شفاء", "الشفاء", "يشفي", "مضمون", "مضمونة", "نضمن", "ضمان", "نسبة نجاح", "معدل نجاح", "معدلات نجاح",
    "قبل وبعد", "شهادات", "تجارب المرضى", "آراء المرضى", "عكس الشيخوخة", "إيقاف الشيخوخة"],
};
const AR_FOLD = (s) => s.normalize("NFC").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[\u0622\u0623\u0625]/g, "\u0627");
/** Banned terms found in visible text for an edition (empty array = clean). */
export function bannedTermsIn(text, edition) {
  const terms = BANNED_TERMS[edition] || [];
  if (edition === "zh") return terms.filter((t) => text.includes(t));
  if (edition === "ar") {
    const folded = AR_FOLD(text);
    const words = folded.split(/[^\u0621-\u064A\u0671-\u06D3]+/).filter(Boolean);
    const hits = [];
    for (const t of terms) {
      const ft = AR_FOLD(t);
      if (/\s/.test(ft)) { if (folded.replace(/\s+/g, " ").includes(ft)) hits.push(t); continue; }
      if (words.some((w) => w === ft || (/^[وفبكل]/.test(w) && w.slice(1) === ft) || (w.startsWith("لل") && "ال" + w.slice(2) === ft))) hits.push(t);
    }
    return hits;
  }
  return [];
}

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

// The only rules that may (and must) carry noindex: R1, the production *.pages.dev hosts
// (<project>.pages.dev and the per-deployment <hash>.<project>.pages.dev).
export const PAGES_DEV_NOINDEX_PATTERNS = ["https://:project.pages.dev/*", "https://:version.:project.pages.dev/*"];

/**
 * Cloudflare Pages _headers matching for one request URL.
 * Path patterns ("/x/*") apply to every host. Absolute-URL patterns ("https://host/path")
 * apply only when the host matches; like Cloudflare, they ignore the request's protocol and
 * port. ":name" placeholders match one label (no "." in the host, no "/" in the path);
 * "*" matches anything. Headers from all matching rules merge.
 * https://developers.cloudflare.com/pages/configuration/headers/
 */
export function headerPatternRegex(pattern) {
  const abs = /^https?:\/\//i.test(pattern);
  const p = abs ? pattern.replace(/^https?:\/\//i, "") : pattern;
  const hostEnd = abs ? (p.indexOf("/") < 0 ? p.length : p.indexOf("/")) : 0;
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") { re += ".*"; continue; }
    if (c === ":" && /[A-Za-z]/.test(p[i + 1] || "")) {
      let j = i + 1;
      while (j < p.length && /\w/.test(p[j])) j++;
      re += abs && i < hostEnd ? "[^./]+" : "[^/]+";
      i = j - 1;
      continue;
    }
    re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return { absolute: abs, regex: new RegExp(`^${re}$`, abs ? "i" : "") };
}
export function headersForUrl(rules, url) {
  const u = new URL(url);
  const out = {};
  for (const rule of rules) {
    const { absolute, regex } = headerPatternRegex(rule.pattern);
    const subject = absolute ? `${u.hostname}${u.pathname}` : u.pathname;
    if (regex.test(subject)) {
      for (const [k, v] of Object.entries(rule.headers)) out[k] = out[k] ? `${out[k]}, ${v}` : v;
    }
  }
  return out;
}
