'use strict';
/* SENTINEL — AI-Based Predictive Personnel Stress & Welfare Monitoring System
 * SIH 26186 · MHA / CRPF · Role-based access, privacy-first design.
 */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./lib/db');
const { computeRisk } = require('./lib/risk');
const { recommend } = require('./lib/recommend');
const { analyze: analyzeJournal, speedStats } = require('./lib/journal-analyze');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'");
  next();
});

const PORT = process.env.PORT || 4400;
const APP_VERSION = process.env.RENDER_GIT_COMMIT || process.env.APP_VERSION || 'local-dev';
const todayStr = () => new Date().toISOString().slice(0, 10);

// auto-seed demo data on fresh deploys (e.g. Render free tier with empty disk)
if (db.prepare('SELECT COUNT(*) c FROM personnel').get().c === 0) {
  console.log('Empty database detected — seeding demo data...');
  require('./lib/seed');
  console.log('Running initial risk pipeline...');
  runPipeline();
}

/* ---------------- helpers ---------------- */
function send(res, code, obj) { res.status(code).json(obj); }
function hash(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }

function parseCookies(req) {
  const h = req.headers.cookie || '';
  return Object.fromEntries(h.split(';').map(p => p.trim().split('=').map(decodeURIComponent)).filter(a => a[0]));
}
function getUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid);
  if (!s || s.expires_at < new Date().toISOString()) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id) || null;
}
function requireAuth(roles) {
  return (req, res, next) => {
    const u = getUser(req);
    if (!u) return send(res, 401, { error: 'Not logged in' });
    if (roles && !roles.includes(u.role)) return send(res, 403, { error: 'Not permitted for your role' });
    req.user = u;
    next();
  };
}
function audit(actor, action, target, justification) {
  db.prepare('INSERT INTO audit_log (actor_id, action, target_personnel, justification, at) VALUES (?,?,?,?,?)')
    .run(actor.id || actor, action, target || null, justification || '', new Date().toISOString());
}

const sinceDate = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
function avgNum(rows, key) {
  const values = rows.map(r => Number(r[key])).filter(Number.isFinite);
  return values.length ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : null;
}
function workloadFor(pid, windowDays = 90) {
  const events = db.prepare('SELECT type, date, value, note FROM hr_events WHERE personnel_id = ? AND date >= ? ORDER BY date DESC').all(pid, sinceDate(windowDays));
  const sum = type => events.filter(e => e.type === type).reduce((n, e) => n + Number(e.value || 0), 0);
  const count = type => events.filter(e => e.type === type).length;
  return {
    window_days: windowDays,
    overtime_hours: Math.round(sum('duty_overtime')),
    deployment_starts: count('deployment'), leave_denials: count('leave_denied'),
    incident_exposures: count('incident_exposure'), transfers: count('transfer'),
    training_days: Math.round(sum('training')),
    records: events.filter(e => !['disciplinary'].includes(e.type)).slice(0, 20)
  };
}

/* ---------------- auth ---------------- */
const loginAttempts = new Map();
app.post('/api/login', (req, res) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const attempt = loginAttempts.get(key) || { count: 0, reset: Date.now() + 10 * 60000 };
  if (Date.now() > attempt.reset) { attempt.count = 0; attempt.reset = Date.now() + 10 * 60000; }
  if (attempt.count >= 10) return send(res, 429, { error: 'Too many sign-in attempts. Try again in a few minutes.' });
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!u || hash(String(password || ''), u.salt) !== u.pass_hash) {
    attempt.count++; loginAttempts.set(key, attempt);
    return send(res, 401, { error: 'Invalid credentials' });
  }
  loginAttempts.delete(key);
  const sid = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + 7 * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (sid, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(sid, u.id, new Date().toISOString(), exp);
  const secure = process.env.NODE_ENV === 'production' || req.get('x-forwarded-proto') === 'https';
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure ? '; Secure' : ''}`);
  send(res, 200, { ok: true, role: u.role, name: u.name });
});
app.post('/api/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  send(res, 200, { ok: true });
});
app.get('/api/me', (req, res) => {
  const u = getUser(req);
  if (!u) return send(res, 401, { error: 'Not logged in' });
  send(res, 200, { user: { id: u.id, username: u.username, role: u.role, name: u.name, unit_id: u.unit_id } });
});
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  send(res, 200, { version: APP_VERSION, features: ['WHO5', 'journal-insights-v1'] });
});

/* ==== risk pipeline & API routes appended below ==== */

/* ---------------- risk pipeline ---------------- */
function gatherData(pid, today) {
  const personnel = db.prepare('SELECT * FROM personnel WHERE id = ?').get(pid);
  if (!personnel) return null;
  const hr = db.prepare(`SELECT * FROM hr_events WHERE personnel_id = ? AND date >= ?
    ORDER BY date ASC`).all(pid, new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10));
  const checkins = db.prepare(`SELECT * FROM checkins WHERE personnel_id = ? AND date >= ?
    ORDER BY date ASC`).all(pid, new Date(Date.now() - 65 * 86400000).toISOString().slice(0, 10));
  const assessments = db.prepare(`SELECT * FROM assessments WHERE personnel_id = ? AND date >= ?
    ORDER BY date ASC`).all(pid, new Date(Date.now() - 95 * 86400000).toISOString().slice(0, 10));
  return { personnel, hr, checkins, assessments, today };
}

/** Recompute today's risk for everyone active; raise alerts for Elevated/Critical. */
function runPipeline() {
  const today = todayStr();
  const active = db.prepare('SELECT id FROM personnel WHERE active = 1').all();
  const counts = { Critical: 0, Elevated: 0, Watch: 0, Low: 0 };
  for (const { id } of active) {
    const d = gatherData(id, today);
    if (!d) continue;
    const r = computeRisk(d);
    db.prepare(`INSERT INTO risk_scores (personnel_id, date, score, band, factors) VALUES (?,?,?,?,?)
      ON CONFLICT(personnel_id, date) DO UPDATE SET score=excluded.score, band=excluded.band, factors=excluded.factors`)
      .run(id, today, r.score, r.band, JSON.stringify(r.factors));
    counts[r.band]++;
    if (r.band === 'Elevated' || r.band === 'Critical') {
      const open = db.prepare(`SELECT id FROM alerts WHERE personnel_id = ? AND status IN ('new','acknowledged')
        ORDER BY created_at DESC LIMIT 1`).get(id);
      const top = r.factors.slice(0, 3).map(f => f.label).join('; ');
      if (!open) {
        db.prepare('INSERT INTO alerts (personnel_id, level, reason, created_at, status) VALUES (?,?,?,?,?)')
          .run(id, r.band, `${r.band} support priority: ${top || 'current welfare indicators'}`, new Date().toISOString(), 'new');
      } else db.prepare('UPDATE alerts SET level=?, reason=? WHERE id=?')
        .run(r.band, `${r.band} support priority: ${top || 'current welfare indicators'}`, open.id);
    }
  }
  db.prepare(`UPDATE alerts SET status='dismissed', action_note='Automatically closed: current indicators are below alert threshold'
    WHERE status IN ('new','acknowledged') AND personnel_id IN
    (SELECT personnel_id FROM risk_scores WHERE date=? AND band NOT IN ('Elevated','Critical'))`).run(today);
  return counts;
}
// Reconcile stored snapshots and open alerts whenever scoring rules change or the
// service restarts. This avoids showing decisions produced by an older model.
setImmediate(() => {
  try { runPipeline(); } catch (e) { console.error('Initial model refresh failed:', e.message); }
});

/* ---------------- personnel self-service ---------------- */
app.post('/api/checkin', requireAuth(['personnel']), (req, res) => {
  const { stress, sleep_hours, mood, physical_symptoms, feeling_supported } = req.body || {};
  if (!req.user.personnel_id) return send(res, 400, { error: 'No personnel record linked to this account' });
  const s = Number(stress), sl = Number(sleep_hours);
  if (!(s >= 1 && s <= 10)) return send(res, 400, { error: 'stress must be 1-10' });
  if (!(sl >= 0 && sl <= 14)) return send(res, 400, { error: 'sleep_hours must be 0-14' });
  db.prepare(`INSERT INTO checkins (personnel_id, date, stress, sleep_hours, mood, physical_symptoms, feeling_supported, anonymous)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(personnel_id, date) DO UPDATE SET stress=excluded.stress, sleep_hours=excluded.sleep_hours,
      mood=excluded.mood, physical_symptoms=excluded.physical_symptoms, feeling_supported=excluded.feeling_supported,
      anonymous=0`)
    .run(req.user.personnel_id, todayStr(), s, sl, String(mood || ''), physical_symptoms ? 1 : 0,
      Math.min(5, Math.max(1, Number(feeling_supported) || 3)), 0);
  runPipeline();
  send(res, 200, { ok: true });
});

app.post('/api/assessment', requireAuth(['personnel']), (req, res) => {
  const { type, answers } = req.body || {};
  const spec = {
    WHO5: { count: 5, maxAnswer: 5 },
    PSS10: { count: 10, maxAnswer: 4 },
    GAD7: { count: 7, maxAnswer: 3 },
    PHQ9: { count: 9, maxAnswer: 3 }
  }[type];
  if (!spec) return send(res, 400, { error: 'Unknown assessment type' });
  if (!Array.isArray(answers) || answers.length !== spec.count ||
      answers.some(a => !Number.isInteger(Number(a)) || a < 0 || a > spec.maxAnswer))
    return send(res, 400, { error: `${spec.count} answers with values 0-${spec.maxAnswer} required` });
  const values = answers.map(Number);
  let raw, displayScore, score, level, guidance, urgent = false;
  if (type === 'WHO5') {
    raw = values.reduce((s, a) => s + a, 0);             // 0..25
    displayScore = raw * 4;                               // official 0..100 wellbeing score
    score = 100 - displayScore;                           // normalized support-need direction
    level = displayScore > 50 ? 'Good wellbeing' : displayScore >= 29 ? 'Low wellbeing' : 'Very low wellbeing';
    guidance = displayScore <= 50
      ? 'Your result suggests it may help to speak with a qualified health professional for a fuller assessment.'
      : 'Your answers suggest positive current wellbeing. Continue checking in over time to notice changes.';
  } else if (type === 'PSS10') {
    // Official scoring reverses the four positively stated items (4, 5, 7, 8; zero-based 3,4,6,7).
    raw = values.reduce((s, a, i) => s + ([3,4,6,7].includes(i) ? 4 - a : a), 0);
    displayScore = raw; score = Math.round(raw / 40 * 100);
    level = raw <= 13 ? 'Low perceived stress' : raw <= 26 ? 'Moderate perceived stress' : 'High perceived stress';
    guidance = raw >= 27 ? 'High perceived stress can be worth discussing with a qualified professional.' : 'Use this result as a personal baseline and look for changes over time.';
  } else if (type === 'GAD7') {
    raw = values.reduce((s, a) => s + a, 0); displayScore = raw; score = Math.round(raw / 21 * 100);
    level = raw <= 4 ? 'Minimal anxiety' : raw <= 9 ? 'Mild anxiety' : raw <= 14 ? 'Moderate anxiety' : 'Severe anxiety';
    guidance = raw >= 10 ? 'This screening result supports considering a conversation with a qualified health professional.' : 'Track how these feelings change; seek support whenever they interfere with daily life.';
  } else {
    raw = values.reduce((s, a) => s + a, 0); displayScore = raw; score = Math.round(raw / 27 * 100);
    level = raw <= 4 ? 'Minimal symptoms' : raw <= 9 ? 'Mild symptoms' : raw <= 14 ? 'Moderate symptoms' : raw <= 19 ? 'Moderately severe symptoms' : 'Severe symptoms';
    urgent = values[8] > 0;
    if (urgent) score = Math.max(60, score); // safety signal; displayed PHQ-9 total remains unchanged
    guidance = urgent ? 'You indicated thoughts of self-harm or being better off dead. Please contact immediate support now and do not stay alone.'
      : raw >= 10 ? 'This screening result supports considering a conversation with a qualified health professional.' : 'Track changes over time and reach out if symptoms persist or worsen.';
  }
  db.prepare('INSERT INTO assessments (personnel_id, date, type, score, answers) VALUES (?,?,?,?,?)')
    .run(req.user.personnel_id, todayStr(), type, score, JSON.stringify(values));
  runPipeline();
  send(res, 200, { ok: true, type, raw, display_score: displayScore, risk_score: score, level, guidance, urgent });
});

app.get('/api/my-status', requireAuth(['personnel']), (req, res) => {
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const today = todayStr();
  const d = gatherData(pid, today);
  const r = d ? computeRisk(d) : { score: 0, band: 'Low', factors: [] };
  const mine = db.prepare(`SELECT date, stress, sleep_hours, mood, feeling_supported FROM checkins WHERE personnel_id = ? ORDER BY date DESC LIMIT 30`).all(pid);
  const accessed = db.prepare(`SELECT a.action, a.at, u.name AS actor, u.role FROM audit_log a
    JOIN users u ON u.id = a.actor_id WHERE a.target_personnel = ? ORDER BY a.at DESC LIMIT 10`).all(pid);
  const asmts = db.prepare(`SELECT date, type, score FROM assessments WHERE personnel_id = ? ORDER BY date DESC, id DESC LIMIT 20`).all(pid);
  const corrections = db.prepare(`SELECT id, category, message, created_at, status, resolution_note FROM data_corrections
    WHERE personnel_id = ? ORDER BY created_at DESC LIMIT 10`).all(pid);
  const workload = workloadFor(pid);
  const recent = mine.slice(0, 7);
  const selfReport = { responses: recent.length, stress: avgNum(recent, 'stress'), sleep: avgNum(recent, 'sleep_hours'), supported: avgNum(recent, 'feeling_supported') };
  const orgPressure = workload.overtime_hours >= 40 || workload.deployment_starts >= 2 || workload.incident_exposures > 0 || workload.leave_denials >= 2;
  const feltPressure = selfReport.stress !== null && selfReport.stress >= 6;
  const comparison = !recent.length ? 'No recent self-report to compare' : orgPressure === feltPressure
    ? (orgPressure ? 'Recorded workload and your check-ins both indicate pressure' : 'Recorded workload and your check-ins are currently aligned')
    : orgPressure ? 'Work records show pressure, while your check-ins are steadier' : 'Your check-ins show more pressure than work records alone suggest';
  send(res, 200, { risk: { ...r, model: 'transparent rules prototype', updated_at: new Date().toISOString(), evidence_count: r.factors.length },
    checkins: mine.reverse(), accessed, assessments: asmts, workload, self_report: selfReport, comparison, corrections });
});

app.post('/api/my-data/correction', requireAuth(['personnel']), (req, res) => {
  const pid = req.user.personnel_id;
  const category = String(req.body && req.body.category || '').trim();
  const message = String(req.body && req.body.message || '').trim();
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  if (!['workload', 'leave', 'deployment', 'profile', 'other'].includes(category) || message.length < 10 || message.length > 1000)
    return send(res, 400, { error: 'Choose a category and provide 10–1000 characters' });
  db.prepare('INSERT INTO data_corrections (personnel_id, category, message, created_at) VALUES (?,?,?,?)')
    .run(pid, category, message, new Date().toISOString());
  audit(req.user, 'request_data_correction', pid, category);
  send(res, 200, { ok: true });
});

/* ---------------- welfare officer: flagged roster ---------------- */
app.get('/api/dashboard/roster', requireAuth(['welfare']), (req, res) => {
  const today = todayStr();
  const rows = db.prepare(`SELECT rs.score, rs.band, rs.factors, p.id, p.force_id, p.rank, p.name, u.name AS unit
    FROM risk_scores rs JOIN personnel p ON p.id = rs.personnel_id JOIN units u ON u.id = p.unit_id
    WHERE rs.date = ? AND rs.band IN ('Watch','Elevated','Critical')
    ORDER BY CASE rs.band WHEN 'Critical' THEN 0 WHEN 'Elevated' THEN 1 ELSE 2 END, rs.score DESC`).all(today);
  send(res, 200, { roster: rows.map(r => ({ ...r, factors: JSON.parse(r.factors) })) });
});

app.get('/api/welfare/overview', requireAuth(['welfare']), (req, res) => {
  const today = todayStr();
  const bands = Object.fromEntries(['Low','Watch','Elevated','Critical'].map(b => [b,
    db.prepare('SELECT COUNT(*) c FROM risk_scores WHERE date=? AND band=?').get(today, b).c]));
  const alerts = db.prepare(`SELECT status, COUNT(*) c FROM alerts GROUP BY status`).all();
  const interventions = db.prepare(`SELECT status, COUNT(*) c FROM interventions GROUP BY status`).all();
  const corrections = db.prepare(`SELECT d.id,d.category,d.message,d.created_at,d.status,p.id personnel_id,p.rank,p.name,p.force_id
    FROM data_corrections d JOIN personnel p ON p.id=d.personnel_id WHERE d.status IN ('submitted','reviewing')
    ORDER BY CASE d.status WHEN 'submitted' THEN 0 ELSE 1 END, d.created_at`).all();
  send(res, 200, { bands, alerts: Object.fromEntries(alerts.map(x=>[x.status,x.c])),
    interventions: Object.fromEntries(interventions.map(x=>[x.status,x.c])), corrections });
});

app.post('/api/data-corrections/:id', requireAuth(['welfare']), (req, res) => {
  const row = db.prepare('SELECT * FROM data_corrections WHERE id=?').get(req.params.id);
  if (!row) return send(res, 404, { error: 'Request not found' });
  const status = ['reviewing','resolved','declined'].includes(req.body && req.body.status) ? req.body.status : 'reviewing';
  const note = String(req.body && req.body.resolution_note || '').slice(0, 1000);
  db.prepare('UPDATE data_corrections SET status=?,resolved_by=?,resolution_note=? WHERE id=?').run(status, req.user.id, note, row.id);
  audit(req.user, 'data_correction_' + status, row.personnel_id, note);
  send(res, 200, { ok: true });
});

app.get('/api/personnel/:id', requireAuth(['welfare']), (req, res) => {
  const p = db.prepare(`SELECT p.*, u.name AS unit FROM personnel p JOIN units u ON u.id = p.unit_id WHERE p.id = ?`).get(req.params.id);
  if (!p) return send(res, 404, { error: 'Not found' });
  audit(req.user, 'view_profile', p.id, req.query.justification || 'welfare review');
  const today = todayStr();
  const d = gatherData(p.id, today);
  const risk = computeRisk(d);
  const hr = db.prepare("SELECT * FROM hr_events WHERE personnel_id = ? AND type <> 'disciplinary' ORDER BY date DESC LIMIT 40").all(p.id);
  const checkins = db.prepare('SELECT date, stress, sleep_hours, mood FROM checkins WHERE personnel_id = ? ORDER BY date ASC').all(p.id);
  const history = db.prepare('SELECT date, score, band FROM risk_scores WHERE personnel_id = ? ORDER BY date ASC').all(p.id);
  const interventions = db.prepare('SELECT * FROM interventions WHERE personnel_id = ? ORDER BY recommended_at DESC').all(p.id);
  const alerts = db.prepare('SELECT * FROM alerts WHERE personnel_id = ? ORDER BY created_at DESC LIMIT 10').all(p.id);
  send(res, 200, { personnel: p, risk, hr, checkins, history, interventions, alerts });
});

/* ---------------- private reflective journal (merged from seven50) ----------------
 * STRICTLY PRIVATE: readable/writable only by the owning personnel account.
 * Journal content is NEVER returned to welfare/commander roles and is NOT an
 * input to the risk engine — this is the personnel's own space. */
const J_GOAL = 750, J_BLUE = 400, J_STREAK_MIN = 250;
function jWords(t) { t = String(t || '').trim(); return t ? t.split(/\s+/).length : 0; }

const JOURNAL_LEVELS = [
  [0, 'Blank Page'], [3, 'Inkling'], [7, 'Steady Hand'], [14, 'Momentum'],
  [30, 'Habit Builder'], [60, 'Wordsmith'], [100, 'Marathoner'], [180, 'Devoted'], [365, 'Legend of the Page']
];
function journalLevel(points) {
  let name = JOURNAL_LEVELS[0][1];
  for (const [at, n] of JOURNAL_LEVELS) if (points >= at) name = n;
  const next = JOURNAL_LEVELS.find(([at]) => at > points);
  return { name, points, nextAt: next ? next[0] : null };
}
function journalStats(pid) {
  const rows = db.prepare('SELECT date, words, time_sec FROM journal_entries WHERE personnel_id = ? ORDER BY date').all(pid);
  const goalDates = new Set(rows.filter(r => r.words >= J_GOAL).map(r => r.date));
  const totalWords = rows.reduce((n, r) => n + r.words, 0);
  const totalTime = rows.reduce((n, r) => n + (r.time_sec || 0), 0);
  let current = 0, d = new Date();
  if (!goalDates.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  while (goalDates.has(d.toISOString().slice(0, 10))) { current++; d.setUTCDate(d.getUTCDate() - 1); }
  let longest = 0, run = 0, previous = null;
  for (const date of [...goalDates].sort()) {
    run = previous && (new Date(date) - new Date(previous)) / 86400000 === 1 ? run + 1 : 1;
    previous = date; longest = Math.max(longest, run);
  }
  const badges = [];
  for (const n of [3, 7, 14, 30, 60, 100, 365]) if (longest >= n) badges.push({ type: 'streak', label: `${n}-day streak` });
  for (const n of [1000, 10000, 25000, 50000, 100000, 250000]) if (totalWords >= n) badges.push({ type: 'words', label: `${n.toLocaleString()} total words` });
  const byDate = Object.fromEntries(rows.map(r => [r.date, r.words]));
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(); dt.setUTCDate(dt.getUTCDate() - i);
    const date = dt.toISOString().slice(0, 10);
    last30.push({ date, words: byDate[date] || 0 });
  }
  return {
    total_words: totalWords, total_days: rows.filter(r => r.words > 0).length,
    current_streak: current, longest_streak: longest, avg_words: rows.length ? Math.round(totalWords / rows.length) : 0,
    green_days: goalDates.size, total_time_min: Math.round(totalTime / 60), points: goalDates.size,
    level: journalLevel(goalDates.size), badges, last30
  };
}

app.get('/api/journal/overview', requireAuth(['personnel']), (req, res) => {
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const days = db.prepare(`SELECT date, words, time_sec FROM journal_entries
    WHERE personnel_id = ? AND date >= ? ORDER BY date ASC`)
    .all(pid, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const map = new Map(days.map(d => [d.date, d.words]));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const dt = new Date(); dt.setUTCDate(dt.getUTCDate() - i);
    const w = map.get(dt.toISOString().slice(0, 10));
    if (w !== undefined && w >= J_STREAK_MIN) streak++;
    else if (i === 0) continue; // today not written yet — don't break the streak view
    else break;
  }
  const totals = db.prepare('SELECT COUNT(*) days, COALESCE(SUM(words),0) tw FROM journal_entries WHERE personnel_id = ?').get(pid);
  send(res, 200, { days, streak, total_days: totals.days, total_words: totals.tw });
});

app.get('/api/journal/stats', requireAuth(['personnel']), (req, res) => {
  if (!req.user.personnel_id) return send(res, 400, { error: 'No personnel record linked' });
  send(res, 200, journalStats(req.user.personnel_id));
});

app.get('/api/journal/analysis/list', requireAuth(['personnel']), (req, res) => {
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const days = db.prepare(`SELECT date, words, started_at, updated_at FROM journal_entries
    WHERE personnel_id = ? AND words > 0 ORDER BY date DESC LIMIT 500`).all(pid);
  send(res, 200, { days });
});

app.get('/api/journal/analysis/:date', requireAuth(['personnel']), (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return send(res, 400, { error: 'Bad date format' });
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const row = db.prepare(`SELECT date, content, words, time_sec, timeline, started_at, updated_at
    FROM journal_entries WHERE personnel_id = ? AND date = ?`).get(pid, req.params.date);
  if (!row) return send(res, 404, { error: 'No journal entry for that date' });
  let timeline = [];
  try { timeline = JSON.parse(row.timeline || '[]'); } catch {}
  send(res, 200, {
    date: row.date, words: row.words, time_sec: row.time_sec, started_at: row.started_at,
    updated_at: row.updated_at, analysis: analyzeJournal(row.content), timeline,
    speed: speedStats(timeline, row.words, row.time_sec)
  });
});

app.get('/api/journal/:date', requireAuth(['personnel']), (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return send(res, 400, { error: 'Bad date format' });
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const e = db.prepare(`SELECT date, content, words, time_sec, timeline, started_at, updated_at FROM journal_entries
    WHERE personnel_id = ? AND date = ?`).get(pid, req.params.date) || null;
  send(res, 200, { entry: e });
});

app.post('/api/journal', requireAuth(['personnel']), (req, res) => {
  const { date, content, time_sec, timeline, started_at } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return send(res, 400, { error: 'Bad date format' });
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const words = jWords(content);
  const prev = db.prepare('SELECT time_sec FROM journal_entries WHERE personnel_id = ? AND date = ?').get(pid, date);
  const t = Math.max(Number(time_sec) || 0, prev ? prev.time_sec : 0);
  const safeTimeline = Array.isArray(timeline) ? timeline.slice(-2000).filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
    .map(p => [Math.max(0, Math.round(+p[0])), Math.max(0, Math.round(+p[1]))]) : [];
  const prior = db.prepare('SELECT timeline, started_at FROM journal_entries WHERE personnel_id = ? AND date = ?').get(pid, date);
  const timelineJson = safeTimeline.length ? JSON.stringify(safeTimeline) : (prior ? prior.timeline : '[]');
  const started = String(started_at || (prior && prior.started_at) || '').slice(0, 40);
  db.prepare(`INSERT INTO journal_entries (personnel_id, date, content, words, time_sec, updated_at, timeline, started_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(personnel_id, date) DO UPDATE SET content = excluded.content, words = excluded.words,
      time_sec = excluded.time_sec, updated_at = excluded.updated_at,
      timeline = excluded.timeline, started_at = excluded.started_at`)
    .run(pid, date, String(content || ''), words, t, new Date().toISOString(), timelineJson, started);
  send(res, 200, { ok: true, words, saved_at: new Date().toISOString() });
});

/* ---------------- alerts & interventions ---------------- */
app.get('/api/alerts', requireAuth(['welfare']), (req, res) => {
  const rows = db.prepare(`SELECT a.*, p.name, p.rank, p.force_id, u.name AS unit FROM alerts a
    JOIN personnel p ON p.id = a.personnel_id JOIN units u ON u.id = p.unit_id
    ORDER BY CASE a.level WHEN 'Critical' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 100`).all();
  send(res, 200, { alerts: rows });
});

app.post('/api/alerts/:id', requireAuth(['welfare']), (req, res) => {
  const a = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!a) return send(res, 404, { error: 'Alert not found' });
  const { status, action_note, interventions: recs } = req.body || {};
  const nextStatus = ['acknowledged', 'actioned', 'dismissed'].includes(status) ? status : null;
  if (!nextStatus) return send(res, 400, { error: 'Invalid alert status' });
  db.prepare('UPDATE alerts SET status = ?, acted_by = ?, action_note = ? WHERE id = ?')
    .run(nextStatus,
      req.user.id, String(action_note || ''), a.id);
  if (Array.isArray(recs)) {
    for (const r of recs.slice(0, 6)) {
      db.prepare('INSERT INTO interventions (personnel_id, type, reason, recommended_at, status) VALUES (?,?,?,?,?)')
        .run(a.personnel_id, String(r.type || 'peer_support'), String(r.reason || ''), new Date().toISOString(), 'recommended');
    }
  }
  audit(req.user, 'alert_' + nextStatus, a.personnel_id, action_note || '');
  send(res, 200, { ok: true });
});

app.post('/api/interventions/recommend', requireAuth(['welfare']), (req, res) => {
  const { personnel_id, recs } = req.body || {};
  const p = db.prepare('SELECT id FROM personnel WHERE id = ?').get(personnel_id);
  if (!p) return send(res, 404, { error: 'Personnel not found' });
  for (const r of (Array.isArray(recs) ? recs : []).slice(0, 6)) {
    db.prepare('INSERT INTO interventions (personnel_id, type, reason, recommended_at, status) VALUES (?,?,?,?,?)')
      .run(p.id, String(r.type || 'peer_support'), String(r.reason || ''), new Date().toISOString(), 'recommended');
  }
  audit(req.user, 'recommend_intervention', p.id, (recs || []).map(r => r.type).join(','));
  send(res, 200, { ok: true });
});
app.post('/api/interventions/:id', requireAuth(['welfare']), (req, res) => {
  const iv = db.prepare('SELECT * FROM interventions WHERE id = ?').get(req.params.id);
  if (!iv) return send(res, 404, { error: 'Not found' });
  const { status, outcome_note } = req.body || {};
  const nextStatus = ['accepted', 'completed', 'declined'].includes(status) ? status : null;
  if (!nextStatus) return send(res, 400, { error: 'Invalid intervention status' });
  db.prepare('UPDATE interventions SET status = ?, completed_at = ?, outcome_note = ? WHERE id = ?')
    .run(nextStatus,
      nextStatus === 'completed' ? new Date().toISOString() : iv.completed_at,
      String(outcome_note || iv.outcome_note), iv.id);
  audit(req.user, 'intervention_' + nextStatus, iv.personnel_id, outcome_note || '');
  send(res, 200, { ok: true });
});

/* ---------------- transparency: access log ---------------- */
app.get('/api/audit', requireAuth(['welfare']), (req, res) => {
  const rows = db.prepare(`SELECT a.action, a.at, a.justification, u.name AS actor, u.role,
    p.name AS target FROM audit_log a JOIN users u ON u.id = a.actor_id
    LEFT JOIN personnel p ON p.id = a.target_personnel ORDER BY a.at DESC LIMIT 50`).all();
  send(res, 200, { audit: rows });
});

/* ---------------- risk pipeline trigger ---------------- */
app.post('/api/recalculate', requireAuth(['welfare']), (req, res) => {
  const counts = runPipeline();
  audit(req.user, 'recalculate', null, 'manual pipeline run');
  send(res, 200, { ok: true, counts });
});

/* ---------------- commander dashboard (aggregated + k-anonymized) ---------------- */
const K_MIN = 5; // never expose a group smaller than 5 personnel

app.get('/api/dashboard/unit', requireAuth(['commander']), (req, res) => {
  const today = todayStr();
  const units = db.prepare('SELECT * FROM units').all();
  const out = units.map(u => {
    const strength = db.prepare('SELECT COUNT(*) c FROM personnel WHERE unit_id = ? AND active = 1').get(u.id).c;
    const pulse = db.prepare(`SELECT COUNT(DISTINCT c.personnel_id) respondents, AVG(stress) stress, AVG(sleep_hours) sleep
      FROM checkins c JOIN personnel p ON p.id = c.personnel_id WHERE p.unit_id = ? AND c.date >= ?`).get(u.id, sinceDate(14));
    const work = db.prepare(`SELECT e.type, COUNT(*) c, COALESCE(SUM(e.value),0) total FROM hr_events e
      JOIN personnel p ON p.id=e.personnel_id WHERE p.unit_id=? AND e.date>=? AND e.type IN
      ('duty_overtime','deployment','leave_denied','incident_exposure','transfer','training') GROUP BY e.type`).all(u.id, sinceDate(90));
    const wm = Object.fromEntries(work.map(x=>[x.type,x]));
    return { unit: u.name, region: u.region, strength,
      pulse: pulse.respondents >= K_MIN ? { respondents:pulse.respondents, avg_stress:+pulse.stress.toFixed(1), avg_sleep:+pulse.sleep.toFixed(1) }
        : { respondents:pulse.respondents, avg_stress:null, avg_sleep:null, suppressed:true },
      workload: { overtime_hours:Math.round(wm.duty_overtime?.total||0), overtime_per_person:+((wm.duty_overtime?.total||0)/Math.max(strength,1)).toFixed(1), deployments:wm.deployment?.c||0,
        leave_denials:wm.leave_denied?.c||0, incidents:wm.incident_exposure?.c||0, transfers:wm.transfer?.c||0,
        training_days:Math.round(wm.training?.total||0) } };
  });
  const trend = db.prepare(`SELECT date, AVG(score) a, SUM(CASE WHEN band IN ('Elevated','Critical') THEN 1 ELSE 0 END) flagged
    FROM risk_scores WHERE date >= ? GROUP BY date ORDER BY date`).all(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const totals = out.reduce((a,u)=>{for(const k of Object.keys(a))a[k]+=u.workload[k]||0;return a;},
    {overtime_hours:0,deployments:0,leave_denials:0,incidents:0,transfers:0,training_days:0});
  const actions = [];
  const highOt = [...out].sort((a,b)=>b.workload.overtime_per_person-a.workload.overtime_per_person)[0];
  if (highOt && highOt.workload.overtime_hours) actions.push({ domain:'Demand', unit:highOt.unit, action:'Review duty roster and recovery time', evidence:`${highOt.workload.overtime_per_person} overtime hours per active person in 90 days (${highOt.workload.overtime_hours} total)` });
  const highLeave = [...out].sort((a,b)=>(b.workload.leave_denials/b.strength)-(a.workload.leave_denials/a.strength))[0];
  if (highLeave && highLeave.workload.leave_denials) actions.push({ domain:'Support', unit:highLeave.unit, action:'Review leave constraints and family-contact opportunities', evidence:`${highLeave.workload.leave_denials} leave denials recorded in 90 days` });
  const highInc = [...out].sort((a,b)=>b.workload.incidents-a.workload.incidents)[0];
  if (highInc && highInc.workload.incidents) actions.push({ domain:'Support', unit:highInc.unit, action:'Confirm post-incident decompression and voluntary support', evidence:`${highInc.workload.incidents} incident exposures recorded in 90 days` });
  send(res, 200, { units: out, totals, actions, trend, privacy:{k_min:K_MIN, note:'Pulse values are suppressed below five respondents; commanders receive no individual wellbeing records.'} });
});

// Never let an old HTML/app.js stay paired with a newly deployed API. Assets such
// as CSS/images may still be revalidated by the browser, but application shells
// are always fetched fresh after a Render deployment.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(?:html|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store, must-revalidate');
    else res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  }
}));
app.listen(PORT, () => console.log(`SENTINEL running → http://localhost:${PORT}`));
