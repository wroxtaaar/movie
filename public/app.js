const $ = (sel) => document.querySelector(sel);
const resultsEl = $('#results');
const statusEl = $('#status');

async function fallbackPoster(img) {
  // Try the backend fallback once, then use the normal placeholder.
  if (img.dataset.posterFallback === '1') {
    img.parentNode.innerHTML = '<div class="ph">🎞️</div>';
    return;
  }
  img.dataset.posterFallback = '1';

  try {
    const params = new URLSearchParams({
      title: img.dataset.title || '',
      year: img.dataset.year || '',
    });
    const res = await fetch('/api/poster?' + params.toString());
    const data = await res.json();
    if (res.ok && data.poster) {
      img.src = data.poster;
      img.dataset.full = data.poster;
      return;
    }
  } catch {
    // Fall through to the placeholder.
  }

  img.parentNode.innerHTML = '<div class="ph">🎞️</div>';
}

// Browse results (from YTS) are kept here so card buttons can read the magnet
// for the currently selected quality without another request.
let browseData = [];

// Seedr token kept in localStorage so it survives reloads.
let seedrToken = localStorage.getItem('seedrToken') || null;
let seedrEmail = localStorage.getItem('seedrEmail') || null;

function updateSeedrUI() {
  const btn = $('#seedrBtn');
  const label = $('#seedrLabel');
  if (seedrToken) {
    btn.classList.add('connected');
    label.textContent = `● ${seedrEmail || 'Seedr connected'}`;
    btn.title = 'Click to disconnect';
  } else {
    btn.classList.remove('connected');
    label.textContent = 'Connect Seedr';
    btn.title = 'Connect your Seedr account';
  }
}

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  setTimeout(() => t.classList.add('hidden'), 3200);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function skeletons(n) {
  return Array.from({ length: n }).map(() => `
    <div class="card skeleton">
      <div class="poster"></div>
      <div class="card-body"><div class="card-title">&nbsp;</div></div>
    </div>`).join('');
}

function setActiveTag(el) {
  document.querySelectorAll('.tag').forEach((t) => t.classList.remove('active'));
  if (el) el.classList.add('active');
}

// --- Free text search (torrent-search-api) ----------------------------------
async function doSearch() {
  const q = $('#query').value.trim();
  const category = $('#category').value;
  if (!q) return;
  setActiveTag(null);

  statusEl.textContent = 'Searching…';
  resultsEl.innerHTML = skeletons(8);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&category=${category}&limit=40`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');

    // YTS movies render as rich browse cards; scraper hits as simple cards.
    browseData = data.yts || [];
    const torrents = data.torrents || [];
    const total = browseData.length + torrents.length;
    if (!total) {
      statusEl.textContent = 'No results found. Try a different title.';
      resultsEl.innerHTML = '';
      return;
    }
    statusEl.textContent = `${total} results`;
    let html = browseData.length ? buildBrowseCards(browseData) : '';
    if (torrents.length) {
      if (browseData.length) html += '<div class="section-label">More from other sources</div>';
      html += buildSearchCards(torrents);
    }
    resultsEl.innerHTML = html;
  } catch (err) {
    statusEl.textContent = '';
    resultsEl.innerHTML = '';
    toast(err.message, 'err');
  }
}

function buildSearchCards(items) {
  return items.map((t) => {
    const poster = t.poster
      ? `<img src="${esc(t.poster)}" data-full="${esc(t.poster)}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='<div class=\\'ph\\'>🎞️</div>'" />`
      : `<div class="ph">🎞️</div>`;
    return `
    <div class="card" data-id="${t.id}">
      <div class="poster">
        ${poster}
        <div class="badge seeds" title="Seeders">▲ ${t.seeds}</div>
        ${t.provider ? `<div class="provider-tag">${esc(t.provider)}</div>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title" title="${esc(t.title)}">${esc(t.title)}</div>
        <div class="meta">
          <span class="s">▲ ${t.seeds} seeders</span>
          <span class="p">▼ ${t.peers} peers</span>
          ${t.size ? `<span>${esc(t.size)}</span>` : ''}
        </div>
        <div class="actions">
          <button class="btn-copy" data-id="${t.id}">⧉ Copy magnet</button>
          <button class="btn-seedr" data-id="${t.id}">＋ Seedr</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// --- Browse by tag (YTS API) ------------------------------------------------
async function doBrowse(params, tagEl) {
  setActiveTag(tagEl);
  $('#query').value = '';
  statusEl.textContent = 'Loading…';
  resultsEl.innerHTML = skeletons(10);

  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch('/api/browse?' + qs);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Browse failed');

    if (!data.results.length) {
      statusEl.textContent = 'Nothing found for this tag.';
      resultsEl.innerHTML = '';
      return;
    }
    browseData = data.results;
    statusEl.textContent = `${data.results.length} movies`;
    resultsEl.innerHTML = buildBrowseCards(data.results);
  } catch (err) {
    statusEl.textContent = '';
    resultsEl.innerHTML = '';
    toast(err.message, 'err');
  }
}

function buildBrowseCards(items) {
  return items.map((m, idx) => {
    const poster = m.poster
      ? `<img src="${esc(m.poster)}" data-full="${esc(m.backdrop || m.poster)}" data-title="${esc(m.title)}" data-year="${esc(m.year || '')}" alt="" loading="lazy" onerror="fallbackPoster(this)" />`
      : `<div class="ph">🎞️</div>`;
    // Default the card to its best-seeded quality so the badge, meta and the
    // copied/added magnet are all consistent.
    let bestIdx = 0, best = -1;
    m.torrents.forEach((t, i) => { if (t.seeds > best) { best = t.seeds; bestIdx = i; } });
    const bt = m.torrents[bestIdx];
    const opts = m.torrents.map((t, i) =>
      `<option value="${i}"${i === bestIdx ? ' selected' : ''}>${esc(t.quality)} • ${esc(t.size)}${t.seeds ? ' • ▲' + t.seeds : ''}</option>`).join('');
    const seedBadge = bt.seeds ? `<div class="badge seeds" title="Seeders">▲ ${bt.seeds}</div>` : '';
    return `
    <div class="card" data-idx="${idx}">
      <div class="poster">
        ${poster}
        ${seedBadge}
        ${m.rating ? `<div class="badge rating" title="IMDb rating">★ ${m.rating}</div>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title" title="${esc(m.title)}">${esc(m.title)}</div>
        <div class="meta meta-dyn">
          <span class="s">${bt.seeds ? '▲ ' + bt.seeds + ' seeders' : ''}</span>
          <span class="p">${bt.peers ? '▼ ' + bt.peers + ' peers' : ''}</span>
          <span>${esc(bt.size)} · ${m.year || ''}</span>
        </div>
        <select class="quality-select" title="Choose quality">${opts}</select>
        <div class="actions">
          <button class="btn-copy" data-idx="${idx}">⧉ Copy magnet</button>
          <button class="btn-seedr" data-idx="${idx}">＋ Seedr</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Resolve the magnet for a button, whether it's a search card (lazy fetch)
// or a browse card (inline magnet for the chosen quality).
async function magnetForButton(btn) {
  if (btn.dataset.idx !== undefined) {
    const movie = browseData[btn.dataset.idx];
    const sel = btn.closest('.card').querySelector('.quality-select');
    const qIdx = sel ? parseInt(sel.value, 10) : 0;
    return movie.torrents[qIdx].magnet;
  }
  const res = await fetch(`/api/magnet/${btn.dataset.id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not get magnet');
  return data.magnet;
}

// --- Card interactions ------------------------------------------------------
resultsEl.addEventListener('click', async (e) => {
  // Poster click → lightbox
  const img = e.target.closest('.poster img');
  if (img) {
    const title = img.closest('.card').querySelector('.card-title')?.textContent || '';
    openLightbox(img.dataset.full || img.src, title);
    return;
  }

  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.classList.contains('btn-copy')) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const magnet = await magnetForButton(btn);
      await navigator.clipboard.writeText(magnet);
      btn.textContent = '✓ Copied';
      btn.classList.add('done');
      toast('Magnet copied to clipboard', 'ok');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('done'); btn.disabled = false; }, 1800);
    } catch (err) {
      btn.textContent = orig;
      btn.disabled = false;
      toast(err.message, 'err');
    }
  }

  if (btn.classList.contains('btn-seedr')) {
    if (!seedrToken) {
      openModal();
      toast('Connect your Seedr account first', 'err');
      return;
    }
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      const magnet = await magnetForButton(btn);
      const res = await fetch('/api/seedr/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: seedrToken, magnet }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || /token/i.test(data.error || '')) {
          seedrToken = null;
          localStorage.removeItem('seedrToken');
          updateSeedrUI();
        }
        throw new Error(data.error || 'Seedr rejected the magnet');
      }
      btn.textContent = '✓ Added';
      btn.classList.add('done');
      toast('Added to Seedr 🎉', 'ok');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('done'); btn.disabled = false; }, 2200);
    } catch (err) {
      btn.textContent = orig;
      btn.disabled = false;
      toast(err.message, 'err');
    }
  }
});

// Quality change → update the seeders/peers/size shown on the card
resultsEl.addEventListener('change', (e) => {
  const sel = e.target.closest('.quality-select');
  if (!sel) return;
  const card = sel.closest('.card');
  const movie = browseData[card.dataset.idx];
  const t = movie.torrents[parseInt(sel.value, 10)];
  const badge = card.querySelector('.badge.seeds');
  if (badge) badge.textContent = t.seeds ? `▲ ${t.seeds}` : '';
  const meta = card.querySelector('.meta-dyn');
  meta.querySelector('.s').textContent = t.seeds ? `▲ ${t.seeds} seeders` : '';
  meta.querySelector('.p').textContent = t.peers ? `▼ ${t.peers} peers` : '';
  meta.querySelectorAll('span')[2].textContent = `${t.size} · ${movie.year || ''}`;
});

// --- Lightbox ---------------------------------------------------------------
function openLightbox(src, caption) {
  $('#lightboxImg').src = src;
  $('#lightboxCaption').textContent = caption || '';
  $('#lightbox').classList.remove('hidden');
}
$('#lightbox').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#lightbox').classList.add('hidden');
});

// --- Tags -------------------------------------------------------------------
document.querySelectorAll('.tag').forEach((tag) => {
  tag.addEventListener('click', () => {
    const params = {};
    if (tag.dataset.sort) {
      params.sort = tag.dataset.sort;
      if (tag.dataset.min) params.minRating = tag.dataset.min;
    } else if (tag.dataset.genre) {
      params.genre = tag.dataset.genre;
      params.sort = 'download_count';
    } else if (tag.dataset.quality) {
      params.quality = tag.dataset.quality;
      params.sort = 'seeds';
    }
    doBrowse(params, tag);
  });
});

// --- Seedr modal ------------------------------------------------------------
function openModal() {
  $('#modalError').textContent = '';
  $('#modal').classList.remove('hidden');
  $('#seedrEmail').value = seedrEmail || '';
  $('#seedrEmail').focus();
}
function closeModal() { $('#modal').classList.add('hidden'); }

$('#seedrBtn').addEventListener('click', () => {
  if (seedrToken) {
    seedrToken = null;
    localStorage.removeItem('seedrToken');
    localStorage.removeItem('seedrEmail');
    updateSeedrUI();
    toast('Seedr disconnected');
  } else {
    openModal();
  }
});
$('#modalCancel').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

$('#modalLogin').addEventListener('click', async () => {
  const email = $('#seedrEmail').value.trim();
  const password = $('#seedrPass').value;
  const errEl = $('#modalError');
  if (!email || !password) { errEl.textContent = 'Enter email and password'; return; }

  const btn = $('#modalLogin');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  errEl.textContent = '';
  try {
    const res = await fetch('/api/seedr/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    seedrToken = data.token;
    seedrEmail = email;
    localStorage.setItem('seedrToken', seedrToken);
    localStorage.setItem('seedrEmail', email);
    updateSeedrUI();
    closeModal();
    $('#seedrPass').value = '';
    toast('Seedr connected ✓', 'ok');
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
});

// --- Wire up search ---------------------------------------------------------
$('#searchBtn').addEventListener('click', doSearch);
$('#query').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

updateSeedrUI();

// Load a sensible default view on first paint.
doBrowse({ sort: 'download_count' }, document.querySelector('.tag[data-sort="download_count"]'));
