'use strict';
/* SENTINEL — Predictive Risk Engine
 * Hybrid model: transparent weighted multi-factor scoring + trend detection.
 * Every score ships with explainable contributing factors (ethical-AI requirement).
 */

const FACTORS = [
  { key: 'leave_denials',   label: 'Repeated leave denials',            max: 14 },
  { key: 'overtime',        label: 'Sustained overtime / duty load',    max: 14 },
  { key: 'deployment',      label: 'Prolonged deployment pressure',     max: 12 },
  { key: 'family_sep',      label: 'Prolonged family separation',       max: 10 },
  { key: 'incidents',       label: 'Recent traumatic incident exposure',max: 12 },
  { key: 'stress_trend',    label: 'Rising self-reported stress',       max: 14 },
  { key: 'sleep',           label: 'Sleep degradation',                 max: 10 },
  { key: 'assessment',      label: 'High standardized wellness assessment score', max: 14 },
  { key: 'transfers',       label: 'Frequent transfers / instability',  max: 6 }
];
// Internal rule weights are used to assign broad support-priority bands.

function days(a, b) { return Math.round((a - b) / 86400000); }
function dparse(s) { return new Date(s + 'T00:00:00Z').getTime(); }

/**
 * @param {object} d  aggregated data for one personnel member
 *   hr, checkins, assessments: recent rows; personnel: row; today: 'YYYY-MM-DD'
 */
function computeRisk(d, config = {}) {
  const cfg = Object.assign({ watch: 35, elevated: 55, critical: 70 }, config);
  const today = dparse(d.today);
  const out = [];

  /* ---- HR-based factors ---- */
  const denials90 = d.hr.filter(e => e.type === 'leave_denied' && days(today, dparse(e.date)) <= 90);
  if (denials90.length >= 2) {
    out.push({ key: 'leave_denials', points: Math.min(14, denials90.length * 3.5),
      detail: `${denials90.length} leave requests denied in last 90 days` });
  }

  const ot = d.hr.filter(e => e.type === 'duty_overtime');
  const ot60 = ot.filter(e => days(today, dparse(e.date)) <= 60).reduce((s, e) => s + e.value, 0);
  const otPrev60 = ot.filter(e => { const dd = days(today, dparse(e.date)); return dd > 60 && dd <= 120; })
    .reduce((s, e) => s + e.value, 0);
  if (ot60 >= 40 || (otPrev60 > 0 && ot60 > otPrev60 * 1.4)) {
    out.push({ key: 'overtime', points: Math.min(14, 6 + ot60 / 20),
      detail: `${Math.round(ot60)} extra duty hours in 60 days${otPrev60 > 0 && ot60 > otPrev60 * 1.4 ? ' (rising trend)' : ''}` });
  }

  const deployments = d.hr.filter(e => e.type === 'deployment' && days(today, dparse(e.date)) <= 365);
  const returns = d.hr.filter(e => e.type === 'return_from_deployment').sort((a,b)=>b.date.localeCompare(a.date));
  const latestDep = [...deployments].sort((a,b)=>b.date.localeCompare(a.date))[0];
  const elapsed = latestDep ? days(today, dparse(latestDep.date)) : Infinity;
  const expectedDays = latestDep ? Math.max(1, Number(latestDep.value) || 180) : 0;
  const onDepNow = latestDep && (!returns[0] || latestDep.date > returns[0].date) && elapsed <= expectedDays;
  if (onDepNow || deployments.length >= 2) {
    out.push({ key: 'deployment', points: deployments.length >= 2 ? 12 : 7,
      detail: deployments.length >= 2 ? `${deployments.length} deployments in past year` : `Active deployment recorded (${elapsed} days)` });
  }

  const lastVisit = d.hr.filter(e => e.type === 'family_visit').sort((a, b) => b.date.localeCompare(a.date))[0];
  const sinceVisit = lastVisit ? days(today, dparse(lastVisit.date)) : 0;
  if (d.personnel.family_status !== 'single' && sinceVisit >= 180) {
    out.push({ key: 'family_sep', points: Math.min(10, 5 + (sinceVisit - 180) / 40),
      detail: `No recorded family visit for ${Math.floor(sinceVisit / 30)} months` });
  }

  const incidents = d.hr.filter(e => e.type === 'incident_exposure' && days(today, dparse(e.date)) <= 90);
  if (incidents.length) {
    out.push({ key: 'incidents', points: Math.min(12, 6 + (incidents.length - 1) * 3 + (days(today, dparse(incidents[incidents.length - 1].date)) < 14 ? 2 : 0)),
      detail: `${incidents.length} incident exposure${incidents.length > 1 ? 's' : ''} in 90 days` });
  }

  const transfers = d.hr.filter(e => e.type === 'transfer' && days(today, dparse(e.date)) <= 365);
  if (transfers.length >= 2) {
    out.push({ key: 'transfers', points: Math.min(6, transfers.length * 3),
      detail: `${transfers.length} transfers in past year` });
  }

  addWellnessFactors(d, today, out);

  /* ---- normalize & band ---- */
  const raw = out.reduce((s, f) => s + f.points, 0);
  // factor weights total 120 but are calibrated so a realistic multi-factor
  // case lands 60-100; normalize against 100 (capped) for actionable bands
  const score = Math.min(100, Math.round(raw));
  const band = score >= cfg.critical ? 'Critical' : score >= cfg.elevated ? 'Elevated' : score >= cfg.watch ? 'Watch' : 'Low';
  const factors = out
    .map(f => ({ key: f.key, label: FACTORS.find(x => x.key === f.key).label,
      points: Math.round(f.points * 10) / 10, max: f.max, detail: f.detail,
      source: ['stress_trend','sleep','assessment'].includes(f.key) ? 'voluntary wellness' : 'organizational record' }))
    .sort((x, y) => y.points - x.points);

  return { score, band, factors };
}

/* ---- self-reported wellness factors (shared tail of computeRisk) ---- */
function addWellnessFactors(d, today, out) {
  const c = d.checkins;
  if (c.length >= 4) {
    const recent = c.slice(-7);
    const older = c.slice(0, Math.max(0, c.length - 7));
    const avg = a => a.reduce((s, x) => s + x.stress, 0) / a.length;
    const rAvg = avg(recent), oAvg = older.length ? avg(older) : rAvg;
    const highStress = rAvg >= 6.5;
    if (highStress || rAvg - oAvg >= 1.5) {
      out.push({ key: 'stress_trend', points: Math.min(14, (highStress ? 8 : 4) + Math.max(0, rAvg - oAvg) * 2.5),
        detail: `Avg stress ${rAvg.toFixed(1)}/10${rAvg - oAvg >= 1.5 ? `, up from ${oAvg.toFixed(1)}` : ''}` });
    }

    const sl = c.slice(-14);
    const slAvg = sl.reduce((s, x) => s + x.sleep_hours, 0) / sl.length;
    const slEarly = c.slice(0, Math.max(0, c.length - 14));
    const slEarlyAvg = slEarly.length ? slEarly.reduce((s, x) => s + x.sleep_hours, 0) / slEarly.length : slAvg;
    if (slAvg < 6 || slEarlyAvg - slAvg >= 1.2) {
      out.push({ key: 'sleep', points: Math.min(10, (slAvg < 6 ? 6 : 3) + Math.max(0, slEarlyAvg - slAvg) * 2),
        detail: `Avg sleep ${slAvg.toFixed(1)}h${slEarlyAvg - slAvg >= 1.2 ? `, down from ${slEarlyAvg.toFixed(1)}h` : ''}` });
    }
  }

  const a = d.assessments.filter(x => Math.round((today - new Date(x.date + 'T00:00:00Z').getTime()) / 86400000) <= 60);
  const worst = a.reduce((m, x) => Math.max(m, x.score), 0);
  if (worst >= 60) {
    out.push({ key: 'assessment', points: Math.min(14, 7 + (worst - 60) / 4),
      detail: 'Recent standardized screening indicated that supportive follow-up may help' });
  }
}

module.exports = { computeRisk, FACTORS };

