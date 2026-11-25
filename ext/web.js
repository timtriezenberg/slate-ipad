/* Slate on the web (iPad / Safari): keeps your budgets in your claude.ai account so they survive
   Safari clearing website data, and saves exported files through the page's download prompt.
   Does nothing in the desktop apps. */
(function () {
  if (window.slateNative || !window.claude || !window.claude.use) return;
  let ref = null, state = 'connecting', lastSent = '', writing = false, again = false, timer = null, err = '', savedAt = 0;
  const merge = (a, b) => {   // budget by budget, newest edit wins; deleted budgets stay deleted
    const del = Object.assign({}, a.deleted || {}); Object.entries(b.deleted || {}).forEach(([k, t]) => { if (!del[k] || t > del[k]) del[k] = t; });
    const by = new Map(); [a, b].forEach(l => (l.budgets || []).forEach(x => { const o = by.get(x.id); if (!o || (+x.updated || 0) >= (+o.updated || 0)) by.set(x.id, x); }));
    return { slate: 1, kind: 'library', currentId: null, budgets: [...by.values()].filter(x => !(del[x.id] && del[x.id] >= (+x.updated || 0))), deleted: del };
  };
  async function write() {
    if (!ref) return; if (writing) { again = true; return; }
    const text = libraryJSON(); if (text === lastSent) return;
    if (text.length > 250000) { state = 'big'; setStatus(); return; }
    writing = true;
    try { await ref.set({ text, savedAt: Date.now() }); lastSent = text; savedAt = Date.now(); state = 'ok'; err = ''; }
    catch (e) { state = 'err'; err = (e && (e.message || e.code)) || 'unknown error'; setTimeout(write, 8000); }
    writing = false; setStatus();
    if (again) { again = false; write(); }
  }
  window.SlateWeb = {
    push() { clearTimeout(timer); timer = setTimeout(write, 1200); },
    statusText() {
      if (state === 'ok') return { text: 'Saved to your account' + (savedAt ? ' ' + new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''), title: 'Your budgets are kept in your claude.ai account and on this device.' };
      if (state === 'err') return { text: '⚠ Not saved to account', bad: true, title: err + '. Your work is still on this device; Slate keeps trying.' };
      if (state === 'big') return { text: 'Saved on this device', title: 'Too large to keep in your account; use Share file to back up.' };
      return null;
    },
    save: null
  };
  (async () => {
    try {
      const dl = await claude.use('downloads');
      if (dl) window.SlateWeb.save = async (name, text) => {
        try { const r = await dl.save({ filename: name, data: text }); toast('Saved ' + name); return { ok: true, status: r && r.status }; }
        catch (e) { if (e && e.code !== 'declined' && e.code !== 'canceled') toast('Couldn’t save the file: ' + (e.message || e.code)); return { ok: false, canceled: true }; }
      };
    } catch (e) {}
    try {
      const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
      if (!db || !user) { state = 'none'; return; }
      const id = await user.id(); if (!id) { state = 'none'; return; }
      ref = db.collection('data/users/' + id).doc('library');
      const snap = await ref.get();
      const local = JSON.parse(libraryJSON());
      if (snap.exists) {
        const d = snap.data(); let remote = null; try { remote = JSON.parse(d.text); } catch (e) {}
        if (remote && remote.budgets) {
          const m = merge(local, remote);
          const keep = S.currentId; S.budgets = m.budgets; S.deleted = m.deleted;
          if (keep && !S.budgets.find(x => x.id === keep)) S.currentId = null;
          try { localStorage.setItem(STORE_KEY, libraryJSON()); } catch (e) {}
          if (!U.editing && !U.modal) render();
          lastSent = d.text === libraryJSON() ? d.text : '';
        }
      }
      state = 'ok'; savedAt = snap.exists ? (+snap.data().savedAt || 0) : 0;
      if (libraryJSON() !== lastSent) write(); else setStatus();
    } catch (e) { state = 'err'; err = (e && (e.message || e.code)) || 'could not connect'; setStatus(); }
  })();
})();
