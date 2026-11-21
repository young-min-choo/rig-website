# RIG — Regenesis International Group

Website for a private healthcare agency: a gateway to Japanese healthcare for
international patients (regenerative medicine first), plus a partner track for
hospitals, clinics, physicians and agents.

**Live (v1, until cutover):** https://young-min-choo.github.io/rig-website/
**Production (at cutover):** https://regenig.com/ on Cloudflare Pages. Today regenig.com is still
a Squarespace "Coming Soon" page on Squarespace DNS; the switch is in [`docs/LAUNCH-RUNBOOK.md`](docs/LAUNCH-RUNBOOK.md).

## Structure (v2 — Luqman's brief, Nov 2026)

| Page | Audience | Sections |
|---|---|---|
| `index.html` | Patients | Hero (video-ready) · About teaser · Regenerative Medicine · Your Journey · Private Enquiry form (`#enquire`) · Partnerships teaser |
| `about.html` | Patients, partners | Mission · Our Story · Leadership (`#leadership`) |
| `partners.html` | Hospitals, clinics, agents | Partner With Regenesis · Why Partner · How It Works · Partner form |
| `privacy.html` | All | **Draft** Privacy Policy v0.1, pending Luqman's review (blanks in brackets) |
| `disclaimer.html` | All | **Interim** text (v1 notice adapted) — final text to be supplied |
| `services/process/network/team/contact.html` | — | v1 URLs kept as redirect stubs to their new homes (also 301s in `_redirects`) |
| `thanks.html` · `enquiry-error.html` · `404.html` | — | Form outcome pages (no-JS path) and the not-found page; `noindex` |
| `functions/api/enquiry.js` | — | Cloudflare Pages Function behind both forms (`POST /api/enquiry`) |
| `_headers` · `_redirects` · `robots.txt` · `sitemap.xml` | — | Cloudflare Pages config (CSP, HSTS, caching; v1 301s) and crawler files |

Menu: Home · About · Partners · Enquire, plus language switcher (EN live; 中文 / العربية pending).

## Design system
- Deep navy / near-black grounds, ivory text, champagne gold (`#c8b27c`) accents
- Cormorant Garamond headings + thin serif step numerals, Inter body; hairline dividers, square buttons
- Mobile first; reduced-motion respected; CSS uses logical properties so Arabic only needs `dir="rtl"`
- **Zero third-party requests**: fonts self-hosted (`assets/fonts/`, OFL) — never add CDN fonts, analytics, YouTube/Vimeo embeds
- Primary benchmark: Clinique La Prairie (pacing, imagery, tone) — but RIG's written colour spec wins

## Content rules (compliance)
- Never: "cure", "guaranteed", "reverse ageing", success rates, testimonials, before/after images, superlatives ("finest", "best", "most trusted")
- Don't name partner clinics until agreements allow
- Keep on every page: *Treatment is provided solely by licensed physicians at our partner clinics.*
- Copy softened from the brief is marked `<!-- COPY: ... -->` in the HTML

## Wiring points
- **Hero video:** put self-hosted files in `assets/video/` and set `data-video-mp4` / `data-video-webm` on `.hero-media` in `index.html` (10–20 s, silent, ≤ ~4 MB). `site.js` skips it for reduced-motion / data-saver visitors; the still `assets/img/hero.jpg` stays as poster/fallback.
- **Forms (wired):** both forms post to `/api/enquiry` (`action` + `data-endpoint`). With JS, `site.js` sends
  `Accept: application/json` and shows the outcome inline; without JS the browser gets a 303 to `thanks.html`
  or `enquiry-error.html`. `functions/api/enquiry.js` validates (required fields, length caps, email shape,
  consent), drops spam silently (honeypot field `website`), checks `Origin` against `ALLOWED_ORIGINS`, caps the
  body at 32 KB, and sends a plain-text email through the Resend API to `MAIL_TO` with `Reply-To` set to the
  enquirer. Env vars on the Pages project: `RESEND_API_KEY` (secret), `MAIL_TO`, `MAIL_FROM`, `ALLOWED_ORIGINS`.
  Until they are set it answers 503 and visitors are told to write to info@regenig.com; nothing is silently
  dropped. It logs only form type, outcome and status code, never personal data.
- **Imagery:** `scripts/gen_images.py` (local ComfyUI + Z-Image Turbo) holds the prompts; Japan, light, texture, calm — no labs, needles or clinical stock.

## Team photos
Drop `luqman.jpg`, `choo.jpg`, `shiv.jpg`, `lucas.jpg`, `aya.jpg` (portrait 4:5, ≥ 800×1000) into `assets/team/`,
then add the matching `<img>` in `about.html` (see `assets/team/README.md`). Tags are not pre-placed: a missing file
would 404 on every visit, and inline `onerror` handlers are blocked by the CSP. Initial placeholders show until then.

## Checks (run before every deploy)
```bash
node --test tests/            # Pages Function unit tests (fake fetch; never calls Resend)
node tests/static-check.mjs   # links, h1, alt, labels, canonical/og, sitemap, _headers CSP, _redirects, form wiring
node tests/qa.mjs             # real-browser QA at 390 and 1440 px with the CSP served; screenshots → ~/.hermes/cache/scratch/rig-qa/
```

## Before launch checklist
Done in the launch-prep lane:
- [x] Form delivery code: Pages Function `/api/enquiry` → Resend → info@regenig.com, both forms wired (`data-endpoint` + `action`), honeypot, thanks / error pages
- [x] Canonical + absolute `og:url` / `og:image` on real pages (regenig.com); `noindex` on stubs and status pages
- [x] `robots.txt`, `sitemap.xml`, `404.html`
- [x] `_headers` (strict CSP, HSTS, nosniff, referrer, permissions, caching) and `_redirects` (v1 URLs, 301)
- [x] QA tooling: unit tests, static checks, browser QA (see Checks)
- [x] Launch runbook: [`docs/LAUNCH-RUNBOOK.md`](docs/LAUNCH-RUNBOOK.md)

Still open (owners):
- [ ] Luqman OK on softened copy (`COPY:` comments) and colour direction
- [ ] Luqman: Workspace seat `choo@regenig.com`; Squarespace domain-manager invite for regenig.com
- [ ] Cloudflare account + Pages project + env vars; Resend account + `send.regenig.com` verified (runbook 1–4c)
- [ ] Processor agreements (Cloudflare, Resend DPA) and both named in the Privacy Policy
- [ ] Final Privacy Policy (draft v0.1 in place) + Disclaimer text (replace interim notice)
- [ ] Registered company name + number in footer (`OPEN ITEM` comment)
- [ ] Dr. Lucas full name + credentials; leadership photos + short bios
- [ ] Hero footage
- [ ] regenig.com DNS → Cloudflare (DNSSEC off first) and website cutover (runbook 4a–4d), then post-launch checks (runbook 6)
- [ ] Chinese (Simplified) + Arabic (RTL) editions (in-house AI translation, after launch)

## Deploy
- **Production: Cloudflare Pages**, project `regenig`, Direct Upload with `npx wrangler pages deploy` from the repo
  root (site files only; `functions/` is compiled from the root). Custom domains `regenig.com` (canonical) and
  `www.regenig.com` (301 → apex). Exact steps, env vars, DNS order and rollback: [`docs/LAUNCH-RUNBOOK.md`](docs/LAUNCH-RUNBOOK.md).
- **Preview:** `regenig-preview.vercel.app` (Vercel), `noindex` added at deploy time by a `vercel.json` outside this
  repo. Do not add a site-wide `noindex` to the repo: the only one in `_headers` is the host-scoped
  `https://:project.pages.dev/*` rule, so the production `*.pages.dev` address is never indexed while regenig.com is.
- **v1 (GitHub Pages, push to `main`)** retires at cutover: unpublish it in the GitHub repo settings once regenig.com
  serves v2, and retire or noindex the `rig-website-five.vercel.app` alias.
