'use strict';
/* SENTINEL — demo data seeder: 150 personnel, 6 months of HR + wellness history.
 * Run: npm run seed   (wipes and rebuilds demo content)
 */
const db = require('./db');
const crypto = require('crypto');

const RANKS = ['Sepoy', 'Constable', 'Naik', 'Havildar', 'Naib Subedar', 'Subedar', 'Inspector', 'Sub-Inspector'];
const REGIONS = ['North', 'South', 'East', 'West', 'NE', 'Central'];
const MOODS = ['okay', 'tired', 'good', 'stressed', 'low', 'motivated', 'anxious'];

function rnd(n) { return Math.floor(Math.random() * n); }
function pick(a) { return a[rnd(a.length)]; }
function dstr(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; }
function hash(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }

function mkUser(username, pass, role, name, unit_id, personnel_id) {
  const salt = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO users (username, pass_hash, salt, role, name, unit_id, personnel_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(username, hash(pass, salt), salt, role, name, unit_id, personnel_id, new Date().toISOString());
}

function main() {
  console.log('Wiping existing demo data...');
  for (const t of ['users', 'units', 'personnel', 'hr_events', 'checkins', 'assessments', 'risk_scores', 'alerts', 'interventions', 'audit_log', 'data_corrections', 'sessions'])
    db.exec(`DELETE FROM ${t};`);
  try { db.exec('DELETE FROM sqlite_sequence;'); } catch {} // reset AUTOINCREMENT counters

  const unitNames = ['1 Bn OP Dtk', '2 Bn Ops', '3 Bn Trg Ctr', '5 Bn Ops', '7 Bn Ops', '91 Bn COBRA', '148 Bn'];
  const unitIds = [];
  unitNames.forEach((name, i) => {
    db.prepare('INSERT INTO units (name, region) VALUES (?, ?)').run(name, REGIONS[i % REGIONS.length]);
    unitIds.push(i + 1);
  });

  mkUser('commander', 'demo123', 'commander', 'Commander Sharma', null, null);
  mkUser('welfare', 'demo123', 'welfare', 'Welfare Officer Kaur', null, null);

  const insertHR = db.prepare('INSERT INTO hr_events (personnel_id, type, date, value, note) VALUES (?,?,?,?,?)');
  const insertCI = db.prepare('INSERT INTO checkins (personnel_id, date, stress, sleep_hours, mood, physical_symptoms, feeling_supported, anonymous) VALUES (?,?,?,?,?,?,?,?)');
  const insertAS = db.prepare('INSERT INTO assessments (personnel_id, date, type, score, answers) VALUES (?,?,?,?,?)');
  let firstPid = null;

  console.log('Generating 150 personnel with 180 days of history...');
  for (let n = 1; n <= 150; n++) {
    const unit = pick(unitIds);
    const rank = pick(RANKS);
    const name = `Personnel ${String(n).padStart(3, '0')}`;
    const join = daysAgo(400 + rnd(4000));
    const family = Math.random() < 0.6 ? 'married' : 'single';
    const pid = Number(db.prepare('INSERT INTO personnel (force_id, rank, name, unit_id, years_service, family_status, join_date, active) VALUES (?,?,?,?,?,?,?,1)')
      .run(`CRPF${100000 + n}`, rank, name, unit, Math.floor((Date.now() - join.getTime()) / 31557600000), family, dstr(join)).lastInsertRowid);
    if (n === 1) firstPid = pid;

    const r = Math.random();
    const profile = r < 0.55 ? 'healthy' : r < 0.75 ? 'moderate' : r < 0.9 ? 'stressed' : 'critical';
    seedPerson(pid, family, join, profile, { insertHR, insertCI, insertAS });
  }

  mkUser('sepoy.demo', 'demo123', 'personnel', 'Sepoy Demo', 1, firstPid);

  const counts = ['personnel', 'hr_events', 'checkins', 'assessments'].map(t =>
    `${t}: ${db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c}`).join('  ');
  console.log('Seed complete → ' + counts);
}

/* ==== part 2 appended below ==== */
function seedPerson(pid, family, join, profile, { insertHR, insertCI, insertAS }) {
  /* ---- HR history ---- */
  const deployments = profile === 'healthy' ? 1 : profile === 'critical' ? rnd(3) : rnd(2);
  for (let k = 0; k < deployments; k++) {
    const start = 30 + rnd(330);
    insertHR.run(pid, 'deployment', dstr(daysAgo(start)), 60 + rnd(90), '');
    if (start > 150) insertHR.run(pid, 'return_from_deployment', dstr(daysAgo(Math.max(1, start - 90 - rnd(30)))), 0, '');
  }
  const denials = profile === 'critical' ? 2 + rnd(3) : profile === 'stressed' ? rnd(3) : rnd(2);
  for (let k = 0; k < denials; k++) insertHR.run(pid, 'leave_denied', dstr(daysAgo(5 + rnd(85))), 0, 'Operational requirements');
  if (family === 'married' && profile !== 'critical' && Math.random() < 0.7)
    insertHR.run(pid, 'family_visit', dstr(daysAgo(30 + rnd(200))), 0, '');
  if (profile === 'critical' && family === 'married' && Math.random() < 0.5)
    insertHR.run(pid, 'family_visit', dstr(daysAgo(200 + rnd(160))), 0, '');
  const otBase = profile === 'healthy' ? 2 : profile === 'moderate' ? 10 : 22;
  for (let m = 0; m < 4; m++) {
    const mult = (profile === 'stressed' || profile === 'critical') ? 1 + (3 - m) * 0.35 : 1;
    insertHR.run(pid, 'duty_overtime', dstr(daysAgo(m * 30 + 10)), Math.round(otBase * mult + rnd(8)), '');
  }
  const incidents = profile === 'critical' ? 1 + rnd(2) : profile === 'stressed' ? rnd(2) : 0;
  for (let k = 0; k < incidents; k++)
    insertHR.run(pid, 'incident_exposure', dstr(daysAgo(3 + rnd(85))), 0, pick(['IO action', 'CASF briefing done', 'cordon op', 'IED site']));
  const transfers = profile === 'critical' && Math.random() < 0.5 ? 2 : Math.random() < 0.2 ? 1 : 0;
  for (let k = 0; k < transfers; k++)
    insertHR.run(pid, 'transfer', dstr(daysAgo(60 + rnd(300))), 0, pick(['Srinagar', 'Raxaul', 'Chhattisgarh', 'Imphal']));
  if (profile === 'critical' && Math.random() < 0.4) insertHR.run(pid, 'disciplinary', dstr(daysAgo(10 + rnd(100))), 0, 'Minor');
  if (Math.random() < 0.3) insertHR.run(pid, 'commendation', dstr(daysAgo(20 + rnd(200))), 0, 'DG commendation');
  if (Math.random() < 0.25) insertHR.run(pid, 'training', dstr(daysAgo(30 + rnd(150))), 5 + rnd(15), 'refresher');

  /* ---- wellness check-ins (last 60 days) ---- */
  const stressBase = profile === 'healthy' ? 3 : profile === 'moderate' ? 5 : profile === 'stressed' ? 6.5 : 8;
  const sleepBase = profile === 'healthy' ? 7 : profile === 'moderate' ? 6.5 : 5.5;
  const freq = profile === 'critical' ? 0.35 : 0.8;
  for (let dd = 60; dd >= 0; dd--) {
    if (Math.random() > freq) continue;
    const drift = (profile === 'stressed' || profile === 'critical') ? (60 - dd) / 60 * 1.5 : 0;
    const stress = Math.max(1, Math.min(10, Math.round(stressBase + drift + (Math.random() * 2 - 1))));
    const sleep = Math.max(3, Math.min(9, +(sleepBase - drift / 2 + (Math.random() * 1.6 - 0.8)).toFixed(1)));
    insertCI.run(pid, dstr(daysAgo(dd)), stress, sleep, pick(MOODS),
      stress > 6 && Math.random() < 0.5 ? 1 : 0, Math.max(1, Math.min(5, 3 + rnd(3) - 1)), 0);
  }

  /* ---- assessments ---- */
  if (profile === 'stressed' || profile === 'critical') {
    insertAS.run(pid, dstr(daysAgo(3 + rnd(30))), 'PSS10', profile === 'critical' ? 72 + rnd(20) : 60 + rnd(15), '[]');
  } else if (Math.random() < 0.5) {
    insertAS.run(pid, dstr(daysAgo(5 + rnd(50))), 'PSS10', 15 + rnd(30), '[]');
  }
}

main();

