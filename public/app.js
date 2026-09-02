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

/* ---- dark / light theme — pull the cord! (drag the knob) ---- */
const themeCol = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let curView = null;
(function initTheme() {
  const root = document.documentElement;
  root.dataset.theme = localStorage.getItem('sentinel-theme') || 'dark';
  const btn = $('#theme-toggle');
  const line = btn.querySelector('.cord-line');
  const knob = btn.querySelector('.cord-knob');

  const MAX = 42, FLIP_AT = 30;   // max stretch px / distance that flips the switch
  let dragging = false, startY = 0, dy = 0, baseH = 108, fired = false;

  const setPull = d => {
    line.style.transform = `scaleY(${1 + d / baseH})`;   // cord stretches from its anchor
    knob.style.transform = `translateY(${d}px)`;
  };
  const snapBack = () => {   // springy release
    line.style.transition = 'transform .4s cubic-bezier(.3,1.7,.5,1)';
    knob.style.transition = 'transform .4s cubic-bezier(.3,1.7,.5,1)';
    setPull(0);
    setTimeout(() => { line.style.transition = ''; knob.style.transition = ''; }, 450);
  };
  const flip = () => {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('sentinel-theme', root.dataset.theme);
    // redraw canvas charts so their colors match the new theme
    if (curView && !$('#app-view').classList.contains('hidden')) showView(curView);
    if (curView === 'journal') setTimeout(() => {
      if (jrActivePane === 'insights' && jrLastAnalysis) jrRenderAnalysis(jrLastAnalysis.date);
      if (jrActivePane === 'progress' && jrLastStats) jrDrawStats(jrLastStats.last30);
    }, 80);
  };

  knob.addEventListener('pointerdown', e => {
    dragging = true; fired = false; dy = 0;
    startY = e.clientY; baseH = line.offsetHeight;
    btn.classList.add('pulling');           // stops the hover sway while gripping
    knob.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  knob.addEventListener('pointermove', e => {
    if (!dragging) return;
    dy = Math.max(0, Math.min(MAX, e.clientY - startY));
    setPull(dy);
    if (!fired && dy >= FLIP_AT) { fired = true; flip(); }   // switch flips mid-pull
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    btn.classList.remove('pulling');
    snapBack();
    if (!fired && dy < 4) flip();            // a plain click still toggles
    dy = 0;
  };
  knob.addEventListener('pointerup', release);
  knob.addEventListener('pointercancel', release);
})();
const ASSESSMENTS = {
  WHO5: {
    name: 'WHO-5 Well-Being Index', short: 'Wellbeing check', icon: '☀', accent: '#3ddc97',
    period: 'Please choose the answer that best describes how you have felt over the last two weeks.',
    questions: [
      'I have felt cheerful and in good spirits.',
      'I have felt calm and relaxed.',
      'I have felt active and vigorous.',
      'I woke up feeling fresh and rested.',
      'My daily life has been filled with things that interest me.'
    ],
    options: [[5,'All of the time'],[4,'Most of the time'],[3,'More than half of the time'],[2,'Less than half of the time'],[1,'Some of the time'],[0,'At no time']],
    source: 'World Health Organization (2024) · WHO-5 · CC BY-NC-SA 3.0',
    sourceUrl: 'https://www.who.int/publications/m/item/WHO-UCN-MSD-MHE-2024.01'
  },
  PSS10: {
    name: 'Perceived Stress Scale (PSS-10)', short: 'Stress check', icon: '◒', accent: '#60a5fa',
    period: 'In the last month, how often have you…',
    questions: [
      'been upset because of something that happened unexpectedly?',
      'felt that you were unable to control the important things in your life?',
      'felt nervous and stressed?',
      'felt confident about your ability to handle your personal problems?',
      'felt that things were going your way?',
      'found that you could not cope with all the things that you had to do?',
      'been able to control irritations in your life?',
      'felt that you were on top of things?',
      'been angered because of things that were outside of your control?',
      'felt difficulties were piling up so high that you could not overcome them?'
    ],
    options: [[0,'Never'],[1,'Almost never'],[2,'Sometimes'],[3,'Fairly often'],[4,'Very often']],
    source: 'Cohen, Kamarck & Mermelstein · Perceived Stress Scale',
    sourceUrl: 'https://www.cmu.edu/dietrich/psychology/stress-immunity-disease-lab/scales/index.html'
  },
  GAD7: {
    name: 'General Anxiety Disorder (GAD-7)', short: 'Anxiety check', icon: '≈', accent: '#a78bfa',
    period: 'Over the last two weeks, how often have you been bothered by the following problems?',
    questions: [
      'Feeling nervous, anxious, or on edge.',
      'Not being able to stop or control worrying.',
      'Worrying too much about different things.',
      'Trouble relaxing.',
      'Being so restless that it is hard to sit still.',
      'Becoming easily annoyed or irritable.',
      'Feeling afraid, as if something awful might happen.'
    ],
    options: [[0,'Not at all'],[1,'Several days'],[2,'More than half the days'],[3,'Nearly every day']],
    source: 'Spitzer, Kroenke, Williams & Löwe · GAD-7 · Reproduction permitted',
    sourceUrl: 'https://www.phqscreeners.com/select-screener'
  },
  PHQ9: {
    name: 'Patient Health Questionnaire (PHQ-9)', short: 'Mood check', icon: '○', accent: '#f4b400',
    period: 'Over the last two weeks, how often have you been bothered by the following problems?',
    questions: [
      'Little interest or pleasure in doing things.',
      'Feeling down, depressed, or hopeless.',
      'Trouble falling or staying asleep, or sleeping too much.',
      'Feeling tired or having little energy.',
      'Poor appetite or overeating.',
      'Feeling bad about yourself—or that you are a failure or have let yourself or your family down.',
      'Trouble concentrating on things, such as reading or watching television.',
      'Moving or speaking so slowly that other people could have noticed—or being so restless that you have been moving a lot more than usual.',
      'Thoughts that you would be better off dead, or of hurting yourself in some way.'
    ],
    options: [[0,'Not at all'],[1,'Several days'],[2,'More than half the days'],[3,'Nearly every day']],
    source: 'Kroenke, Spitzer & Williams · PHQ-9 · Reproduction permitted',
    sourceUrl: 'https://www.phqscreeners.com/select-screener'
  }
};
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
  personnel: [['dashboard', '🏠 My Dashboard'], ['assessments', '🧩 Assessments'], ['journal', '📝 Journal']],
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
  showView(me.role === 'personnel' ? 'dashboard' : me.role === 'welfare' ? 'welfare' : 'commander');
}
function showView(v) {
  curView = v;
  document.querySelectorAll('.view').forEach(x => x.classList.add('hidden'));
  document.querySelectorAll('#nav .btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#view-' + v).classList.remove('hidden');
  if (v === 'dashboard') loadPersonnel();
  if (v === 'assessments') renderAssessments();
  if (v === 'journal') loadJournal();
  if (v === 'commander') loadCommander();
  if (v === 'welfare') loadWelfare();
  if (jrListening) jrStopMic(); // defined below — stops dictation when leaving journal
}

/* ==== personnel app (part 3) ==== */
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
async function loadPersonnel() {
  const j = await api('/api/my-status');
  const r = j.risk;
  const last7 = j.checkins.slice(-7), prev7 = j.checkins.slice(-14, -7);
  const s7 = avg(last7.map(c => c.stress)), sl7 = avg(last7.map(c => c.sleep_hours));
  const sPrev = avg(prev7.map(c => c.stress));
  const trend = s7 != null && sPrev != null ? (s7 - sPrev) : null;
  const tArr = trend == null ? '' : trend <= -0.5 ? ' 📉 improving' : trend >= 0.5 ? ' 📈 rising' : ' → steady';
  $('#my-tiles').innerHTML = `
    <div class="tile">
      <span class="t-label">Welfare index</span>
      <span class="t-big" style="color:${BAND_COLOR[r.band]}">${r.score}</span>
      <span class="t-sub" style="color:${BAND_COLOR[r.band]}">${r.band}</span>
      <span class="t-note">support-only · never discipline</span>
    </div>
    <div class="tile">
      <span class="t-label">Avg stress (7d)</span>
      <span class="t-big">${s7 != null ? s7.toFixed(1) : '—'}<small>/10</small></span>
      <span class="t-sub">${s7 != null ? tArr.trim() : 'no data yet'}</span>
    </div>
    <div class="tile">
      <span class="t-label">Avg sleep (7d)</span>
      <span class="t-big">${sl7 != null ? sl7.toFixed(1) : '—'}<small>h</small></span>
      <span class="t-sub">${sl7 != null ? (sl7 >= 7 ? '✓ well rested' : 'below the 7h target') : 'no data yet'}</span>
    </div>
    <div class="tile">
      <span class="t-label">Check-ins (30d)</span>
      <span class="t-big">${j.checkins.length}<small>/30</small></span>
      <span class="t-sub">${j.checkins.length >= 20 ? '🔥 great consistency' : 'daily check-ins help spot patterns'}</span>
    </div>`;
  drawSpark($('#my-chart'), j.checkins.map(c => c.stress));
  $('#my-access').innerHTML = j.accessed.length
    ? j.accessed.map(a => `<div class="access-item">${a.at.slice(0, 10)} — <b>${a.actor}</b> (${a.role}) · ${a.action.replace(/_/g, ' ')}</div>`).join('')
    : '<p class="muted">No one has viewed your record. You are notified whenever a welfare officer does.</p>';
  lastAsmts = j.assessments || [];
}
let lastAsmts = [], activeAsmt = null, asmtIndex = 0, asmtAnswers = [];
const ASMT_LIBRARY = [
  { id:'PSS10', label:'Stress', desc:'Understand how unpredictable or overloaded life has felt during the last month.', meta:'10 questions · 3 min' },
  { id:'GAD7', label:'Anxiety', desc:'A brief check for patterns of worry, tension, restlessness, and fear.', meta:'7 questions · 2 min' },
  { id:'PHQ9', label:'Mood', desc:'A confidential screen for changes in mood, interest, sleep, energy, and concentration.', meta:'9 questions · 3 min' }
];
async function renderAssessments() {
  try { lastAsmts = (await api('/api/my-status')).assessments || []; } catch {}
  const who = lastAsmts.find(a => a.type === 'WHO5');
  $('#who-last').textContent = who ? `Last completed ${who.date}` : 'A gentle place to begin';
  $('#asmt-grid').innerHTML = ASMT_LIBRARY.map(a => {
    const s=ASSESSMENTS[a.id], mine=lastAsmts.find(x=>x.type===a.id);
    return `<article class="asmt-card" style="--asmt-accent:${s.accent}">
      <div class="asmt-card-head"><span class="asmt-symbol">${s.icon}</span><span>${a.label}</span></div>
      <h3>${s.name}</h3><p>${a.desc}</p>
      <div class="asmt-card-foot"><span>${a.meta}${mine?` · last ${mine.date}`:''}</span>
        <button data-start-asmt="${a.id}" aria-label="Start ${s.name}">Start →</button></div>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-start-asmt]').forEach(b=>b.onclick=()=>startAssessment(b.dataset.startAsmt));
}
function startAssessment(id) {
  activeAsmt=id; asmtIndex=0; asmtAnswers=Array(ASSESSMENTS[id].questions.length).fill(null);
  $('#asmt-home').classList.add('hidden'); $('#asmt-result').classList.add('hidden'); $('#asmt-runner').classList.remove('hidden');
  renderAssessmentQuestion(); window.scrollTo({top:0,behavior:'smooth'});
}
function renderAssessmentQuestion() {
  const a=ASSESSMENTS[activeAsmt], total=a.questions.length, answer=asmtAnswers[asmtIndex];
  $('#asmt-kind').textContent=a.short; $('#asmt-title').textContent=a.name;
  $('#asmt-step').textContent=`${asmtIndex+1} of ${total}`; $('#asmt-progress-bar').style.width=`${(asmtIndex+1)/total*100}%`;
  $('#asmt-period').textContent=a.period; $('#asmt-question').textContent=a.questions[asmtIndex];
  $('#asmt-attribution').innerHTML=`Source: <a href="${a.sourceUrl}" target="_blank" rel="noopener">${a.source}</a>`;
  $('#asmt-options').innerHTML=a.options.map(([v,label])=>`<button class="asmt-option ${answer===v?'selected':''}" data-value="${v}">
    <span class="asmt-option-check">${answer===v?'✓':''}</span><span>${label}</span></button>`).join('');
  $('#asmt-options').querySelectorAll('.asmt-option').forEach(b=>b.onclick=()=>{
    asmtAnswers[asmtIndex]=+b.dataset.value; renderAssessmentQuestion();
  });
  $('#asmt-prev').disabled=asmtIndex===0; $('#asmt-next').disabled=answer===null;
  $('#asmt-next').innerHTML=asmtIndex===total-1?'See my result <span>→</span>':'Next <span>→</span>';
}
$('#asmt-exit').onclick=assessmentHome;
$('#asmt-prev').onclick=()=>{if(asmtIndex>0){asmtIndex--;renderAssessmentQuestion();}};
$('#asmt-next').onclick=async()=>{
  if(asmtAnswers[asmtIndex]===null)return;
  if(asmtIndex<ASSESSMENTS[activeAsmt].questions.length-1){asmtIndex++;renderAssessmentQuestion();return;}
  $('#asmt-next').disabled=true; $('#asmt-next').textContent='Saving…';
  try {
    const result=await api('/api/assessment',{method:'POST',body:JSON.stringify({type:activeAsmt,answers:asmtAnswers})});
    showAssessmentResult(result);
  } catch(e) { toast(e.message); renderAssessmentQuestion(); }
};
function assessmentHome(){
  $('#asmt-runner').classList.add('hidden');$('#asmt-result').classList.add('hidden');$('#asmt-home').classList.remove('hidden');renderAssessments();
}
function showAssessmentResult(r){
  const a=ASSESSMENTS[r.type], who=r.type==='WHO5', max={WHO5:100,PSS10:40,GAD7:21,PHQ9:27}[r.type];
  const shown=r.display_score, pct=who?shown:Math.round(shown/max*100);
  $('#asmt-runner').classList.add('hidden'); $('#asmt-result').classList.remove('hidden');
  $('#asmt-result').innerHTML=`<div class="asmt-result-card ${r.urgent?'urgent':''}">
    <span class="asmt-result-icon">${r.urgent?'!':'✓'}</span><span class="asmt-eyebrow">Assessment complete</span>
    <h1>${r.level}</h1><p class="asmt-result-lead">${r.guidance}</p>
    <div class="asmt-score-row"><div><b>${shown}</b><span>${who?'out of 100':'out of '+max}</span></div>
      <div class="asmt-score-track"><i style="width:${pct}%"></i></div></div>
    ${r.urgent?`<div class="asmt-urgent-box"><b>Get immediate support</b><p>Call emergency services (112), Tele-MANAS at <b>14416</b>, or KIRAN at <b>1800-599-0019</b>. If possible, stay with someone you trust.</p></div>`:''}
    <p class="asmt-disclaimer">This is a screening result, not a diagnosis. A qualified health professional can interpret it alongside your circumstances.</p>
    <div class="asmt-result-actions"><button class="asmt-hero-action" id="asmt-done">Back to assessments</button>
      <a href="${a.sourceUrl}" target="_blank" rel="noopener">View official source ↗</a></div></div>`;
  $('#asmt-done').onclick=assessmentHome; window.scrollTo({top:0,behavior:'smooth'});
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
let jrTimeline = [], jrStartedAt = '', jrActivePane = 'write', jrLastAnalysis = null, jrLastStats = null;

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
  try { jrTimeline = entry && entry.timeline ? JSON.parse(entry.timeline) : []; } catch { jrTimeline = []; }
  jrStartedAt = (entry && entry.started_at) || (entry && entry.content ? '' : new Date().toISOString());
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
  if (!jrStartedAt) jrStartedAt = new Date().toISOString();
  const sec = Math.round(jrBase + (jrStart ? (Date.now() - jrStart) / 1000 : 0));
  const last = jrTimeline[jrTimeline.length - 1];
  if (!last || sec - last[0] >= 2 || Math.abs(jrWords() - last[1]) >= 10) jrTimeline.push([sec, jrWords()]);
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
    time_sec: Math.round(jrBase + (jrStart ? (Date.now() - jrStart) / 1000 : 0)),
    timeline: jrTimeline, started_at: jrStartedAt };
  const req = api('/api/journal', { method: 'POST', body: JSON.stringify(body) });
  if (sync) return req;
  try {
    const r = await req; jrDirty = false;
    jrBase = body.time_sec; jrStart = Date.now();
    $('#jr-save').textContent = 'saved ✓ ' + new Date(r.saved_at).toLocaleTimeString();
  } catch { $('#jr-save').textContent = '⚠ save failed'; }
}
setInterval(() => { if (!$('#view-journal').classList.contains('hidden')) jrUpdate(); }, 30000);

/* ---- private 750 Words-style journal analytics ---- */
document.querySelectorAll('.jr-tab').forEach(b => b.addEventListener('click', () => jrShowPane(b.dataset.jrPane)));
async function jrShowPane(name) {
  jrActivePane = name;
  document.querySelectorAll('.jr-tab').forEach(b => b.classList.toggle('on', b.dataset.jrPane === name));
  document.querySelectorAll('.jr-pane').forEach(p => p.classList.add('hidden'));
  $('#jr-pane-' + name).classList.remove('hidden');
  if (jrDirty) await saveJournal(false);
  if (name === 'insights') await jrLoadAnalysisList();
  if (name === 'progress') await jrLoadStats();
}

async function jrLoadAnalysisList() {
  const { days } = await api('/api/journal/analysis/list');
  const empty = !days.length;
  $('#jr-an-empty').classList.toggle('hidden', !empty);
  $('#jr-an-content').classList.toggle('hidden', empty);
  if (empty) return;
  const sel = $('#jr-an-date'), previous = sel.value;
  sel.innerHTML = days.map(d => `<option value="${d.date}">${d.date} · ${d.words} words</option>`).join('');
  if (days.some(d => d.date === previous)) sel.value = previous;
  await jrRenderAnalysis(sel.value);
}
$('#jr-an-date').addEventListener('change', e => jrRenderAnalysis(e.target.value));

async function jrRenderAnalysis(date) {
  const d = await api('/api/journal/analysis/' + date);
  jrLastAnalysis = d;
  const s = d.speed, start = d.started_at ? new Date(d.started_at) : null;
  const startText = start && !isNaN(start) ? ` starting ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  const details = [`${s.wpm || 0} words per minute`];
  if (d.timeline.length >= 2) details.push(`${s.distractions} distraction${s.distractions === 1 ? '' : 's'}`);
  details.push(s.minutesToGoal !== null ? `${s.minutesToGoal} minutes to 750 words` : `${s.minutes} minutes spent`);
  $('#jr-an-summary').innerHTML = `<b>You wrote ${d.words.toLocaleString()} words${startText}</b><span>${details.join(' · ')}</span>`;
  jrDrawSpeed(d.timeline, d.words, d.time_sec);
  const m = d.analysis.mindset;
  const donuts = [
    ['Introvert', 'Extrovert', m.introvert, '#f0b27a', '#526071'],
    ['Positive', 'Negative', m.positive, '#45b39d', '#526071'],
    ['Certain', 'Uncertain', m.certain, '#f4b400', '#526071'],
    ['Thinking', 'Feeling', m.thinking, '#5dade2', '#e76f51']
  ];
  $('#jr-an-mindset').innerHTML = donuts.map(([a,b,p,c1,c2]) => `<div class="jr-donut"><b style="color:${c1}">${a}</b><small>vs ${b}</small><canvas width="132" height="132" data-pct="${p}" data-c1="${c1}" data-c2="${c2}"></canvas></div>`).join('');
  $('#jr-an-mindset').querySelectorAll('canvas').forEach(jrDrawDonut);
  jrBars($('#jr-an-feelings'), d.analysis.feelings);
  jrBars($('#jr-an-topics'), d.analysis.topics);
  jrBars($('#jr-an-time'), d.analysis.time);
  jrBars($('#jr-an-senses'), d.analysis.senses);
  jrBars($('#jr-an-pronouns'), d.analysis.pronouns);
}
function jrDrawDonut(cv) {
  const ctx = cv.getContext('2d'), pct = +cv.dataset.pct, cx = 66, cy = 66, r = 50;
  ctx.clearRect(0, 0, 132, 132); ctx.lineWidth = 17;
  ctx.strokeStyle = cv.dataset.c2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = cv.dataset.c1; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct / 100 * Math.PI * 2); ctx.stroke();
  ctx.fillStyle = themeCol('--ink'); ctx.font = '700 19px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(pct + '%', cx, cy);
}
function jrBars(el, data) {
  const shown = data.filter(x => x.count > 0).slice(0, 7);
  if (!shown.length) { el.innerHTML = '<p class="muted">Not enough matching words yet.</p>'; return; }
  const max = Math.max(...shown.map(x => x.count));
  el.innerHTML = shown.map(x => `<div class="jr-eb" title="${x.label}: ${x.count}"><span class="jr-eb-count">${x.count}</span><div class="jr-eb-bar" style="height:${Math.max(8, x.count / max * 100)}%;background:${x.color}"></div><span class="jr-eb-emoji">${x.emoji || '●'}</span><small>${x.label}</small></div>`).join('');
}
function jrDrawSpeed(timeline, words, timeSec) {
  const cv = $('#jr-an-speed'), ctx = cv.getContext('2d'), tl = timeline || [];
  ctx.clearRect(0, 0, cv.width, cv.height);
  $('#jr-an-speed-note').textContent = tl.length < 2 ? 'Detailed speed samples were not recorded for this older entry; average speed is calculated from total writing time. New writing will show the full curve.' : '';
  const data = tl.length >= 2 ? tl : [[0, 0], [Math.max(timeSec, 1), words]];
  const W = cv.width, H = cv.height, l = 48, r = 18, top = 18, bottom = 34;
  const maxT = Math.max(60, data[data.length - 1][0]), maxW = Math.max(J_GOAL, ...data.map(p => p[1]));
  const X = s => l + s / maxT * (W-l-r), Y = w => H-bottom-w/maxW*(H-bottom-top);
  ctx.font = '11px Segoe UI'; ctx.fillStyle = themeCol('--muted'); ctx.strokeStyle = themeCol('--line');
  for (let w=0; w<=maxW; w+=Math.max(100, Math.ceil(maxW/8/100)*100)) { ctx.beginPath(); ctx.moveTo(l,Y(w));ctx.lineTo(W-r,Y(w));ctx.stroke();ctx.fillText(w,l-35,Y(w)+4); }
  ctx.strokeStyle = themeCol('--accent'); ctx.lineWidth = 3; ctx.beginPath(); data.forEach(([s,w],i)=>i?ctx.lineTo(X(s),Y(w)):ctx.moveTo(X(s),Y(w)));ctx.stroke();
}

async function jrLoadStats() {
  const s = await api('/api/journal/stats'); jrLastStats = s;
  const cards = [['Total words',s.total_words.toLocaleString()],['Days written',s.total_days],['Current streak','🔥 '+s.current_streak],['Longest streak','🏆 '+s.longest_streak],['Avg words/day',s.avg_words],['750+ days',s.green_days],['Time spent',s.total_time_min+' min'],['Level',s.level.name]];
  $('#jr-stat-cards').innerHTML = cards.map(([k,v])=>`<div class="jr-stat"><b>${v}</b><span>${k}</span></div>`).join('');
  $('#jr-badges').innerHTML = s.badges.length ? s.badges.map(b=>`<span class="jr-badge">${b.type==='streak'?'🔥':'📖'} ${b.label}</span>`).join('') : '<p class="muted">No badges yet — write 750 words on 3 consecutive days to earn your first.</p>';
  jrDrawStats(s.last30);
}
function jrDrawStats(days) {
  const cv=$('#jr-stat-chart'),ctx=cv.getContext('2d'),W=cv.width,H=cv.height,l=42,r=14,t=18,b=35,max=Math.max(J_GOAL,...days.map(d=>d.words)),bw=(W-l-r)/30;
  ctx.clearRect(0,0,W,H); ctx.strokeStyle=themeCol('--line'); ctx.fillStyle=themeCol('--muted');ctx.font='11px Segoe UI';
  [J_BLUE,J_GOAL].forEach(g=>{const y=H-b-g/max*(H-b-t);ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(W-r,y);ctx.stroke();ctx.fillText(g,5,y+4);});ctx.setLineDash([]);
  days.forEach((d,i)=>{const h=d.words/max*(H-b-t);ctx.fillStyle=d.words>=J_GOAL?themeCol('--accent'):d.words>=J_BLUE?themeCol('--blue'):themeCol('--muted');ctx.fillRect(l+i*bw+2,H-b-h,Math.max(2,bw-4),h);});
  ctx.fillStyle=themeCol('--muted');ctx.fillText(days[0].date.slice(5),l,H-10);ctx.fillText('today',W-r-34,H-10);
}

// auto-login if session exists
api('/api/me').then(j => { me = j.user; boot(); }).catch(() => {});




