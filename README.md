# RIG — Regenesis International Group website

Public exposure site for Regenesis International Group (RIG): international
business development & liaison in regenerative medicine, connecting medical
institutions and corporations (Japan ↔ Southeast Asia corridor).

- **Live URL:** https://young-min-choo.github.io/rig-website/
- **Stack:** plain static HTML/CSS (no build step, no dependencies)
- **Deadline context:** basic completion Oct 6, 2026; member photos by Oct 7

## Editing

| What | Where |
|---|---|
| Copy / sections / team roles | `index.html` (search `TODO:`) |
| Styling | `assets/css/style.css` |
| Images | `assets/img/` (regenerate: `python3 scripts/gen_images.py`) |
| Team photos | `assets/team/` — drop in, they appear automatically |

## Team photos (due Oct 7)

Drop each photo into `assets/team/` using exactly these filenames — the page
picks them up with zero code changes (until then, initial-letter avatars show):

```
choo.jpg    luqman.jpg    shiv.jpg    lucas.jpg    aya.jpg
```

## Images

`scripts/gen_images.py` regenerates the 4 site images (hero, network, cells,
hospital) via pollinations.ai (Flux). Any image that 404s degrades gracefully to
a CSS gradient — the site never looks broken without them.

## Deploying

The site is served by GitHub Pages from the `main` branch. Any push to `main`
auto-deploys:

```bash
git add -A && git commit -m "..." && git push
```

## Content TODOs

- [ ] Titles for Shiv and Dr Lucas (placeholders in place — confirm with Luqman)
- [ ] Contact email (activate after domain registration)
- [ ] Optional: real office addresses / phone

## Domain (not yet registered — as of 2026-10-04)

These were available at check time (verify again at purchase):

- `regenesisinternationalgroup.com` ✅ available
- `regenesisintl.com` ✅ available

To attach after registering: repo → Settings → Pages → Custom domain, then
commit the auto-created `CNAME` file.

## Compliance note (keep)

The footer disclaimer ("business development and liaison services; no medical
treatment or advice") is deliberate — keep it on every version of the site.
Japan's medical advertising rules (医療広告ガイドライン) and regenerative
medicine regulations are strict about patient-facing claims; keep all copy
B2B and non-therapeutic.