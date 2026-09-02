'use strict';
/* SENTINEL — frontend app */

const $ = s => document.querySelector(s);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const BAND_COLOR = { Low: '#2eb872', Watch: '#f4b400', Elevated: '#e67e22', Critical: '#e74c3c' };

/* ---- dark / light theme — pull the cord! ---- */
const themeCol = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let curView = null;
(function initTheme() {
  document.documentElement.dataset.theme = localStorage.getItem('sentinel-theme') || 'dark';
  const btn = $('#theme-toggle');
  btn.onclick = () => {
    if (btn.classList.contains('pulling')) return; // ignore spam clicks mid-pull
    btn.classList.add('pulling');
    // flip the theme at the bottom of the pull, like the light actually switching
    setTimeout(() => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('sentinel-theme', next);
      // redraw canvas charts so their colors match the new theme
      if (curView && !$('#app-view').classList.contains('hidden')) showView(curView);
    }, 200);
    setTimeout(() => btn.classList.remove('pulling'), 650);
  };
})();
const PSS_Q = [
  'Been upset because of something that happened unexpectedly?',
  'Felt unable to control the important things in your life?',
  'Felt nervous and stressed?',
  'Felt confident about your ability to handle your personal problems? (reverse)',
  'Felt that things were going your way? (reverse)',
  'Found that you could not cope with all the things that you had to do?',
  'Been able to control irritations in your life? (reverse)',
  'Felt that you were on top of things? (reverse)',
  'Been angered because of things that happened that were outside of your control?',
  'Felt difficulties were piling up so high that you could not overcome them?'
];
let me = null;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ==== auth & shell (part 2) ==== */
async function login(username, password) {
  me = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  boot();
}
$('#li-btn').onclick = () => {
  $('#li-err').classList.add('hidden');
  login($('#li-user').value.trim(), $('#li-pass').value)
    .catch(e => { $('#li-err').textContent = e.message; $('#li-err').classList.remove('hidden'); });
};
$('#li-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#li-btn').click(); });
document.querySelectorAll('.linkish').forEach(b =>
  b.onclick = () => { $('#li-user').value = b.dataset.quick; $('#li-pass').value = 'demo123'; $('#li-btn').click(); });
$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };

const NAVS = {
  personnel: [['personnel', '🏠 Wellness'], ['journal', '📝 Journal']],
  commander: [['commander', '🗺️ Unit Dashboard']],
  welfare: [['welfare', '🔔 Alerts & Roster'], ['commander', '🗺️ Unit Dashboard']]
};
function boot() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#who').textContent = `${me.name} · ${me.role}`;
  const nav = $('#nav');
  nav.innerHTML = '';
  (NAVS[me.role] || []).forEach(([v, label]) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label; b.dataset.view = v;
    b.onclick = () => showView(v);
    nav.appendChild(b);
  });
  showView(me.role === 'personnel' ? 'personnel' : me.role === 'welfare' ? 'welfare' : 'commander');
}
function showView(v) {
  curView = v;
  document.querySelectorAll('.view').forEach(x => x.classList.add('hidden'));
  document.querySelectorAll('#nav .btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#view-' + v).classList.remove('hidden');
  if (v === 'personnel') loadPersonnel();
  if (v === 'journal') loadJournal();
  if (v === 'commander') loadCommander();
  if (v === 'welfare') loadWelfare();
  if (jrListening) jrStopMic(); // defined below — stops dictation when leaving journal
}

/* ==== personnel app (part 3) ==== */
async function loadPersonnel() {
  const j = await api('/api/my-status');
  const r = j.risk;
  $('#my-risk').innerHTML = `
    <canvas id="gauge" width="150" height="90"></canvas>
    <p class="center">Current welfare index: <b style="color:${BAND_COLOR[r.band]}">${r.band}</b></p>
    ${r.factors.length ? `<p class="muted center" style="margin-top:6px">Support areas detected: ${r.factors.slice(0, 3).map(f => f.label).join(' · ')}</p>` : ''}
    <p class="muted center" style="margin-top:6px;font-size:13px">This index is used only to offer welfare support — never for discipline.</p>`;
  drawGauge(r.score, BAND_COLOR[r.band]);
  drawSpark($('#my-chart'), j.checkins.map(c => c.stress));
  $('#my-access').innerHTML = j.accessed.length
    ? j.accessed.map(a => `<div class="access-item">${a.at.slice(0, 10)} — <b>${a.actor}</b> (${a.role}) · ${a.action.replace(/_/g, ' ')}</div>`).join('')
    : '<p class="muted">No one has viewed your record. You are notified whenever a welfare officer does.</p>';
}
function drawGauge(score, color) {
  const cv = $('#gauge'), ctx = cv.getContext('2d');
  const cx = 75, cy = 80, rad = 60;
  ctx.clearRect(0, 0, 150, 90);
  ctx.lineWidth = 14; ctx.lineCap = 'round';
  ctx.strokeStyle = themeCol('--line');
  ctx.beginPath(); ctx.arc(cx, cy, rad, Math.PI, 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, rad, Math.PI, Math.PI + (score / 100) * Math.PI); ctx.stroke();
  ctx.fillStyle = color; ctx.font = 'bold 24px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText(score, cx, 74);
}
function drawSpark(cv, vals) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = themeCol('--muted'); ctx.font = '12px Segoe UI';
  ctx.fillText('Your stress check-ins (last 30)', 8, 16);
  if (vals.length < 2) { ctx.fillText('Not enough data yet — check in daily!', 8, 60); return; }
  const W = cv.width - 30, H = cv.height - 40, max = 10;
  ctx.strokeStyle = '#e74c3c'; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(26, 20 + H * (1 - 6 / max)); ctx.lineTo(cv.width - 4, 20 + H * (1 - 6 / max)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#3498db'; ctx.lineWidth = 2; ctx.beginPath();
  vals.forEach((v, i) => {
    const x = 26 + (i / (vals.length - 1)) * W, y = 20 + H * (1 - v / max);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

$('#ci-stress').oninput = () => $('#v-stress').textContent = $('#ci-stress').value;
$('#ci-save').onclick = async () => {
  await api('/api/checkin', { method: 'POST', body: JSON.stringify({
    stress: +$('#ci-stress').value, sleep_hours: +$('#ci-sleep').value, mood: $('#ci-mood').value,
    physical_symptoms: $('#ci-sym').checked, feeling_supported: +$('#ci-sup').value, anonymous: $('#ci-anon').checked
  })});
  $('#ci-msg').textContent = '✓ Check-in saved. Thank you for taking care of yourself.';
  $('#ci-msg').classList.remove('hidden');
  toast('Check-in recorded');
  loadPersonnel();
};
$('#pss-save').onclick = async () => {
  const answers = [];
  for (let i = 0; i < 10; i++) {
    const el = document.querySelector(`input[name=pss${i}]:checked`);
    if (!el) { toast('Please answer all 10 questions'); return; }
    answers.push(+el.value);
  }
  const j = await api('/api/assessment', { method: 'POST', body: JSON.stringify({ type: 'PSS10', answers }) });
  $('#pss-msg').textContent = `✓ Assessment saved (score ${j.score}/100). A welfare officer will reach out if supportive follow-up would help.`;
  $('#pss-msg').classList.remove('hidden');
  toast('Assessment submitted');
};

/* ==== welfare & commander (part 4) ==== */
async function loadCommander() {
  const j = await api('/api/dashboard/unit');
  $('#unit-table').innerHTML = `
    <tr><th>Unit</th><th>Region</th><th>Strength</th><th>Low</th><th>Watch</th><th>Elevated</th><th>Critical</th><th>Avg stress (14d)</th></tr>
    ${j.units.map(u => `
      <tr>
        <td><b>${u.unit}</b></td><td>${u.region}</td><td>${u.strength}</td>
        <td class="bcell b-Low">${u.bands.Low}</td>
        <td class="bcell ${u.bands.Watch === null ? 'sup' : 'b-Watch'}">${u.bands.Watch === null ? '·suppressed·' : u.bands.Watch}</td>
        <td class="bcell ${u.bands.Elevated === null ? 'sup' : 'b-Elevated'}">${u.bands.Elevated === null ? '·suppressed·' : u.bands.Elevated}</td>
        <td class="bcell ${u.bands.Critical === null ? 'sup' : 'b-Critical'}">${u.bands.Critical === null ? '·suppressed·' : u.bands.Critical}</td>
        <td>${u.avgStress ?? '—'}/10</td>
      </tr>`).join('')}`;
  drawTrend($('#trend-chart'), j.trend);
  renderAudit();
}
function drawTrend(cv, trend) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = themeCol('--muted'); ctx.font = '12px Segoe UI';
  if (trend.length < 2) { ctx.fillText('Risk trend builds as the engine runs daily — press Recalculate to store today\'s snapshot.', 10, 60); return; }
  const padL = 40, W = cv.width - padL - 12, H = cv.height - 44;
  const maxS = 100;
  const X = i => padL + (i / (trend.length - 1)) * W;
  const Y = v => 20 + H * (1 - v / maxS);
  ctx.strokeStyle = themeCol('--line');
  [0, 25, 50, 75, 100].forEach(g => { ctx.beginPath(); ctx.moveTo(padL, Y(g)); ctx.lineTo(padL + W, Y(g)); ctx.stroke(); ctx.fillText(g, 12, Y(g)); });
  ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.beginPath();
  trend.forEach((t, i) => { i ? ctx.lineTo(X(i), Y(t.flagged)) : ctx.moveTo(X(i), Y(t.flagged)); });
  ctx.stroke();
  ctx.fillStyle = '#e74c3c'; ctx.font = '11px Segoe UI';
  ctx.fillText('flagged personnel', padL + 6, Y(Math.max(...trend.map(t => t.flagged))) - 6);
}
async function renderAudit() {
  const j = await api('/api/audit');
  $('#audit-log').innerHTML = j.audit.map(a => `
    <div class="access-item">${a.at.slice(0, 16).replace('T', ' ')} — <b>${a.actor}</b> (${a.role})
    ${a.action.replace(/_/g, ' ')} ${a.target ? `→ <b>${a.target}</b>` : ''} ${a.justification ? `<span class="muted">“${a.justification}”</span>` : ''}</div>`).join('')
    || '<p class="muted">No access events yet.</p>';
}
$('#recalc').onclick = async () => {
  const j = await api('/api/recalculate', { method: 'POST' });
  toast(`Engine run: ${j.counts.Low} low · ${j.counts.Watch} watch · ${j.counts.Elevated} elevated · ${j.counts.Critical} critical`);
  loadCommander();
};

async function loadWelfare() {
  const [al, ro] = await Promise.all([api('/api/alerts'), api('/api/dashboard/roster')]);
  $('#alerts-list').innerHTML = al.alerts.length ? al.alerts.map(a => `
    <div class="alert-item">
      <span class="lv b-${a.level}" style="color:${BAND_COLOR[a.level]}">${a.level}</span>
      <span class="muted"> · ${a.created_at.slice(0, 16).replace('T', ' ')} · ${a.status}</span>
      <div><b>${a.rank} ${a.name}</b> <span class="muted">(${a.force_id}, ${a.unit})</span></div>
      <div class="reason">${a.reason}</div>
      ${a.status === 'new' ? `
        <div class="alert-actions">
          <button class="btn small" onclick="actAlert(${a.id},'acknowledged')">Acknowledge</button>
          <button class="btn small primary" onclick="openPerson(${a.personnel_id})">Review &amp; act</button>
        </div>` : ''}
    </div>`).join('') : '<p class="muted">No open alerts. Force welfare is stable.</p>';
  $('#roster').innerHTML = ro.roster.length ? ro.roster.map(p => `
    <div class="roster-item" onclick="openPerson(${p.id})">
      <span class="lv" style="color:${BAND_COLOR[p.band]}">${p.band} · ${p.score}/100</span>
      <div><b>${p.rank} ${p.name}</b> <span class="muted">${p.unit}</span></div>
      <div class="reason muted">${p.factors.slice(0, 2).map(f => f.label).join(' · ')}</div>
    </div>`).join('') : '<p class="muted">Nobody currently flagged. 🎉</p>';
}
async function actAlert(id, status) {
  await api('/api/alerts/' + id, { method: 'POST', body: JSON.stringify({ status }) });
  toast('Alert ' + status);
  loadWelfare();
}
$('#back-welfare').onclick = () => showView(me.role === 'welfare' ? 'welfare' : 'commander');

/* ---------------- person detail (welfare) ---------------- */
async function openPerson(pid) {
  const j = await api('/api/personnel/' + pid);
  showView('person');
  const p = j.personnel, r = j.risk;
  $('#person-detail').innerHTML = `
    <div class="card wide">
      <div class="row-between">
        <h3>${p.rank} ${p.name} <span class="muted">(${p.force_id} · ${p.unit} · ${p.years_service} yrs service · ${p.family_status})</span></h3>
        <span class="pill" style="color:${BAND_COLOR[r.band]};border-color:${BAND_COLOR[r.band]}">${r.band} risk · ${r.score}/100</span>
      </div>
      <div class="factors">
        ${r.factors.length ? r.factors.map(f => `
          <div class="factor"><span style="min-width:260px">${f.label}</span>
            <div class="bar"><i style="width:${Math.round((f.points / f.max) * 100)}%"></i></div>
            <span class="pts">${f.points}/${f.max}</span>
            <span class="muted" style="font-size:12.5px">${f.detail}</span></div>`).join('')
        : '<p class="muted">No risk factors currently active.</p>'}
      </div>
      <h3 style="margin-top:16px">Recommended welfare interventions</h3>
      <div id="recs"></div>
    </div>
    <div class="cols">
      <div class="card"><h3>HR event timeline (recent)</h3>
        ${j.hr.map(h => `<div class="tl-item"><span class="d">${h.date}</span><span>${h.type.replace(/_/g, ' ')}${h.value ? ` · ${h.value}` : ''}${h.note ? ` <span class="muted">— ${h.note}</span>` : ''}</span></div>`).join('') || '<p class="muted">None</p>'}
      </div>
      <div class="card"><h3>Wellness check-in trend</h3>
        <canvas id="p-chart" width="520" height="180"></canvas>
        <h3 style="margin-top:14px">Risk history</h3>
        ${j.history.map(h => `<div class="tl-item"><span class="d">${h.date}</span><span class="bcell b-${h.band}" style="color:${BAND_COLOR[h.band]}">${h.score} · ${h.band}</span></div>`).join('')}
      </div>
    </div>
    <div class="card wide"><h3>Interventions on record</h3><div id="ivs"></div></div>`;
  drawSpark($('#p-chart'), j.checkins.slice(-30).map(c => c.stress));
  renderRecs(r.factors, pid);
  $('#ivs').innerHTML = j.interventions.map(iv => `
    <div class="int-row">
      <span><b>${iv.type.replace(/_/g, ' ')}</b> — ${iv.reason} <span class="muted">(${iv.status})</span></span>
      ${iv.status === 'recommended' ? `<span>
        <button class="btn small" onclick="setIv(${iv.id},'accepted')">Accepted</button>
        <button class="btn small primary" onclick="setIv(${iv.id},'completed')">Completed</button>
        <button class="btn small ghost" onclick="setIv(${iv.id},'declined')">Declined</button></span>` : ''}
    </div>`).join('') || '<p class="muted">No interventions recorded yet.</p>';
}
function renderRecs(factors, pid) {
  const MAP = {
    incidents: ['counseling', 'Recent incident exposure — offer voluntary trauma-informed counseling'],
    stress_trend: ['counseling', 'Sustained/rising stress — voluntary counseling session'],
    assessment: ['counseling', 'Wellness assessment above threshold — professional follow-up'],
    sleep: ['medical_check', 'Sleep degradation — medical/behavioural sleep evaluation'],
    overtime: ['workload_rebalance', 'Sustained overtime — rebalance duty roster'],
    deployment: ['rest_rotation', 'Prolonged deployment — schedule rest rotation'],
    family_sep: ['family_leave', 'Extended family separation — prioritize family travel leave'],
    leave_denials: ['family_leave', 'Multiple denied leave requests — review leave priority'],
    engagement: ['peer_support', 'Low engagement — assign peer-support buddy'],
    disciplinary: ['peer_support', 'Welfare touch-base alongside any process'],
    transfers: ['peer_support', 'Instability from transfers — peer-support network']
  };
  const seen = new Set(), recs = [];
  factors.forEach(f => {
    const m = MAP[f.key];
    if (m && !seen.has(m[0])) { seen.add(m[0]); recs.push({ type: m[0], reason: m[1] }); }
  });
  if (!recs.length) recs.push({ type: 'peer_support', reason: 'Preventive welfare check-in' });
  $('#recs').innerHTML = recs.slice(0, 4).map((r, i) => `
    <div class="int-row">
      <span>✅ <b>${r.type.replace(/_/g, ' ')}</b> — ${r.reason}</span>
      <button class="btn small primary" onclick="applyRecs(${pid},${i})">Recommend this</button>
    </div>`).join('');
  $('#recs').dataset.recs = JSON.stringify(recs.slice(0, 4));
}
async function applyRecs(pid, idx) {
  const recs = JSON.parse($('#recs').dataset.recs);
  await api('/api/recalculate', { method: 'POST' }).catch(() => {});
  // attach via alert-less path: create intervention directly through alerts API needs an alert;
  // use dedicated endpoint instead
  await api('/api/interventions/recommend', { method: 'POST', body: JSON.stringify({ personnel_id: pid, recs: [recs[idx]] }) });
  toast('Intervention recommended');
  openPerson(pid);
}
async function setIv(id, status) {
  await api('/api/interventions/' + id, { method: 'POST', body: JSON.stringify({ status }) });
  toast('Intervention ' + status);
}

/* ==== private journal (merged from seven50) ==== */
const J_GOAL = 750, J_BLUE = 400;
let jrTimer = null, jrStart = null, jrBase = 0, jrDirty = false, jrDate = null;

function jrWords() { const t = $('#jr-editor').value.trim(); return t ? t.split(/\s+/).length : 0; }
function jrUpdate() {
  const w = jrWords(), pct = Math.min(100, (w / J_GOAL) * 100);
  const bar = $('#jr-bar');
  bar.style.width = pct + '%';
  bar.style.background = w >= J_GOAL ? 'var(--accent)' : w >= J_BLUE ? 'var(--blue)' : '#5a7089';
  $('#jr-count').textContent = `${w} / ${J_GOAL} words` +
    (w >= J_GOAL ? ' ✅ goal reached' : w >= J_BLUE ? ' (blue zone)' : '');
  const mins = jrBase / 60 + (jrStart ? (Date.now() - jrStart) / 60000 : 0);
  $('#jr-meta').textContent = `${Math.max(0, Math.round(mins))} min today · ${mins > 0.2 ? Math.round(w / mins) + ' words/min' : '— words/min'}`;
}

async function loadJournal() {
  const today = new Date().toISOString().slice(0, 10);
  jrDate = today;
  const [{ entry }, ov] = await Promise.all([
    api('/api/journal/' + today),
    api('/api/journal/overview').catch(() => ({ days: [], streak: 0, total_days: 0, total_words: 0 }))
  ]);
  $('#jr-editor').value = entry ? entry.content : '';
  jrBase = entry ? entry.time_sec || 0 : 0;
  jrStart = Date.now();
  $('#jr-streak').textContent = ov.streak ? `🔥 ${ov.streak}-day streak` : '🔥 start your streak today';
  $('#jr-days').innerHTML = ov.days && ov.days.length
    ? ov.days.slice(-14).reverse().map(d =>
        `<span class="jr-day ${d.words >= J_GOAL ? 'g' : d.words >= J_BLUE ? 'b' : ''}">${d.date.slice(5)} · ${d.words}w</span>`).join('')
    : '<span class="muted">No entries yet — today is day one.</span>';
  $('#jr-totals').textContent = `All time: ${ov.total_days} entries · ${Number(ov.total_words).toLocaleString()} words`;
  $('#jr-save').textContent = entry ? 'saved' : 'not saved yet';
  jrUpdate();
  $('#jr-editor').focus();
}

$('#jr-editor').addEventListener('input', () => {
  jrUpdate(); jrDirty = true;
  $('#jr-save').textContent = 'typing…';
  clearTimeout(jrTimer);
  jrTimer = setTimeout(saveJournal, 2500); // autosave 2.5s after last keystroke
});
window.addEventListener('beforeunload', () => { if (jrDirty) saveJournal(true); });

/* ---- voice dictation (Web Speech API — free browser engine, no API keys) ---- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let jrRec = null, jrListening = false;

if (!SR) {
  $('#jr-mic').disabled = true;
  $('#jr-mic').title = 'Voice input needs Chrome, Edge, or Safari';
} else {
  jrRec = new SR();
  jrRec.continuous = true;
  jrRec.interimResults = true;

  jrRec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) jrRouteHeard(t, e.results[i][0].confidence);
      else interim += t;
    }
    $('#jr-mic-status').textContent = jrListening ? (interim ? '… ' + interim : 'listening…') : '';
  };
  jrRec.onend = () => { if (jrListening) { try { jrRec.start(); } catch {} } }; // resume after silence pauses
  jrRec.onerror = ev => {
    if (ev.error === 'not-allowed') {
      jrStopMic();
      $('#jr-mic-status').textContent = '⚠ microphone blocked — allow mic access in your browser';
    } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
      $('#jr-mic-status').textContent = '⚠ mic error: ' + ev.error;
    }
  };
}

/* smart ASR corrector: fixes the most common speech-to-text mistakes */
const ASR_FIXES = [
  [/\b(see|sea|csi|si)\s+(are|our|ar|r)\s+(pf|ef|phe)\b/gi, 'CRPF'],
  [/\bc\.?\s*r\.?\s*p\.?\s*f\.?(?=\s|$|[,.!?])/gi, 'CRPF'],
  [/\bha\s?filda{1,2}r\b/gi, 'Havildar'],
  [/\bna(y|i|ee)k\b/gi, 'Naik'],
  [/\bsub(a|e)dar\b/gi, 'Subedar'],
  [/\bseven\s?fifty\b/gi, '750'],
  [/\bseven\s?hundred\s?(and\s?)?fifty\b/gi, '750']
];
function voiceFix(t) {
  let s = ' ' + (t || '').trim() + ' ';
  s = s.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');   // "the the" -> "the"
  s = s.replace(/\bi\b/g, 'I');                  // standalone i -> I
  for (const [re, rep] of ASR_FIXES) s = s.replace(re, rep);
  s = s.replace(/\s+([,.!?;:])/g, '$1');         // no space before punctuation
  s = s.replace(/([,.!?;:])(?=[^\s\d])/g, '$1 ');// space after punctuation
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s && !/[.!?…]$/.test(s)) s += '.';
  return s;
}

/* confidence routing: trustworthy phrases flow in, doubtful ones wait for review */
const CONF_AUTO = 0.75;
function jrRouteHeard(text, conf) {
  const c = (typeof conf === 'number' && conf > 0) ? conf : 0.9; // engines without confidence -> trust
  const fixed = voiceFix(text);
  if (c >= CONF_AUTO) {
    jrAppendSpoken(fixed);
    $('#jr-mic-status').textContent = '✓ added: ' + (fixed.length > 60 ? fixed.slice(0, 57) + '…' : fixed);
  } else {
    const d = $('#jr-draft');
    d.value = (d.value ? d.value + ' ' : '') + fixed;
    $('#jr-draft-wrap').classList.remove('hidden');
    $('#jr-mic-status').textContent = '⚠ low confidence — check the review box below';
  }
}

function jrAppendSpoken(text) {
  const clean = (text || '').trim();
  if (!clean) return;
  const ed = $('#jr-editor');
  const sep = ed.value && !/\s$/.test(ed.value) ? ' ' : '';
  ed.value += sep + clean.charAt(0).toUpperCase() + clean.slice(1) + ' ';
  ed.dispatchEvent(new Event('input')); // reuse autosave + live counters
  ed.scrollTop = ed.scrollHeight;
}

/* review box: human verifies doubtful phrases before they touch the journal */
$('#jr-draft-ok').addEventListener('click', () => {
  const d = $('#jr-draft');
  if (d.value.trim()) { jrAppendSpoken(voiceFix(d.value)); d.value = ''; }
  $('#jr-draft-wrap').classList.add('hidden');
  $('#jr-mic-status').textContent = '✓ reviewed text added to journal';
});
$('#jr-draft-no').addEventListener('click', () => {
  $('#jr-draft').value = '';
  $('#jr-draft-wrap').classList.add('hidden');
  $('#jr-mic-status').textContent = 'discarded — nothing was added';
});

function jrStopMic() {
  jrListening = false;
  $('#jr-mic').classList.remove('recording');
  $('#jr-mic').textContent = '🎤 Speak';
  $('#jr-mic-status').textContent = '';
  try { if (jrRec) jrRec.stop(); } catch {}
}

$('#jr-mic').addEventListener('click', () => {
  if (!SR) { toast('Voice input works in Chrome, Edge, or Safari'); return; }
  if (jrListening) return jrStopMic();
  jrRec.lang = $('#jr-lang').value;
  localStorage.setItem('sentinel-jr-lang', jrRec.lang);
  try { jrRec.start(); } catch { return; }
  jrListening = true;
  $('#jr-mic').classList.add('recording');
  $('#jr-mic').textContent = '⏹ Stop';
  $('#jr-mic-status').textContent = 'listening… speak naturally';
});
$('#jr-lang').addEventListener('change', () => {
  localStorage.setItem('sentinel-jr-lang', $('#jr-lang').value);
  if (jrListening) { jrStopMic(); setTimeout(() => $('#jr-mic').click(), 250); }
});
/* restore remembered language (most "wrong listening" = wrong language selected) */
(() => {
  const saved = localStorage.getItem('sentinel-jr-lang');
  if (saved && [...$('#jr-lang').options].some(o => o.value === saved)) {
    $('#jr-lang').value = saved;
    if (saved !== 'en-IN') $('#jr-mic-status').textContent = 'language: ' + $('#jr-lang').selectedOptions[0].textContent;
  }
})();

async function saveJournal(sync) {
  const body = { date: jrDate, content: $('#jr-editor').value,
    time_sec: Math.round(jrBase + (jrStart ? (Date.now() - jrStart) / 1000 : 0)) };
  const req = api('/api/journal', { method: 'POST', body: JSON.stringify(body) });
  if (sync) return req;
  try {
    const r = await req; jrDirty = false;
    jrBase = body.time_sec; jrStart = Date.now();
    $('#jr-save').textContent = 'saved ✓ ' + new Date(r.saved_at).toLocaleTimeString();
  } catch { $('#jr-save').textContent = '⚠ save failed'; }
}
setInterval(() => { if (!$('#view-journal').classList.contains('hidden')) jrUpdate(); }, 30000);

/* ---------------- PSS form render + init ---------------- */
(function initPss() {
  $('#pss').innerHTML = PSS_Q.map((q, i) => `
    <div style="margin-bottom:4px">
      <label style="margin:8px 0 2px">${i + 1}. ${q}</label>
      <div>${[0,1,2,3,4].map(v =>
        `<label class="chk" style="display:inline-flex;margin-right:14px"><input type="radio" name="pss${i}" value="${v}"> ${v}</label>`).join('')}</div>
    </div>`).join('');
})();
// auto-login if session exists
api('/api/me').then(j => { me = j.user; boot(); }).catch(() => {});




