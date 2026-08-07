#!/usr/bin/env node
// Reads backlog/*.md and emits a single self-contained, self-saving backlog.html
// No dependencies. Run: node scripts/build-backlog.mjs
//
// The generated page saves tick state itself (localStorage, plus optional direct
// write to backlog-state.json in Chrome). You never need to regenerate it just to
// tick something off — only when the task LIST changes.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'planning', 'backlog');
const OUT = join(ROOT, 'planning', 'backlog.html');
const STATE = join(ROOT, 'planning', 'backlog-state.json');

const PHASES = {
  0: 'Phase 0 — Now (security + external lead time)',
  1: 'Phase 1 — Foundations & de-risking spikes',
  2: 'Phase 2 — Risk-first: model, auth, observability, design',
  3: 'Phase 3 — Core domain + app shell',
  4: 'Phase 4 — Payments',
  5: 'Phase 5 — Back office, invoicing, notifications',
  6: 'Phase 6 — Reporting + website',
  7: 'Phase 7 — Data migration',
  8: 'Phase 8 — Beta, cutover, release',
  9: 'Phase 9 — Deferred (post-launch)',
};

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return [{}, text];
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    }
    meta[kv[1]] = v;
  }
  return [meta, m[2]];
}

const TASK_RE = /^\s*-\s*\[([ xX])\]\s*`([A-Z0-9-]+)`\s*(?:\(risk:(\w+)\)\s*)?(?:\(owner:(\w+)\)\s*)?(\(mvp\)\s*)?(.+)$/gm;

function parseTasks(body) {
  const tasks = [];
  let m;
  TASK_RE.lastIndex = 0;
  while ((m = TASK_RE.exec(body))) {
    tasks.push({
      done: m[1].toLowerCase() === 'x',
      id: m[2],
      risk: (m[3] || '').toLowerCase(),
      owner: (m[4] || 'build').toLowerCase(),
      mvp: !!m[5],
      title: m[6].trim(),
    });
  }
  return tasks;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

function contextHtml(body, file) {
  const parts = body.split(/^##\s+Tasks\s*$/m);
  if (parts.length < 2) {
    throw new Error(`${file}: missing a "## Tasks" heading — every epic file needs one.`);
  }
  const out = [];
  let inList = false;
  for (const raw of parts[0].split('\n')) {
    const line = raw.trimEnd();
    if (/^##+\s+/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h4>${inline(line.replace(/^##+\s+/, ''))}</h4>`);
    } else if (/^\s*-\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*-\s+/, ''))}</li>`);
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

// Seed done-state from backlog-state.json so Claude Code's updates survive a rebuild.
let seeded = {};
if (existsSync(STATE)) {
  try { seeded = JSON.parse(readFileSync(STATE, 'utf8')).done || {}; } catch { /* ignore */ }
}

const epics = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort().map((f) => {
  const [meta, body] = parseFrontmatter(readFileSync(join(SRC, f), 'utf8'));
  const tasks = parseTasks(body).map((t) => ({ ...t, done: t.done || !!seeded[t.id] }));
  return {
    file: f,
    id: meta.id || f.slice(0, 3),
    title: meta.title || f,
    phase: Number(meta.phase ?? 9),
    risk: (meta.risk || 'low').toLowerCase(),
    summary: meta.summary || '',
    depends: Array.isArray(meta.depends_on) ? meta.depends_on : [],
    context: contextHtml(body, f),
    tasks,
  };
});

const phaseGroups = [...new Set(epics.map((e) => e.phase))].sort((a, b) => a - b);
const totalTasks = epics.reduce((n, e) => n + e.tasks.length, 0);

const epicHtml = phaseGroups.map((p) => {
  const inPhase = epics.filter((e) => e.phase === p);
  const cards = inPhase.map((e) => {
    const rows = e.tasks.map((t) => `
      <li class="task" data-id="${esc(t.id)}" data-seed="${t.done ? '1' : '0'}" data-risk="${esc(t.risk)}" data-owner="${esc(t.owner)}" data-mvp="${t.mvp ? '1' : '0'}"${t.done ? ' data-seed="1"' : ''}>
        <button class="box" role="checkbox" aria-checked="false" aria-label="Toggle ${esc(t.id)}"></button>
        <code class="tid">${esc(t.id)}</code>
        ${t.risk ? `<span class="badge r-${esc(t.risk)}">${esc(t.risk)}</span>` : ''}
        ${t.owner === 'andy' ? '<span class="badge r-you">you</span>' : ''}
        ${t.mvp ? '<span class="badge r-mvp">v1</span>' : '<span class="badge r-later">later</span>'}
        <span class="ttext">${inline(t.title)}</span>
      </li>`).join('');
    return `
    <article class="epic" data-phase="${e.phase}" data-risk="${esc(e.risk)}" data-id="${esc(e.id)}">
      <header class="epic-head">
        <div class="epic-title">
          <code class="eid">${esc(e.id)}</code>
          <h3>${esc(e.title)}</h3>
          <span class="badge r-${esc(e.risk)}">${esc(e.risk)}</span>
        </div>
        <div class="meter-wrap">
          <div class="meter"><span style="width:0%"></span></div>
          <span class="meter-num">0/${e.tasks.length}</span>
        </div>
      </header>
      <p class="summary">${inline(e.summary)}</p>
      ${e.depends.length ? `<p class="deps">Depends on ${e.depends.map((x) => `<code>${esc(x)}</code>`).join(' ')}</p>` : ''}
      <details>
        <summary>Context &amp; ${e.tasks.length} tasks</summary>
        <div class="context">${e.context}</div>
        <ul class="tasks">${rows}</ul>
      </details>
    </article>`;
  }).join('');
  return `
  <section class="phase" data-phase="${p}">
    <h2>${esc(PHASES[p] || 'Phase ' + p)} <span class="phase-count"></span></h2>
    ${cards}
  </section>`;
}).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GrayBag Rebuild — Backlog</title>
<style>
  :root{
    --surface:#ffffff; --surface-2:#f6f8f7; --line:#dde5e2;
    --ink:#0f1b17; --ink-2:#4a5a58; --brand:#145f48; --meter:#008f45; --track:#e3eae7;
    --c-bg:#fdecea; --c-fg:#b3261e; --h-bg:#fdf1e0; --h-fg:#8a4b00;
    --m-bg:#e8f3ef; --m-fg:#145f48; --l-bg:#eef1f0; --l-fg:#42504f;
    --y-bg:#fff8e3; --y-fg:#6b4a00; --v-bg:#e4eed4; --v-fg:#3d5210;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --surface:#12201b; --surface-2:#182a23; --line:#2b3d36;
      --ink:#e8efe9; --ink-2:#a6b8b1; --brand:#8fd6ae; --meter:#00af52; --track:#22312c;
      --c-bg:#3a1613; --c-fg:#ffb4aa; --h-bg:#3a2708; --h-fg:#ffd08a;
      --m-bg:#14322a; --m-fg:#8fd6ae; --l-bg:#232e2b; --l-fg:#b6c4c0;
      --y-bg:#332a10; --y-fg:#ffd98a; --v-bg:#26331a; --v-fg:#c8de92;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--ink);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 20px 80px}
  h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}
  .sub{color:var(--ink-2);margin:0 0 18px;font-size:13.5px}
  .savebar{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;
    padding:9px 12px;margin-bottom:14px;font-size:12.5px;color:var(--ink-2)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
  .kpi{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .kpi .n{font-size:28px;font-weight:650;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}
  .kpi .k{font-size:11.5px;color:var(--ink-2);text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
  .overall{display:flex;align-items:center;gap:12px;margin:16px 0 20px}
  .overall .meter{flex:1}
  .meter{height:8px;background:var(--track);border-radius:999px;overflow:hidden}
  .meter>span{display:block;height:100%;background:var(--meter);border-radius:999px;transition:width .18s ease}
  .meter-wrap{display:flex;align-items:center;gap:8px;min-width:150px}
  .meter-wrap .meter{flex:1}
  .meter-num{font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
  .savebar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--surface-2);
    border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:13px}
  .savebar .status{color:var(--ink-2);flex:1;min-width:200px}
  button.act{font:inherit;font-size:12.5px;font-weight:550;padding:6px 11px;border-radius:8px;
    border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
  button.act:hover{border-color:var(--brand);color:var(--brand)}
  .controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;position:sticky;top:0;
    background:var(--surface);padding:10px 0;z-index:5;border-bottom:1px solid var(--line)}
  .controls input,.controls select{font:inherit;font-size:13px;padding:6px 10px;border:1px solid var(--line);
    border-radius:8px;background:var(--surface-2);color:var(--ink)}
  .controls input{flex:1;min-width:170px}
  h2{font-size:14.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);
    margin:32px 0 12px;font-weight:600;display:flex;gap:10px;align-items:baseline}
  .phase-count{font-size:12px;font-variant-numeric:tabular-nums;font-weight:400}
  .epic{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}
  .epic-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
  .epic-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .epic h3{font-size:16px;margin:0;font-weight:600}
  .eid,.tid{font:600 11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);
    border:1px solid var(--line);border-radius:5px;padding:1px 5px;color:var(--ink-2)}
  .badge{font-size:10.5px;font-weight:650;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:999px}
  .r-critical{background:var(--c-bg);color:var(--c-fg)}
  .r-high{background:var(--h-bg);color:var(--h-fg)}
  .r-medium{background:var(--m-bg);color:var(--m-fg)}
  .r-low{background:var(--l-bg);color:var(--l-fg)}
  .r-you{background:var(--y-bg);color:var(--y-fg);border:1px solid var(--y-fg)}
  .r-mvp{background:var(--v-bg);color:var(--v-fg)}
  .r-later{background:transparent;color:var(--ink-2);border:1px solid var(--line)}
  .summary{color:var(--ink-2);font-size:13.5px;margin:8px 0 4px}
  .deps{font-size:12px;color:var(--ink-2);margin:0 0 6px}
  summary{cursor:pointer;font-size:13px;color:var(--brand);font-weight:550;padding:4px 0}
  .context{border-left:2px solid var(--line);padding:2px 0 2px 14px;margin:10px 0 14px;color:var(--ink-2);font-size:13.5px}
  .context h4{font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:12px 0 4px}
  .context p{margin:6px 0} .context ul{margin:6px 0;padding-left:18px}
  ul.tasks{list-style:none;margin:0;padding:0}
  .task{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-top:1px solid var(--line);font-size:13.5px}
  .box{flex:none;width:16px;height:16px;padding:0;border:1.5px solid var(--line);border-radius:4px;
    background:var(--surface);cursor:pointer;position:relative;top:3px}
  .box:hover{border-color:var(--meter)}
  .task.is-done .box{background:var(--meter);border-color:var(--meter)}
  .task.is-done .box::after{content:"";position:absolute;left:4.5px;top:1px;width:4px;height:8px;
    border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
  .task.is-done{color:var(--ink-2)} .task.is-done .ttext{text-decoration:line-through}
  .ttext{flex:1}
  code{font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  .hidden{display:none!important}
  footer{margin-top:44px;color:var(--ink-2);font-size:12px;border-top:1px solid var(--line);padding-top:16px}
</style>
</head>
<body>
<div class="wrap">
  <h1>GrayBag Rebuild — Backlog</h1>
  <p class="sub">Tick boxes directly. Served from <code>scripts/serve-backlog.mjs</code>, every
    click writes <code>backlog-state.json</code> to disk immediately.</p>

  <div class="savebar"><span class="status" id="saveStatus">…</span></div>

  <div class="kpis">
    <div class="kpi"><div class="n" id="kTotal">0</div><div class="k">Tasks</div></div>
    <div class="kpi"><div class="n" id="kDone">0</div><div class="k">Done</div></div>
    <div class="kpi"><div class="n" id="kOpen">0</div><div class="k">Open</div></div>
    <div class="kpi"><div class="n" id="kCrit">0</div><div class="k">Open critical</div></div>
    <div class="kpi"><div class="n" id="kMvp">0</div><div class="k">MVP open</div></div>
    <div class="kpi"><div class="n" id="kMine">0</div><div class="k">Yours to do</div></div>
  </div>

  <div class="overall">
    <div class="meter"><span id="overallBar" style="width:0%"></span></div>
    <span class="meter-num" id="overallNum">0% complete</span>
  </div>

  <div class="controls">
    <input id="q" type="search" placeholder="Search tasks and epics…" aria-label="Search">
    <select id="phase" aria-label="Filter by phase">
      <option value="">All phases</option>
      ${phaseGroups.map((p) => `<option value="${p}">${esc(PHASES[p] || 'Phase ' + p)}</option>`).join('')}
    </select>
    <select id="owner" aria-label="Filter by owner">
      <option value="">Anyone</option>
      <option value="andy">Only mine (Andy)</option>
      <option value="build">Only build tasks</option>
    </select>
    <select id="scope" aria-label="Filter by scope">
      <option value="">All scope</option>
      <option value="1">MVP (v1) only</option>
      <option value="0">Fast-follow only</option>
    </select>
    <select id="risk" aria-label="Filter by risk">
      <option value="">All risk levels</option>
      <option value="critical">Critical only</option>
      <option value="high">High and above</option>
    </select>
    <select id="state" aria-label="Filter by state">
      <option value="">All states</option>
      <option value="open">Open only</option>
      <option value="done">Done only</option>
    </select>
  </div>

  ${epicHtml}

  <footer>
    Task definitions live in <code>backlog/*.md</code>; ticks live in
    <code>backlog-state.json</code>, written on every click.
    <code>#mine</code> opens your tasks, <code>#v1</code> opens the open MVP list.
  </footer>
</div>

<script>
(function(){
  var KEY='graybag-backlog-v1';
  var tasks=[].slice.call(document.querySelectorAll('li.task'));
  var onServer = location.protocol==='http:' || location.protocol==='https:';
  var done={}, saveTimer=null, pending=false;
  var st=document.getElementById('saveStatus');
  function status(m){ st.textContent=m; }

  tasks.forEach(function(t){ if(t.dataset.seed==='1') done[t.dataset.id]=true; });
  try{
    var saved=localStorage.getItem(KEY);
    if(saved) done=Object.assign(done, JSON.parse(saved).done||{});
  }catch(e){}

  function payload(){ return { updated:new Date().toISOString(), done:done }; }
  function localSave(){
    try{ localStorage.setItem(KEY, JSON.stringify(payload())); return true; }catch(e){ return false; }
  }
  function serverSave(){
    pending=true;
    return fetch('/state', {method:'POST', headers:{'Content-Type':'application/json'},
                            body:JSON.stringify(payload())})
      .then(function(r){ if(!r.ok) throw 0; pending=false;
        status('Saved to backlog-state.json · '+new Date().toLocaleTimeString()); })
      .catch(function(){ pending=false;
        status('\u26a0 Could not reach the server — kept a local copy. Is serve-backlog.mjs still running?'); });
  }
  function persist(){
    var ok=localSave();
    if(onServer){ clearTimeout(saveTimer); saveTimer=setTimeout(serverSave,120); }
    else status(ok ? 'Saved in this browser only. Run  node scripts/serve-backlog.mjs  and open localhost:4321 to save to disk.'
                   : '\u26a0 Saving blocked here — open via localhost:4321.');
  }
  window.addEventListener('beforeunload', function(e){ if(pending){ e.preventDefault(); e.returnValue=''; } });

  function render(){
    var total=tasks.length, d=0, crit=0, mvpOpen=0, mine=0;
    tasks.forEach(function(t){
      var isDone=!!done[t.dataset.id];
      t.classList.toggle('is-done', isDone);
      t.querySelector('.box').setAttribute('aria-checked', isDone?'true':'false');
      if(isDone) d++;
      else{
        if(t.dataset.risk==='critical') crit++;
        if(t.dataset.mvp==='1') mvpOpen++;
        if(t.dataset.owner==='andy') mine++;
      }
    });
    document.getElementById('kTotal').textContent=total;
    document.getElementById('kDone').textContent=d;
    document.getElementById('kOpen').textContent=total-d;
    document.getElementById('kCrit').textContent=crit;
    document.getElementById('kMvp').textContent=mvpOpen;
    document.getElementById('kMine').textContent=mine;
    var pct=total?Math.round(d/total*100):0;
    document.getElementById('overallBar').style.width=pct+'%';
    document.getElementById('overallNum').textContent=pct+'% complete';
    document.querySelectorAll('article.epic').forEach(function(ep){
      var its=[].slice.call(ep.querySelectorAll('li.task'));
      var dd=its.filter(function(t){return !!done[t.dataset.id];}).length;
      ep.querySelector('.meter>span').style.width=(its.length?Math.round(dd/its.length*100):0)+'%';
      ep.querySelector('.meter-num').textContent=dd+'/'+its.length;
    });
    document.querySelectorAll('section.phase').forEach(function(sec){
      var its=[].slice.call(sec.querySelectorAll('li.task'));
      sec.querySelector('.phase-count').textContent=
        its.filter(function(t){return !!done[t.dataset.id];}).length+'/'+its.length;
    });
  }

  document.addEventListener('click', function(ev){
    var b=ev.target.closest('.box'); if(!b) return;
    var id=b.closest('li.task').dataset.id;
    if(done[id]) delete done[id]; else done[id]=true;
    render(); persist(); apply();
  });

  var q=document.getElementById('q'), ph=document.getElementById('phase'),
      rk=document.getElementById('risk'), sf=document.getElementById('state'),
      ow=document.getElementById('owner'), sc=document.getElementById('scope');
  var rank={critical:3,high:2,medium:1,low:0,'':0};
  function apply(){
    var term=q.value.toLowerCase().trim(), phase=ph.value, risk=rk.value,
        state=sf.value, owner=ow.value, scope=sc.value;
    var anyFilter=!!(term||risk||state||owner||scope);
    document.querySelectorAll('section.phase').forEach(function(sec){
      var anyEpic=false;
      sec.querySelectorAll('article.epic').forEach(function(ep){
        var anyTask=false;
        ep.querySelectorAll('li.task').forEach(function(t){
          var d=t.classList.contains('is-done');
          var ok=(!risk || rank[t.dataset.risk||'']>=rank[risk])
              && (!state || (state==='open' ? !d : d))
              && (!owner || (t.dataset.owner||'build')===owner)
              && (!scope || (t.dataset.mvp||'0')===scope)
              && (!term || t.textContent.toLowerCase().indexOf(term)>-1
                   || ep.querySelector('.epic-title').textContent.toLowerCase().indexOf(term)>-1);
          t.classList.toggle('hidden', !ok);
          if(ok) anyTask=true;
        });
        var show=(!phase || ep.dataset.phase===phase) && (anyTask || !anyFilter);
        ep.classList.toggle('hidden', !show);
        if(show) anyEpic=true;
      });
      sec.classList.toggle('hidden', !anyEpic);
    });
  }
  [q,ph,rk,sf,ow,sc].forEach(function(el){ el.addEventListener('input',apply); });
  if(location.hash==='#v1'){ sc.value='1'; sf.value='open'; }
  if(location.hash==='#mine'){ ow.value='andy'; sf.value='open';
    document.querySelectorAll('details').forEach(function(d){ d.open=true; }); }

  render(); apply();
  if(onServer){
    fetch('/state',{cache:'no-store'}).then(function(r){return r.json();})
      .then(function(j){ done=Object.assign({}, j.done||{}, done);
        render(); apply(); localSave();
        status('Connected — ticks save to backlog-state.json.'); })
      .catch(function(){ status('\u26a0 Server not responding — working from the local copy.'); });
  } else { localSave(); persist(); }
})();
</script>
</body>
</html>`;

writeFileSync(OUT, html);

// ---- TODO.md — Andy's tasks only, one flat file he edits in VS Code ----
const andy = [];
for (const e of epics) {
  for (const t of e.tasks) if (t.owner === 'andy') andy.push({ ...t, epic: e.id, phase: e.phase });
}
const strip = (x) => x.replace(/\*\*/g, '').replace(/`/g, '');
const GROUPS = [
  ['Do now — these block everything else', (t) => t.phase <= 1 && (t.risk === 'critical' || t.risk === 'high')],
  ['Needed within 2–3 weeks', (t) => t.phase <= 1],
  ['Decisions to make (no rush, but they gate later work)', (t) => t.id.startsWith('E18') || t.epic === 'E09'],
  ['Later — release and rollout', () => true],
];
const used = new Set();
let todo = `# Andy's TODO\n\n`;
todo += `Your tasks only — ${andy.filter((t) => !t.done).length} open of ${andy.length}.\n`;
todo += `Everything here is a **decision**, a **validation**, or something only you have the\n`;
todo += `credentials to do. Everything else is build work and is not your problem.\n\n`;
todo += `Generated — do not edit. Tick things off in the dashboard\n`;
todo += `(\`node scripts/serve-backlog.mjs\` then http://localhost:4321/backlog.html#mine),\n`;
todo += `or tell Claude Code "done E00-01". This file is here so you can read your list\n`;
todo += `in VS Code or on GitHub without opening anything.\n\n---\n`;
for (const [heading, test] of GROUPS) {
  const items = andy.filter((t) => !used.has(t.id) && test(t));
  if (!items.length) continue;
  items.forEach((t) => used.add(t.id));
  todo += `\n## ${heading}\n\n`;
  for (const t of items) {
    const r = t.risk ? ` **[${t.risk}]**` : '';
    const v = t.mvp ? '' : ' _(fast-follow)_';
    todo += `- [${t.done ? 'x' : ' '}] \`${t.id}\`${r}${v} ${strip(t.title)}\n`;
  }
}
todo += `\n---\n\nFull backlog: \`backlog/\` (markdown) or open \`backlog.html\` for the overview.\n`;
writeFileSync(join(ROOT, 'planning', 'TODO.md'), todo);

console.log(`backlog.html + TODO.md written — ${epics.length} epics, ${totalTasks} tasks, ${andy.length} for Andy.`);
