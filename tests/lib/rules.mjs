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
