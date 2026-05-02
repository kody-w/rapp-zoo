// rapp-zoo Pokédex — local-first organism collection.
//
// Three tabs:
//   My collection — what's on this device (active brainstems + egg backups)
//   Starters       — the 3 archetype rapps bundled with rapp-zoo
//   Discover       — fetched from the global rapp_store Pokédex API
//
// Every card carries a deterministic SVG "sprite" derived from the rappid
// hash so the same organism always looks the same across devices, no matter
// who hosts it. Drag a .egg anywhere on the page to import.

const $ = (id) => document.getElementById(id);

async function api(path, opts) {
  const r = await fetch(path, opts);
  let body = null;
  try { body = await r.json(); } catch { /* not json */ }
  if (!r.ok) {
    const msg = (body && body.error) || (path + ' → ' + r.status);
    throw new Error(msg);
  }
  return body;
}

function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || 'ok') + ' show';
  setTimeout(() => { t.className = 'toast'; }, 3500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── Sprite generator ─────────────────────────────────────────────────
// Deterministic pixel-style avatar generated from the rappid string.
// Hash → 6×6 symmetric "Pokémon" silhouette + colour. Same rappid always
// yields the same sprite — that's the recognition affordance.
function spriteFor(rappid, type) {
  const hash = simpleHash(rappid || 'unknown');
  const palette = {
    work:    ['#ffa657', '#f78166', '#bc4c00'],
    play:    ['#b58ddf', '#a78bfa', '#8250df'],
    regular: ['#79c0ff', '#58a6ff', '#0969da'],
    organism:['#3fb950', '#56d364', '#1a7f37'],
    twin:    ['#d29922', '#ffa657', '#7d4e00'],
    rapp:    ['#58a6ff', '#79c0ff', '#0969da'],
  };
  const colors = palette[type] || palette.rapp;
  const fg = colors[hash % 3];
  const bg = colors[(hash >> 4) % 3];
  // Build a 6×6 grid that's left-right symmetric (3×6 then mirror).
  const cells = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 3; x++) {
      const bit = (hash >> ((y * 3 + x) % 28)) & 1;
      cells.push({ x, y, on: bit === 1 });
      cells.push({ x: 5 - x, y, on: bit === 1 });
    }
  }
  const rects = cells.filter(c => c.on).map(c =>
    `<rect x="${c.x * 8}" y="${c.y * 8}" width="8" height="8" fill="${fg}"/>`
  ).join('');
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect width="48" height="48" fill="${bg}" opacity="0.25"/>${rects}
  </svg>`;
}

function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ── Tabs ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    $('panel-' + tab.dataset.tab).classList.add('is-active');
    if (tab.dataset.tab === 'starters') loadStarters();
    if (tab.dataset.tab === 'discover') loadDiscover();
  });
});

// ── My Collection: twins + eggs ─────────────────────────────────────

function scopeFor(inc) {
  if (inc.is_global) return ['scope-global', 'global'];
  if (inc.is_twin_only) return ['scope-twin', 'twin'];
  return ['scope-project', inc.project_name || 'project'];
}

function renderTwins(data) {
  const root = $('twins');
  const twins = data.twins || [];
  $('twins-count').textContent = twins.length === 0 ? '' : twins.length + ' organism' + (twins.length === 1 ? '' : 's');
  if (twins.length === 0) {
    root.innerHTML = '<div class="empty">No organisms running on this device yet. Drop a <code>.egg</code> on the page to import, or grab a starter.</div>';
    return;
  }
  root.innerHTML = twins.map(t => {
    const sprite = spriteFor(t.rappid_uuid, 'twin');
    const incs = (t.incarnations || []);
    const target = incs.find(i => i.is_twin_only) || incs[0];
    const isLive = !!(target && target.live);
    const port = target && target.port;
    const repoPath = (target && target.brainstem_dir) || '';

    const incPills = incs.map(inc => {
      const [cls, label] = scopeFor(inc);
      return `<span class="pill ${cls}" title=":${inc.port || '?'}">${label}${inc.live ? ' ●' : ''}</span>`;
    }).join('');

    return `
      <div class="card" data-rappid="${t.rappid_uuid}" data-repo="${escapeHtml(repoPath)}">
        <div class="sprite">${sprite}</div>
        <div class="body">
          <h3>${escapeHtml(t.name || 'unnamed organism')}</h3>
          <div class="rappid">${escapeHtml(t.rappid_uuid)}</div>
          <div class="meta">${incPills}${isLive ? '<span class="pill live">live</span>' : ''}</div>
          <div class="actions">
            ${isLive
              ? `<a class="btn primary" href="http://localhost:${port}/" target="_blank">Open ↗</a>
                 <button class="btn danger" data-act="stop">Stop</button>`
              : `<button class="btn primary" data-act="start">Start</button>`
            }
            <button class="btn" data-act="lay-egg" title="Pack as portable .egg">⬇ Egg</button>
            <button class="btn" data-act="reveal" title="Open workspace in Finder">📂</button>
          </div>
        </div>
      </div>`;
  }).join('');
  root.onclick = onTwinAction;
}

async function renderEggs(data) {
  const root = $('eggs');
  const eggs = data.eggs || [];
  $('eggs-count').textContent = eggs.length === 0 ? '' : eggs.length + ' total';
  if (eggs.length === 0) {
    root.innerHTML = '<div class="empty">No eggs yet. Lay one from a running organism, or import.</div>';
    return;
  }
  root.innerHTML = eggs.map(e => {
    const schemaShort = (e.schema || '').replace('brainstem-egg/', '');
    return `
      <div class="egg-row" data-path="${escapeHtml(e.path)}">
        <div class="name">${escapeHtml(e.filename)}</div>
        <div class="size">${(e.size_bytes / 1024).toFixed(1)} KB</div>
        <div class="ts">${e.mtime} · ${escapeHtml(e.rappid_uuid.slice(0, 8))}…</div>
        <div class="schema">${schemaShort}${e.kernel_version ? ' · k' + e.kernel_version : ''}</div>
        <div class="actions">
          <button class="btn" data-act="inspect">Inspect</button>
          <a class="btn" href="/api/export-egg?path=${encodeURIComponent(e.path)}" download>⬇</a>
        </div>
      </div>`;
  }).join('');
  root.onclick = onEggAction;
}

async function onEggAction(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const row = btn.closest('.egg-row');
  if (!row) return;
  const path = row.dataset.path;
  if (btn.dataset.act === 'inspect') return showInspect(path);
}

async function onTwinAction(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.card');
  if (!card) return;
  const rid = card.dataset.rappid;
  const repo = card.dataset.repo;
  const name = card.querySelector('h3').textContent;
  const act = btn.dataset.act;

  try {
    if (act === 'start') {
      btn.disabled = true;
      const r = await api('/api/start', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rappid_uuid: rid }),
      });
      toast(r.already_running ? 'Already running (pid ' + r.pid + ')' : 'Started (pid ' + r.pid + ')');
      setTimeout(refresh, 1200);
    } else if (act === 'stop') {
      const ok = await confirmThen({
        title: 'Stop ' + name + '?',
        body:  'The organism stops responding to chat. Its state stays on disk; you can start again any time.',
      });
      if (!ok) return;
      btn.disabled = true;
      const r = await api('/api/stop', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rappid_uuid: rid }),
      });
      toast(r.was_running ? 'Stopped (pid ' + r.pid + ')' : 'Was not running');
      setTimeout(refresh, 600);
    } else if (act === 'lay-egg') {
      $('lay-twin-name').textContent = name + ' — ' + rid.slice(0, 8) + '…';
      $('lay-repo-path').value = repo || '';
      $('lay-egg-dialog').dataset.rid = rid;
      $('lay-egg-dialog').showModal();
    } else if (act === 'reveal') {
      try {
        await api('/api/reveal', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ path: repo }),
        });
      } catch (err) { toast(err.message, 'err'); }
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally { btn.disabled = false; }
}

// ── Confirm dialog wrapper ───────────────────────────────────────────
function confirmThen({title, body}) {
  return new Promise(resolve => {
    const dlg = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-body').textContent = body;
    const cleanup = (val) => {
      dlg.close();
      $('confirm-cancel').onclick = null;
      $('confirm-proceed').onclick = null;
      resolve(val);
    };
    $('confirm-cancel').onclick = () => cleanup(false);
    $('confirm-proceed').onclick = () => cleanup(true);
    dlg.showModal();
  });
}

// ── Inspect modal ────────────────────────────────────────────────────
async function showInspect(eggPath) {
  try {
    const r = await api('/api/eggs/manifest?path=' + encodeURIComponent(eggPath));
    $('inspect-body').textContent = JSON.stringify(r.manifest, null, 2);
    $('inspect-tree').innerHTML = (r.file_tree || []).map(n =>
      '<li>' + escapeHtml(n) + '</li>'
    ).join('') || '<li class="muted">(empty)</li>';
    $('inspect-export').href = '/api/export-egg?path=' + encodeURIComponent(eggPath);
    $('inspect-dialog').showModal();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Starters ─────────────────────────────────────────────────────────
async function loadStarters() {
  const root = $('starters');
  root.innerHTML = '<div class="empty">Loading starters…</div>';
  try {
    const d = await api('/api/starters');
    const starters = d.starters || [];
    if (starters.length === 0) {
      root.innerHTML = '<div class="empty">No starters available — run <code>python3 starters/build_starters.py</code> in the rapp-zoo repo to build them.</div>';
      return;
    }
    root.innerHTML = starters.map(s => {
      const sprite = spriteFor(s.rappid, s.type);
      return `
        <div class="card">
          <div class="sprite">${sprite}</div>
          <div class="body">
            <h3>${escapeHtml(s.name)}</h3>
            <div class="rappid">${escapeHtml(s.rappid)}</div>
            <div class="meta">
              <span class="pill type-${escapeHtml(s.type)}">${escapeHtml(s.type)}</span>
              <span class="pill ${s.has_skin ? 'skin' : 'skinless'}">${s.has_skin ? 'has skin' : 'no skin'}</span>
              <span class="pill">v${escapeHtml(s.version)}</span>
            </div>
            <div class="desc">${starterDescription(s.rapp_id)}</div>
            <div class="actions">
              <a class="btn primary" href="${s.egg_url}" download="${s.rapp_id}.egg">⬇ Download .egg</a>
              <button class="btn" onclick="showInspect('${s.egg_url.replace(/^\/starters\/dist\//, location.origin + '/starters/dist/')}')">Inspect</button>
            </div>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    root.innerHTML = '<div class="err">' + escapeHtml(e.message) + '</div>';
  }
}

function starterDescription(rappId) {
  const m = {
    workday:  'Daybrief operator. Tight bullets, never paragraphs. Ask it to plan, recap, prep.',
    playtime: 'Riff partner. Story prompts, what-if games, brainstorm fuel — generous and loose.',
    journal:  'A journal that talks back. Listens, mirrors, asks one question at a time.',
  };
  return m[rappId] || 'A starter rapplication.';
}

// ── Discover ─────────────────────────────────────────────────────────
async function loadDiscover() {
  const root = $('discover');
  root.innerHTML = '<div class="empty">Loading discover…</div>';
  try {
    const meta = await api('/api/discover');
    // Fetch the upstream catalog directly from raw.githubusercontent.com.
    const r = await fetch(meta.upstream_url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('upstream catalog ' + r.status + ' — the rapp_store API may not be live yet (see kody-w/RAPP_Store)');
    const catalog = await r.json();
    const entries = catalog.rapplications || catalog.entries || [];
    if (entries.length === 0) {
      root.innerHTML = '<div class="empty">No entries in the global catalog yet.</div>';
      return;
    }
    root.innerHTML = entries.map(e => {
      const rappid = e.rappid || e.id || e.singleton_filename || '';
      const sprite = spriteFor(rappid, e.category === 'creative' ? 'play' : 'rapp');
      return `
        <div class="card">
          <div class="sprite">${sprite}</div>
          <div class="body">
            <h3>${escapeHtml(e.name || e.id || 'unknown')}</h3>
            <div class="rappid">${escapeHtml(rappid)}</div>
            <div class="meta">
              ${e.category ? `<span class="pill">${escapeHtml(e.category)}</span>` : ''}
              ${e.quality_tier ? `<span class="pill">${escapeHtml(e.quality_tier)}</span>` : ''}
              ${e.egg_url ? '<span class="pill skin">egg available</span>' : '<span class="pill skinless">singleton only</span>'}
            </div>
            <div class="desc">${escapeHtml(e.summary || e.description || '')}</div>
            <div class="actions">
              ${e.egg_url ? `<a class="btn primary" href="${e.egg_url}" download>⬇ Download .egg</a>` : ''}
              ${e.singleton_url ? `<a class="btn" href="${e.singleton_url}" download>⬇ Singleton .py</a>` : ''}
              ${e.spec_post ? `<a class="btn" href="${e.spec_post}" target="_blank">Spec ↗</a>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    root.innerHTML = '<div class="err">' + escapeHtml(e.message) + '</div>';
  }
}

// ── Drag-drop import ─────────────────────────────────────────────────
let dragDepth = 0;
window.addEventListener('dragenter', e => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file')) return;
  e.preventDefault();
  dragDepth++;
  $('drop-overlay').classList.add('show');
});
window.addEventListener('dragleave', e => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $('drop-overlay').classList.remove('show');
});
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-overlay').classList.remove('show');
  const files = Array.from(e.dataTransfer.files || []).filter(f => f.name.endsWith('.egg'));
  if (files.length === 0) return toast('Drop a .egg file', 'err');
  for (const file of files) await uploadEgg(file);
});

// File-picker fallback
$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async e => {
  for (const file of Array.from(e.target.files || [])) {
    if (file.name.endsWith('.egg')) await uploadEgg(file);
  }
  e.target.value = '';
});

async function uploadEgg(file) {
  const fd = new FormData();
  fd.append('egg', file);
  try {
    const r = await fetch('/api/import-egg', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    const mname = (d.manifest && (d.manifest.name || d.manifest.id || d.manifest.rappid)) || file.name;
    toast('🥚 Imported ' + mname + ' (' + (d.size_bytes / 1024).toFixed(1) + ' KB)');
    refresh();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Health + main refresh ────────────────────────────────────────────
async function renderHealth(data) {
  $('health').innerHTML = `<span class="ok">●</span> ${data.peer_count} peer(s) · ${data.live_count} live<br>` +
    `<span class="muted">${escapeHtml(data.rapp_home)}</span>`;
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
    $('twins').innerHTML = '<div class="err">' + escapeHtml(e.message) + '</div>';
  }
}

$('btn-refresh').addEventListener('click', refresh);

// ── Lay-egg dialog ───────────────────────────────────────────────────
$('lay-egg-dialog').addEventListener('close', async function () {
  if (this.returnValue !== 'confirm') return;
  const repo_path = $('lay-repo-path').value.trim();
  if (!repo_path) return toast('repo path required', 'err');
  try {
    const r = await api('/api/lay-egg', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ repo_path }),
    });
    toast('Laid ' + (r.size_bytes / 1024).toFixed(1) + ' KB egg');
    refresh();
  } catch (e) { toast(e.message, 'err'); }
});

refresh();
setInterval(refresh, 15000);
