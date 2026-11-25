/* Slate extension: the "update ready" banner.
   (Sync between computers is off in 3.0, so the "who else has this budget open" bar and the
   team-name prompt are gone. They come back when sync does.) */
(function () {
  if (!window.slateNative) return;
  const st = document.createElement('style');
  st.textContent = `#updbar:empty{display:none}
  #updbar{display:flex;align-items:center;gap:10px;padding:8px 16px;font-size:13px;border-bottom:1.5px solid var(--text)}
  #updbar{background:var(--accent);color:var(--on-accent,#fff)} #updbar button{background:var(--panel);color:var(--text)}
  .landing #updbar{margin:0 0 14px;border:1.5px solid var(--text)}`;
  document.head.appendChild(st);

  let upd = null;
  const updHTML = () => upd ? `<b>Slate ${esc(upd.version)} is ready.</b><span style="flex:1">${esc(upd.notes || 'A Slate update is ready to install.')}</span><button data-act="doupdate">Restart &amp; update</button>` : '';
  function paint() { $$('#updbar').forEach(u => { u.innerHTML = updHTML(); }); }

  SlateExt.banners.push(() => `<div id="updbar">${updHTML()}</div>`);
  SlateExt.homeBanners.push(() => `<div id="updbar">${updHTML()}</div>`);
  SlateExt.actions.doupdate = async () => {
    const sr = saveNowSync(); if (!sr.ok) return toast('Fix saving first: ' + (sr.error || ''));
    const r = await NATIVE.updateInstall(); if (!r.ok) toast('Couldn’t update: ' + r.error); else toast('Updating… Slate will reopen.');
  };
  SlateExt.menu['update-ready'] = p => { upd = p; paint(); if (!$('#updbar') && !U.modal) render(); };
  window.SlateTeam = { others: () => [], poll() {}, beat() {} };
})();
