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
