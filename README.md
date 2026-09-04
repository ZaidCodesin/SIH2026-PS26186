# SENTINEL — PS 26186

Privacy-first personnel stress and welfare monitoring prototype for uniformed forces, built for Smart India Hackathon Problem Statement **26186** (MHA / CRPF).

SENTINEL combines organizational workload records with voluntary wellbeing information to support earlier, humane intervention. It keeps workforce conditions, welfare casework, and private personal reflection as separate data products with different access boundaries.

## Role-specific product

### Personnel

- Optional confidential check-in for stress, sleep, mood, physical strain and perceived support
- Comparison between recorded workload and lived experience
- Visibility into the non-disciplinary HR records used by the prototype
- Tracked requests to review incorrect workload, leave, deployment or profile data
- WHO-5, PSS-10, GAD-7 and PHQ-9 guided screeners with source attribution and non-diagnostic results
- Private 750 Words-style journal with autosave, voice dictation review, progress and reflective text statistics
- Personal access log showing authorized views of the welfare record

### Welfare Officer

- Prioritized support case queue and automated alerts
- Explainable evidence labelled by source (organizational record or voluntary wellness)
- Individual welfare context excluding private journals and disciplinary records
- Suggested non-disciplinary interventions: workload review, rest rotation, family leave, voluntary counseling, medical review and peer support
- Intervention lifecycle from recommended → accepted → completed/declined with outcome notes
- Queue for personnel-submitted data correction requests
- Access audit trail and manual model refresh

### Commander

- Unit-level operational conditions: overtime, deployments, leave denials, incident exposure, transfers and training load
- Aggregated 14-day pulse averages only when at least five personnel responded
- Organizational action prompts for roster/recovery, leave constraints and post-incident support
- No names, individual scores, assessment answers, journal content, personal case notes or welfare audit log

## Evidence and product principles

- **WHO Mental health at work:** excessive workload, low control, poor support and hazardous work are organizational risks; prevention includes organizational interventions.
- **HSE Management Standards:** demand, control, support, relationships, role and change should be considered holistically, prioritizing removal or reduction of workplace stressors.
- **NIOSH:** long/unpredictable hours, hazardous exposure, traumatic events, physical demands and low schedule control are relevant occupational conditions.
- **WHO-5 / PHQ / GAD / PSS:** screening supports reflection and professional follow-up; it is not diagnosis.
- **750 Words pattern:** private writing and reflective statistics are useful personal tools, but journal analytics are not clinical signals.

## Safeguards implemented

- Strict server-side role authorization and role-specific endpoints
- Journal APIs available only to the owning personnel account
- Journal text/insights never enter organizational scoring
- Optional non-participation contributes **zero** support-priority points
- Disciplinary records contribute **zero** points and are excluded from welfare context
- No false anonymous claim: linked personal check-ins are described honestly as confidential
- Aggregate pulse values suppressed below five respondents
- Explainable factors carry source labels
- Personnel can request review of organizational data
- CSP/security headers, HTTP-only/secure cookie behavior, validation, output escaping and basic sign-in throttling
- Startup reconciliation prevents stale alert reasons after model changes

## Prototype limitations

- The support-priority engine is a transparent rules prototype, **not a clinically validated prediction model**.
- Internal weights are not probabilities of illness, violence, misconduct or operational failure.
- Biometric integration is not included; future use requires legal authority, explicit purpose, minimization, security and meaningful authorization.
- Production requires force SSO/MFA, encryption/key management, retention governance, clinical/legal oversight, validation and independent security testing.
- Demo data is simulated and must not be treated as real CAPF data.

## Run locally

Requires Node.js 22+ (`node:sqlite`).

```bash
git clone https://github.com/ZaidCodesin/SIH2026-PS26186.git
cd SIH2026-PS26186
npm install
npm run seed
npm test
npm start
```

Open `http://localhost:4400`.

Prototype evaluator accounts (password `demo123`):

- Personnel: `sepoy.demo`
- Welfare Officer: `welfare`
- Commander: `commander`
- Any seeded personnel service ID: `CRPF100001` through `CRPF100150`

Service-ID accounts are provisioned on first successful prototype sign-in, so
existing demo databases gain personnel access without being reset. Set
`DEMO_ACCOUNTS=false` to disable this behavior or set
`DEMO_PERSONNEL_PASSWORD` to change the shared prototype password.

Credentials appear only inside the explicit **Demo credentials** disclosure, not as production-style quick-login buttons.

## Automated validation

`npm test` creates a temporary SQLite database, starts an isolated server and
verifies service-ID login, all roles, cross-role denials, workload/self-report
transparency, correction and intervention workflows, commander minimization,
journal privacy, risk exclusions, WHO-5 scoring and journal insights. The
temporary database is removed afterward; the working database is never used.

## Main files

```text
server.js                 API, sessions, role authorization and dashboards
lib/db.js                 SQLite schema and migrations
lib/risk.js               Explainable support-priority rules
lib/recommend.js          Welfare intervention mapping
lib/journal-analyze.js    Private reflective writing statistics
lib/seed.js               Simulated prototype dataset
public/                   Responsive role-specific web application
test-regression.js        Authorization/workflow regression suite
```
