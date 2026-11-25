/* Slate on the iPad (the website version): keeps budgets in step with the desktop app through the private
   GitHub repository timtriezenberg/slate-budget (branch "data", file slate-budgets.json). The token is kept only in
   this browser. Changes are sent a few seconds after you make them; Slate checks for changes from the Mac every
   20 seconds and whenever you come back to the page. Each budget is merged separately: the most recent edit wins,
   deleted budgets stay deleted. Does nothing inside the desktop app or the claude.ai version. */
(function () {
  if (window.slateNative || window.claude) return;
  const REPO = 'timtriezenberg/slate-budget', BRANCH = 'data', PATH = 'slate-budgets.json', KEY = 'slate-gh-token', API = window.SLATE_GH_API || 'https://api.github.com';
  let token = ''; try { token = localStorage.getItem(KEY) || ''; } catch (e) {}
  let remote = { sha: null, etag: null, text: null }, busy = false, again = false, timer = null, state = token ? 'syncing' : 'none', err = '', at = 0;
  const b64enc = s => btoa(unescape(encodeURIComponent(s)));
  const b64dec = s => decodeURIComponent(escape(atob(String(s || '').replace(/\s/g, ''))));
  const merge = (libs) => {   // same rule as the desktop app: per budget, newest edit wins; tombstones stick
    const del = {}, by = new Map(), order = []; const cutoff = Date.now() - 120 * 864e5;
    libs.filter(Boolean).forEach(l => Object.entries(l.deleted || {}).forEach(([k, t]) => { if (+t > cutoff && +t > (del[k] || 0)) del[k] = +t; }));
    libs.filter(Boolean).forEach(l => (l.budgets || []).forEach(x => { if (!x || !x.id) return; const o = by.get(x.id); if (!o) order.push(x.id); if (!o || (+x.updated || 0) >= (+o.updated || 0)) by.set(x.id, x); }));
    return { slate: 1, kind: 'library', currentId: null, budgets: order.map(id => by.get(id)).filter(x => !(del[x.id] && del[x.id] >= (+x.updated || 0))), deleted: del };
  };
  // A starter template Slate made by itself and nobody has touched: never worth sending.
  const isStarter = b => /^Film Budget Template$/.test(b.name || '') && Math.abs((+b.updated || 0) - (+b.created || 0)) < 5000 && !(b.transactions || []).length;
  const forRemote = lib => { const x = Object.assign({}, lib); x.currentId = null; return JSON.stringify(x); };
  async function req(method, body, extra) {
    const url = API + '/repos/' + REPO + '/contents/' + PATH + (method === 'GET' ? '?ref=' + BRANCH : '');
    const h = Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, extra || {});
    if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  }
  const busyEditing = () => U.editing || U.modal || (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName));
  async function sync() {
    if (!token) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const g = await req('GET', null, remote.etag ? { 'If-None-Match': remote.etag } : null);
        if (g.status === 401 || g.status === 403) throw Object.assign(new Error('GitHub refused the token. It may have expired: make a new one and paste it in again.'), { auth: true });
        if (g.status === 200) { const j = await g.json(); remote = { sha: j.sha, etag: g.headers.get('etag'), text: b64dec(j.content) }; }
        else if (g.status === 404) remote = { sha: null, etag: null, text: null };
        else if (g.status !== 304) throw new Error('GitHub answered ' + g.status);
        let rl = null; try { rl = remote.text ? JSON.parse(remote.text) : null; } catch (e) {}
        let mine = JSON.parse(libraryJSON());
        // First connection on this iPad: it has nothing of its own yet (just the starter Slate makes), so take your budgets as they are.
        let first = false; try { first = !localStorage.getItem(KEY + '-synced'); } catch (e) {}
        if (first && rl) mine = { slate: 1, kind: 'library', currentId: null, budgets: [], deleted: {} };
        else mine.budgets = mine.budgets.filter(b => !(rl && isStarter(b) && rl.budgets.some(x => x.name === b.name)));
        const merged = rl ? merge([rl, mine]) : mine;
        // Bring changes from the Mac into the page (not while you're typing in a box: try again shortly).
        const onScreen = JSON.parse(libraryJSON()); const changedHere = JSON.stringify(merged.budgets) !== JSON.stringify(onScreen.budgets) || JSON.stringify(merged.deleted || {}) !== JSON.stringify(onScreen.deleted || {});
        if (changedHere) {
          if (busyEditing()) { again = true; break; }
          const keep = S.currentId; S.budgets = merged.budgets; S.deleted = merged.deleted;
          if (keep && !S.budgets.find(x => x.id === keep)) S.currentId = null;
          invalidate(); try { localStorage.setItem(STORE_KEY, libraryJSON()); } catch (e) {}
          render(); toast('Updated from your Mac');
        }
        const up = forRemote(merged);
        if (remote.text !== null && forRemote(JSON.parse(remote.text)) === up) { state = 'ok'; at = Date.now(); err = ''; try { localStorage.setItem(KEY + '-synced', '1'); } catch (e) {} break; }
        const p = await req('PUT', { message: 'Slate: budgets updated on iPad', content: b64enc(up), branch: BRANCH, sha: remote.sha || undefined });
        if (p.status === 200 || p.status === 201) { const j = await p.json(); remote = { sha: j.content.sha, etag: null, text: up }; state = 'ok'; at = Date.now(); err = ''; try { localStorage.setItem(KEY + '-synced', '1'); } catch (e) {} break; }
        if (p.status === 409 || p.status === 422) { remote.etag = null; continue; }
        if (p.status === 401 || p.status === 403 || p.status === 404) throw Object.assign(new Error('GitHub refused the save. Check the token can write to slate-budget.'), { auth: true });
        throw new Error('GitHub answered ' + p.status);
      }
    } catch (e) {
      state = e.auth ? 'err' : (navigator.onLine === false || /fetch|network|load failed/i.test(String(e.message)) ? 'offline' : 'err');
      err = state === 'offline' ? 'No internet right now. Your changes are kept on this iPad and sync when it’s back.' : String(e.message || e);
    }
    busy = false; setStatus();
    if (again) { again = false; clearTimeout(timer); timer = setTimeout(sync, 1500); }
  }
  function connectModal(msg) {
    U.modal = 'ghconnect';
    openModal(`<h2>Connect to your budgets</h2>
      <p>Paste the GitHub token you made for Slate (the same one you used in the Mac app). It stays on this iPad only.</p>
      <div class="row"><label>Token</label><input id="ghw-tok" type="password" placeholder="github_pat_…" style="flex:1" autocomplete="off"></div>
      <div id="ghw-msg" class="${msg ? 'neg' : 'muted'}" style="min-height:20px;font-size:13px">${esc(msg || '')}</div>
      <div class="acts"><button data-mclose>Not now</button><button class="primary" id="ghw-go">Connect</button></div>`);
    $('#ghw-go').onclick = async () => {
      const t = $('#ghw-tok').value.trim(); if (!/^(github_pat_|ghp_)\w{20,}$/.test(t)) { $('#ghw-msg').textContent = 'That doesn’t look like a GitHub token (it starts with github_pat_).'; $('#ghw-msg').className = 'neg'; return; }
      const r = await fetch(API + '/repos/' + REPO, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' }, cache: 'no-store' }).catch(() => null);
      if (!r || r.status !== 200) { $('#ghw-msg').textContent = !r ? 'Couldn’t reach GitHub. Check the internet connection.' : 'That token can’t open slate-budget.'; $('#ghw-msg').className = 'neg'; return; }
      token = t; try { localStorage.setItem(KEY, t); } catch (e) {}
      closeModal(); state = 'syncing'; setStatus(); remote = { sha: null, etag: null, text: null }; await sync();
      toast(state === 'ok' ? 'Connected. These are your budgets from the Mac' : '⚠ ' + err);
    };
    setTimeout(() => { const i = $('#ghw-tok'); if (i) i.focus(); }, 50);
  }
  window.SlateWeb = {
    push() { if (!token) return; clearTimeout(timer); timer = setTimeout(sync, 2500); },
    statusText() {
      if (state === 'none') return { text: 'Not connected · tap to connect', bad: true, title: 'Connect with your GitHub token to see the budgets from your Mac.' };
      if (state === 'ok') return { text: 'Synced' + (at ? ' ' + new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''), title: 'In step with your Mac through GitHub.' };
      if (state === 'syncing') return { text: 'Syncing…', title: '' };
      return { text: '⚠ Not synced', bad: true, title: err };
    },
    save: null
  };
  SlateExt.actions.ghweb = () => connectModal(state === 'err' ? err : '');
  SlateExt.commands.push({ label: 'Connect to GitHub sync (token)…', run: () => connectModal('') });
  // The save pill opens the connect box when there's no token or the token stopped working.
  document.addEventListener('click', e => { if (e.target.closest('#savestat') && (state === 'none' || state === 'err')) { e.stopPropagation(); connectModal(state === 'err' ? err : ''); } }, true);
  setInterval(() => { if (token && document.visibilityState === 'visible') sync(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (token && document.visibilityState === 'visible') sync(); });
  window.addEventListener('online', () => { if (token) sync(); });
  setTimeout(() => { if (token) sync(); else connectModal(''); }, 600);
  window.SlateGH = { sync, state: () => ({ state, err, at }) };
})();
