// rapp-zoo UI: thin client over /api/* — twin grid, action buttons, dialogs.

const $ = (id) => document.getElementById(id);

async function api(path, opts) {
  const r = await fetch(path, opts);
  let body = null;
  try { body = await r.json(); } catch (_) {}
  if (!r.ok) {
    const msg = (body && body.error) || (path + " → " + r.status);
    throw new Error(msg);
  }
  return body;
}

function toast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (kind || "ok") + " show";
  setTimeout(() => { t.className = "toast"; }, 3500);
}

function scopeFor(inc) {
  if (inc.is_global) return ["scope-global", "global"];
  if (inc.is_twin_only) return ["scope-twin", "twin"];
  return ["scope-project", inc.project_name || "project"];
}

function renderTwins(data) {
  const root = $("twins");
  if (!data.twins || data.twins.length === 0) {
    root.innerHTML = '<div class="empty">No twins on this device yet. Use "Summon from egg" or run <code>installer/initialize-variant.sh</code> in a templated repo.</div>';
    return;
  }
  root.innerHTML = data.twins.map(t => {
    const incs = (t.incarnations || []).map(inc => {
      const [cls, label] = scopeFor(inc);
      return `
        <div class="incarnation">
          <span class="live-dot ${inc.live ? 'live' : ''}" title="${inc.live ? 'live' : 'offline'}"></span>
          <span class="scope ${cls}">${label}</span>
          <span class="port">:${inc.port || '?'}</span>
          <span class="dir" title="${inc.brainstem_dir || ''}">${inc.brainstem_dir || ''}</span>
        </div>`;
    }).join('');

    const lineage = t.parent_repo
      ? `<div class="lineage">parent: <a href="${t.parent_repo}" target="_blank" rel="noopener">${t.parent_repo}</a></div>`
      : '';

    // Action buttons: pick the twin-only incarnation as the workspace target if present
    const twinOnly = (t.incarnations || []).find(i => i.is_twin_only);
    const target = twinOnly || (t.incarnations || [])[0];
    const isLive = !!(target && target.live);
    const port = target && target.port;
    const repoPath = target && target.brainstem_dir;

    return `
      <div class="twin-card" data-rappid="${t.rappid_uuid}" data-repo="${repoPath || ''}">
        <h3>${escapeHtml(t.name || 'unnamed twin')}</h3>
        <div class="rappid">${t.rappid_uuid}</div>
        ${lineage}
        <div class="incarnations">
          <h4>${t.incarnation_count} incarnation${t.incarnation_count === 1 ? '' : 's'}</h4>
          ${incs}
        </div>
        <div class="actions">
          ${isLive
            ? `<a class="open-link" href="http://localhost:${port}/" target="_blank">Open chat ↗</a>
               <button class="btn danger" data-act="stop">Stop</button>`
            : `<button class="btn primary" data-act="start">Start</button>`
          }
          <button class="btn" data-act="lay-egg">Lay egg</button>
          <button class="btn" data-act="hatch">Hatch…</button>
        </div>
      </div>`;
  }).join('');

  // Wire up action buttons (delegated)
  root.onclick = onTwinAction;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

async function onTwinAction(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.twin-card');
  if (!card) return;
  const rid = card.dataset.rappid;
  const repo = card.dataset.repo;
  const name = card.querySelector('h3').textContent;
  const act = btn.dataset.act;

  try {
    if (act === 'start') {
      btn.disabled = true;
      const r = await api('/api/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({rappid_uuid: rid}),
      });
      toast(r.already_running ? 'Already running (pid '+r.pid+')' : 'Started (pid '+r.pid+')');
      setTimeout(refresh, 1500);
    } else if (act === 'stop') {
      btn.disabled = true;
      const r = await api('/api/stop', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({rappid_uuid: rid}),
      });
      toast(r.was_running ? 'Stopped (pid '+r.pid+')' : 'Was not running');
      setTimeout(refresh, 800);
    } else if (act === 'lay-egg') {
      $('lay-twin-name').textContent = name + ' — ' + rid.slice(0, 8) + '…';
      $('lay-repo-path').value = repo || '';
      $('lay-egg-dialog').dataset.rid = rid;
      $('lay-egg-dialog').showModal();
    } else if (act === 'hatch') {
      $('hatch-twin-name').textContent = name + ' — ' + rid.slice(0, 8) + '…';
      $('hatch-new-kernel').value = '';
      $('hatch-dialog').dataset.rid = rid;
      $('hatch-dialog').showModal();
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function renderEggs(data) {
  const root = $("eggs");
  $("eggs-count").textContent = (data.eggs || []).length + ' total';
  if (!data.eggs || data.eggs.length === 0) {
    root.innerHTML = '<div class="empty">No egg backups yet.</div>';
    return;
  }
  root.innerHTML = data.eggs.map(e => `
    <div class="egg-row">
      <span class="ts">${e.mtime}</span>
      <span class="rid">${e.rappid_uuid.slice(0, 8)}…</span>
      <span>${e.filename}</span>
      <span class="size">${(e.size_bytes / 1024).toFixed(1)} KB</span>
    </div>`).join('');
}

async function renderHealth(data) {
  $('health').innerHTML = `<span class="ok">●</span> ${data.peer_count} peer(s) — ${data.live_count} live<br><span class="muted">RAPP_HOME = ${data.rapp_home}</span>`;
}

async function refresh() {
  try {
    const [twins, eggs, health] = await Promise.all([
      api('/api/twins'),
      api('/api/eggs'),
      api('/api/health'),
    ]);
    renderHealth(health);
    renderTwins(twins);
    renderEggs(eggs);
  } catch (e) {
    $('twins').innerHTML = '<div class="err">'+escapeHtml(e.message)+'</div>';
  }
}

// Dialog wiring
$('btn-summon-from-egg').onclick = () => $('summon-dialog').showModal();
$('btn-refresh').onclick = refresh;

$('summon-dialog').addEventListener('close', async function () {
  if (this.returnValue !== 'confirm') return;
  const path = $('summon-egg-path').value.trim();
  const keep = $('summon-keep-kernel').checked;
  if (!path) return toast('egg path required', 'err');
  try {
    const r = await api('/api/summon', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({egg_path: path, keep_existing_kernel: keep}),
    });
    toast('Summoned to ' + r.workspace);
    refresh();
  } catch (e) { toast(e.message, 'err'); }
});

$('lay-egg-dialog').addEventListener('close', async function () {
  if (this.returnValue !== 'confirm') return;
  const repo_path = $('lay-repo-path').value.trim();
  if (!repo_path) return toast('repo path required', 'err');
  try {
    const r = await api('/api/lay-egg', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({repo_path}),
    });
    toast('Laid egg ('+(r.size_bytes/1024).toFixed(1)+' KB) — '+r.egg_path);
    refresh();
  } catch (e) { toast(e.message, 'err'); }
});

$('hatch-dialog').addEventListener('close', async function () {
  if (this.returnValue !== 'confirm') return;
  const rid = this.dataset.rid;
  const new_kernel = $('hatch-new-kernel').value.trim();
  if (!new_kernel) return toast('new kernel path required', 'err');
  try {
    const r = await api('/api/hatch', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({rappid_uuid: rid, new_kernel}),
    });
    toast('Hatched. Kernel from '+r.kernel_swapped_from);
    refresh();
  } catch (e) { toast(e.message, 'err'); }
});

refresh();
setInterval(refresh, 10000);
