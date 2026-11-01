# RIG — Regenesis International Group

Website for a private healthcare agency: a gateway to Japanese healthcare for
international patients (regenerative medicine first), plus a partner track for
hospitals, clinics, physicians and agents.

**Live (v1, until v2 merges):** https://young-min-choo.github.io/rig-website/
**Target domain:** regenig.com (Squarespace DNS; currently a Squarespace "Coming Soon" page)

## Structure (v2 — Luqman's brief, Nov 2026)

| Page | Audience | Sections |
|---|---|---|
| `index.html` | Patients | Hero (video-ready) · About teaser · Regenerative Medicine · Your Journey · Private Enquiry form (`#enquire`) · Partnerships teaser |
| `about.html` | Patients, partners | Mission · Our Story · Leadership (`#leadership`) |
| `partners.html` | Hospitals, clinics, agents | Partner With Regenesis · Why Partner · How It Works · Partner form |
| `privacy.html` | All | **Interim** notice — final Privacy Policy to be supplied |
| `disclaimer.html` | All | **Interim** text (v1 notice adapted) — final text to be supplied |
| `services/process/network/team/contact.html` | — | v1 URLs kept as redirect stubs to their new homes |

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
- **Forms:** set `data-endpoint` on each `<form>` to the delivery endpoint (→ info@regenig.com). Until then `site.js` tells visitors to email instead — nothing is silently dropped.
- **Imagery:** `scripts/gen_images.py` (local ComfyUI + Z-Image Turbo) holds the prompts; Japan, light, texture, calm — no labs, needles or clinical stock.

## Team photos
Drop `luqman.jpg`, `choo.jpg`, `shiv.jpg`, `lucas.jpg`, `aya.jpg` (portrait 4:5, ≥ 800×1000) into `assets/team/`;
they appear automatically (initial placeholders until then).

## Before launch checklist
- [ ] Luqman OK on softened copy (`COPY:` comments) and colour direction
- [ ] Form delivery to info@regenig.com + processor agreement; set `data-endpoint`
- [ ] Final Privacy Policy + Disclaimer text (replace interim notices)
- [ ] Registered company name + number in footer (`OPEN ITEM` comment)
- [ ] Dr. Lucas full name + credentials; leadership photos + short bios
- [ ] Hero footage
- [ ] regenig.com DNS → host; update canonical/OG URLs
- [ ] Chinese (Simplified) + Arabic (RTL) editions from professional translation

Deploy: push to `main` → GitHub Pages serves automatically.
