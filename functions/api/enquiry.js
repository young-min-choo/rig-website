/* POST /api/enquiry — Cloudflare Pages Function for both website forms.
 *
 * The browser only ever talks to this origin. This function validates the
 * enquiry and hands it to the Resend API server-side; the mailbox is info@.
 *
 * Env (Pages project settings):
 *   RESEND_API_KEY   secret, required
 *   MAIL_TO          required, e.g. info@regenig.com
 *   MAIL_FROM        required, e.g. "Regenesis Website <website@send.regenig.com>"
 *   ALLOWED_ORIGINS  required, comma list, e.g. https://regenig.com,https://www.regenig.com
 *   RESEND_API_URL   optional override (tests / local mocks only)
 *
 * Logging: one line per request with the form type, the outcome and a status
 * code. Never names, emails, phones, messages or IP addresses.
 */

export const LIMITS = {
  name: 200, position: 200, organisation: 200, country: 200,
  email: 254, whatsapp: 40, message: 5000,
};

/* Body cap. LIMITS count UTF-16 code units (as the markup's maxlength does). The no-JS
 * path sends application/x-www-form-urlencoded, where one BMP character (e.g. CJK) costs
 * up to 9 bytes (%XX%XX%XX). Every field of either form at its cap in such characters is
 * about 54 KB, so 64 KB never refuses a submission the form allows. */
export const MAX_BODY_BYTES = 64 * 1024;

export const FORMS = {
  "private-enquiry": {
    required: ["name", "email", "message"],
    optional: ["whatsapp"],
    label: "Private enquiry",
    subjectField: "name",
  },
  "partner-enquiry": {
    required: ["name", "position", "organisation", "country", "email", "message"],
    optional: [],
    label: "Partner enquiry",
    subjectField: "organisation",
  },
};

export const HONEYPOT_FIELD = "website";
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const CONSENT_VALUES = new Set(["yes", "on", "true"]);

const ERRORS = {
  400: "invalid",
  403: "forbidden",
  413: "too_large",
  502: "delivery_failed",
  503: "unavailable",
};

class HttpError extends Error {
  constructor(status, outcome) { super(outcome); this.status = status; this.outcome = outcome; }
}

function log(form, outcome, status) {
  // The only log line this function writes. Keep it free of personal data.
  console.log(JSON.stringify({ fn: "enquiry", form: Object.hasOwn(FORMS, form) ? form : "unknown", outcome, status }));
}

/** Remove CR/LF and other control characters (C0, DEL, C1 incl. NEL, U+2028/2029) from header-bound values. */
export function oneLine(value) {
  return String(value).replace(/[\r\n\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function wantsJson(request) {
  return (request.headers.get("accept") || "").toLowerCase().includes("application/json");
}

function respond(request, status) {
  const ok = status >= 200 && status < 300;
  if (wantsJson(request)) {
    const body = ok ? { ok: true } : { ok: false, error: ERRORS[status] || "error" };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // No-JS path: a normal form POST lands on a page in the site design.
  return new Response(null, {
    status: 303,
    headers: { location: ok ? "/thanks.html" : "/enquiry-error.html", "cache-control": "no-store" },
  });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
}

function requestOrigin(request) {
  const origin = request.headers.get("origin");
  // A present Origin is authoritative, including the opaque "null" origin.
  if (origin !== null) return origin.trim().toLowerCase();
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try { return new URL(referer).origin.toLowerCase(); } catch { return null; }
}

/** Read the body, refusing anything over the cap even without Content-Length. */
async function readCapped(request, max) {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > max) {
    try { await request.body?.cancel(); } catch { /* ignore */ }
    throw new HttpError(413, "too_large");
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new HttpError(413, "too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

async function parseForm(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  const isMultipart = type.startsWith("multipart/form-data");
  const isUrlEncoded = type.startsWith("application/x-www-form-urlencoded");
  if (!isMultipart && !isUrlEncoded) throw new HttpError(400, "bad_content_type");
  const bytes = await readCapped(request, MAX_BODY_BYTES);
  let fd;
  try {
    fd = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") } }).formData();
  } catch {
    throw new HttpError(400, "bad_body");
  }
  const data = {};
  for (const [key, value] of fd.entries()) {
    if (typeof value !== "string") throw new HttpError(400, "file_upload");
    if (!(key in data)) data[key] = value; // first value wins; ignore duplicates
  }
  return data;
}

function validate(spec, data) {
  const clean = {};
  for (const field of [...spec.required, ...spec.optional]) {
    // Browsers submit textarea line breaks as CRLF but maxlength counts each as one character.
    const value = typeof data[field] === "string" ? data[field].replace(/\r\n?/g, "\n").trim() : "";
    if (value.length > LIMITS[field]) throw new HttpError(400, "too_long");
    if (!value && spec.required.includes(field)) throw new HttpError(400, "missing_field");
    clean[field] = value;
  }
  if (!EMAIL_RE.test(clean.email)) throw new HttpError(400, "bad_email");
  if (!CONSENT_VALUES.has(String(data.consent || "").trim().toLowerCase())) throw new HttpError(400, "no_consent");
  return clean;
}

function buildEmail(formType, spec, clean, env) {
  const subjectValue = oneLine(clean[spec.subjectField]).slice(0, 120);
  const lines = [`${spec.label} from the website.`, ""];
  const rows = formType === "private-enquiry"
    ? [["Name", clean.name], ["Email", clean.email], ["WhatsApp", clean.whatsapp || "(not given)"]]
    : [["Name", clean.name], ["Position", clean.position], ["Organisation", clean.organisation],
       ["Country", clean.country], ["Email", clean.email]];
  for (const [k, v] of rows) lines.push(`${k}: ${oneLine(v)}`);
  lines.push("Consent: given (Privacy Policy)", "", "Message:", clean.message.replace(/\r\n?/g, "\n"));
  return {
    from: oneLine(env.MAIL_FROM),
    to: String(env.MAIL_TO).split(",").map(oneLine).filter(Boolean),
    reply_to: oneLine(clean.email),
    subject: `[Website] ${spec.label} — ${subjectValue}`,
    text: lines.join("\n"),
  };
}

export async function handle(request, env = {}, fetchImpl = fetch) {
  let formType = "unknown";
  try {
    if (!env.RESEND_API_KEY || !env.MAIL_TO || !env.MAIL_FROM || allowedOrigins(env).length === 0) {
      log(formType, "config_missing", 503);
      return respond(request, 503); // JSON: 503; no-JS: 303 to the error page
    }

    const origin = requestOrigin(request);
    if (!origin || !allowedOrigins(env).includes(origin)) throw new HttpError(403, "bad_origin");

    const data = await parseForm(request);
    formType = typeof data.form === "string" ? data.form.trim() : "";
    const spec = Object.prototype.hasOwnProperty.call(FORMS, formType) ? FORMS[formType] : null;
    if (!spec) throw new HttpError(400, "unknown_form");

    // Honeypot: a person never sees this field. Pretend success, send nothing.
    if (typeof data[HONEYPOT_FIELD] === "string" && data[HONEYPOT_FIELD].trim() !== "") {
      log(formType, "honeypot", 200);
      return respond(request, 200);
    }

    const clean = validate(spec, data);
    const email = buildEmail(formType, spec, clean, env);

    let upstream;
    try {
      upstream = await fetchImpl(env.RESEND_API_URL || "https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(email),
      });
    } catch {
      throw new HttpError(502, "upstream_unreachable");
    }
    if (!upstream || !upstream.ok) {
      log(formType, "upstream_error", upstream ? upstream.status : 0);
      return respond(request, 502);
    }
    log(formType, "sent", 200);
    return respond(request, 200);
  } catch (err) {
    if (err instanceof HttpError) {
      log(formType, err.outcome, err.status);
      return respond(request, err.status);
    }
    log(formType, "internal_error", 502);
    return respond(request, 502);
  }
}

export const onRequestPost = (context) => handle(context.request, context.env);
