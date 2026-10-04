# RIG — Regenesis International Group

Exposure site for a regenerative-medicine liaison company (Japan <-> Southeast Asia).

**Live:** https://young-min-choo.github.io/rig-website/

## Structure (v1.0)

| Page | Purpose |
|---|---|
| `index.html` | Hero + stats, who we serve, process preview, network teaser, team, contact |
| `about.html` | Story, 3 principles, stats band, what-we-are/are-not compliance split |
| `services.html` | 4 numbered services with imagery + scope compliance split |
| `process.html` | Full 4-stage working process with "you get" per stage |
| `network.html` | Tokyo + KL hubs, coverage map in tiles |
| `team.html` | 5 members; photos auto-swap when dropped into assets/team/ |
| `contact.html` | Contact facts + form (wire Formspree action before launch) |
| `disclaimer.html` | Full scope/compliance notice (Japan medical advertising caution) |

## Design system
- Light "warm paper" palette (#fafaf7), deep viridian accent (#0e7c66), gold details
- Instrument Serif display / Inter UI, one accent discipline
- Sections alternate paper / mint / graphite bands; hairline dividers
- Fully responsive (5-col team -> 3 -> 2), reduced-motion respected

## Team photos
Drop `luqman.jpg`, `choo.jpg`, `shiv.jpg`, `lucas.jpg`, `aya.jpg` into `assets/team/`
and they appear automatically (initial-letter placeholders until then).

## Before launch checklist
- [ ] Wire contact form to a real endpoint (Formspree free tier works on GitHub Pages)
- [ ] Confirm Shiv + Dr Lucas titles (TODO comments in team sections)
- [ ] Contact email -> company-domain address when domain is registered
- [ ] Team member photos arriving 10/7

Deploy: push to `main` -> GitHub Pages serves automatically.
