# SIH2026-PS26186 — SENTINEL

Smart India Hackathon 2026 — Problem Statement **26186**
**AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces**
*(Organization: Ministry of Home Affairs — CRPF, Police II Division)*

> **SENTINEL** is a privacy-first welfare platform for uniformed forces: personnel get a private daily journal + voice-ready check-ins, a transparent predictive engine converts HR & wellness signals into explainable stress-risk scores, and commanders/welfare officers get aggregated dashboards and intervention recommendations — **without ever accessing private journals**.

## ✨ Features

- **📝 Private Journal** — daily 750-word-style journaling (word count, streaks, time tracking, autosave). Journal content is *never* exposed to any dashboard or the risk engine.
- **🩺 Wellness Check-ins** — daily stress/sleep/mood self-reporting + standardized **PSS-10** assessment.
- **🧠 Predictive Risk Engine** — transparent 11-factor weighted model (leave denials, overtime trends, deployment pressure, family separation, incident exposure, sleep degradation, disengagement…) → 0–100 score in 4 bands (Low / Watch / Elevated / Critical), every score with **explainable contributing factors**.
- **🚨 Automated Alerts** — welfare officers auto-notified on Elevated/Critical risk, with deduplication.
- **🎯 Intervention Recommender** — welfare-focused actions: counseling, rest rotation, workload rebalance, family leave, peer support, medical check — with tracking to completion.
- **🛡️ Privacy Framework** — k-anonymized commander heatmap (cells <5 suppressed), strict role-based access, full audit log, personnel can see who accessed their record, anonymous check-in option. Welfare-only framing — never disciplinary.

## 👥 Team

| Member | GitHub | Role |
|---|---|---|
| Zaid | [@ZaidCodesin](https://github.com/ZaidCodesin) | Team Lead |
| *(add teammates)* | @username | Developer |

## 🧰 Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (via `node:sqlite`, zero external DB deps)
- **Frontend:** Vanilla HTML/CSS/JS (responsive — works on phone browsers)
- **No external APIs required** — the entire stack runs locally/offline

## 🗂️ Project Structure

```
├── server.js            # Express API: auth, risk pipeline, dashboards, alerts
├── lib/
│   ├── db.js            # SQLite schema (users, personnel, hr_events, checkins…)
│   ├── risk.js          # 11-factor predictive risk engine (explainable output)
│   ├── recommend.js     # Intervention recommendation rules
│   └── seed.js          # Demo data: 150 personnel, 6 months of history
└── public/              # Single-page app (personnel + welfare + commander views)
```

## 🚀 Getting Started

```bash
git clone https://github.com/ZaidCodesin/SIH2026-PS26186.git
cd SIH2026-PS26186
npm install
npm run seed        # loads 150 simulated personnel with 180 days of history
npm start           # → http://localhost:4400
```

**Demo logins** (after seeding): `commander / demo123` · `welfare / demo123` · `sepoy.demo / demo123`

## 🔐 Privacy by Design

| Layer | Mechanism |
|---|---|
| Commander dashboard | Aggregated unit heatmaps only; k-anonymity (cells <5 suppressed) |
| Welfare officer | Sees risk indicators + factors; **cannot** access journal content (enforced at API level) |
| Personnel | Journal is private forever; can view the audit trail of who accessed their record |
| Data | All-local SQLite storage; `data/` is git-ignored and never published |


## 🌿 Workflow

- `main` — stable, working code only (protected: no force-pushes, no deletions)
- `dev` — integration branch where teammates' feature branches get merged
- Feature work: branch off `dev` as `feature/<your-feature>` and open a Pull Request into `dev`

## 📄 License

TBD

