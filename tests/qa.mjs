#!/usr/bin/env node
// Browser QA for the RIG site. Run from the repo root: node tests/qa.mjs
//
// Starts its own HTTP server (in this process), serves the site with the
// `_headers` rules applied (so the real CSP is enforced by Chromium), routes
// POST /api/enquiry to the real Pages Function with a fake Resend fetch, and
// checks every page at 390×844 and 1440×900:
//   no horizontal overflow · zero non-origin requests · zero console errors /
//   CSP violations · exactly one h1 · every input labelled · keyboard focus
//   visible · text contrast ≥ 4.5:1 from computed colours · honeypot hidden
//   from sight, keyboard and the accessibility tree · both forms (JS + no-JS).
// Screenshots: ~/.hermes/cache/scratch/rig-qa/
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, extname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { Readable } from "node:stream";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(homedir(), ".hermes/cache/scratch/rig-qa");
const PW = process.env.PLAYWRIGHT_MODULE || "/home/min/dev/soren-jrpg/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(PW).href);
const { handle } = await import(pathToFileURL(join(ROOT, "functions/api/enquiry.js")).href);
const { parseHeaders, parseCsp, REQUIRED_CSP, headersForUrl } = await import(pathToFileURL(join(ROOT, "tests/lib/rules.mjs")).href);

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
const PAGES = [
  ["home", "/"],
  ["about", "/about.html"],
  ["partners", "/partners.html"],
  ["privacy", "/privacy.html"],
  ["disclaimer", "/disclaimer.html"],
  ["thanks", "/thanks.html"],
  ["enquiry-error", "/enquiry-error.html"],
  ["enquiry-too-long", "/enquiry-too-long.html"],
  ["404", "/no/such/page"],
];
const STUBS = [
  ["/services.html", "/index.html#regenerative-medicine"],
  ["/process.html", "/index.html#journey"],
  ["/network.html", "/partners.html"],
  ["/team.html", "/about.html#leadership"],
  ["/contact.html", "/index.html#enquire"],
];
const MIN_CONTRAST = 4.5;

// ---------------------------------------------------------------- results
let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}


// A wait that times out is a recorded failure, not a crash that skips every later check.
async function waitOrFail(name, fn) {
  try { await fn(); return true; } catch (e) { return check(name, false, String(e.message || e).split("\n")[0]); }
}

// ---------------------------------------------------------------- server
const headerRules = parseHeaders(readFileSync(join(ROOT, "_headers"), "utf8"));
const siteCsp = (headerRules.find((r) => r.pattern === "/*") || { headers: {} }).headers["content-security-policy"];
// Same matcher as tests/headers.test.mjs: path rules apply to every host; absolute-URL rules
// (the R1 pages.dev noindex rule) only to their host, so they never apply to this local origin.
const headersFor = (url) => headersForUrl(headerRules, url);
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".mp4": "video/mp4", ".webm": "video/webm", ".ico": "image/x-icon",
};
// Like Cloudflare Pages: "/" → index.html, "/about" → about.html, unknown → 404.html (status 404).
function resolveFile(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith("/")) p += "index.html";
  const safe = normalize(p).replace(/^(\.\.[/\\])+/, "");
  const parts = safe.split("/").filter(Boolean);
  if (parts.some((s) => s.startsWith(".") || s.startsWith("_")) || ["functions", "tests", "scripts", "docs"].includes(parts[0])) return null;
  for (const cand of [safe, `${safe}.html`]) {
    const f = join(ROOT, cand);
    if (f.startsWith(ROOT) && existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const upstream = { status: 200, calls: [] };
const fakeResend = async (url, init) => {
  upstream.calls.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: "qa" }), { status: upstream.status });
};
const apiHits = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/enquiry" && req.method === "POST") {
      // Real Pages Function, fake Resend: delivery is mocked, everything else is live.
      const request = new Request(url, {
        method: "POST", headers: req.headers, body: Readable.toWeb(req), duplex: "half",
      });
      const origLog = console.log;
      console.log = () => {};
      let response;
      try {
        response = await handle(request, {
          RESEND_API_KEY: "re_qa_fake", MAIL_TO: "info@regenig.com", MAIL_FROM: "Website <website@send.regenig.com>",
          ALLOWED_ORIGINS: ORIGIN, RESEND_API_URL: "http://resend.invalid/emails",
        }, fakeResend);
      } finally { console.log = origLog; }
      apiHits.push({ status: response.status, accept: req.headers.accept || "" });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = resolveFile(url.pathname);
    const status = file ? 200 : 404;
    const served = file || join(ROOT, "404.html");
    res.writeHead(status, { "content-type": MIME[extname(served)] || "application/octet-stream", ...headersFor(url.href) });
    res.end(req.method === "HEAD" ? undefined : readFileSync(served));
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- in-page probes
const INIT = () => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    window.__csp.push(`${e.violatedDirective} ${e.blockedURI || ""} ${e.sourceFile || ""}:${e.lineNumber || ""}`);
  });
};

function pageProbe(minContrast) {
  const parse = (c) => {
    let m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
    if (!m) m = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/);
    if (!m) return null;
    const scale = c.startsWith("color(") ? 255 : 1;
    let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [m[1] * scale, m[2] * scale, m[3] * scale, a];
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
  };
  const lum = (rgb) => {
    const ch = rgb.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  const out = {};
  out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.h1 = document.querySelectorAll("h1").length;
  out.unlabelled = [...document.querySelectorAll("input, textarea, select")]
    .filter((el) => el.type !== "hidden")
    .filter((el) => !(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
    .map((el) => el.id || el.name);
  out.styleAttrs = [...document.querySelectorAll("[style]")].map((el) => el.tagName + "." + el.className);

  // contrast: every element with its own text, in <main> and the footer
  const low = [];
  let measured = 0, skipped = 0;
  for (const el of document.querySelectorAll("main *, footer *")) {
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText || !visible(el)) continue;
    if (el.closest("[aria-hidden=true]")) continue;
    // Text set over photography (.hero-media) has no single computed background.
    const heroSection = el.closest(".hero, .page-hero");
    if (heroSection && heroSection.querySelector(".hero-media")) { skipped++; continue; }
    const fg = parse(getComputedStyle(el).color);
    if (!fg) continue;
    const bg = bgOf(el);
    const fgFlat = over(fg, bg);
    const L1 = lum(fgFlat), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    measured++;
    if (ratio < minContrast) {
      low.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
    }
  }
  out.contrast = { measured, skipped, low };

  // honeypot
  out.honeypots = [...document.querySelectorAll("input[name=website]")].map((el) => {
    const wrap = el.closest("[aria-hidden=true]");
    const box = (wrap || el).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const clipped = wrap ? getComputedStyle(wrap).overflow === "hidden" : false;
    return { tabindex: el.tabIndex, ariaHidden: !!wrap, area: Math.min(box.width * box.height, r.width * r.height), clipped, autocomplete: el.autocomplete };
  });
  return out;
}

// ---------------------------------------------------------------- run
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();

async function openPage(context, path) {
  const page = await context.newPage();
  const log = { requests: [], console: [], pageErrors: [] };
  page.on("request", (r) => log.requests.push(r.url()));
  page.on("console", (m) => { if (m.type() === "error" || /Content Security Policy/i.test(m.text())) log.console.push(m.text()); });
  page.on("pageerror", (e) => log.pageErrors.push(String(e)));
  const response = await page.goto(ORIGIN + path, { waitUntil: "load" });
  return { page, log, response };
}

function foreign(requests) {
  return requests.filter((u) => !u.startsWith(ORIGIN + "/") && !u.startsWith("data:"));
}

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  await context.addInitScript(INIT);
  const tag = `${vp.width}`;

  for (const [name, path] of PAGES) {
    const { page, log, response } = await openPage(context, path);
    const id = `${name}@${tag}`;
    const expectStatus = name === "404" ? 404 : 200;
    check(`${id}: HTTP ${expectStatus}`, response.status() === expectStatus, String(response.status()));
    check(`${id}: CSP header served`, response.headers()["content-security-policy"] === siteCsp && !!siteCsp);
    check(`${id}: no X-Robots-Tag (site stays indexable off pages.dev)`, !("x-robots-tag" in response.headers()), response.headers()["x-robots-tag"]);

    // scroll through so lazy images load and any late errors surface
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState("networkidle");

    const probe = await page.evaluate(pageProbe, MIN_CONTRAST);
    check(`${id}: no horizontal overflow`, probe.overflow <= 0, `${probe.overflow}px`);
    check(`${id}: exactly one h1`, probe.h1 === 1, String(probe.h1));
    check(`${id}: every input labelled`, probe.unlabelled.length === 0, probe.unlabelled.join(", "));
    check(`${id}: no style attributes in the DOM`, probe.styleAttrs.length === 0, probe.styleAttrs.join(", "));
    check(`${id}: contrast ≥ ${MIN_CONTRAST}:1 (${probe.contrast.measured} text elements)`, probe.contrast.low.length === 0 && probe.contrast.measured > 5,
      probe.contrast.low.slice(0, 6).join(" | "));
    const ext = foreign(log.requests);
    check(`${id}: zero third-party requests`, ext.length === 0, ext.slice(0, 5).join(", "));
    const csp = await page.evaluate(() => window.__csp);
    check(`${id}: zero CSP violations`, csp.length === 0, csp.join(" | "));
    // The 404 document itself is reported by Chromium as a failed resource; nothing else may be.
    const errors = log.console.filter((t) => !(name === "404" && /status of 404/.test(t) && log.console.filter((x) => /status of 404/.test(x)).length === 1));
    check(`${id}: zero console errors`, errors.length === 0 && log.pageErrors.length === 0, [...errors, ...log.pageErrors].join(" | "));
    for (const hp of probe.honeypots) {
      check(`${id}: honeypot out of tab order / AT / sight`, hp.tabindex === -1 && hp.ariaHidden && hp.clipped && hp.area <= 1 && hp.autocomplete === "off", JSON.stringify(hp));
    }
    if (probe.honeypots.length) {
      const snap = await page.locator("form").ariaSnapshot();
      check(`${id}: honeypot absent from accessibility tree`, !/Leave this field empty|website/i.test(snap));
    }

    // keyboard focus: tab through every stop; links/buttons need a visible outline
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    const bad = [], badControls = [], controlsSeen = new Set();
    let stops = 0, hpFocused = false, firstKey = null;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(async () => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        // measure the settled focus style, not the first frame of a colour transition
        await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
        const s = getComputedStyle(el);
        let ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        if (el.id === "nav-toggle") {
          const b = getComputedStyle(document.querySelector("label[for=nav-toggle]"));
          ring = b.outlineStyle !== "none" && parseFloat(b.outlineWidth) > 0;
        }
        // form controls: a ≥2px outline, or a ≥2px underline in the brand gold
        let control = null;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && el.type !== "hidden" && el.id !== "nav-toggle") {
          const hex = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim();
          const gold = `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
          const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
          const underline = s.borderBottomStyle !== "none" && parseFloat(s.borderBottomWidth) >= 2 && s.borderBottomColor === gold;
          control = { ok: outline || underline, desc: `${el.type || el.tagName.toLowerCase()} outline=${s.outlineStyle}/${s.outlineWidth} under=${s.borderBottomWidth}/${s.borderBottomColor}` };
        }
        return { tag: el.tagName, id: el.id, name: el.name || "", text: (el.textContent || "").trim().slice(0, 24), ring, control, key: el.outerHTML.slice(0, 80) };
      });
      if (!f) break;
      if (f.name === "website") hpFocused = true;
      if (firstKey === null) firstKey = f.key;
      else if (f.key === firstKey) break; // wrapped around
      stops++;
      if ((["A", "BUTTON"].includes(f.tag) || f.id === "nav-toggle") && !f.ring) bad.push(`${f.tag} "${f.text || f.id}"`);
      if (f.control) { controlsSeen.add(f.id || f.name); if (!f.control.ok) badControls.push(`#${f.id} ${f.control.desc}`); }
    }
    check(`${id}: focus visible on links/buttons (${stops} tab stops)`, bad.length === 0 && stops > 3, bad.slice(0, 5).join(", "));
    // every visible form control must be reached by Tab and show a ≥2px focus indicator
    const controls = await page.evaluate(() => [...document.querySelectorAll("input, textarea, select")]
      .filter((el) => el.type !== "hidden" && el.id !== "nav-toggle" && el.tabIndex >= 0 && !el.closest("[aria-hidden=true]")).map((el) => el.id || el.name));
    if (controls.length) {
      const missed = controls.filter((c) => !controlsSeen.has(c));
      check(`${id}: Tab reaches every form control (${controls.length})`, missed.length === 0, missed.join(", "));
      check(`${id}: focus visible (≥2px) on inputs/textarea/checkbox`, badControls.length === 0 && controlsSeen.size >= controls.length, badControls.slice(0, 5).join(" | "));
    }
    check(`${id}: honeypot never receives keyboard focus`, !hpFocused);
    // review C2-5 (X8): the 2px focus underline must not move anything (padding gives back the extra px)
    if (controls.length) {
      const shifts = await page.evaluate(async () => {
        const settle = (el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
        const out = [];
        for (const el of document.querySelectorAll(".field input, .field textarea")) {
          if (el.closest("[aria-hidden=true]")) continue;
          const field = el.closest(".field"), next = field.nextElementSibling;
          const measure = () => [el.getBoundingClientRect().height, next ? next.getBoundingClientRect().top - field.getBoundingClientRect().top : 0];
          el.blur(); await settle(el);
          const rest = measure();
          el.focus({ preventScroll: true }); await settle(el);
          const focused = measure();
          el.blur();
          if (Math.abs(rest[0] - focused[0]) > 0.01 || Math.abs(rest[1] - focused[1]) > 0.01) out.push(`#${el.id} h ${rest[0]}→${focused[0]} next ${rest[1]}→${focused[1]}`);
        }
        return out;
      });
      check(`${id}: focusing a field moves nothing (height + next field unchanged)`, shifts.length === 0, shifts.slice(0, 3).join(" | "));
    }

    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo({ top: 0, behavior: "instant" }); });
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(SHOTS, `${name}-${tag}.png`), fullPage: true });
    await page.close();
  }

  // mobile menu must be operable from the keyboard
  if (vp.width < 860) {
    const { page } = await openPage(context, "/about.html");
    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement && document.activeElement.id === "nav-toggle");
    }
    if (check(`menu@${tag}: burger reachable by keyboard`, reached)) {
      await page.keyboard.press("Space");
      const open = await page.evaluate(() => getComputedStyle(document.querySelector(".nav-menu")).display !== "none");
      check(`menu@${tag}: Space opens the menu`, open);
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".nav-menu")).backgroundColor);
      check(`menu@${tag}: open menu is opaque (page text must not show through)`, /^rgb\(/.test(bg), bg);
      await page.keyboard.press("Tab");
      const inMenu = await page.evaluate(() => !!document.activeElement.closest(".nav-menu"));
      check(`menu@${tag}: focus moves into the menu`, inMenu);
      await page.screenshot({ path: join(SHOTS, `menu-open-${tag}.png`) });
    }
    await page.close();
  }

  // forms, JS path: real function + fake Resend
  const forms = [
    ["/", "pe", { name: "QA Patient", email: "qa.patient@example.com", wa: "+60 12 000 0000", msg: "QA test enquiry." }, "private-enquiry"],
    ["/partners.html", "pf", { name: "QA Partner", pos: "Director", org: "QA Clinic", country: "Malaysia", email: "qa.partner@example.com", msg: "QA partner enquiry." }, "partner-enquiry"],
  ];
  for (const [path, prefix, fields, type] of forms) {
    const id = `${type}@${tag}`;
    const { page, log } = await openPage(context, path);
    const status = page.locator("form .form-status");

    // empty submit: stays client-side, no request
    const before = apiHits.length;
    await page.locator("form button[type=submit]").click();
    await page.waitForTimeout(150);
    check(`${id}: empty submit asks for required fields`, /required fields/i.test(await status.textContent()));
    check(`${id}: empty submit sends nothing`, apiHits.length === before);

    for (const [k, v] of Object.entries(fields)) await page.fill(`#${prefix}-${k}`, v);
    await page.check(`#${prefix}-consent`);
    upstream.status = 200;
    const sent = upstream.calls.length;
    await page.locator("form button[type=submit]").click();
    await waitOrFail(`${id}: JS submit settles within 5 s`, () => page.waitForFunction(() => /Thank you|could not/.test(document.querySelector("form .form-status").textContent), null, { timeout: 5000 }));
    check(`${id}: JS submit shows thank-you status`, /Thank you/.test(await status.textContent()), await status.textContent());
    const mail = upstream.calls[sent];
    check(`${id}: delivered once via function`, upstream.calls.length === sent + 1 && mail && mail.reply_to === fields.email && mail.to[0] === "info@regenig.com");
    check(`${id}: request used Accept: application/json`, /application\/json/.test(apiHits[apiHits.length - 1].accept));
    check(`${id}: form reset after success`, (await page.inputValue(`#${prefix}-name`)) === "");

    // upstream failure → inline error
    for (const [k, v] of Object.entries(fields)) await page.fill(`#${prefix}-${k}`, v);
    await page.check(`#${prefix}-consent`);
    upstream.status = 500;
    await page.locator("form button[type=submit]").click();
    await waitOrFail(`${id}: upstream failure shows an error within 5 s`, () => page.waitForFunction(() => /could not/.test(document.querySelector("form .form-status").textContent), null, { timeout: 5000 }));
    check(`${id}: upstream failure shows error status`, /info@regenig\.com/.test(await status.textContent()));
    upstream.status = 200;
    check(`${id}: zero third-party requests while submitting`, foreign(log.requests).length === 0);
    // the 502 from the API is expected here; nothing else may error
    const errs = log.console.filter((t) => !/status of 502/.test(t));
    check(`${id}: no unexpected console errors`, errs.length === 0 && log.pageErrors.length === 0, errs.join(" | "));
    check(`${id}: no CSP violations`, (await page.evaluate(() => window.__csp)).length === 0);
    await page.screenshot({ path: join(SHOTS, `form-${type}-${tag}.png`) });

    // ruling R2 (review C3-1): live count, no silent truncation, over-limit submit blocked with the text kept
    {
      const msgSel = `#${prefix}-msg`;
      const num = page.locator(`#${prefix}-msg-count > span:first-child`);
      const liveText = () => page.evaluate(() => document.querySelector("form [data-count-live]").textContent);
      const settle = () => page.waitForTimeout(900); // the live region updates 700 ms after typing stops
      check(`${id}: message has no maxlength`, (await page.getAttribute(msgSel, "maxlength")) === null);
      const wiring = await page.evaluate((p) => {
        const ta = document.getElementById(`${p}-msg`), c = document.getElementById(`${p}-msg-count`);
        const l = document.querySelector("form [data-count-live]");
        if (!c || !l) return null;
        const r = c.getBoundingClientRect(), t = ta.getBoundingClientRect();
        return { described: (ta.getAttribute("aria-describedby") || "").split(/\s+/).includes(c.id), live: l.getAttribute("aria-live"),
          countLive: c.getAttribute("aria-live"), visible: r.height > 4 && r.width > 4, below: r.top >= t.bottom - 0.5 };
      }, prefix);
      check(`${id}: counter present, under the message, in its description`, !!wiring && wiring.visible && wiring.below && wiring.described, JSON.stringify(wiring));
      check(`${id}: count announced through a polite live region (the visible count itself is not live)`, !!wiring && wiring.live === "polite" && wiring.countLive === null, JSON.stringify(wiring));

      await page.fill(msgSel, "Short note.");
      await settle();
      check(`${id}: counter counts live ("11 / 5,000")`, (await num.textContent()) === "11 / 5,000", await num.textContent());
      check(`${id}: nothing announced far below the limit`, (await liveText()) === "", await liveText());
      await page.fill(msgSel, "n".repeat(4600));
      await settle();
      check(`${id}: near the limit the remaining count is announced`, (await liveText()) === "400 characters left.", await liveText());

      const long = "a".repeat(6000);
      await page.fill(msgSel, long);
      check(`${id}: a 6,000-character paste is kept whole (no silent truncation)`, (await page.inputValue(msgSel)).length === 6000, String((await page.inputValue(msgSel)).length));
      check(`${id}: counter shows "6,000 / 5,000" in the over state`, (await num.textContent()) === "6,000 / 5,000" &&
        (await page.getAttribute(`#${prefix}-msg-count`, "class")).includes("is-over") && (await page.getAttribute(msgSel, "aria-invalid")) === "true",
        await num.textContent());
      await waitOrFail(`${id}: over-limit count announced`, () => page.waitForFunction(() =>
        document.querySelector("form [data-count-live]").textContent === "Your message is 1,000 characters over the limit of 5,000.", null, { timeout: 3000 }));
      const over = await page.evaluate(pageProbe, MIN_CONTRAST);
      check(`${id}: contrast ≥ ${MIN_CONTRAST}:1 with the counter in its over state`, over.contrast.low.length === 0, over.contrast.low.slice(0, 4).join(" | "));
      check(`${id}: no overflow with the counter in its over state`, over.overflow <= 0, `${over.overflow}px`);

      for (const [k, v] of Object.entries(fields)) if (k !== "msg") await page.fill(`#${prefix}-${k}`, v);
      await page.check(`#${prefix}-consent`);
      const hits = apiHits.length, mails = upstream.calls.length;
      await page.locator("form button[type=submit]").click();
      await page.waitForTimeout(300);
      const st = await status.textContent();
      check(`${id}: over-limit submit is blocked with a clear status`, st === "Messages are limited to 5,000 characters. Please shorten yours by 1,000, or write to info@regenig.com.", st);
      check(`${id}: over-limit submit sends nothing`, apiHits.length === hits && upstream.calls.length === mails, `${apiHits.length - hits} requests`);
      check(`${id}: over-limit submit keeps the text and returns focus to it`, (await page.inputValue(msgSel)) === long &&
        (await page.evaluate(() => document.activeElement && document.activeElement.id)) === `${prefix}-msg`);
      await page.screenshot({ path: join(SHOTS, `form-${type}-over-${tag}.png`) });

      // exactly at the limit, with line breaks the browser submits as CRLF: the counter and the server agree
      const at = Array(10).fill("a".repeat(499)).join("\n") + "a";
      await page.fill(msgSel, at + "b");
      await page.locator("form button[type=submit]").click();
      await page.waitForTimeout(200);
      check(`${id}: 5,001 characters (with line breaks) are blocked "by 1"`, /shorten yours by 1,/.test(await status.textContent()) && apiHits.length === hits, await status.textContent());
      await page.fill(msgSel, at);
      check(`${id}: 5,000 characters with 9 line breaks count as "5,000 / 5,000"`, (await num.textContent()) === "5,000 / 5,000" &&
        !(await page.getAttribute(`#${prefix}-msg-count`, "class")).includes("is-over"), await num.textContent());
      await page.locator("form button[type=submit]").click();
      await waitOrFail(`${id}: at-limit submit settles within 5 s`, () => page.waitForFunction(() => /Thank you|could not|limited/.test(document.querySelector("form .form-status").textContent), null, { timeout: 5000 }));
      const atMail = upstream.calls[mails];
      check(`${id}: the server accepts what the counter allows (delivered once, message whole)`, /Thank you/.test(await status.textContent()) &&
        upstream.calls.length === mails + 1 && !!atMail && atMail.text.endsWith(at), await status.textContent());
      await page.waitForTimeout(50);
      check(`${id}: counter back to "0 / 5,000" after the form resets`, (await num.textContent()) === "0 / 5,000", await num.textContent());
      check(`${id}: no CSP violations or errors around the counter`, (await page.evaluate(() => window.__csp)).length === 0 && log.pageErrors.length === 0, log.pageErrors.join(" | "));
    }
    await page.close();
  }

  // v1 stubs land on their new homes
  for (const [from, to] of STUBS) {
    const { page } = await openPage(context, from);
    await page.waitForURL((u) => u.pathname + u.hash === to, { timeout: 5000 }).catch(() => {});
    const now = new URL(page.url());
    check(`stub ${from}@${tag} → ${to}`, now.pathname + now.hash === to, now.pathname + now.hash);
    await page.close();
  }
  await context.close();
}

// forms, no-JS path: plain POST → 303 → thanks / error page
{
  const context = await browser.newContext({ viewport: VIEWPORTS[0], javaScriptEnabled: false, reducedMotion: "reduce" });
  for (const [mode, expect] of [[200, "/thanks.html"], [500, "/enquiry-error.html"]]) {
    const page = await context.newPage();
    const ext = [];
    page.on("request", (r) => ext.push(r.url()));
    await page.goto(ORIGIN + "/partners.html");
    for (const [k, v] of Object.entries({ name: "NoJS", pos: "Lead", org: "NoJS Org", country: "Japan", email: "nojs@example.com", msg: "No JS." })) {
      await page.fill(`#pf-${k}`, v);
    }
    await page.check("#pf-consent");
    upstream.status = mode;
    await Promise.all([page.waitForURL(`**${expect}`, { timeout: 5000 }).catch(() => {}), page.click("form button[type=submit]")]);
    check(`no-JS partner submit (upstream ${mode}) → ${expect}`, new URL(page.url()).pathname === expect, page.url());
    check(`no-JS partner submit (upstream ${mode}): no third-party requests`, foreign(ext).length === 0);
    await page.close();
  }
  // ruling R2: without JS an over-long message is not cut off; the server refuses it and the page names the limit
  {
    const page = await context.newPage();
    await page.goto(ORIGIN + "/partners.html");
    for (const [k, v] of Object.entries({ name: "NoJS", pos: "Lead", org: "NoJS Org", country: "Japan", email: "nojs@example.com", msg: "b".repeat(6000) })) {
      await page.fill(`#pf-${k}`, v);
    }
    await page.check("#pf-consent");
    check("no-JS: a 6,000-character message is kept whole", (await page.inputValue("#pf-msg")).length === 6000);
    const sent = upstream.calls.length;
    upstream.status = 200;
    await Promise.all([page.waitForURL("**/enquiry-too-long.html", { timeout: 5000 }).catch(() => {}), page.click("form button[type=submit]")]);
    check("no-JS over-limit submit → /enquiry-too-long.html", new URL(page.url()).pathname === "/enquiry-too-long.html", page.url());
    check("no-JS over-limit submit: refused by the server (303 to the limit page), nothing delivered", upstream.calls.length === sent && apiHits[apiHits.length - 1].status === 303);
    const body = await page.locator("main").innerText();
    check("no-JS too-long page says messages are limited to 5,000 characters", /Messages are limited to 5,000 characters/.test(body), body.slice(0, 120));
    check("no-JS too-long page offers info@regenig.com", (await page.locator('main a[href="mailto:info@regenig.com"]').count()) === 1);
    await page.screenshot({ path: join(SHOTS, "nojs-too-long-390.png"), fullPage: true });
    await page.close();
  }
  // missing consent without JS → error page, nothing delivered
  const page = await context.newPage();
  await page.goto(ORIGIN + "/");
  await page.fill("#pe-name", "NoJS"); await page.fill("#pe-email", "nojs@example.com"); await page.fill("#pe-msg", "Hi");
  const sent = upstream.calls.length;
  upstream.status = 200;
  await Promise.all([page.waitForURL("**/enquiry-error.html", { timeout: 5000 }).catch(() => {}), page.click("form button[type=submit]")]);
  check("no-JS private submit without consent → /enquiry-error.html", new URL(page.url()).pathname === "/enquiry-error.html", page.url());
  check("no-JS private submit without consent: nothing delivered", upstream.calls.length === sent);
  await context.close();
}

// the policy QA served is the required one (removing it from _headers must fail QA too)
{
  let ok = false;
  try {
    const csp = parseCsp(siteCsp || "");
    ok = Object.entries(REQUIRED_CSP).every(([d, v]) => JSON.stringify(csp[d]) === JSON.stringify(v));
  } catch { ok = false; }
  check("_headers CSP is the required strict policy", ok, siteCsp || "(missing)");
}

await browser.close();
server.close();

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`qa: ${passed} passed, ${failures.length} failed · ${PAGES.length} pages × ${VIEWPORTS.length} viewports · screenshots in ${SHOTS}`);
process.exit(failures.length ? 1 : 0);
