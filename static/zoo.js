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

// ── Dex number, rarity, HP, type — TCG-style derived stats ──────────
//
// Every organism gets a stable 3-digit Pokédex number, a rarity tier,
// an HP-like stat, and a type-icon glyph. All derived from data we
// already have — same input always produces the same readout. No state.

function dexNumFor(seed) {
  const h = simpleHash(seed || 'unknown');
  return String((h % 999) + 1).padStart(3, '0');
}

function rarityFor(entry, kind) {
  // Returns: common | uncommon | rare | holo | ultra | secret
  // Drives the foil treatment (rare+ get holo overlays, ultra+ get
  // animated rainbow shimmer, secret gets the works).
  if (kind === 'holocard') return entry.rarity || 'common';
  if (kind === 'hologram') return entry.kind === 'character' ? 'ultra' : 'holo';
  if (kind === 'twin') {
    const instances = entry.instances || entry.incarnations || [];
    if (instances.some(i => i.live && i.is_global)) return 'secret';
    if (instances.some(i => i.live)) return 'ultra';
    if (instances.length > 1) return 'holo';
    if (entry.rappid_uuid) return 'rare';
    return 'uncommon';
  }
  if (kind === 'starter') return entry.has_skin ? 'rare' : 'uncommon';
  if (kind === 'discover') {
    if (entry.id === 'rapp-zoo') return 'secret';                 // self-reference
    if (entry.quality_tier === 'official') return 'holo';
    if (entry.kind === 'tool') return 'rare';
    if (entry.egg_url || entry.egg) return 'uncommon';
    return 'common';
  }
  return 'common';
}

const RARITY_GLYPH = {
  common:   '●',
  uncommon: '◆',
  rare:     '★',
  holo:     '✦',
  ultra:    '✧',
  secret:   '☆',
};

const TYPE_ICONS = {
  work:        '⚙',
  play:        '✦',
  regular:     '◯',
  organism:    '◉',
  twin:        '⌬',
  rapp:        '◆',
  creative:    '✨',
  productivity:'⚙',
  analysis:    '◉',
  utility:     '⛬',
  tool:        '🛠',
};

function typeIconFor(type) { return TYPE_ICONS[type] || '◆'; }

function hpFor(entry, kind) {
  // HP is flavor — meant to feel meaningful, not be authoritative. Pulls
  // from real metrics so identical inputs always give identical numbers.
  let n = 40;
  if (kind === 'twin') {
    const instances = entry.instances || entry.incarnations || [];
    n += (instances.length * 30);
    if (instances.some(i => i.live)) n += 30;
  } else if (kind === 'starter') {
    n += Math.round((entry.size_bytes || 0) / 200);
  } else if (kind === 'discover') {
    n += Math.round((entry.singleton_lines || entry.lines || 0) / 8);
    if (entry.has_skin) n += 20;
    if (entry.quality_tier === 'official') n += 30;
  }
  // Round to nearest 10, cap so it stays card-like
  return Math.min(220, Math.max(30, Math.round(n / 10) * 10));
}

function inferType(entry, kind) {
  if (entry.type) return entry.type;
  if (entry.category) {
    const c = entry.category.toLowerCase();
    if (c in TYPE_ICONS) return c;
  }
  if (kind === 'twin') return 'twin';
  if (kind === 'hologram') return 'organism';
  if (kind === 'discover') return entry.kind === 'tool' ? 'tool' : 'rapp';
  if (kind === 'holocard') return 'rapp';
  return 'rapp';
}

function dexNumberFor(entry, kind) {
  // Holocards carry their printed number ("007 / Base Set"); otherwise
  // synthesize a stable 3-digit from the rappid hash.
  if (entry.number) return String(entry.number).padStart(3, '0');
  const rappid = entry.rappid_uuid || entry.rappid || entry.id ||
                 entry.singleton_filename || entry.name || 'unknown';
  return dexNumFor(rappid);
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

// ── Holocard renderer ────────────────────────────────────────────────
//
// One factory used by every tab. The kind argument tells it which
// shape the entry came in as (twin / starter / discover) so it can
// derive the right name, rappid, type, version, etc. without each
// caller re-implementing the dex maths.

function holocardHTML(entry, kind, opts) {
  opts = opts || {};
  const rappid = entry.rappid_uuid || entry.rappid || entry.id ||
                 entry.singleton_filename || entry.name || 'unknown';
  const name   = entry.name || entry.display_name || rappid;
  const type   = inferType(entry, kind);
  const sprite = spriteFor(rappid, type);
  const dex    = dexNumberFor(entry, kind);
  const rarity = rarityFor(entry, kind);
  const hp     = hpFor(entry, kind);
  const tagline = entry.tagline || entry.summary || entry.description ||
                  (kind === 'starter' ? starterDescription(entry.rapp_id) : '') || '';
  const instances = entry.instances || entry.incarnations || [];
  const version = entry.version ||
                  ((instances.find(i => i.version) || {}).version) || '';
  const publisher = entry.publisher || entry.author || entry.maintainer || '';
  const isLive = instances.some(i => i.live);
  const isSelf = entry.id === 'rapp-zoo';

  // Pills (existing pill styles stay; we just curate which ones)
  const pills = [];
  pills.push(`<span class="pill type-${type}">${escapeHtml(type)}</span>`);
  if (version) pills.push(`<span class="pill">v${escapeHtml(version)}</span>`);
  if (isLive)  pills.push('<span class="pill live">live</span>');
  if (entry.has_skin === true)  pills.push('<span class="pill skin">has skin</span>');
  if (entry.has_skin === false) pills.push('<span class="pill skinless">no skin</span>');
  if (entry.quality_tier && entry.quality_tier !== 'official') {
    pills.push(`<span class="pill">${escapeHtml(entry.quality_tier)}</span>`);
  }
  for (const inc of instances) {
    const [cls, label] = scopeFor(inc);
    pills.push(`<span class="pill ${cls}" title=":${inc.port || '?'}">${label}</span>`);
  }

  // Per-card actions are kind-specific; the caller still owns wiring.
  const actions = (opts.actions || '').trim();

  // Data attrs the caller's existing event delegation relies on
  const dataAttrs = [
    `data-rappid="${escapeHtml(rappid)}"`,
    entry.selected_instance_rappid
      ? `data-instance="${escapeHtml(entry.selected_instance_rappid)}"`
      : '',
    entry.brainstem_dir || instances[0]?.brainstem_dir
      ? `data-repo="${escapeHtml(entry.brainstem_dir || instances.find(i => i.brainstem_dir)?.brainstem_dir || '')}"`
      : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="card holocard rarity-${rarity} type-${type}${isSelf ? ' is-self' : ''}"
         ${dataAttrs} data-kind="${kind}" data-name="${escapeHtml(name)}"
         data-rarity="${rarity}" data-hp="${hp}" data-dex="${dex}">
      <div class="holo-foil" aria-hidden="true"></div>
      <div class="holo-rarity-stripe" aria-hidden="true"></div>
      <div class="sprite">${sprite}</div>
      <div class="body">
        <div class="holo-header">
          <span class="dex-num mono">#${dex}</span>
          <h3>${escapeHtml(name)}${isSelf ? ' <span class="pill skin" style="font-weight:600">you are here</span>' : ''}</h3>
          <span class="hp-pill"><span class="hp-num">${hp}</span><span class="hp-label">HP</span><span class="type-icon">${typeIconFor(type)}</span></span>
        </div>
        <div class="rappid">${escapeHtml(rappid)}</div>
        <div class="meta">${pills.join('')}</div>
        ${tagline ? `<div class="desc">${escapeHtml(tagline)}</div>` : ''}
        ${actions ? `<div class="actions">${actions}</div>` : ''}
        <div class="holo-footer">
          <span class="rarity-glyph" title="${rarity}">${RARITY_GLYPH[rarity]}</span>
          <span class="rarity-name">${rarity}</span>
          ${publisher ? `<span class="publisher mono">${escapeHtml(publisher)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

// Mouse-tracked tilt + foil shimmer. One delegated handler per grid root,
// updates CSS variables on the hovered card. requestAnimationFrame so we
// only paint once per frame even if the mouse fires faster.
function bindHoloTilt(root) {
  if (root._holoTiltBound) return;
  root._holoTiltBound = true;
  let pending = null;
  root.addEventListener('mousemove', (e) => {
    const card = e.target.closest('.holocard');
    if (!card) return;
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const r = card.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * 100;
      const py = ((e.clientY - r.top)  / r.height) * 100;
      // tilt: -1..1 mapped to small rotation (subtle — no nausea)
      const tx = ((py / 100) - 0.5) * -6;
      const ty = ((px / 100) - 0.5) * 6;
      card.style.setProperty('--pos-x', px + '%');
      card.style.setProperty('--pos-y', py + '%');
      card.style.setProperty('--tilt-x', tx + 'deg');
      card.style.setProperty('--tilt-y', ty + 'deg');
    });
  });
  // mouseout bubbles; reset when the cursor leaves a holocard.
  root.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.holocard');
    if (!card) return;
    if (card.contains(e.relatedTarget)) return;  // moved to a child
    card.style.removeProperty('--tilt-x');
    card.style.removeProperty('--tilt-y');
  });
  // Click anywhere on the card body (not a button / link) → detail view.
  root.addEventListener('click', (e) => {
    if (e.target.closest('button, a, [data-act], [data-copy], [data-hotload-url]')) return;
    const card = e.target.closest('.holocard');
    if (!card) return;
    openCardDetail(card);
  });
}

// ── Card detail dialog (the "showcase" view) ────────────────────────
function openCardDetail(card) {
  const dlg = $('card-detail-dialog');
  if (!dlg) return;
  // Clone the entire card into the dialog so it preserves rarity, foil,
  // pills, footer — everything the grid view shows, but at showcase size.
  const clone = card.cloneNode(true);
  clone.classList.add('detail');
  // Buttons inside the clone — wire them to dispatch the same data-act
  // events on the original card. Avoid surprising the user when they
  // click "Start" inside the modal vs in the grid.
  for (const btn of clone.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const orig = card.querySelector(`[data-act="${btn.dataset.act}"]`);
      if (orig) orig.click();
      dlg.close();
    });
  }
  const slot = $('card-detail-slot');
  slot.innerHTML = '';
  slot.appendChild(clone);
  // Bind tilt to the dialog so the showcased card reacts to cursor too.
  bindHoloTilt(slot);
  dlg.showModal();
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
    if (tab.dataset.tab === 'holocards') loadHolocards();
    if (tab.dataset.tab === 'holograms') loadHolograms();
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
    const incs = t.instances || t.incarnations || [];
    const target = incs.find(i => i.is_twin_only) || incs[0];
    const isLive = !!(target && target.live);
    const port = target && target.port;
    const actions = `
      ${isLive
        ? `<a class="btn primary" href="http://localhost:${port}/" target="_blank">Open ↗</a>
           <button class="btn danger" data-act="stop">Stop</button>`
        : `<button class="btn primary" data-act="start">Start</button>`}
      <button class="btn" data-act="lay-egg" title="Pack as portable .egg">⬇ Egg</button>
      <button class="btn" data-act="reveal" title="Open workspace in Finder">📂</button>`;
    return holocardHTML({
      ...t,
      selected_instance_rappid: target && target.instance_rappid,
    }, 'twin', { actions });
  }).join('');
  root.onclick = onTwinAction;
  bindHoloTilt(root);
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
    const schemaShort = e.schema
      ? `${e.schema}${e.variant ? ' · ' + e.variant : ''}`
      : 'invalid egg';
    const artifact = e.artifact_rappid || e.rappid_uuid || 'unknown';
    return `
      <div class="egg-row" data-path="${escapeHtml(e.path)}">
        <div class="name">${escapeHtml(e.filename)}</div>
        <div class="size">${(e.size_bytes / 1024).toFixed(1)} KB</div>
        <div class="ts">${e.mtime} · ${escapeHtml(artifact.slice(0, 18))}…</div>
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
  const rid = card.dataset.instance || card.dataset.rappid;
  const repo = card.dataset.repo;
  const name = card.querySelector('h3').textContent;
  const act = btn.dataset.act;

  try {
    if (act === 'start') {
      btn.disabled = true;
      const r = await api('/api/start', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ instance_rappid: rid }),
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
        body: JSON.stringify({ instance_rappid: rid }),
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
// Two egg sources to handle:
//   - http(s):// URL  → fetch the bytes + parse client-side via JSZip
//                       (works for starter eggs served from /starters/dist/
//                        and for catalog eggs served from raw.githubusercontent.com)
//   - filesystem path → backend /api/eggs/manifest?path= (existing flow,
//                       used for ~/.rapp/eggs/ backups)
// The earlier code passed URLs to the backend endpoint, which 400'd
// because the path-traversal guard rejects anything that isn't a real
// file under ~/.rapp/eggs/. Dispatch on shape now.
async function showInspect(eggSource) {
  const isUrl = /^https?:/i.test(eggSource)
    || eggSource.startsWith('/starters/dist/');
  try {
    let manifest, fileTree, exportHref;
    if (isUrl) {
      const r = await fetch(eggSource, { cache: 'no-cache' });
      if (!r.ok) throw new Error('fetch failed: HTTP ' + r.status);
      const buf = await r.arrayBuffer();
      fileTree = [];
      const bytes = new Uint8Array(buf);
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        if (typeof JSZip === 'undefined') {
          throw new Error('JSZip not loaded — refresh and try again');
        }
        const zip = await JSZip.loadAsync(buf);
        const mf = zip.file('manifest.json');
        if (!mf) throw new Error('no manifest.json in egg');
        manifest = JSON.parse(await mf.async('string'));
        zip.forEach((p, e) => { if (!e.dir) fileTree.push(p); });
      } else {
        manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      }
      fileTree.sort();
      exportHref = eggSource;  // direct download link to the URL
    } else {
      // Backend peek — for local egg backups under ~/.rapp/eggs/.
      const r = await api('/api/eggs/manifest?path=' + encodeURIComponent(eggSource));
      manifest = r.manifest;
      fileTree = r.file_tree || [];
      exportHref = '/api/export-egg?path=' + encodeURIComponent(eggSource);
    }
    $('inspect-close').addEventListener('click', () => $('inspect-dialog').close());
    $('inspect-body').textContent = JSON.stringify(manifest, null, 2);
    $('inspect-tree').innerHTML = fileTree.map(n =>
      '<li>' + escapeHtml(n) + '</li>'
    ).join('') || '<li class="muted">(empty)</li>';
    $('inspect-export').href = exportHref;
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
      const fullEggUrl = s.egg_url.startsWith('/')
        ? location.origin + s.egg_url
        : s.egg_url;
      const actions = `
        <a class="btn primary" href="${escapeHtml(s.egg_url)}" download="${escapeHtml(s.rapp_id)}.egg">⬇ Download .egg</a>
        <button class="btn" data-act="inspect-url" data-url="${escapeHtml(fullEggUrl)}">Inspect</button>`;
      return holocardHTML(s, 'starter', { actions });
    }).join('');
    // Inspect-url buttons (delegate)
    root.onclick = (e) => {
      const btn = e.target.closest('button[data-act="inspect-url"]');
      if (btn) showInspect(btn.dataset.url);
    };
    bindHoloTilt(root);
  } catch (e) {
    root.innerHTML = '<div class="err">' + escapeHtml(e.message) + '</div>';
  }
}

// ── Holo Zoo: live Holo/1 habitats + quarantined legacy bottles ─────
let holoHeads = [];
let hologramEntries = [];
let activeHologram = null;
let activeHologramContext = null;
let currentDataSlosh = null;

async function loadHolograms() {
  const legacyRoot = $('holograms');
  const headsRoot = $('holo-heads');
  legacyRoot.innerHTML = '<div class="empty">Loading legacy exhibit…</div>';
  headsRoot.innerHTML = '<div class="empty">Watching for Holo/1 streams…</div>';
  try {
    const [data, headData] = await Promise.all([
      api('/api/holograms'),
      api('/api/holo/heads'),
    ]);
    holoHeads = headData.heads || [];
    $('holo-heads-count').textContent = `${holoHeads.length} current`;
    headsRoot.innerHTML = holoHeads.length
      ? holoHeads.map(holoHeadHTML).join('')
      : '<div class="empty">No AI has emitted a Holo/1 output yet. The stage stays empty until an AI chooses one.</div>';
    headsRoot.onclick = event => {
      const open = event.target.closest('button[data-holo-open]');
      if (open) {
        const head = holoHeads.find(item => item.holo_id === open.dataset.holoOpen);
        if (head) openCurrentHolo(head);
        return;
      }
      const history = event.target.closest('button[data-holo-history]');
      if (history) {
        const head = holoHeads.find(item => item.subject_rappid === history.dataset.holoHistory);
        if (head) showHoloHistory(head);
      }
    };

    const local = data.holograms || [];
    let remote = [];
    try {
      remote = (await api('/api/holograms/rar')).entries || [];
    } catch {
      // The local bundled gallery remains usable when RAR is offline.
    }
    const byId = new Map(local.map(entry => [entry.id, entry]));
    for (const entry of remote) {
      if (byId.has(entry.id)) {
        byId.get(entry.id).rar_available = true;
      } else {
        byId.set(entry.id, {
          ...entry,
          description: 'RAR hologram DOGG — summon its verified data record to project it.',
          source: 'rar-catalog',
          rar_available: true,
          rar_notarized: false,
          remote_only: true,
        });
      }
    }
    hologramEntries = [...byId.values()];
    $('holograms-count').textContent =
      `${holoHeads.length} live · ${hologramEntries.length} legacy`;
    legacyRoot.innerHTML = hologramEntries.map(entry => {
      const rarAction = entry.rar_notarized
        ? '<span class="pill live">RAR bottle ✓</span>'
        : `<button class="btn" data-hologram-summon="${escapeHtml(entry.id)}" data-zoo-control="hologram.summon.${escapeHtml(entry.id)}">Catch RAR bottle</button>`;
      const projectAction = entry.remote_only
        ? ''
        : `<button class="btn primary" data-hologram="${escapeHtml(entry.id)}" data-zoo-control="hologram.project.${escapeHtml(entry.id)}">Hotload</button>`;
      const actions = `
        ${projectAction}
        ${rarAction}`;
      const html = holocardHTML({
        ...entry,
        type: entry.kind === 'character' ? 'twin' : 'analysis',
        tagline: `Legacy projection · ${entry.description}`,
      }, 'hologram', { actions });
      return html.replace('class="sprite"', 'class="sprite hologram-card-art"');
    }).join('');
    legacyRoot.onclick = event => {
      const button = event.target.closest('button[data-hologram]');
      if (button) {
        openLegacyHologram(button.dataset.hologram);
        return;
      }
      const summon = event.target.closest('button[data-hologram-summon]');
      if (summon) summonHologramDogg(summon.dataset.hologramSummon, summon);
    };
    bindHoloTilt(legacyRoot);
    if (activeHologram?.mode === 'holo/1' && activeHologram.live) {
      const newest = holoHeads.find(
        head => head.subject_rappid === activeHologram.subject_rappid,
      );
      if (newest && newest.holo_id !== activeHologram.target_holo_id) {
        await queueHoloCatchup(newest);
      }
    }
  } catch (error) {
    headsRoot.innerHTML = `<div class="err">${escapeHtml(error.message)}</div>`;
    legacyRoot.innerHTML = '<div class="empty">Legacy exhibit unavailable.</div>';
  }

  async function summonHologramDogg(id, button) {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Verifying RAR…';
    try {
      const result = await api('/api/holograms/summon', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id }),
      });
      toast(`Caught ${id} bottle · ${result.record_sha256.slice(0, 12)}…`);
      await loadHolograms();
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      toast(error.message, 'err');
    }
  }
}

function holoSubjectName(rappid) {
  const slash = String(rappid || '').lastIndexOf('/');
  const colon = String(rappid || '').lastIndexOf(':');
  return slash >= 0 && colon > slash ? rappid.slice(slash + 1, colon) : rappid;
}

function holoPresence(head) {
  const classification = head.presence?.classification || 'indeterminate';
  if (classification === 'ai-present-likely') {
    return { label: 'Holo Wake active', cls: 'live' };
  }
  if (classification === 'unassisted-human-likely') {
    return { label: 'Holo Wake lost', cls: 'err' };
  }
  return { label: 'Wake gathering', cls: '' };
}

function holoHeadHTML(head) {
  const presence = holoPresence(head);
  const playerState = head.player_active_holo_id === head.holo_id
    ? '<span class="pill live">player active</span>'
    : head.player_active_holo_id
      ? '<span class="pill err">player behind</span>'
      : '<span class="pill">not opened here</span>';
  return `
    <article class="card holo-stream-card" data-holo-id="${escapeHtml(head.holo_id)}">
      <div class="holo-stream-mark" aria-hidden="true">H/1</div>
      <div class="body">
        <div class="holo-header">
          <span class="dex-num mono">#${String(head.holo_seq).padStart(3, '0')}</span>
          <h3>${escapeHtml(holoSubjectName(head.subject_rappid))}</h3>
          <span class="pill ${presence.cls}">${escapeHtml(presence.label)}</span>
        </div>
        <div class="rappid">${escapeHtml(head.subject_rappid)}</div>
        <div class="meta">
          <span class="pill live">current AI holo</span>
          ${playerState}
          <span class="pill">body ${head.body_seq}</span>
          <span class="pill">immutable</span>
        </div>
        <div class="desc mono">holo ${escapeHtml(head.holo_id.slice(0, 16))}…<br>source ${escapeHtml(head.source_frame_hash.slice(0, 16))}…</div>
        <div class="actions">
          <button class="btn primary" data-holo-open="${escapeHtml(head.holo_id)}">Open current</button>
          <button class="btn" data-holo-history="${escapeHtml(head.subject_rappid)}">Flipbook</button>
        </div>
      </div>
    </article>`;
}

function holoPlayerId(subjectRappid) {
  return `zoo-${simpleHash(subjectRappid).toString(16)}`;
}

async function holoHistory(subjectRappid) {
  return api(
    `/api/holo/history?subject_rappid=${encodeURIComponent(subjectRappid)}&limit=256`,
  );
}

function holoPlayerUpdate(item, historyData, authoritativeHoloId) {
  const older = Object.fromEntries(
    historyData.frames
      .filter(frame => frame.holo_seq < item.holo_seq)
      .map(frame => [frame.holo_id, frame.frame]),
  );
  return {
    schema: 'rapp-holo-player-update/1',
    authoritative_holo_id: authoritativeHoloId,
    holo_id: item.holo_id,
    record: item.frame,
    base: item.visual_parent ? older[item.visual_parent] : null,
    history: older,
  };
}

function sendNextHoloUpdate() {
  if (
    activeHologram?.mode !== 'holo/1'
    || !activeHologram.live
    || activeHologram.updateInFlight
    || !activeHologram.pendingUpdates?.length
    || !$('hologram-frame').contentWindow
  ) return;
  const item = activeHologram.pendingUpdates.shift();
  activeHologram.updateInFlight = item.holo_id;
  $('hologram-frame').contentWindow.postMessage(
    holoPlayerUpdate(
      item,
      activeHologram.historyData,
      activeHologram.target_holo_id,
    ),
    '*',
  );
}

async function queueHoloCatchup(head) {
  const data = await holoHistory(head.subject_rappid);
  const ascending = data.frames.slice().reverse();
  const currentIndex = ascending.findIndex(
    item => item.holo_id === activeHologram?.id,
  );
  if (!activeHologram || currentIndex < 0) return;
  activeHologram.historyData = data;
  activeHologram.target_holo_id = head.holo_id;
  activeHologram.pendingUpdates = ascending.slice(currentIndex + 1);
  sendNextHoloUpdate();
}

function sendHologramContext(context) {
  if (
    !activeHologram
    || activeHologram.mode === 'holo/1'
    || !$('hologram-frame').contentWindow
  ) return;
  $('hologram-frame').contentWindow.postMessage({
    schema: 'rapp-zoo-hologram-context/1.0',
    hologram_id: activeHologram.id,
    data_slosh: context,
  }, '*');
}

function prepareHologramFrame(src) {
  const frame = $('hologram-frame');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  frame.setAttribute(
    'sandbox',
    loopback ? 'allow-scripts allow-same-origin' : 'allow-scripts',
  );
  const hologramOrigin = loopback
    ? `${location.protocol}//hologram.localhost:${location.port}`
    : location.origin;
  frame.src = hologramOrigin + src;
  if (!$('hologram-dialog').open) {
    if (
      desktopBridge
      && window.matchMedia('(min-width: 1100px)').matches
    ) {
      $('hologram-dialog').show();
    } else {
      $('hologram-dialog').showModal();
    }
  }
}

function openLegacyHologram(id) {
  activeHologram = hologramEntries.find(entry => entry.id === id);
  if (!activeHologram) return;
  activeHologram.mode = 'legacy';
  activeHologramContext = currentDataSlosh;
  $('hologram-viewer-kind').textContent = activeHologram.kind === 'character'
    ? 'LEGACY CHARACTER BOTTLE'
    : 'LEGACY DATA BOTTLE';
  $('hologram-viewer-title').textContent = activeHologram.name;
  $('hologram-mode-note').textContent =
    'Legacy projection exhibit. This bottle is not an AI Holo/1 self.';
  $('hologram-binding-status').textContent = currentDataSlosh
    ? 'data slosh'
    : 'bottle memory';
  document.querySelectorAll('.legacy-hologram-control').forEach(node => {
    node.hidden = false;
  });
  $('holo-flipbook').hidden = true;
  prepareHologramFrame(`/holograms/${encodeURIComponent(activeHologram.id)}`);
}

async function openHoloFrame(item) {
  const subject = item.subject_rappid || item.frame?.stream_id;
  const holoId = item.holo_id || item.frame?.frame_hash;
  if (!subject || !holoId) return;
  const current = holoHeads.find(head => head.subject_rappid === subject);
  activeHologram = {
    id: holoId,
    mode: 'holo/1',
    subject_rappid: subject,
    holo_seq: item.holo_seq ?? item.frame?.payload?.holo_seq,
    live: false,
    target_holo_id: current?.holo_id || holoId,
    pendingUpdates: [],
    updateInFlight: null,
  };
  activeHologramContext = null;
  $('hologram-viewer-kind').textContent =
    current?.holo_id === holoId ? 'CURRENT AI HOLO · H/1' : 'IMMUTABLE HOLO HISTORY · H/1';
  $('hologram-viewer-title').textContent = holoSubjectName(subject);
  $('hologram-mode-note').textContent =
    'Exact AI-authored output. The Zoo validates and plays it without choosing a form.';
  $('hologram-binding-status').textContent =
    current?.holo_id === holoId ? holoPresence(current).label : `flipbook #${activeHologram.holo_seq}`;
  document.querySelectorAll('.legacy-hologram-control').forEach(node => {
    node.hidden = true;
  });
  await showHoloHistory(current || { subject_rappid: subject, holo_id: holoId });
  prepareHologramFrame(`/holo/${encodeURIComponent(holoId)}`);
}

async function openCurrentHolo(head) {
  const data = await holoHistory(head.subject_rappid);
  const ascending = data.frames.slice().reverse();
  const persistedIndex = ascending.findIndex(
    item => item.holo_id === head.player_active_holo_id,
  );
  const startIndex = persistedIndex >= 0 ? persistedIndex : 0;
  const start = ascending[startIndex];
  if (!start) throw new Error('Current Holo history is unavailable.');
  activeHologram = {
    id: start.holo_id,
    mode: 'holo/1',
    subject_rappid: head.subject_rappid,
    holo_seq: start.holo_seq,
    live: true,
    target_holo_id: head.holo_id,
    historyData: data,
    pendingUpdates: ascending.slice(startIndex + 1),
    updateInFlight: null,
  };
  activeHologramContext = null;
  $('hologram-viewer-kind').textContent = 'CURRENT AI HOLO · H/1';
  $('hologram-viewer-title').textContent = holoSubjectName(head.subject_rappid);
  $('hologram-mode-note').textContent =
    'Exact AI-authored output. The Zoo validates and plays it without choosing a form.';
  $('hologram-binding-status').textContent =
    start.holo_id === head.holo_id ? holoPresence(head).label : 'catching up flipbook';
  document.querySelectorAll('.legacy-hologram-control').forEach(node => {
    node.hidden = true;
  });
  await showHoloHistory(head, data);
  prepareHologramFrame(`/holo/${encodeURIComponent(start.holo_id)}`);
}

async function showHoloHistory(head, loadedData = null) {
  const root = $('holo-flipbook');
  root.hidden = false;
  root.innerHTML = '<span class="muted small">Loading immutable flipbook…</span>';
  try {
    const data = loadedData || await holoHistory(head.subject_rappid);
    root.innerHTML = `
      <div class="holo-flipbook-head">
        <strong>Flipbook</strong>
        <span class="muted small">${data.frames.length} retained frames</span>
      </div>
      <div class="holo-flipbook-strip">
        ${data.frames.slice().reverse().map(item => `
          <button class="holo-frame-chip${item.holo_id === head.holo_id ? ' is-current' : ''}"
                  data-holo-flipbook-open="${escapeHtml(item.holo_id)}"
                  title="${escapeHtml(item.holo_id)}">
            H${item.holo_seq}
          </button>`).join('')}
      </div>`;
    root.onclick = event => {
      const button = event.target.closest('button[data-holo-flipbook-open]');
      if (!button) return;
      const item = data.frames.find(frame => frame.holo_id === button.dataset.holoFlipbookOpen);
      if (item) openHoloFrame({
        ...item,
        subject_rappid: data.subject_rappid,
      });
    };
  } catch (error) {
    root.innerHTML = `<span class="err">${escapeHtml(error.message)}</span>`;
  }
}

window.addEventListener('message', async event => {
  if (event.source !== $('hologram-frame').contentWindow) return;
  const message = event.data || {};
  const messageId = message.holo_id || message.hologram_id;
  if (
    activeHologram?.mode !== 'holo/1'
    && messageId !== activeHologram?.id
  ) return;
  if (message.schema === 'rapp-holo-ready/1') {
    $('hologram-binding-status').textContent = 'Holo/1 ready';
    return;
  }
  if (message.schema === 'rapp-holo-active/1') {
    $('hologram-binding-status').textContent = message.authoritative
      ? 'current AI holo'
      : 'historical holo';
    if (activeHologram?.live) {
      try {
        await api('/api/holo/activate', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            player_id: holoPlayerId(activeHologram.subject_rappid),
            previous_active_holo_id: message.previous_active_holo_id ?? null,
            departure_logical_ms: message.departure_logical_ms ?? null,
            departure_manifest_hash: message.departure_manifest_hash ?? null,
            new_holo_id: message.holo_id,
          }),
        });
        activeHologram.id = message.holo_id;
        activeHologram.holo_seq = activeHologram.historyData?.frames.find(
          item => item.holo_id === message.holo_id,
        )?.holo_seq ?? activeHologram.holo_seq;
        activeHologram.updateInFlight = null;
        if (activeHologram.pendingUpdates.length) {
          $('hologram-binding-status').textContent = 'catching up flipbook';
          sendNextHoloUpdate();
        } else {
          $('hologram-binding-status').textContent = message.authoritative
            ? 'current AI holo'
            : 'player caught up';
          await loadHolograms();
        }
      } catch (error) {
        activeHologram.updateInFlight = null;
        $('hologram-binding-status').textContent = 'active locally · record failed';
        toast(error.message, 'err');
      }
    }
    return;
  }
  if (message.schema === 'rapp-holo-error/1') {
    $('hologram-binding-status').textContent = 'player held prior holo';
    toast(message.error || 'Holo/1 output refused', 'err');
    return;
  }
  if (message.schema === 'rapp-zoo-hologram-ready/1.0') {
    if (activeHologram?.mode === 'holo/1') sendNextHoloUpdate();
    else sendHologramContext(activeHologramContext);
  } else if (message.schema === 'rapp-zoo-hologram-bound/1.0') {
    $('hologram-binding-status').textContent =
      message.live ? 'data slosh' : 'bottle memory';
  } else if (message.schema === 'rapp-zoo-hologram-error/1.0') {
    $('hologram-binding-status').textContent = 'projection error';
    toast(message.error || 'Hologram projection failed', 'err');
  }
});

$('hologram-bind').addEventListener('click', async () => {
  try {
    const context = await api('/api/intelligence-context');
    activeHologramContext = {
      ...context,
      data_slosh: currentDataSlosh?.data_slosh || null,
    };
    sendHologramContext(activeHologramContext);
  } catch (error) {
    toast(error.message, 'err');
  }
});
$('hologram-demo').addEventListener('click', () => {
  currentDataSlosh = null;
  activeHologramContext = null;
  sendHologramContext(null);
});
$('hologram-fullscreen').addEventListener('click', () => {
  $('hologram-frame').requestFullscreen?.();
});
$('hologram-close').addEventListener('click', () => {
  $('hologram-dialog').close();
});
$('hologram-dialog').addEventListener('close', () => {
  $('hologram-frame').src = 'about:blank';
  $('holo-flipbook').hidden = true;
  activeHologram = null;
  activeHologramContext = null;
});

function starterDescription(rappId) {
  const m = {
    workday:  'Daybrief operator. Tight bullets, never paragraphs. Ask it to plan, recap, prep.',
    playtime: 'Riff partner. Story prompts, what-if games, brainstorm fuel — generous and loose.',
    journal:  'A journal that talks back. Listens, mirrors, asks one question at a time.',
  };
  return m[rappId] || 'A starter rapplication.';
}

// ── Discover ─────────────────────────────────────────────────────────
// Cached after first fetch so search/filter stay snappy.
let _discoverEntries = [];
let _discoverMeta = null;
let _discoverSearch = '';
let _discoverRarity = 'all';

function renderDiscover() {
  const root = $('discover');
  if (!_discoverEntries.length) {
    root.innerHTML = '<div class="empty">No entries in the global catalog yet.</div>';
    return;
  }
  const q = _discoverSearch.trim().toLowerCase();
  const matches = _discoverEntries.filter(e => {
    if (_discoverRarity !== 'all' && rarityFor(e, 'discover') !== _discoverRarity) return false;
    if (!q) return true;
    const blob = JSON.stringify([
      e.id, e.name, e.tagline, e.summary, e.description,
      e.category, e.publisher, e.author, e.quality_tier, e.kind,
      e.tags, e.rappid,
    ]).toLowerCase();
    return blob.includes(q);
  });
  $('discover-count').textContent = matches.length === _discoverEntries.length
    ? `${matches.length} entries`
    : `${matches.length} of ${_discoverEntries.length}`;
  if (matches.length === 0) {
    root.innerHTML = `<div class="empty">No entries match "${escapeHtml(_discoverSearch)}".</div>`;
    return;
  }
  root.innerHTML = matches.map(e => {
    const isTool = (e.kind || 'rapplication') === 'tool';
    const installBtn = isTool && (e.install_one_liner || e.install_url)
      ? `<button class="btn primary" data-copy="${escapeHtml(e.install_one_liner || e.install_url)}">⎘ Copy install</button>`
      : (e.egg_url ? `<a class="btn primary" href="${escapeHtml(e.egg_url)}" download>⬇ Download .egg</a>` : '');
    const hotLoadBtn = (!isTool && e.egg_url)
      ? `<button class="btn" data-hotload-url="${escapeHtml(e.egg_url)}" data-hotload-name="${escapeHtml(e.name || e.id)}">⚡ Hot-load</button>`
      : '';
    const repoBtn = e.repo_url
      ? `<a class="btn" href="${escapeHtml(e.repo_url)}" target="_blank" rel="noopener">Repo ↗</a>`
      : '';
    const singletonBtn = e.singleton_url
      ? `<a class="btn" href="${escapeHtml(e.singleton_url)}" download>⬇ Singleton .py</a>`
      : '';
    const specBtn = e.spec_post
      ? `<a class="btn" href="${escapeHtml(e.spec_post)}" target="_blank" rel="noopener">Spec ↗</a>`
      : '';
    const actions = [installBtn, hotLoadBtn, singletonBtn, repoBtn, specBtn]
      .filter(Boolean).join('\n');
    return holocardHTML(e, 'discover', { actions });
  }).join('');
  // Re-wire copy + hot-load (delegated)
  root.querySelectorAll('button[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('📋 Install command copied — paste into your terminal');
      } catch {
        toast('Could not copy — open the repo and grab the one-liner manually', 'err');
      }
    });
  });
  root.querySelectorAll('button[data-hotload-url]').forEach(btn => {
    btn.addEventListener('click', () => hotLoadIntoBrainstem(
      btn.dataset.hotloadUrl, btn.dataset.hotloadName, btn));
  });
  bindHoloTilt(root);
}

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
    // Stash for the search/rarity filter; renderDiscover handles wiring.
    _discoverEntries = entries;
    _discoverMeta = catalog;
    renderDiscover();
  } catch (e) {
    root.innerHTML = '<div class="err">' + escapeHtml(e.message) + '</div>';
  }
}

// ── Holocards ────────────────────────────────────────────────────────
//
// Six card classes — same renderer, class-specific frame and play verb:
//   organism      🥚 Hatch       hot-load .egg permanently
//   rapplication  ⚙ Run          one-shot .egg call (no install)
//   agent         ✦ Cast         /chat with prompt that targets a named agent
//   action        ⚡ Play         /chat with canned prompt — no agent binding
//   stadium       📍 Check in    geofenced; only fires when at the GPS POI
//   sense         👁 Equip       install a sense file into the brainstem

const PLAY_VERBS = {
  organism:     { icon: '🥚', verb: 'Hatch'    },
  rapplication: { icon: '⚙',  verb: 'Run'      },
  agent:        { icon: '✦',  verb: 'Cast'     },
  action:       { icon: '⚡', verb: 'Play'     },
  stadium:      { icon: '📍', verb: 'Check in' },
  sense:        { icon: '👁', verb: 'Equip'    },
};

let _holocards = [];
let _holocardSets = [];
let _holocardClassFilter = 'all';
let _holocardSetFilter = 'all';

async function loadHolocards() {
  const root = $('holocards');
  $('holocards-target').textContent = brainstemTarget();
  if (_holocards.length) { renderHolocards(); return; }
  root.innerHTML = '<div class="empty">Loading deck…</div>';
  try {
    const d = await api('/api/holocards');
    _holocards = d.cards || [];
    _holocardSets = d.sets || [];
    // Build set filter chips from the data (one per discovered set)
    const setRoot = document.querySelector('.set-filters');
    if (setRoot) {
      // Keep the "All sets" chip; add one per set
      const existing = new Set();
      setRoot.querySelectorAll('.set-filter').forEach(c => existing.add(c.dataset.set));
      for (const sid of _holocardSets) {
        if (existing.has(sid)) continue;
        const sample = _holocards.find(c => c.set_id === sid) || {};
        const label = (sample.set_name || sid).toUpperCase();
        const chip = document.createElement('button');
        chip.className = 'set-filter';
        chip.dataset.set = sid;
        chip.textContent = label;
        chip.addEventListener('click', () => {
          document.querySelectorAll('.set-filter').forEach(c => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          _holocardSetFilter = sid;
          renderHolocards();
        });
        setRoot.appendChild(chip);
      }
      // The default "All sets" chip
      setRoot.querySelector('[data-set="all"]').onclick = () => {
        document.querySelectorAll('.set-filter').forEach(c => c.classList.remove('is-active'));
        setRoot.querySelector('[data-set="all"]').classList.add('is-active');
        _holocardSetFilter = 'all';
        renderHolocards();
      };
    }
    // Class filter wiring (one-time)
    document.querySelectorAll('.class-filter').forEach(chip => {
      if (chip._bound) return;
      chip._bound = true;
      chip.addEventListener('click', () => {
        document.querySelectorAll('.class-filter').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        _holocardClassFilter = chip.dataset.class;
        renderHolocards();
      });
    });
    renderHolocards();
  } catch (e) {
    root.innerHTML = '<div class="err">' + escapeHtml(e.message) + '</div>';
  }
}

function renderHolocards() {
  const root = $('holocards');
  const matches = _holocards.filter(c => {
    if (_holocardClassFilter !== 'all' && c.card_class !== _holocardClassFilter) return false;
    if (_holocardSetFilter !== 'all'  && c.set_id     !== _holocardSetFilter)   return false;
    return true;
  });
  $('holocards-count').textContent = matches.length === _holocards.length
    ? `${matches.length} cards across ${_holocardSets.length} set${_holocardSets.length === 1 ? '' : 's'}`
    : `${matches.length} of ${_holocards.length}`;
  if (matches.length === 0) {
    root.innerHTML = '<div class="empty">No cards match this filter.</div>';
    return;
  }
  root.innerHTML = matches.map(c => {
    const cls = c.card_class || 'action';
    const v = PLAY_VERBS[cls] || PLAY_VERBS.action;
    const setBadge = c.set_id
      ? `<span class="card-set-tag mono">${escapeHtml((c.set_name || c.set_id).toUpperCase())} · ${escapeHtml(c.number || '')}</span>`
      : '';
    const classBadge = `<span class="card-class-badge class-${cls}">${escapeHtml(cls)}</span>`;
    const stadium = (cls === 'stadium' && c.location)
      ? `<div class="holo-location mono small muted">📍 ${escapeHtml(c.location.name)}<br><span style="font-size:10px">${escapeHtml(c.location.address || '')} · ${c.location.lat.toFixed(4)}, ${c.location.lng.toFixed(4)} · r=${c.location.radius_m}m</span></div>`
      : '';
    const actions = `
      <button class="btn primary" data-act="play" data-card-id="${escapeHtml(c.id)}">${v.icon} ${v.verb}</button>
      ${c.egg_url || c.rapp_url || c.sense_url
        ? `<a class="btn" href="${escapeHtml(c.egg_url || c.rapp_url || c.sense_url)}" target="_blank" rel="noopener">Source ↗</a>`
        : ''}
      ${stadium}`;
    // The renderer wraps the card body; inject set badge + class badge into the title row via opts.
    return holocardHTML({
      ...c,
      // Put the set/class badge into the tagline area? Better: put it before the rappid in a custom wrapper.
      // The unified renderer doesn't have a slot for class badge — easiest: prepend to the card via post-process below.
    }, 'holocard', { actions });
  }).join('');
  // Post-process: inject set/class badges into each card. Cleaner than
  // bolting yet another slot into holocardHTML.
  const cardEls = root.querySelectorAll('.holocard');
  matches.forEach((c, i) => {
    const el = cardEls[i];
    if (!el) return;
    const cls = c.card_class || 'action';
    el.classList.add('class-' + cls);
    const body = el.querySelector('.body');
    if (!body) return;
    const setRow = document.createElement('div');
    setRow.className = 'card-tags-row';
    setRow.innerHTML = `
      <span class="card-class-badge class-${cls}">${escapeHtml(cls)}</span>
      ${c.set_id ? `<span class="card-set-tag mono">${escapeHtml((c.set_name || c.set_id).toUpperCase())} · ${escapeHtml(c.number || '')}</span>` : ''}`;
    body.insertBefore(setRow, body.querySelector('.rappid') || body.firstChild);
    if (c.card_class === 'stadium' && c.location) {
      const loc = document.createElement('div');
      loc.className = 'holo-location mono small muted';
      loc.innerHTML = `📍 ${escapeHtml(c.location.name)}<br><span style="font-size:10px">${escapeHtml(c.location.address || '')} · ${c.location.lat.toFixed(4)}, ${c.location.lng.toFixed(4)} · r=${c.location.radius_m}m</span>`;
      body.insertBefore(loc, body.querySelector('.actions'));
    }
  });
  // Wire Play buttons
  root.querySelectorAll('button[data-act="play"]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const card = _holocards.find(c => c.id === btn.dataset.cardId);
      if (card) playHolocard(card);
    });
  });
  bindHoloTilt(root);
}

// ── Play handler — dispatches by card_class ──────────────────────────
async function playHolocard(card) {
  const cls = card.card_class || 'action';
  const v = PLAY_VERBS[cls] || PLAY_VERBS.action;
  const dlg = $('play-dialog');
  $('play-title').textContent = card.name;
  $('play-class-badge').textContent = cls.toUpperCase();
  $('play-class-badge').className = 'play-class-badge class-' + cls;
  $('play-set').textContent = card.set_id
    ? `${(card.set_name || card.set_id).toUpperCase()} · ${card.number || ''}`
    : '';
  const body = $('play-body');
  const target = brainstemTarget();

  // Class-specific body content
  if (cls === 'organism') {
    body.innerHTML = `
      <p class="muted small">Hatching this card hot-loads the bound <code>.egg</code> permanently
      into <code>${escapeHtml(target)}</code>. The agent appears in subsequent <code>/chat</code>
      tool-calls.</p>
      <p class="mono small" style="word-break:break-all"><strong>egg_url:</strong> ${escapeHtml(card.egg_url || '')}</p>
      <div class="play-actions">
        <button class="btn" id="play-cancel">Cancel</button>
        <button class="btn primary" id="play-fire">${v.icon} ${v.verb} into brainstem</button>
      </div>
      <div class="play-result" id="play-result"></div>`;
  } else if (cls === 'rapplication') {
    body.innerHTML = `
      <p class="muted small">Runs the rapplication as a <em>one-shot call</em> — the
      brainstem will fetch and invoke without permanent install.</p>
      <p class="mono small" style="word-break:break-all"><strong>rapp_url:</strong> ${escapeHtml(card.rapp_url || '')}</p>
      <label class="muted small">Bound prompt (edit before sending):</label>
      <textarea id="play-prompt" rows="5">${escapeHtml(card.prompt || '')}</textarea>
      <div class="play-actions">
        <button class="btn" id="play-cancel">Cancel</button>
        <button class="btn primary" id="play-fire">${v.icon} ${v.verb}</button>
      </div>
      <div class="play-result" id="play-result"></div>`;
  } else if (cls === 'sense') {
    body.innerHTML = `
      <p class="muted small">Installs a sense — a translation overlay applied to every
      response. Senses live in the brainstem's <code>senses/</code> dir and load on next chat.</p>
      <p class="mono small" style="word-break:break-all"><strong>sense_url:</strong> ${escapeHtml(card.sense_url || '')}</p>
      <div class="play-actions">
        <button class="btn" id="play-cancel">Cancel</button>
        <button class="btn primary" id="play-fire">${v.icon} ${v.verb}</button>
      </div>
      <div class="play-result" id="play-result"></div>`;
  } else if (cls === 'stadium') {
    const loc = card.location || {};
    body.innerHTML = `
      <p class="muted small">Stadium cards are geofenced. The bound action only plays when
      you're physically inside the radius.</p>
      <div class="stadium-info mono small">
        📍 ${escapeHtml(loc.name || '')}<br>
        ${escapeHtml(loc.address || '')}<br>
        ${(loc.lat || 0).toFixed(4)}, ${(loc.lng || 0).toFixed(4)} · radius ${loc.radius_m || '?'} m
      </div>
      <div class="play-actions">
        <button class="btn" id="play-cancel">Cancel</button>
        <button class="btn primary" id="play-fire">📍 Check in</button>
      </div>
      <div class="play-result" id="play-result"></div>`;
  } else {
    // agent / action — both ride /chat with an editable prompt
    body.innerHTML = `
      ${card.agent ? `<p class="muted small">Bound to agent <code>${escapeHtml(card.agent)}</code>. Cast sends the prompt to <code>${escapeHtml(target)}/chat</code>.</p>` : '<p class="muted small">No specific agent bound — the brainstem\'s LLM picks tools.</p>'}
      <label class="muted small">Bound prompt (edit before sending):</label>
      <textarea id="play-prompt" rows="5">${escapeHtml(card.prompt || '')}</textarea>
      <div class="play-actions">
        <button class="btn" id="play-cancel">Cancel</button>
        <button class="btn primary" id="play-fire">${v.icon} ${v.verb}</button>
      </div>
      <div class="play-result" id="play-result"></div>`;
  }

  $('play-cancel').onclick = () => dlg.close();
  $('play-fire').onclick = () => firePlay(card);
  dlg.showModal();
}

async function firePlay(card) {
  const cls = card.card_class || 'action';
  const target = brainstemTarget();
  const fireBtn = $('play-fire');
  const result = $('play-result');
  result.className = 'play-result';
  result.innerHTML = '<span class="muted">…firing…</span>';
  fireBtn.disabled = true;

  try {
    if (cls === 'organism') {
      // Existing hot-load mechanic
      const r = await fetch(target + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_input: `Hot-load this rapplication egg permanently: ${card.egg_url}`,
          conversation_history: [],
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
      result.innerHTML = `<strong>${escapeHtml(card.name)}</strong> hatched.<br><pre>${escapeHtml(d.response || JSON.stringify(d, null, 2)).slice(0, 2000)}</pre>`;
      refresh();   // collection may have changed
    } else if (cls === 'sense') {
      const r = await fetch(target + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_input: `Install this sense file from URL: ${card.sense_url} (filename: ${card.sense_filename || ''}). Drop it into rapp_brainstem/senses/ on disk so it auto-loads next chat.`,
          conversation_history: [],
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
      result.innerHTML = `<strong>${escapeHtml(card.name)}</strong> equipped.<br><pre>${escapeHtml(d.response || '').slice(0, 2000)}</pre>`;
    } else if (cls === 'stadium') {
      const loc = card.location || {};
      if (!navigator.geolocation) throw new Error('No geolocation API in this browser');
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 8000, maximumAge: 0,
        });
      });
      const dist = haversineMeters(pos.coords.latitude, pos.coords.longitude, loc.lat, loc.lng);
      if (dist > (loc.radius_m || 100)) {
        const km = dist > 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.round(dist) + ' m';
        result.className = 'play-result err';
        result.innerHTML = `Out of range. You're <strong>${km}</strong> from <strong>${escapeHtml(loc.name)}</strong>. Travel inside the ${loc.radius_m}m radius to play this card.`;
        fireBtn.disabled = false;
        return;
      }
      // Inside the geofence — fire the bound prompt
      const r = await fetch(target + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_input: card.prompt_on_arrive || card.prompt || `Activate stadium ${loc.name}`,
          conversation_history: [],
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
      result.innerHTML = `Checked in at <strong>${escapeHtml(loc.name)}</strong> (${Math.round(dist)} m from center).<br><pre>${escapeHtml(d.response || '').slice(0, 4000)}</pre>`;
    } else {
      // agent / action / rapplication — POST /chat with the editable prompt
      const prompt = $('play-prompt').value.trim();
      if (!prompt) throw new Error('prompt is empty');
      const r = await fetch(target + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_input: prompt,
          conversation_history: [],
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
      result.innerHTML = `<pre>${escapeHtml(d.response || JSON.stringify(d, null, 2)).slice(0, 4000)}</pre>`;
    }
  } catch (e) {
    result.className = 'play-result err';
    result.innerHTML = escapeHtml(e.message);
  } finally {
    fireBtn.disabled = false;
  }
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Hot-load via brainstem's egg_hatcher_agent ───────────────────────
// Picks a target brainstem from the user's peer registry (or default
// http://localhost:7071) and asks its egg_hatcher agent to fetch + install
// the egg URL. Conversational path — works through /chat, which means it
// honors the brainstem's normal LLM tool-calling loop. The brainstem's
// next /chat call hot-reloads the new agent automatically.

function brainstemTarget() {
  // Order of precedence: explicit localStorage override > first global
  // peer from /api/twins > localhost:7071.
  try {
    const override = localStorage.getItem('brainstem_url');
    if (override) return override.replace(/\/+$/, '');
  } catch {}
  return 'http://localhost:7071';
}

async function hotLoadIntoBrainstem(eggUrl, name, btn) {
  const target = brainstemTarget();
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⚡ hatching…';
  toast(`⚡ Asking ${target} to hot-load ${name}…`);
  try {
    const r = await fetch(target + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_input: `Hot-load this rapplication egg: ${eggUrl}`,
        // No conversation history — this is a one-shot agent call.
        conversation_history: [],
      }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
    // Look for the hatcher's success marker in the response
    const ok = (d.response || '').includes('🥚 Hot-loaded') ||
               (d.agent_logs || '').includes('🥚 Hot-loaded');
    if (ok) {
      toast(`✓ ${name} is now installed in ${target}`);
    } else {
      toast(`Hot-load completed — check brainstem chat for details`, 'ok');
    }
    // Refresh the local "My collection" tab in case the install changed peer state
    refresh();
  } catch (e) {
    toast(`Hot-load failed: ${e.message} — try copying the egg URL and using the brainstem chat directly`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
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
    const payload = (d.manifest && d.manifest.payload) || {};
    const mname = payload.name || payload.rapp_id ||
                  (d.manifest && d.manifest.rappid) || file.name;
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

// ── Discover search & rarity filter ──────────────────────────────────
const _discoverSearchInput = $('discover-search');
if (_discoverSearchInput) {
  _discoverSearchInput.addEventListener('input', (e) => {
    _discoverSearch = e.target.value;
    if (_discoverEntries.length) renderDiscover();
  });
}
document.querySelectorAll('.rarity-filter').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.rarity-filter').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    _discoverRarity = chip.dataset.rarity;
    if (_discoverEntries.length) renderDiscover();
  });
});

// ── Play dialog close ────────────────────────────────────────────────
const _playDlg = $('play-dialog');
if (_playDlg) {
  $('play-close').onclick = () => _playDlg.close();
  _playDlg.addEventListener('click', (e) => {
    if (e.target === _playDlg) _playDlg.close();
  });
}

// ── Card-detail dialog close ─────────────────────────────────────────
const _cardDetailDlg = $('card-detail-dialog');
if (_cardDetailDlg) {
  _cardDetailDlg.addEventListener('click', (e) => {
    // Click on the backdrop (outside the card) closes the dialog
    if (e.target === _cardDetailDlg) _cardDetailDlg.close();
  });
  const closeBtn = $('card-detail-close');
  if (closeBtn) closeBtn.addEventListener('click', () => _cardDetailDlg.close());
}

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

// ── Frontier app-owned Brainstem ────────────────────────────────────
const desktopBridge = window.rappZooDesktop;
let copilotBusy = false;
let copilotAssistant = null;

function copilotMessage(kind, text) {
  const node = document.createElement('div');
  node.className = 'copilot-message ' + kind;
  node.textContent = text;
  $('copilot-transcript').appendChild(node);
  $('copilot-transcript').scrollTop = $('copilot-transcript').scrollHeight;
  return node;
}

function setCopilotBusy(busy) {
  copilotBusy = busy;
  $('copilot-input').disabled = busy;
  $('copilot-send').disabled = busy;
  $('copilot-cancel').disabled = !busy;
  $('copilot-status').textContent = busy ? 'thinking' : 'ready';
}

function setCopilotPanel(open) {
  const dialog = $('copilot-dialog');
  const docked = Boolean(
    desktopBridge
    && window.matchMedia('(min-width: 1100px)').matches
  );
  if (!open) {
    document.body.classList.remove('copilot-dock-open');
    if (dialog.open) dialog.close();
    return;
  }
  if (dialog.open) dialog.close();
  if (docked) {
    document.body.classList.add('copilot-dock-open');
    dialog.show();
  } else {
    document.body.classList.remove('copilot-dock-open');
    dialog.showModal();
  }
  $('copilot-input').focus();
}

if (desktopBridge) {
  document.body.classList.add('desktop-vc');
  $('btn-copilot').hidden = false;
  desktopBridge.brainstemStatus().then((status) => {
    const ready = status.state === 'ready';
    $('copilot-status').textContent = ready ? `${status.tools.length} tools ready` : status.state;
    $('copilot-status').title = status.model || '';
    $('copilot-send').disabled = !ready;
  }).catch((error) => {
    $('copilot-status').textContent = 'Brainstem unavailable';
    $('copilot-status').title = error.message;
    $('copilot-send').disabled = true;
  });
  desktopBridge.onState((state) => {
    const status = state.brainstem || {};
    if (!copilotBusy) {
      $('copilot-status').textContent = status.state === 'ready'
        ? `${(status.tools || []).length} tools ready`
        : status.state || 'starting';
    }
    $('copilot-send').disabled = status.state !== 'ready' || copilotBusy;
  });
  $('btn-copilot').addEventListener('click', () => {
    setCopilotPanel(!$('copilot-dialog').open);
  });
  $('copilot-close').addEventListener('click', () => setCopilotPanel(false));
  $('copilot-cancel').addEventListener('click', async () => {
    await desktopBridge.cancelBrainstem(null);
  });
  document.querySelectorAll('[data-copilot-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      $('copilot-input').value = button.dataset.copilotPrompt;
      $('copilot-form').requestSubmit();
    });
  });
  $('copilot-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = $('copilot-input').value.trim();
    if (!prompt || copilotBusy) return;
    copilotMessage('user', prompt);
    $('copilot-input').value = '';
    copilotAssistant = copilotMessage('assistant', '');
    setCopilotBusy(true);
    try {
      const result = await desktopBridge.askBrainstem(prompt);
      copilotAssistant.textContent = result.response;
      if (result.agent_logs) {
        copilotAssistant.textContent += `\n\nAgents: ${result.agent_logs}`;
      }
      if (result.holo_error || result.holo_commit_error) {
        copilotAssistant.textContent +=
          `\n\nHolo Wake: ${result.holo_error || result.holo_commit_error}`;
      }
      await loadHolograms();
    } catch (error) {
      copilotAssistant.textContent = 'Brainstem error: ' + error.message;
    } finally {
      copilotAssistant = null;
      setCopilotBusy(false);
    }
  });
  if (window.matchMedia('(min-width: 1100px)').matches) {
    setCopilotPanel(true);
  }
}

if ('serviceWorker' in navigator && location.protocol === 'http:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[rapp-zoo] service worker registration failed', error);
    });
  });
}

refresh();
setInterval(refresh, 15000);
