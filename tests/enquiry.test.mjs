// Unit tests for functions/api/enquiry.js. Run: node --test tests/
// Never touches the network: every test injects a fake fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, onRequestPost, MAX_BODY_BYTES, HONEYPOT_FIELD } from "../functions/api/enquiry.js";

// The function's single outcome line per request is noise here; tests that
// inspect logging install their own capture.
console.log = () => {};

const ORIGIN = "https://regenig.com";
const ENV = Object.freeze({
  RESEND_API_KEY: "re_test_key",
  MAIL_TO: "info@regenig.com",
  MAIL_FROM: "Regenesis Website <website@send.regenig.com>",
  ALLOWED_ORIGINS: "https://regenig.com, https://www.regenig.com",
  RESEND_API_URL: "http://resend.invalid/emails",
});

const PRIVATE = Object.freeze({
  form: "private-enquiry",
  name: "Aisha Rahman",
  email: "aisha.rahman@example.com",
  whatsapp: "+60 12-345 6789",
  message: "I would like to learn about a consultation in Tokyo next spring.",
  consent: "yes",
  [HONEYPOT_FIELD]: "",
});

const PARTNER = Object.freeze({
  form: "partner-enquiry",
  name: "Dr Tan Wei Ming",
  position: "Medical Director",
  organisation: "Harbourview Clinic",
  country: "Singapore",
  email: "tan.weiming@harbourview.example",
  message: "We would like to discuss a referral partnership.",
  consent: "yes",
  [HONEYPOT_FIELD]: "",
});

function fakeFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: "test" }), { status });
  };
  fn.calls = calls;
  return fn;
}

function formRequest(fields, { json = true, origin = ORIGIN, referer, headers = {}, encoding = "multipart" } = {}) {
  const h = new Headers(headers);
  if (json) h.set("accept", "application/json");
  else h.set("accept", "text/html,application/xhtml+xml");
  if (origin !== undefined && origin !== null) h.set("origin", origin);
  if (referer) h.set("referer", referer);
  let body;
  if (encoding === "multipart") {
    // Serialised by hand (as a browser would send it): undici's lazy FormData
    // stream throws asynchronously when a body is rejected unread.
    const boundary = "----rigtestboundary7MA4YWxkTrZu0gW";
    body = Object.entries(fields)
      .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
      .join("") + `--${boundary}--\r\n`;
    h.set("content-type", `multipart/form-data; boundary=${boundary}`);
  } else {
    body = new URLSearchParams(fields).toString();
    h.set("content-type", "application/x-www-form-urlencoded");
  }
  return new Request(`${ORIGIN}/api/enquiry`, { method: "POST", headers: h, body });
}

async function json(res) { return JSON.parse(await res.text()); }

// ---------- happy paths ----------

test("valid private enquiry is sent to Resend and returns {ok:true}", async () => {
  const f = fakeFetch();
  const res = await handle(formRequest(PRIVATE), ENV, f);
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true });
  assert.equal(f.calls.length, 1);
  const { url, init, body } = f.calls[0];
  assert.equal(url, ENV.RESEND_API_URL);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer re_test_key");
  assert.deepEqual(body.to, ["info@regenig.com"]);
  assert.equal(body.from, ENV.MAIL_FROM);
  assert.equal(body.reply_to, PRIVATE.email);
  assert.equal(body.subject, "[Website] Private enquiry — Aisha Rahman");
  assert.match(body.text, /WhatsApp: \+60 12-345 6789/);
  assert.match(body.text, /I would like to learn about a consultation/);
  assert.equal(body.html, undefined, "plain-text body only");
});

test("valid partner enquiry uses the organisation in the subject", async () => {
  const f = fakeFetch();
  const res = await handle(formRequest(PARTNER), ENV, f);
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true });
  const { body } = f.calls[0];
  assert.equal(body.subject, "[Website] Partner enquiry — Harbourview Clinic");
  assert.equal(body.reply_to, PARTNER.email);
  for (const v of ["Medical Director", "Harbourview Clinic", "Singapore", "Dr Tan Wei Ming"]) assert.ok(body.text.includes(v), v);
});

test("url-encoded bodies (no-JS browsers) are accepted", async () => {
  const f = fakeFetch();
  const res = await handle(formRequest(PRIVATE, { encoding: "urlencoded" }), ENV, f);
  assert.equal(res.status, 200);
  assert.equal(f.calls.length, 1);
});

test("Referer is used when Origin is absent", async () => {
  const f = fakeFetch();
  const res = await handle(formRequest(PRIVATE, { origin: null, referer: "https://www.regenig.com/index.html" }), ENV, f);
  assert.equal(res.status, 200);
});

test("onRequestPost wires context.request and context.env", async () => {
  // No RESEND key in env → 503 without touching the network.
  const res = await onRequestPost({ request: formRequest(PRIVATE), env: {} });
  assert.equal(res.status, 503);
});

// ---------- validation ----------

test("missing consent → 400, nothing sent", async () => {
  const f = fakeFetch();
  const { consent, ...rest } = PRIVATE;
  const res = await handle(formRequest(rest), ENV, f);
  assert.equal(res.status, 400);
  assert.deepEqual(await json(res), { ok: false, error: "invalid" });
  assert.equal(f.calls.length, 0);
  const res2 = await handle(formRequest({ ...PARTNER, consent: "no" }), ENV, f);
  assert.equal(res2.status, 400);
  assert.equal(f.calls.length, 0);
});

test("every required field is enforced for each form", async () => {
  const required = {
    "private-enquiry": [PRIVATE, ["name", "email", "message"]],
    "partner-enquiry": [PARTNER, ["name", "position", "organisation", "country", "email", "message"]],
  };
  for (const [, [base, fields]] of Object.entries(required)) {
    for (const field of fields) {
      const f = fakeFetch();
      const res = await handle(formRequest({ ...base, [field]: "   " }), ENV, f);
      assert.equal(res.status, 400, `${base.form} without ${field}`);
      assert.equal(f.calls.length, 0);
    }
  }
});

test("bad email shape → 400", async () => {
  for (const email of ["not-an-email", "a@b", "a b@example.com", "a@example.com\r\nbcc: x@evil.test", "<a@example.com>"]) {
    const f = fakeFetch();
    const res = await handle(formRequest({ ...PRIVATE, email }), ENV, f);
    assert.equal(res.status, 400, email);
    assert.equal(f.calls.length, 0);
  }
});

test("field length caps → 400", async () => {
  const cases = [["name", 201], ["email", 255], ["whatsapp", 41], ["message", 5001]];
  for (const [field, n] of cases) {
    const f = fakeFetch();
    let value = "x".repeat(n);
    if (field === "email") value = "x".repeat(n - "@example.com".length) + "@example.com";
    const res = await handle(formRequest({ ...PRIVATE, [field]: value }), ENV, f);
    assert.equal(res.status, 400, field);
    assert.equal(f.calls.length, 0);
  }
  for (const field of ["position", "organisation", "country"]) {
    const f = fakeFetch();
    const res = await handle(formRequest({ ...PARTNER, [field]: "y".repeat(201) }), ENV, f);
    assert.equal(res.status, 400, field);
  }
  // exactly at the cap is fine
  const ok = await handle(formRequest({ ...PRIVATE, message: "m".repeat(5000), name: "n".repeat(200) }), ENV, fakeFetch());
  assert.equal(ok.status, 200);
});

test("unknown or missing form type → 400", async () => {
  for (const form of ["newsletter", "", "__proto__", "constructor"]) {
    const f = fakeFetch();
    const res = await handle(formRequest({ ...PRIVATE, form }), ENV, f);
    assert.equal(res.status, 400, JSON.stringify(form));
    assert.equal(f.calls.length, 0);
  }
  const { form, ...noForm } = PRIVATE;
  assert.equal((await handle(formRequest(noForm), ENV, fakeFetch())).status, 400);
});

test("JSON request bodies and other content types are refused", async () => {
  const f = fakeFetch();
  const req = new Request(`${ORIGIN}/api/enquiry`, {
    method: "POST",
    headers: { origin: ORIGIN, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(PRIVATE),
  });
  const res = await handle(req, ENV, f);
  assert.equal(res.status, 400);
  assert.equal(f.calls.length, 0);
});

// ---------- spam guards ----------

test("honeypot filled → pretend success, send nothing", async () => {
  const f = fakeFetch();
  const res = await handle(formRequest({ ...PRIVATE, [HONEYPOT_FIELD]: "https://spam.example" }), ENV, f);
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true });
  assert.equal(f.calls.length, 0);
  const noJs = await handle(formRequest({ ...PARTNER, [HONEYPOT_FIELD]: "x" }, { json: false }), ENV, f);
  assert.equal(noJs.status, 303);
  assert.equal(noJs.headers.get("location"), "/thanks.html");
  assert.equal(f.calls.length, 0);
});

test("bad origin → 403 (missing, null, look-alike, http, other site)", async () => {
  const bad = [
    { origin: "https://evil.example" },
    { origin: "https://regenig.com.evil.example" },
    { origin: "https://evilregenig.com" },
    { origin: "http://regenig.com" },
    { origin: "null", referer: "https://regenig.com/" },
    { origin: null },
    { origin: null, referer: "https://evil.example/regenig.com" },
    { origin: null, referer: "not a url" },
  ];
  for (const opts of bad) {
    const f = fakeFetch();
    const res = await handle(formRequest(PRIVATE, opts), ENV, f);
    assert.equal(res.status, 403, JSON.stringify(opts));
    assert.deepEqual(await json(res), { ok: false, error: "forbidden" });
    assert.equal(f.calls.length, 0);
  }
});

test("oversize body → 413 (declared length and streamed without length)", async () => {
  const f = fakeFetch();
  const big = { ...PRIVATE, message: "z".repeat(MAX_BODY_BYTES + 10) };
  const res = await handle(formRequest(big), ENV, f);
  assert.equal(res.status, 413);
  assert.deepEqual(await json(res), { ok: false, error: "too_large" });

  // chunked: no content-length header, body arrives as a stream
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    i: 0,
    pull(c) { if (this.i++ < 40) c.enqueue(enc.encode("message=" + "q".repeat(1024) + "&")); else c.close(); },
  });
  const req = new Request(`${ORIGIN}/api/enquiry`, {
    method: "POST", body: stream, duplex: "half",
    headers: { origin: ORIGIN, accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(req.headers.get("content-length"), null);
  const res2 = await handle(req, ENV, f);
  assert.equal(res2.status, 413);

  // a lying small content-length does not help either
  const req3 = new Request(`${ORIGIN}/api/enquiry`, {
    method: "POST", body: new URLSearchParams(big).toString(),
    headers: { origin: ORIGIN, accept: "application/json", "content-type": "application/x-www-form-urlencoded", "content-length": "10" },
  });
  const res3 = await handle(req3, ENV, f);
  assert.equal(res3.status, 413);
  assert.equal(f.calls.length, 0);
});

// ---------- header injection ----------

test("CR/LF in name/organisation is stripped from subject and fields", async () => {
  const f = fakeFetch();
  const res = await handle(formRequest({ ...PRIVATE, name: "Eve\r\nBcc: victim@example.com\nX-Evil: 1" }), ENV, f);
  assert.equal(res.status, 200);
  const { body } = f.calls[0];
  assert.doesNotMatch(body.subject, /[\r\n]/);
  assert.equal(body.subject, "[Website] Private enquiry — Eve Bcc: victim@example.com X-Evil: 1");
  assert.doesNotMatch(body.reply_to, /[\r\n]/);
  assert.doesNotMatch(body.from, /[\r\n]/);
  assert.ok(body.text.includes("Name: Eve Bcc: victim@example.com X-Evil: 1"));

  const f2 = fakeFetch();
  await handle(formRequest({ ...PARTNER, organisation: "Acme\r\n\r\nInjected body", name: "A\rB" }), ENV, f2);
  assert.equal(f2.calls[0].body.subject, "[Website] Partner enquiry — Acme Injected body");
  assert.ok(f2.calls[0].body.text.includes("Name: A B"));
});

test("C1 controls (NEL U+0085 etc.), DEL and U+2028/2029 are stripped from header-bound values", async () => {
  const f = fakeFetch();
  const name = "Ann\u0085Bcc: x@evil.io\u0080A\u009fB\u007fC\u2028D\u2029E";
  const res = await handle(formRequest({ ...PRIVATE, name }, { encoding: "urlencoded" }), ENV, f);
  assert.equal(res.status, 200);
  const { body } = f.calls[0];
  assert.doesNotMatch(body.subject, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  assert.equal(body.subject, "[Website] Private enquiry — Ann Bcc: x@evil.io A B C D E");
  assert.ok(body.text.includes("Name: Ann Bcc: x@evil.io A B C D E"));
});

test("log line never echoes an unknown form type, including Object.prototype keys", async () => {
  for (const form of ["__proto__", "toString", "constructor", "hasOwnProperty", "nope"]) {
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(" "));
    let res;
    try { res = await handle(formRequest({ ...PRIVATE, form }), ENV, fakeFetch()); } finally { console.log = orig; }
    assert.equal(res.status, 400, form);
    assert.equal(lines.length, 1, form);
    assert.deepEqual(JSON.parse(lines[0]), { fn: "enquiry", form: "unknown", outcome: "unknown_form", status: 400 }, form);
  }
});

// ---------- upstream + config ----------

test("upstream 500 → 502", async () => {
  const f = fakeFetch(500);
  const res = await handle(formRequest(PRIVATE), ENV, f);
  assert.equal(res.status, 502);
  assert.deepEqual(await json(res), { ok: false, error: "delivery_failed" });
  assert.equal(f.calls.length, 1);
});

test("upstream unreachable (fetch throws) → 502", async () => {
  const res = await handle(formRequest(PRIVATE), ENV, async () => { throw new Error("ECONNREFUSED"); });
  assert.equal(res.status, 502);
});

test("missing config → 503 and logs config_missing", async () => {
  for (const missing of ["RESEND_API_KEY", "MAIL_TO", "MAIL_FROM", "ALLOWED_ORIGINS"]) {
    const env = { ...ENV, [missing]: "" };
    const f = fakeFetch();
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(" "));
    let res;
    try { res = await handle(formRequest(PRIVATE), env, f); } finally { console.log = orig; }
    assert.equal(res.status, 503, missing);
    assert.deepEqual(await json(res), { ok: false, error: "unavailable" });
    assert.ok(lines.some((l) => l.includes("config_missing")), missing);
    assert.equal(f.calls.length, 0);
  }
});

test("default Resend URL is used when RESEND_API_URL is not set", async () => {
  const f = fakeFetch();
  const { RESEND_API_URL, ...env } = ENV;
  await handle(formRequest(PRIVATE), env, f);
  assert.equal(f.calls[0].url, "https://api.resend.com/emails");
});

// ---------- no-JS paths ----------

test("no-JS success → 303 /thanks.html", async () => {
  const res = await handle(formRequest(PRIVATE, { json: false, encoding: "urlencoded" }), ENV, fakeFetch());
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/thanks.html");
});

test("no-JS failures → 303 /enquiry-error.html", async () => {
  const cases = [
    [formRequest({ ...PRIVATE, consent: "" }, { json: false }), ENV, fakeFetch()],
    [formRequest(PRIVATE, { json: false, origin: "https://evil.example" }), ENV, fakeFetch()],
    [formRequest(PRIVATE, { json: false }), ENV, fakeFetch(500)],
    [formRequest(PRIVATE, { json: false }), { ...ENV, RESEND_API_KEY: "" }, fakeFetch()],
    [formRequest({ ...PRIVATE, message: "z".repeat(MAX_BODY_BYTES) }, { json: false }), ENV, fakeFetch()],
  ];
  for (const [req, env, f] of cases) {
    const res = await handle(req, env, f);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/enquiry-error.html");
  }
});

// ---------- privacy ----------

test("no PII is ever logged (console capture across every path)", async () => {
  const captured = [];
  const methods = ["log", "info", "warn", "error", "debug", "trace"];
  const originals = Object.fromEntries(methods.map((m) => [m, console[m]]));
  for (const m of methods) console[m] = (...args) => captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  const IP = "203.0.113.77";
  const ipHeaders = { "cf-connecting-ip": IP, "x-forwarded-for": IP, "x-real-ip": IP };
  try {
    const runs = [
      [formRequest(PRIVATE, { headers: ipHeaders }), ENV, fakeFetch()],
      [formRequest(PARTNER, { headers: ipHeaders }), ENV, fakeFetch()],
      [formRequest({ ...PRIVATE, consent: "" }, { headers: ipHeaders }), ENV, fakeFetch()],
      [formRequest({ ...PRIVATE, email: "aisha.rahman@" }, { headers: ipHeaders }), ENV, fakeFetch()],
      [formRequest({ ...PRIVATE, [HONEYPOT_FIELD]: "x" }, { headers: ipHeaders }), ENV, fakeFetch()],
      [formRequest(PRIVATE, { headers: ipHeaders, origin: "https://evil.example" }), ENV, fakeFetch()],
      [formRequest(PRIVATE, { headers: ipHeaders }), ENV, fakeFetch(500)],
      [formRequest(PRIVATE, { headers: ipHeaders }), ENV, async () => { throw new Error(`down ${PRIVATE.email}`); }],
      [formRequest(PRIVATE, { headers: ipHeaders }), { ...ENV, MAIL_TO: "" }, fakeFetch()],
      [formRequest({ ...PRIVATE, form: PRIVATE.email }, { headers: ipHeaders }), ENV, fakeFetch()],
      [formRequest({ ...PRIVATE, message: "z".repeat(MAX_BODY_BYTES) + PRIVATE.name }, { headers: ipHeaders }), ENV, fakeFetch()],
      [formRequest({ ...PARTNER, name: "Eve\r\nBcc: x" }, { headers: ipHeaders }), ENV, fakeFetch()],
    ];
    for (const [req, env, f] of runs) await handle(req, env, f);
  } finally {
    for (const m of methods) console[m] = originals[m];
  }
  assert.ok(captured.length >= 12, "every request logs exactly its outcome line");
  const pii = [
    PRIVATE.name, "Aisha", PRIVATE.email, "aisha.rahman", PRIVATE.whatsapp, "345 6789", PRIVATE.message.slice(0, 20),
    PARTNER.name, PARTNER.email, PARTNER.organisation, PARTNER.position, PARTNER.message.slice(0, 20), "Eve",
    IP, "re_test_key",
  ];
  const all = captured.join("\n");
  for (const s of pii) assert.ok(!all.includes(s), `log leaked: ${s}`);
  for (const line of captured) {
    const parsed = JSON.parse(line);
    assert.deepEqual(Object.keys(parsed).sort(), ["fn", "form", "outcome", "status"]);
    assert.ok(["private-enquiry", "partner-enquiry", "unknown"].includes(parsed.form));
  }
});
