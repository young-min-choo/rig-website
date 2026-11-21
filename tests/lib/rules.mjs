// Shared site rules for tests/static-check.mjs and tests/qa.mjs.
export const SITE = "https://regenig.com";

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

// The one rule that may (and must) carry noindex: R1, production *.pages.dev host only.
export const PAGES_DEV_NOINDEX_PATTERN = "https://:project.pages.dev/*";

/**
 * Cloudflare Pages _headers matching for one request URL.
 * Path patterns ("/x/*") apply to every host. Absolute-URL patterns ("https://host/path")
 * apply only when protocol + host match. ":name" placeholders match one label (no "." in the
 * host, no "/" in the path); "*" matches anything. Headers from all matching rules merge.
 * https://developers.cloudflare.com/pages/configuration/headers/
 */
export function headerPatternRegex(pattern) {
  const abs = /^https?:\/\//i.test(pattern);
  const hostEnd = abs ? pattern.indexOf("/", pattern.indexOf("//") + 2) : 0;
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") { re += ".*"; continue; }
    if (c === ":" && /[A-Za-z]/.test(pattern[i + 1] || "") && !(abs && i < pattern.indexOf("//"))) {
      let j = i + 1;
      while (j < pattern.length && /\w/.test(pattern[j])) j++;
      re += abs && (hostEnd < 0 || i < hostEnd) ? "[^./]+" : "[^/]+";
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
    const subject = absolute ? `${u.protocol}//${u.host}${u.pathname}` : u.pathname;
    if (regex.test(subject)) {
      for (const [k, v] of Object.entries(rule.headers)) out[k] = out[k] ? `${out[k]}, ${v}` : v;
    }
  }
  return out;
}
