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
// zh: substring match (no word breaks in Chinese); 最 alone is the superlative marker. The list
// also carries the common PRC Advertising Law absolutes (首选, 极致, 唯一, 国家级 …) and the
// safety-guarantee phrases (零风险, 无副作用 …).
// ar: whole-word match after removing diacritics/tatweel and folding alef forms, also with a
// one-letter conjunction/preposition prefix (و ف ب ك ل); phrases match as written. On top of the
// list, arElativeHits() catches the superlative by its shape (see below).
export const BANNED_TERMS = {
  zh: ["最", "顶级", "顶尖", "第一", "首屈一指", "无与伦比", "领先", "一流", "权威", "独一无二",
    "世界级", "世界标准", "世界水准", "首选", "极致", "尖端", "唯一", "独家", "首家", "国家级", "金牌", "王牌", "冠军", "No.1", "NO.1",
    "治愈", "根治", "包治", "痊愈", "保证", "担保", "确保疗效", "成功率", "有效率", "疗效显著", "前后对比", "术前术后",
    "零风险", "无风险", "无副作用", "零副作用", "绝对安全", "100%有效", "100％有效", "百分之百",
    "见证", "好评", "患者评价", "逆转衰老", "返老还童", "抗衰老奇迹"],
  ar: ["الأفضل", "أفضل", "أحسن", "الأحسن", "الأكثر ثقة", "الأكثر تقدما", "الأكثر تقدماً", "الأول", "الرائد", "الرائدة", "رائد", "رائدة",
    "الأرقى", "الأفخم", "الأمثل", "الأعلى", "الأقوى", "الأشهر", "الأوحد", "لا مثيل", "الأحدث", "الأمهر",
    // bare (indefinite / construct) elatives: أرقى عيادة, أحدث علاج …
    "أرقى", "أمهر", "أرفع", "أعلى", "أحدث", "أفخم", "أقوى", "أشهر", "أمثل", "أعظم", "أجود", "أبرع", "أكفأ", "أميز",
    "المعيار العالمي", "معايير عالمية", "عالمي المستوى", "عالمية المستوى", "على مستوى عالمي", "من الطراز الأول", "لا يضاهى", "منقطع النظير",
    "علاج نهائي", "شفاء", "الشفاء", "يشفي", "مضمون", "مضمونة", "نضمن", "ضمان", "نسبة نجاح", "معدل نجاح", "معدلات نجاح",
    "خال من المخاطر", "بلا مخاطر", "بدون آثار جانبية", "آمن تماما", "آمن تماماً",
    "قبل وبعد", "شهادات", "تجارب المرضى", "آراء المرضى", "عكس الشيخوخة", "إيقاف الشيخوخة"],
};
const AR_STRIP = (s) => s.normalize("NFC").replace(/[\u064B-\u065F\u0670\u0640]/g, ""); // diacritics + tatweel (hamza kept)
const AR_FOLD = (s) => AR_STRIP(s).replace(/[\u0622\u0623\u0625]/g, "\u0627");
const AR_WORDS = (s) => s.split(/[^\u0621-\u064A\u0671-\u06D3]+/).filter(Boolean);

/* Arabic superlatives by shape, not by list. The Arabic superlative is the elative أفعل:
 *   - in construct with a definite noun: أرقى العيادات ("the finest clinics"), أفضل الأطباء,
 *     أحدث العلاجات, أكثر البوابات موثوقية ("the most trusted gateway");
 *   - definite on its own: الأرقى, الأحدث;
 *   - أكثر / الأكثر + an abstract noun of quality: الأكثر موثوقية, أكثر … ثقةً / تقدماً / أماناً.
 * Elative shape = أ (or bare ا) + three letters (أفضل, أرقى, أكثر), or أ + a doubled root
 * (أهم, أدق). Not every word of that shape is an elative: AR_ELATIVE_ALLOW lists the
 * non-superlative words of that shape that the pages use (or that plainly are not elatives),
 * each with its meaning. Ordinals (أول/أولى) are allowed here; الأول stays banned by the list. */
export const AR_ELATIVE_ALLOW = {
  "أول": "first (ordinal: من أول حديث)", "أولى": "first (ordinal: أولى تخصصاتنا)",
  "أحد": "one of (أحد المنسقين)", "أهل": "people / family", "أمام": "in front of", "أيضا": "also",
  "أثر": "effect", "أمر": "matter", "أجل": "for (من أجل)", "أخذ": "taking", "أسس": "foundations",
  "أنتم": "you (pl.)", "أنها": "that it", "أننا": "that we", "أنهم": "that they",
  "أقصى": "maximum (الحد الأقصى: the message limit)", "أحرف": "letters/characters (plural of حرف: عدد الأحرف)",
  "أطلب": "I request", "اطلب": "request (imperative)", "أرسل": "send", "أكمل": "complete",
};
const AR_ELATIVE_DOUBLED = new Set(["أهم", "أدق", "أعز", "أشد", "أحق"]);
const AR_QUALITY_NOUNS = new Set(["موثوقية", "ثقة", "تقدما", "تقدم", "امانا", "امان", "فعالية", "نجاحا", "خبرة", "تميزا", "تميز",
  "شهرة", "رقيا", "تطورا", "احترافية", "كفاءة", "جودة", "دقة", "تخصصا", "فخامة"].map((w) => AR_FOLD(w)));
const AR_ALLOW = new Set(Object.keys(AR_ELATIVE_ALLOW).map(AR_STRIP));
function arCores(word) { // the word, then without a one-letter prefix (و ف ب ك ل), then لل… → ال…
  const out = [word];
  if (/^[وفبكل]/.test(word) && word.length > 3) out.push(word.slice(1));
  if (word.startsWith("لل") && word.length > 4) out.push("ال" + word.slice(2));
  return out;
}
function isElative(w) {
  if (AR_ALLOW.has(w)) return false;
  if (AR_ELATIVE_DOUBLED.has(w)) return true;
  return /^[\u0623\u0627][\u0621-\u064A]{3}$/.test(w) && !/[\u0629\u0627]$/.test(w); // not …ة (أسرة) or …ا (أيضا)
}
const isDefiniteNoun = (w) => arCores(w).some((c) => c.startsWith("\u0627\u0644") && c.length > 3);
/** Arabic superlatives found by shape (elative in construct / definite / أكثر + quality noun). */
export function arElativeHits(text) {
  const words = AR_WORDS(AR_STRIP(text));
  const hits = [];
  words.forEach((w, i) => {
    for (const c of arCores(w)) {
      const def = c.startsWith("\u0627\u0644") ? c.slice(2) : null;
      if (def !== null && isElative(def)) { hits.push(w); return; }                    // الأرقى
      if (def === null && isElative(c) && i + 1 < words.length && isDefiniteNoun(words[i + 1])) {
        hits.push(`${w} ${words[i + 1]}`); return;                                         // أرقى العيادات
      }
      if (AR_FOLD(def === null ? c : def) === "اكثر") {                                    // (ال)أكثر … موثوقية
        const q = words.slice(i + 1, i + 4).find((n) => arCores(AR_FOLD(n)).some((x) => AR_QUALITY_NOUNS.has(x)));
        if (q) { hits.push(`${w} … ${q}`); return; }
      }
    }
  });
  return hits;
}

/** Banned terms found in visible text for an edition (empty array = clean). */
export function bannedTermsIn(text, edition) {
  const terms = BANNED_TERMS[edition] || [];
  if (edition === "zh") return terms.filter((t) => text.includes(t));
  if (edition === "ar") {
    const folded = AR_FOLD(text);
    const words = AR_WORDS(folded);
    const hits = [];
    for (const t of terms) {
      const ft = AR_FOLD(t);
      if (/\s/.test(ft)) { if (folded.replace(/\s+/g, " ").includes(ft)) hits.push(t); continue; }
      if (words.some((w) => w === ft || (/^[وفبكل]/.test(w) && w.slice(1) === ft) || (w.startsWith("لل") && "ال" + w.slice(2) === ft))) hits.push(t);
    }
    return [...new Set([...hits, ...arElativeHits(text)])];
  }
  return [];
}

/* RIG is an agency / liaison, never a medical provider (disclaimer: "administrative and
 * coordinating in nature"; footer: we do not provide medical treatment). In Chinese,
 * 医疗机构 / 医疗服务机构 is the regulated term for a provider of diagnosis and treatment, so
 * no zh page may use it (or the provider synonyms) for RIG. The partner clinics may be called
 * 合作医疗机构. Arabic: مؤسسة طبية / منشأة صحية / مقدم رعاية صحية … are the provider terms;
 * a partner (… شريكة) is allowed. RIG's own terms: zh 私人医疗服务中介, ar وكالة رعاية صحية خاصة. */
export const PROVIDER_TERMS = {
  zh: /(?<!合作)(?<!合作的)(医疗服务机构|医疗机构|诊疗机构|医疗服务提供者|医疗服务提供方|医疗服务提供商|医疗服务商|医疗提供者|医疗服务供应商)/g,
  ar: /(?:^|\s)(?:[وفبكل])?(?:ال)?(مؤسسة (?:ال)?(?:طبية|صحية|علاجية)|منشاة (?:ال)?(?:طبية|صحية|علاجية)|مرفق (?:ال)?(?:طبي|صحي)|مقدم (?:ال)?(?:رعاية|خدمات) (?:ال)?(?:صحية|طبية)|مقدم (?:ال)?رعاية|مزود (?:ال)?(?:رعاية|خدمات) (?:ال)?(?:صحية|طبية))(?! (?:ال)?شريك)/g,
};
/** Medical-provider self-descriptions found in visible text (empty array = clean). */
export function providerTermsIn(text, edition) {
  const re = PROVIDER_TERMS[edition];
  if (!re) return [];
  const t = edition === "ar" ? AR_FOLD(text).replace(/\s+/g, " ") : text;
  return [...t.matchAll(re)].map((m) => m[1]);
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
