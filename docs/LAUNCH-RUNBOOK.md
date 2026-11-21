# Launch runbook: regenig.com on Cloudflare Pages

For: Choo (does every step). Luqman does only the two things marked **Luqman**; he never touches DNS.
Goal: move regenig.com from the Squarespace "Coming Soon" page to this repo on Cloudflare Pages,
with both forms delivering to `info@regenig.com`, **without Gmail missing a single message**.

Every value below was read from this repo (`functions/api/enquiry.js`, `_headers`, `_redirects`)
or from live DNS (Google DoH, re-queried 2026-11-21). If live DNS has changed since, re-run the
check in step 0.3 and trust what it prints over this page.

## How the pieces fit

```
visitor ── https://regenig.com ──► Cloudflare Pages (static files + _headers + _redirects)
                                     └─ POST /api/enquiry ─► functions/api/enquiry.js ─► Resend API ─► info@regenig.com (Gmail)
mail for @regenig.com ───────────────────────────────────────────────────────────────► Google Workspace (unchanged)
```

- DNS moves from Squarespace to Cloudflare (Cloudflare becomes the nameserver). The domain stays
  **registered** at Squarespace; only the nameserver setting changes.
- Google Workspace mail keeps working because the exact same mail records are copied to
  Cloudflare **before** the switch.
- Website email goes out through Resend from the subdomain `send.regenig.com`, so the root SPF
  record stays Google-only.

## Order at a glance (nothing visible changes until phase 4)

| Phase | What | Live effect | Can undo? |
|---|---|---|---|
| 0 | Prerequisites (Luqman: mail seat + domain invite) | none | – |
| 1 | Cloudflare account, zone, records copied, DMARC added | none (Cloudflare not in use yet) | delete zone |
| 2 | API token stored on the desktop | none | revoke token |
| 3 | Pages project deployed to `*.pages.dev`, env vars | none (only the pages.dev URL) | delete project |
| 4a | **Turn DNSSEC off at Squarespace, wait ≥ 24 h** | none if done in this order | turn back on |
| 4b | **Nameserver switch** at Squarespace | DNS now from Cloudflare; same answers | switch back (step 5.1) |
| 4c | Resend domain verified, forms tested on pages.dev | sends real email to info@ | – |
| 4d | **Website cutover**: custom domains + www redirect | regenig.com shows the new site | step 5.2 (minutes) |
| 6 | Post-launch checks | – | – |

Mail and website are switched on **different days** on purpose: if something breaks you know which change caused it.

---

## 0. Prerequisites

0.1 **Luqman**: create the Google Workspace user `choo@regenig.com`. Every RIG account below
(Cloudflare, Resend) is registered to that address, not to a personal or IA address.

0.2 **Luqman**: in Squarespace Domains, open regenig.com → Permissions and invite
`choo@regenig.com` as a **domain manager**. Accept the invite. You now see the DNS and
nameserver settings for regenig.com. (Luqman's part ends here.)

0.3 Record what is live today. Paste this into a terminal (needs `curl` and `jq`, both installed):

```bash
dnscheck() {
  for q in "regenig.com NS" "regenig.com DS" "regenig.com A" "www.regenig.com CNAME" \
           "regenig.com MX" "regenig.com TXT" "google._domainkey.regenig.com TXT" \
           "_dmarc.regenig.com TXT" "send.regenig.com MX"; do
    set -- $q
    printf '== %-32s %s\n' "$1" "$2"
    curl -s "https://dns.google/resolve?name=$1&type=$2" | jq -r '.Answer[]? | "\(.TTL)s  \(.data)"'
  done
}
dnscheck
```

Keep the output; it is the "before" picture. On 2026-11-21 it was:

| Name | Type | Value | TTL | Copy to Cloudflare? |
|---|---|---|---|---|
| `regenig.com` | NS | `nsa1.squarespacedns.com`, `nsa2…`, `nsa3…`, `nsa4.squarespacedns.com` | 21600 | no (replaced by Cloudflare's two) |
| `regenig.com` | DS | `5981 8 2 60ABEC86…2035116` (DNSSEC is **on**) | 86400 at .com | no: must be **removed** first (phase 4a) |
| `regenig.com` | A | `198.185.159.144`, `198.185.159.145`, `198.49.23.144`, `198.49.23.145` | 14400 | yes, until website cutover |
| `www` | CNAME | `ext-sq.squarespace.com` | 14400 | yes, until website cutover |
| `regenig.com` | MX | priority `1`, `smtp.google.com` | 3600 | **yes (mail)** |
| `regenig.com` | TXT | `v=spf1 include:_spf.google.com ~all` | 3600 | **yes (mail)** |
| `google._domainkey` | TXT | DKIM key, full value below | 3600 | **yes (mail)** |
| `_dmarc` | TXT | (none) | – | add new (step 1.3) |
| `regenig.com` | HTTPS | `1 . alpn=h2,http/1.1 ipv4hint=…` (Squarespace) | 14400 | no |
| `_domainconnect` | CNAME | `_domainconnect.domains.squarespace.com` | 3600 | no (Squarespace-only feature) |

Full `google._domainkey` value (one line, copy exactly):

```
v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvJEH1uQPMuzULbyxdMJWQhbS0kDfcb4JhAMTjd7PBFLfIn79shOFmR+WRL+0FFM578UIVh3wq+DeT/5WiFF8ONIN2luHpYHCQFllsy1SgPPIdnL/RariZ+r9Tbcyb/qe3Wu42mg1t/lnt9QSt/L4ns4wBXscU0skPLX+3JyB3qeELbGCkMhamXSh2xDQILkHv4FrZy9YWNliXFqkdvfHDTd8vmQesKKRLSraTH6cz2DroR1Hj71T7XI9e4c6In46b1CBmWMDNDgvCKJnLtktPRp7X91nWCLiacQ54PMlTHX+NdFhEeXJOuPVN0muovJsyLF1u3l1DrZgyMUXO0VeXwIDAQAB
```

0.4 In Squarespace, screenshot the DNS settings page for regenig.com. It is the rollback copy.
Do not delete anything at Squarespace at any point in this runbook.

---

## 1. Cloudflare account and zone (no live effect)

1.1 Sign up at https://dash.cloudflare.com/sign-up with `choo@regenig.com`. Turn on two-factor
authentication (My Profile → Authentication). Plan: **Free**.

1.2 Add a domain → `regenig.com` → Free plan. Cloudflare scans the current records and imports
what it finds. Nothing is live yet: the internet still asks Squarespace until phase 4b.

1.3 On the DNS → Records page, make the list match this table exactly. Delete anything else the
scan imported (in particular any `HTTPS` record and `_domainconnect`).

| Type | Name | Content | Priority | Proxy status | TTL |
|---|---|---|---|---|---|
| A | `@` | `198.185.159.144` | – | DNS only (grey cloud) | Auto |
| A | `@` | `198.185.159.145` | – | DNS only | Auto |
| A | `@` | `198.49.23.144` | – | DNS only | Auto |
| A | `@` | `198.49.23.145` | – | DNS only | Auto |
| CNAME | `www` | `ext-sq.squarespace.com` | – | DNS only | Auto |
| MX | `@` | `smtp.google.com` | `1` | (MX is never proxied) | Auto |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | – | – | Auto |
| TXT | `google._domainkey` | the full DKIM value from step 0.3 | – | – | Auto |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:info@regenig.com` | – | – | Auto |

Notes:
- The A and www records are **grey cloud (DNS only)** for now, so the Coming Soon page keeps
  working exactly as today after the nameserver switch. They are replaced in phase 4d.
- The DKIM value is longer than 255 characters. Paste it as one line; Cloudflare splits it
  internally. Do not add quotes.
- `p=none` on DMARC only asks receivers to send reports; it never blocks mail. Daily report
  emails will start arriving at info@ from Google, Microsoft and others. That is expected; a Gmail
  filter on the subject "Report domain: regenig.com" keeps them out of the inbox.

1.4 Note the two nameservers Cloudflare assigns (Overview page, "Replace your nameservers"),
e.g. `xxxx.ns.cloudflare.com` and `yyyy.ns.cloudflare.com`. You need them in phase 4b.

1.5 Before anything is switched, ask Cloudflare's own nameservers what they will answer. This
needs `dig` (`sudo pacman -S --needed bind` if missing). Replace `xxxx` with your nameserver:

```bash
NS=xxxx.ns.cloudflare.com
for q in "regenig.com MX" "regenig.com TXT" "google._domainkey.regenig.com TXT" "_dmarc.regenig.com TXT" "regenig.com A" "www.regenig.com CNAME"; do
  set -- $q; echo "== $1 $2"; dig +short @"$NS" "$1" "$2"
done
```

The MX, SPF and DKIM lines must match step 0.3 character for character (dig shows the DKIM
value split into two quoted pieces; that is normal). **Do not go on to phase 4 until they do.**

1.6 Switch off Cloudflare features that inject scripts or rewrite pages. They would break the
site's "zero third-party requests" promise and its Content-Security-Policy:
- Scrape Shield → **Email Address Obfuscation: Off** (it rewrites the `mailto:info@regenig.com` links and injects a script).
- Speed → Optimization → **Rocket Loader: Off**.
- Security → Bots → **Bot Fight Mode: Off** (it injects a challenge script).
- Analytics → Web Analytics: **do not enable** for this site or the Pages project. Zaraz: leave unused.
- SSL/TLS → Edge Certificates → **Always Use HTTPS: On**. Leave HSTS settings here alone; the
  site already sends HSTS from `_headers` (`max-age=31536000; includeSubDomains`, no preload).

---

## 2. API token for the desktop (no live effect)

The token lets `wrangler` (Cloudflare's CLI) deploy from the desktop. It is a password: it
never goes into chat, a commit, or a shell history.

2.1 My Profile → API Tokens → Create Token → **Create Custom Token**:
- Name: `rig-desktop-deploy`
- Permissions:
  - Account · **Cloudflare Pages** · Edit
  - Account · **Workers Scripts** · Edit
  - Zone · **DNS** · Edit
- Account Resources: Include · (the RIG account)
- Zone Resources: Include · Specific zone · **regenig.com**
- TTL: optional end date (e.g. 1 year); set a calendar reminder to rotate it.

Continue → Create. The token is shown once. Also copy the **Account ID** (Overview page, right
column; it is not secret).

2.2 Store both on the desktop. The token is typed at a hidden prompt, so it never appears on
screen, in chat or in `~/.bash_history`:

```bash
mkdir -p ~/.config/rig && chmod 700 ~/.config/rig
( umask 077
  read -rsp 'Cloudflare API token (hidden): ' T; echo
  read -rp  'Cloudflare Account ID: ' A
  printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCOUNT_ID=%s\n' "$T" "$A" > ~/.config/rig/cloudflare.env
  unset T A )
ls -l ~/.config/rig/cloudflare.env   # must show -rw------- (600)
```

2.3 To use it in a terminal session (wrangler reads these two variables automatically):

```bash
set -a; . ~/.config/rig/cloudflare.env; set +a
npx wrangler whoami      # should list the RIG account
```

If Hermes runs a deploy for you, tell it the file path, never the value. The file lives outside
the repo; the repo's `.gitignore` also ignores `.env*` as a second guard.

---

## 3. Pages project, environment, first deploy (no live effect)

3.1 Create the project once (Direct Upload; a Direct Upload project cannot be switched to Git
integration later, which is fine because there is no build step):

```bash
set -a; . ~/.config/rig/cloudflare.env; set +a
npx wrangler pages project create regenig --production-branch main
```

If the name `regenig` is taken, pick another; every later command uses `--project-name <that name>`,
and its address is `https://<that name>.pages.dev`.

3.2 Deploy. Publish only the site files: the repo also holds tests, docs and scripts that should
not be public. The `functions/` folder is picked up from the **current directory**, so run this
from the repo root:

```bash
cd ~/dev/rig-website            # the checkout on the branch being launched
git status --short              # must print nothing (deploy committed work only)
node --test tests/ && node tests/static-check.mjs && node tests/qa.mjs   # all must pass

DIST=$(mktemp -d)
rsync -a --exclude='.*' --exclude='*.md' --exclude='tests/' --exclude='docs/' \
      --exclude='scripts/' --exclude='functions/' ./ "$DIST"/
ls "$DIST"                      # expect: *.html, _headers, _redirects, robots.txt, sitemap.xml, assets/
npx wrangler pages deploy "$DIST" --project-name regenig --branch main
```

wrangler prints the deployment URL and says it compiled a Worker from `functions/`. If it does
not mention Functions, you ran it from the wrong directory.

3.3 Environment variables. Workers & Pages → `regenig` → Settings → **Variables and Secrets**,
environment **Production**. Names must be exactly these (they are read by
`functions/api/enquiry.js`):

| Name | Type | Value |
|---|---|---|
| `MAIL_TO` | Plaintext | `info@regenig.com` |
| `MAIL_FROM` | Plaintext | `Regenesis Website <website@send.regenig.com>` |
| `ALLOWED_ORIGINS` | Plaintext | `https://regenig.com,https://www.regenig.com,https://regenig.pages.dev` (drop the pages.dev entry at step 4d.5) |
| `RESEND_API_KEY` | **Secret** | set in step 4c.4, never in plaintext |
| `RESEND_API_URL` | – | **do not set** (tests only; production uses `https://api.resend.com/emails`) |

`ALLOWED_ORIGINS` is compared against the browser's `Origin` header (lower-cased, no trailing
slash), so it must list full `https://` origins, comma-separated, no paths.

Variables apply to **new** deployments only: after any change, run the deploy command from 3.2 again.

3.4 Check the function is live, without sending anything:

```bash
curl -s -X POST https://regenig.pages.dev/api/enquiry -H 'Accept: application/json'; echo
```

- `{"ok":false,"error":"unavailable"}` (HTTP 503) = the function runs but a variable is missing.
  Expected until `RESEND_API_KEY` exists. The function logs `config_missing`.
- `{"ok":false,"error":"forbidden"}` (HTTP 403) = configured; curl sent no allowed Origin, so it
  was refused. This is the expected answer once all four variables are set.

Open `https://regenig.pages.dev/` in a browser and click through the pages. The address bar
still shows pages.dev; regenig.com is untouched.

---

## 4. Switching over

### 4a. DNSSEC off at Squarespace (wait at least 24 hours afterwards)

regenig.com is DNSSEC-signed today: the `.com` registry holds a `DS` record pointing at
Squarespace's signing key. If the nameservers moved to Cloudflare while that DS record still
exists, validating resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1 and many mail servers) would
reject every answer, and **both the website and incoming mail would fail**.

1. Squarespace Domains → regenig.com → DNS → **DNSSEC: turn off**.
2. Wait until the DS record is gone from public DNS, then wait **another 24 hours** (the `.com`
   DS TTL is 86400 s, so resolvers may hold the old copy that long):

   ```bash
   curl -s 'https://dns.google/resolve?name=regenig.com&type=DS' | jq '.Answer'
   # null  = DS removed. Anything else = not yet.
   ```

Nothing visible changes while DNSSEC is off; the site and mail work as before.

### 4b. Nameserver switch (mail must not notice)

Pre-flight (all must be true):
- [ ] Step 1.5 passed today: Cloudflare answers MX, SPF and DKIM identically to step 0.3.
- [ ] DS record gone for 24 h+ (4a).
- [ ] Squarespace DNS screenshot saved (0.4).

1. Squarespace Domains → regenig.com → DNS → Domain Nameservers → **Use custom nameservers**.
   Replace `nsa1`–`nsa4.squarespacedns.com` with the two Cloudflare nameservers from step 1.4.
   Save. Leave Squarespace's own DNS records as they are (they are the rollback).
2. Cloudflare → Overview → "Check nameservers". The zone turns **Active** in minutes to a few
   hours (the `.com` registry delegation TTL is 172800 s, so some resolvers take up to 48 h;
   during that time both providers give the same answers, so mail flows either way).
3. Verify from public DNS (re-run the function from 0.3):

   ```bash
   dnscheck
   ```

   Expect: NS = the two `*.ns.cloudflare.com` names; MX, SPF, DKIM unchanged; `_dmarc` now shows
   `v=DMARC1; p=none; rua=mailto:info@regenig.com`; A and www still Squarespace.
   Google caches answers for their TTL; to see changes sooner, flush a name at https://dns.google/cache.
4. Mail test:
   - From a personal Gmail account, send a message to `info@regenig.com`; whoever reads info@
     confirms it arrived.
   - From info@ (or choo@), reply to that personal account. In the received copy, ⋮ → "Show
     original" must show **SPF: PASS, DKIM: PASS, DMARC: PASS**.
   If either fails, roll back now (step 5.1); nothing else depends on this switch yet.

### 4c. Resend: send from `send.regenig.com`

4c.1 Sign up at https://resend.com with `choo@regenig.com`; turn on two-factor authentication.

4c.2 Domains → Add Domain → `send.regenig.com`. Region: pick the one closest to where data
should live (Tokyo `ap-northeast-1` fits RIG; whichever is chosen, the Privacy Policy must name
Resend and the region before forms go live).

4c.3 Resend shows the DNS records to add. They look like the table below, but **copy the exact
names and values from the Resend screen**, not from here. Add each in Cloudflare → DNS → Records,
all **DNS only**, TTL Auto. Cloudflare shows names relative to regenig.com, so a Resend name
of `resend._domainkey.send` becomes the Cloudflare name `resend._domainkey.send`.

| Type | Name (in the regenig.com zone) | Value | Priority | Purpose |
|---|---|---|---|---|
| TXT | `resend._domainkey.send` | `p=<DKIM PUBLIC KEY FROM RESEND>` | – | signs website mail |
| MX | `send.send` | `feedback-smtp.<REGION>.amazonses.com` | `10` | bounce handling for the return path |
| TXT | `send.send` | `v=spf1 include:amazonses.com ~all` | – | SPF for the return path only |

None of these touch the root records: the root MX stays `smtp.google.com` and the root SPF stays
`v=spf1 include:_spf.google.com ~all`. Then click **Verify** in Resend; it turns green in minutes.

4c.4 Resend → API Keys → Create: name `regenig-pages`, permission **Sending access**, domain
`send.regenig.com`. Copy it once and put it straight into Cloudflare at a hidden prompt:

```bash
set -a; . ~/.config/rig/cloudflare.env; set +a
npx wrangler pages secret put RESEND_API_KEY --project-name regenig
```

Then redeploy (3.2) so the new deployment picks the secret up.

4c.5 Test on pages.dev (this sends one real email to info@):
- `curl` from 3.4 now returns `{"ok":false,"error":"forbidden"}`.
- Submit both forms on `https://regenig.pages.dev/` (Home → Private Enquiries; Partners → Become
  a Partner) with your own name and email and a test message. The status line must say "Thank you."
- In info@ the messages arrive with the subjects `[Website] Private enquiry — <your name>` and
  `[Website] Partner enquiry — <your organisation>`, from `website@send.regenig.com`; pressing
  Reply addresses the enquirer. If they land in Spam, mark them "Not spam" once.
- Logs, if needed: `npx wrangler pages deployment tail --project-name regenig`. Each request writes
  one line such as `{"fn":"enquiry","form":"private-enquiry","outcome":"sent","status":200}`; the
  function never logs names, emails, phone numbers, messages or IPs.

Outcomes you may see in the log: `sent`, `honeypot` (spam trap filled, nothing sent),
`bad_origin`, `too_large` (body over 32 KB), `missing_field`, `too_long`, `bad_email`,
`no_consent`, `unknown_form`, `upstream_error` / `upstream_unreachable` (Resend refused or was
unreachable → visitor sees the error page), `config_missing`.

### 4d. Website cutover (regenig.com shows the new site)

1. Workers & Pages → `regenig` → **Custom domains** → Set up a custom domain → `regenig.com`.
   Cloudflare offers to update DNS: accept. If it reports that records already exist, delete the
   four Squarespace `A` records for `@` on the DNS page and try again. The apex then points at
   `regenig.pages.dev` (proxied, orange cloud).
2. Same screen → add `www.regenig.com`. Accept the DNS update; if it reports a conflict, delete
   the `www` CNAME to `ext-sq.squarespace.com` first.
3. www → apex redirect. Rules → **Redirect Rules** → Create rule (or the template "Redirect from
   WWW to root"):
   - When incoming requests match: Hostname equals `www.regenig.com`
   - Then: Dynamic redirect, expression `concat("https://regenig.com", http.request.uri.path)`,
     status **301**, **Preserve query string** on.
4. Wait for both custom domains to show **Active** (certificate issued; usually minutes).
5. Edit `ALLOWED_ORIGINS` to `https://regenig.com,https://www.regenig.com` (remove pages.dev)
   and redeploy (3.2).
6. Run the checks in section 6.

---

## 5. Rollback

### TTLs that decide how fast a rollback takes effect

| Record | TTL | Meaning |
|---|---|---|
| `.com` delegation (which nameservers) | 172800 s (48 h) | after switching nameservers either way, some resolvers keep the old ones up to 2 days |
| `.com` DS (DNSSEC) | 86400 s (24 h) | why phase 4a waits a day |
| Squarespace NS records | 21600 s (6 h) | |
| Squarespace A / www / HTTPS | 14400 s (4 h) | |
| Squarespace MX / TXT / DKIM | 3600 s (1 h) | |
| Cloudflare records set to Auto | 300 s (5 min) | website changes after the switch take minutes |

5.1 **Full DNS rollback** (mail problem after 4b): Squarespace → regenig.com → Domain
Nameservers → **Use Squarespace nameservers** (back to `nsa1`–`nsa4.squarespacedns.com`). Check
the Squarespace DNS records still match the screenshot from 0.4; re-add any missing ones from the
table in 0.3. Keep the Cloudflare zone and its records untouched for at least 48 h afterwards,
because some resolvers keep asking Cloudflare until the delegation TTL runs out; identical
records on both sides mean mail is safe either way. DNSSEC can be turned back on at Squarespace
once things are stable.

5.2 **Website-only rollback** (site problem after 4d; mail unaffected):
- Bad release: Workers & Pages → `regenig` → Deployments → pick the previous good deployment →
  **Rollback**. Takes effect in seconds.
- Back to the Coming Soon page: remove both custom domains in Pages, delete the Redirect Rule,
  and re-create the four Squarespace `A` records and the `www` CNAME (DNS only) from step 1.3.
  Takes effect within about 5 minutes.

---

## 6. Post-launch checks

Run after 4d and after every later deploy. Copy-paste:

```bash
# headers from _headers: CSP, HSTS, nosniff, referrer, permissions, frame
curl -sI https://regenig.com/ | grep -iE '^(content-security-policy|strict-transport-security|x-content-type-options|referrer-policy|permissions-policy|x-frame-options):'

# clean URLs, 404, redirects
curl -s -o /dev/null -w '%{http_code} /about\n'          https://regenig.com/about                 # 200
curl -s -o /dev/null -w '%{http_code} /no-such-page\n'   https://regenig.com/no-such-page          # 404 (404.html)
curl -sI https://www.regenig.com/partners | grep -iE '^(HTTP|location)'                            # 301 → https://regenig.com/partners
curl -sI https://regenig.com/team.html    | grep -iE '^(HTTP|location)'                            # 301 → /about#leadership
curl -sI https://regenig.com/contact.html | grep -iE '^(HTTP|location)'                            # 301 → /#enquire

# robots + sitemap
curl -s https://regenig.com/robots.txt                                                             # Sitemap: https://regenig.com/sitemap.xml
curl -s https://regenig.com/sitemap.xml | grep -c '<loc>'                                          # 5

# long cache on images/fonts, one day on CSS/JS
curl -sI https://regenig.com/assets/img/hero.jpg | grep -i '^cache-control'                        # max-age=31536000, immutable
curl -sI https://regenig.com/assets/css/style.css | grep -i '^cache-control'                       # max-age=86400, stale-while-revalidate=604800

# form function live and configured (sends nothing)
curl -s -X POST https://regenig.com/api/enquiry -H 'Accept: application/json'; echo                # {"ok":false,"error":"forbidden"}

# nothing injected by Cloudflare (must print nothing)
curl -s https://regenig.com/ | grep -iE 'cloudflareinsights|rocket-loader|email-decode|challenge-platform'

# the Vercel preview stays out of search engines
curl -sI https://regenig-preview.vercel.app/ | grep -i '^x-robots-tag'                             # noindex
```

Then by hand:
- [ ] **Forms deliver to info@**: send one private and one partner enquiry on https://regenig.com/;
      both arrive in info@ with the `[Website] …` subjects; Reply goes to the enquirer.
- [ ] **No-JS path**: with JavaScript disabled in the browser, submitting a form lands on
      `/thanks.html` (or `/enquiry-error.html` on failure).
- [ ] **No third-party requests**: browser DevTools → Network → reload each page with "Disable
      cache" ticked; every request's domain is `regenig.com`. DevTools Console shows no errors or
      CSP violations.
- [ ] `dnscheck` (0.3) still shows Google MX/SPF/DKIM and the DMARC record.
- [ ] A week later: DMARC reports at info@ show Google and `send.regenig.com` mail passing.

Afterwards (owner decisions, not blocking launch):
- Retire v1: GitHub repo Settings → Pages → unpublish `young-min-choo.github.io/rig-website/`,
  and retire or noindex the Vercel production alias `rig-website-five.vercel.app`, so only
  regenig.com and the noindex preview remain public.
- `https://regenig.pages.dev` stays reachable. Every page's `<link rel="canonical">` points at
  regenig.com, so search engines treat regenig.com as the original.
- DNSSEC back on: Cloudflare → DNS → Settings → DNSSEC → Enable; it shows a DS record (key tag,
  algorithm 13, digest type 2, digest). Add it in Squarespace's DNSSEC settings if Squarespace
  allows DS records with custom nameservers; if it does not, leave DNSSEC off.
