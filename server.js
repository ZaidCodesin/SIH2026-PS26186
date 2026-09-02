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

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 4400;
const todayStr = () => new Date().toISOString().slice(0, 10);

// auto-seed demo data on fresh deploys (e.g. Render free tier with empty disk)
if (db.prepare('SELECT COUNT(*) c FROM personnel').get().c === 0) {
  console.log('Empty database detected — seeding demo data...');
  require('./lib/seed');
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

/* ---------------- auth ---------------- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!u || hash(String(password || ''), u.salt) !== u.pass_hash) return send(res, 401, { error: 'Invalid credentials' });
  const sid = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + 7 * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (sid, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(sid, u.id, new Date().toISOString(), exp);
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
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
        AND created_at >= ?`).get(id, new Date(Date.now() - 7 * 86400000).toISOString());
      if (!open) {
        const top = r.factors.slice(0, 3).map(f => f.label).join('; ');
        db.prepare('INSERT INTO alerts (personnel_id, level, reason, created_at, status) VALUES (?,?,?,?,?)')
          .run(id, r.band, `${r.band} risk (${r.score}/100): ${top || 'welfare indicators'}`, new Date().toISOString(), 'new');
      }
    }
  }
  return counts;
}

/* ---------------- personnel self-service ---------------- */
app.post('/api/checkin', requireAuth(['personnel']), (req, res) => {
  const { stress, sleep_hours, mood, physical_symptoms, feeling_supported, anonymous } = req.body || {};
  if (!req.user.personnel_id) return send(res, 400, { error: 'No personnel record linked to this account' });
  const s = Number(stress), sl = Number(sleep_hours);
  if (!(s >= 1 && s <= 10)) return send(res, 400, { error: 'stress must be 1-10' });
  if (!(sl >= 0 && sl <= 14)) return send(res, 400, { error: 'sleep_hours must be 0-14' });
  db.prepare(`INSERT INTO checkins (personnel_id, date, stress, sleep_hours, mood, physical_symptoms, feeling_supported, anonymous)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(personnel_id, date) DO UPDATE SET stress=excluded.stress, sleep_hours=excluded.sleep_hours,
      mood=excluded.mood, physical_symptoms=excluded.physical_symptoms, feeling_supported=excluded.feeling_supported`)
    .run(req.user.personnel_id, todayStr(), s, sl, String(mood || ''), physical_symptoms ? 1 : 0,
      Math.min(5, Math.max(1, Number(feeling_supported) || 3)), anonymous ? 1 : 0);
  runPipeline();
  send(res, 200, { ok: true });
});

app.post('/api/assessment', requireAuth(['personnel']), (req, res) => {
  const { type, answers } = req.body || {};
  if (!['PSS10'].includes(type)) return send(res, 400, { error: 'Unknown assessment type' });
  if (!Array.isArray(answers) || answers.length !== 10 || answers.some(a => !(a >= 0 && a <= 4)))
    return send(res, 400, { error: '10 answers with values 0-4 required' });
  // PSS-10 style: score normalized to 0-100
  const raw = answers.reduce((s, a) => s + Number(a), 0); // 0..40
  const score = Math.round((raw / 40) * 100);
  db.prepare('INSERT INTO assessments (personnel_id, date, type, score, answers) VALUES (?,?,?,?,?)')
    .run(req.user.personnel_id, todayStr(), type, score, JSON.stringify(answers));
  runPipeline();
  send(res, 200, { ok: true, score });
});

app.get('/api/my-status', requireAuth(['personnel']), (req, res) => {
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const today = todayStr();
  const d = gatherData(pid, today);
  const r = d ? computeRisk(d) : { score: 0, band: 'Low', factors: [] };
  const mine = db.prepare(`SELECT date, stress, sleep_hours FROM checkins WHERE personnel_id = ? ORDER BY date DESC LIMIT 30`).all(pid);
  const accessed = db.prepare(`SELECT a.action, a.at, u.name AS actor, u.role FROM audit_log a
    JOIN users u ON u.id = a.actor_id WHERE a.target_personnel = ? ORDER BY a.at DESC LIMIT 10`).all(pid);
  send(res, 200, { risk: r, checkins: mine.reverse(), accessed });
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

app.get('/api/personnel/:id', requireAuth(['welfare']), (req, res) => {
  const p = db.prepare(`SELECT p.*, u.name AS unit FROM personnel p JOIN units u ON u.id = p.unit_id WHERE p.id = ?`).get(req.params.id);
  if (!p) return send(res, 404, { error: 'Not found' });
  audit(req.user, 'view_profile', p.id, req.query.justification || 'welfare review');
  const today = todayStr();
  const d = gatherData(p.id, today);
  const risk = computeRisk(d);
  const hr = db.prepare('SELECT * FROM hr_events WHERE personnel_id = ? ORDER BY date DESC LIMIT 40').all(p.id);
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

app.get('/api/journal/:date', requireAuth(['personnel']), (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return send(res, 400, { error: 'Bad date format' });
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const e = db.prepare(`SELECT date, content, words, time_sec, updated_at FROM journal_entries
    WHERE personnel_id = ? AND date = ?`).get(pid, req.params.date) || null;
  send(res, 200, { entry: e });
});

app.post('/api/journal', requireAuth(['personnel']), (req, res) => {
  const { date, content, time_sec } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return send(res, 400, { error: 'Bad date format' });
  const pid = req.user.personnel_id;
  if (!pid) return send(res, 400, { error: 'No personnel record linked' });
  const words = jWords(content);
  const prev = db.prepare('SELECT time_sec FROM journal_entries WHERE personnel_id = ? AND date = ?').get(pid, date);
  const t = Math.max(Number(time_sec) || 0, prev ? prev.time_sec : 0);
  db.prepare(`INSERT INTO journal_entries (personnel_id, date, content, words, time_sec, updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(personnel_id, date) DO UPDATE SET content = excluded.content, words = excluded.words,
      time_sec = excluded.time_sec, updated_at = excluded.updated_at`)
    .run(pid, date, String(content || ''), words, t, new Date().toISOString());
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
  db.prepare('UPDATE alerts SET status = ?, acted_by = ?, action_note = ? WHERE id = ?')
    .run(['acknowledged', 'actioned', 'dismissed'].includes(status) ? status : 'acknowledged',
      req.user.id, String(action_note || ''), a.id);
  if (Array.isArray(recs)) {
    for (const r of recs.slice(0, 6)) {
      db.prepare('INSERT INTO interventions (personnel_id, type, reason, recommended_at, status) VALUES (?,?,?,?,?)')
        .run(a.personnel_id, String(r.type || 'peer_support'), String(r.reason || ''), new Date().toISOString(), 'recommended');
    }
  }
  audit(req.user, 'alert_' + (status || 'acknowledged'), a.personnel_id, action_note || '');
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
  db.prepare('UPDATE interventions SET status = ?, completed_at = ?, outcome_note = ? WHERE id = ?')
    .run(['accepted', 'completed', 'declined'].includes(status) ? status : iv.status,
      status === 'completed' ? new Date().toISOString() : iv.completed_at,
      String(outcome_note || iv.outcome_note), iv.id);
  audit(req.user, 'intervention_' + status, iv.personnel_id, outcome_note || '');
  send(res, 200, { ok: true });
});

/* ---------------- transparency: access log ---------------- */
app.get('/api/audit', requireAuth(['welfare', 'commander']), (req, res) => {
  const rows = db.prepare(`SELECT a.action, a.at, a.justification, u.name AS actor, u.role,
    p.name AS target FROM audit_log a JOIN users u ON u.id = a.actor_id
    LEFT JOIN personnel p ON p.id = a.target_personnel ORDER BY a.at DESC LIMIT 50`).all();
  send(res, 200, { audit: rows });
});

/* ---------------- risk pipeline trigger ---------------- */
app.post('/api/recalculate', requireAuth(['welfare', 'commander']), (req, res) => {
  const counts = runPipeline();
  audit(req.user, 'recalculate', null, 'manual pipeline run');
  send(res, 200, { ok: true, counts });
});

/* ---------------- commander dashboard (aggregated + k-anonymized) ---------------- */
const K_MIN = 5; // never expose a group smaller than 5 personnel

app.get('/api/dashboard/unit', requireAuth(['commander', 'welfare']), (req, res) => {
  const today = todayStr();
  const units = db.prepare('SELECT * FROM units').all();
  const out = units.map(u => {
    const strength = db.prepare('SELECT COUNT(*) c FROM personnel WHERE unit_id = ? AND active = 1').get(u.id).c;
    const rows = db.prepare(`SELECT rs.band, COUNT(*) c FROM risk_scores rs
      JOIN personnel p ON p.id = rs.personnel_id
      WHERE p.unit_id = ? AND rs.date = ? GROUP BY rs.band`).all(u.id, today);
    const bands = { Low: 0, Watch: 0, Elevated: 0, Critical: 0 };
    rows.forEach(r => { bands[r.band] = r.c; });
    const avgStress = db.prepare(`SELECT AVG(stress) a FROM checkins c JOIN personnel p ON p.id = c.personnel_id
      WHERE p.unit_id = ? AND c.date >= ?`).get(u.id, new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)).a;
    const k = { ...bands };
    for (const b of Object.keys(k)) if (k[b] > 0 && k[b] < K_MIN) k[b] = null; // k-anonymity suppression
    return { unit: u.name, region: u.region, strength, bands: k,
      suppressed: Object.values(k).some(v => v === null),
      avgStress: avgStress ? +avgStress.toFixed(1) : null };
  });
  const trend = db.prepare(`SELECT date, AVG(score) a, SUM(CASE WHEN band IN ('Elevated','Critical') THEN 1 ELSE 0 END) flagged
    FROM risk_scores WHERE date >= ? GROUP BY date ORDER BY date`).all(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  send(res, 200, { units: out, trend });
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`SENTINEL running → http://localhost:${PORT}`));
