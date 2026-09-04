'use strict';
/* SENTINEL — database schema (node:sqlite, zero external deps) */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.SENTINEL_DB_PATH
  ? path.resolve(process.env.SENTINEL_DB_PATH)
  : path.join(DEFAULT_DATA_DIR, 'sentinel.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('personnel','welfare','commander')),
  name TEXT NOT NULL,
  unit_id INTEGER,
  personnel_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS personnel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  force_id TEXT UNIQUE NOT NULL,
  rank TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_id INTEGER NOT NULL,
  years_service INTEGER NOT NULL DEFAULT 0,
  family_status TEXT NOT NULL DEFAULT 'single',
  join_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hr_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  type TEXT NOT NULL,          -- leave_approved | leave_denied | deployment | return_from_deployment | transfer | duty_overtime | incident_exposure | training | commendation | disciplinary
  date TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_hr_pid ON hr_events(personnel_id, date);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  stress INTEGER NOT NULL,             -- 1..10 self-reported
  sleep_hours REAL NOT NULL,
  mood TEXT NOT NULL DEFAULT '',
  physical_symptoms INTEGER NOT NULL DEFAULT 0,
  feeling_supported INTEGER NOT NULL DEFAULT 3, -- 1..5
  anonymous INTEGER NOT NULL DEFAULT 0,
  UNIQUE (personnel_id, date)
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,                  -- PSS10 | PHQ2 | BURNOUT
  score INTEGER NOT NULL,
  answers TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS risk_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  score INTEGER NOT NULL,              -- 0..100
  band TEXT NOT NULL,                  -- Low | Watch | Elevated | Critical
  factors TEXT NOT NULL DEFAULT '[]',
  UNIQUE (personnel_id, date)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  level TEXT NOT NULL,                 -- Elevated | Critical
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',  -- new | acknowledged | actioned | dismissed
  acted_by INTEGER,
  action_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS interventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  type TEXT NOT NULL,                  -- counseling | rest_rotation | workload_rebalance | family_leave | peer_support | medical_check
  reason TEXT NOT NULL DEFAULT '',
  recommended_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'recommended', -- recommended | accepted | completed | declined
  completed_at TEXT,
  outcome_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  words INTEGER NOT NULL DEFAULT 0,
  time_sec INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (personnel_id, date)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_personnel INTEGER,
  justification TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  resolved_by INTEGER,
  resolution_note TEXT NOT NULL DEFAULT ''
);
`);

// Non-destructive journal analytics migration. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so inspect the existing table first.
const journalColumns = new Set(db.prepare('PRAGMA table_info(journal_entries)').all().map(c => c.name));
if (!journalColumns.has('timeline')) db.exec("ALTER TABLE journal_entries ADD COLUMN timeline TEXT NOT NULL DEFAULT '[]'");
if (!journalColumns.has('started_at')) db.exec("ALTER TABLE journal_entries ADD COLUMN started_at TEXT NOT NULL DEFAULT ''");

// Alert lifecycle fields let the pipeline distinguish a persistent condition
// from a genuinely new episode without rewriting historical case decisions.
const alertColumns = new Set(db.prepare('PRAGMA table_info(alerts)').all().map(c => c.name));
if (!alertColumns.has('resolved_at')) db.exec('ALTER TABLE alerts ADD COLUMN resolved_at TEXT');
if (!alertColumns.has('cleared_at')) db.exec('ALTER TABLE alerts ADD COLUMN cleared_at TEXT');
if (!alertColumns.has('risk_signature')) db.exec("ALTER TABLE alerts ADD COLUMN risk_signature TEXT NOT NULL DEFAULT ''");
if (!alertColumns.has('last_seen_at')) db.exec('ALTER TABLE alerts ADD COLUMN last_seen_at TEXT');

// Existing installations used a case-sensitive UNIQUE constraint. Add a
// case-insensitive uniqueness guard when legacy data is unambiguous; login
// still rejects an ambiguous legacy duplicate if one is present.
const duplicateUsernames = db.prepare(`SELECT lower(trim(username)) username, COUNT(*) count
  FROM users GROUP BY lower(trim(username)) HAVING COUNT(*) > 1 LIMIT 1`).get();
if (!duplicateUsernames) {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE)');
} else {
  console.warn('Case-insensitive username index not installed: ambiguous legacy usernames exist.');
}

module.exports = db;
module.exports.path = DB_PATH;
