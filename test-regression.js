'use strict';
const { spawn } = require('child_process');
const db = require('./lib/db');
const { computeRisk } = require('./lib/risk');

const PORT = 4496, BASE = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const tracked = ['assessments','data_corrections','interventions','sessions','audit_log'];
const before = Object.fromEntries(tracked.map(t =>
  [t, db.prepare(`SELECT COALESCE(MAX(rowid),0) n FROM ${t}`).get().n]));
const riskBefore = db.prepare('SELECT * FROM risk_scores').all();
const alertsBefore = db.prepare('SELECT * FROM alerts').all();
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), APP_VERSION: 'regression' }, stdio: 'ignore' });
let failures = 0;
function ok(value, label) { console.log(value ? 'PASS' : 'FAIL', label); if (!value) failures++; }
async function login(username) {
  const r = await fetch(BASE + '/api/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username,password:'demo123'}) });
  ok(r.status === 200, `${username} login`);
  return r.headers.get('set-cookie').split(';')[0];
}
async function req(path, cookie, method='GET', body) {
  return fetch(BASE + path, { method, headers:{ cookie, ...(body ? {'content-type':'application/json'} : {}) }, body:body ? JSON.stringify(body) : undefined });
}
(async () => {
  try {
    await wait(1800);
    const publicResponse = await fetch(BASE + '/api/version');
    ok(publicResponse.headers.get('content-security-policy')?.includes("default-src 'self'"), 'content security policy is active');
    ok(publicResponse.headers.get('x-frame-options') === 'DENY', 'clickjacking protection is active');
    const personnel = await login('sepoy.demo'), welfare = await login('welfare'), commander = await login('commander');
    let r = await req('/api/my-status', personnel); const mine = await r.json();
    ok(r.status===200 && mine.workload && mine.self_report && mine.comparison && Array.isArray(mine.corrections), 'personnel workload/self-report transparency payload');
    r = await req('/api/my-data/correction', personnel, 'POST', {category:'workload',message:'Regression test record review request'});
    ok(r.status===200, 'personnel can submit data correction');
    const correction = db.prepare("SELECT id FROM data_corrections WHERE message='Regression test record review request'").get();
    r = await req(`/api/data-corrections/${correction.id}`, welfare, 'POST', {status:'reviewing',resolution_note:'Verification in progress'});
    ok(r.status===200, 'welfare can triage data correction');
    r = await req('/api/welfare/overview', welfare); const w = await r.json();
    ok(r.status===200 && w.bands && w.interventions && Array.isArray(w.corrections), 'welfare operations overview');
    r = await req('/api/dashboard/roster', welfare); ok(r.status===200, 'welfare support roster');
    r = await req('/api/dashboard/unit', commander); const c = await r.json();
    ok(r.status===200 && c.totals && c.actions && c.privacy && c.units.every(u=>u.workload&&u.pulse&&!('bands' in u)), 'commander receives minimized organizational conditions payload');

    const pid = db.prepare("SELECT personnel_id FROM users WHERE username='sepoy.demo'").get().personnel_id;
    r = await req('/api/interventions/recommend', welfare, 'POST', {personnel_id:pid,recs:[{type:'workload_rebalance',reason:'Regression workflow'}]});
    ok(r.status===200, 'welfare can create support plan');
    const intervention=db.prepare("SELECT id FROM interventions WHERE reason='Regression workflow'").get();
    r=await req('/api/interventions/'+intervention.id,welfare,'POST',{status:'accepted'});ok(r.status===200,'support plan can be accepted');
    r=await req('/api/interventions/'+intervention.id,welfare,'POST',{status:'completed',outcome_note:'Roster reviewed'});ok(r.status===200,'accepted support plan can be completed');
    r=await req('/api/interventions/'+intervention.id,welfare,'POST',{status:'invalid'});ok(r.status===400,'invalid intervention transition is rejected');

    for (const [label,cookie,path] of [
      ['commander blocked from person records',commander,'/api/personnel/1'],
      ['commander blocked from welfare overview',commander,'/api/welfare/overview'],
      ['commander blocked from audit log',commander,'/api/audit'],
      ['commander blocked from model trigger',commander,'/api/recalculate'],
      ['welfare blocked from commander aggregates',welfare,'/api/dashboard/unit'],
      ['personnel blocked from welfare queue',personnel,'/api/welfare/overview'],
      ['personnel blocked from commander aggregates',personnel,'/api/dashboard/unit'],
      ['welfare blocked from journal',welfare,'/api/journal/stats'],
      ['commander blocked from journal',commander,'/api/journal/stats']
    ]) { r=await req(path,cookie,path==='/api/recalculate'?'POST':'GET'); ok(r.status===403,label); }

    const basePerson={id:999,active:1,family_status:'single'};
    const disciplinaryOnly=computeRisk({personnel:basePerson,hr:[{type:'disciplinary',date:new Date().toISOString().slice(0,10),value:0}],checkins:[],assessments:[],today:new Date().toISOString().slice(0,10)});
    ok(disciplinaryOnly.score===0 && disciplinaryOnly.factors.length===0, 'disciplinary history never raises support priority');
    const noParticipation=computeRisk({personnel:basePerson,hr:[],checkins:[],assessments:[],today:new Date().toISOString().slice(0,10)});
    ok(noParticipation.score===0 && noParticipation.factors.length===0, 'optional non-participation never raises support priority');

    r=await req('/api/assessment',personnel,'POST',{type:'WHO5',answers:[5,4,3,4,5]}); const a=await r.json();
    ok(r.status===200 && a.type==='WHO5' && a.display_score===84, 'WHO-5 scoring works end-to-end');
    r=await req('/api/journal/analysis/list',personnel); const jl=await r.json();
    ok(r.status===200 && jl.days.length>0, 'private journal insight dates load');
    if(jl.days.length){r=await req('/api/journal/analysis/'+jl.days[0].date,personnel);const ja=await r.json();ok(r.status===200&&ja.analysis.mindset&&ja.analysis.feelings&&ja.analysis.topics&&ja.analysis.time&&ja.analysis.senses&&ja.analysis.pronouns,'all private journal insight groups load');}
  } catch (e) { console.error(e); failures++; }
  finally {
    child.kill();
    for (const t of tracked) db.prepare(`DELETE FROM ${t} WHERE rowid > ?`).run(before[t]);
    db.exec('DELETE FROM risk_scores; DELETE FROM alerts;');
    const putRisk=db.prepare('INSERT INTO risk_scores(id,personnel_id,date,score,band,factors) VALUES(?,?,?,?,?,?)');
    for(const x of riskBefore)putRisk.run(x.id,x.personnel_id,x.date,x.score,x.band,x.factors);
    const putAlert=db.prepare('INSERT INTO alerts(id,personnel_id,level,reason,created_at,status,acted_by,action_note) VALUES(?,?,?,?,?,?,?,?)');
    for(const x of alertsBefore)putAlert.run(x.id,x.personnel_id,x.level,x.reason,x.created_at,x.status,x.acted_by,x.action_note);
    console.log(failures ? `FAILED ${failures}` : 'ALL REGRESSIONS PASSED');
    process.exitCode = failures ? 1 : 0;
  }
})();