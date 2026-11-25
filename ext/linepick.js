/* Slate extension: the "Budget line" dropdowns become search boxes. Type a few letters (or an account number)
   and the list narrows as you type. The original <select> stays hidden underneath and still does the saving. */
(function () {
  const st = document.createElement('style');
  st.textContent = `.ls-in{width:100%;min-width:140px}
  .ls-in:focus{outline:2px solid var(--accent);outline-offset:-1px}
  #ls-pop{position:fixed;z-index:9999;background:var(--panel);border:1.5px solid var(--text);box-shadow:4px 4px 0 var(--shade,rgba(0,0,0,.25));max-height:320px;overflow:auto;font-size:13px;border-radius:var(--r,3px)}
  #ls-pop .it{padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:1px}
  #ls-pop .it.on{background:var(--accent);color:var(--on-accent,#fff)} #ls-pop .it.on .pa{color:inherit;opacity:.85}
  #ls-pop .it .pa{font-size:11px;color:var(--muted)} #ls-pop .it.acct .lb{font-weight:700}
  #ls-pop .it mark{background:#f6d77a;color:#1b1d22;padding:0 1px;border-radius:2px}
  #ls-pop .none{padding:10px;color:var(--muted)} #ls-pop .hint{padding:5px 10px;font:600 10.5px var(--font-mono,monospace);letter-spacing:.06em;color:var(--muted);text-transform:uppercase;border-bottom:1px solid var(--line)}`;
  document.head.appendChild(st);

  let pop = null, cur = null;   // cur = {sel, inp, items, i}
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const labelOf = sel => { const o = sel.selectedOptions[0]; return o && o.value ? (o.dataset.label || o.textContent.trim()) : ''; };
  const hi = (text, toks) => { let h = esc(text); toks.filter(t => t.length).forEach(t => { const i = norm(h).indexOf(t); if (i >= 0 && !/[<>&]/.test(h.slice(i, i + t.length))) h = h.slice(0, i) + '<mark>' + h.slice(i, i + t.length) + '</mark>' + h.slice(i + t.length); }); return h; };

  function options(sel) { return [...sel.options].map(o => ({ v: o.value, label: o.dataset.label || o.textContent.trim(), path: o.dataset.path || '', kind: o.dataset.kind || '' })); }
  function filter(all, q) {
    const toks = norm(q).split(/\s+/).filter(Boolean);
    if (!toks.length) return { list: all, toks };
    const scored = [];
    all.forEach(o => {
      if (!o.v) return;
      const hay = norm(o.label + ' ' + o.path);
      if (!toks.every(t => hay.includes(t))) return;
      const lab = norm(o.label); let sc = 0;
      toks.forEach(t => { if (lab.startsWith(t)) sc += 4; else if (lab.split(/[\s/&-]+/).some(w => w.startsWith(t))) sc += 3; else if (lab.includes(t)) sc += 2; else sc += 1; });
      if (o.kind === 'line') sc += 0.5;
      scored.push([sc, o]);
    });
    scored.sort((a, b) => b[0] - a[0]);
    return { list: scored.map(x => x[1]), toks };
  }
  function place() {
    if (!pop || !cur) return;
    const r = cur.inp.getBoundingClientRect(); const w = Math.max(r.width, 380);
    const below = window.innerHeight - r.bottom;
    pop.style.width = w + 'px'; pop.style.left = Math.max(6, Math.min(r.left, window.innerWidth - w - 6)) + 'px';
    if (below < 220 && r.top > below) { pop.style.top = ''; pop.style.bottom = (window.innerHeight - r.top + 2) + 'px'; pop.style.maxHeight = Math.min(320, r.top - 10) + 'px'; }
    else { pop.style.bottom = ''; pop.style.top = (r.bottom + 2) + 'px'; pop.style.maxHeight = Math.min(320, below - 10) + 'px'; }
  }
  function draw() {
    if (!cur) return;
    const q = cur.inp.value === cur.shown ? '' : cur.inp.value;
    const { list, toks } = filter(cur.all, q);
    cur.items = list; if (cur.i >= list.length) cur.i = list.length - 1; if (cur.i < 0) cur.i = 0;
    if (!pop) { pop = document.createElement('div'); pop.id = 'ls-pop'; document.body.appendChild(pop); pop.addEventListener('mousedown', e => { e.preventDefault(); const it = e.target.closest('.it'); if (it) choose(+it.dataset.i); }); }
    pop.innerHTML = (q ? `<div class="hint">${list.length} match${list.length === 1 ? '' : 'es'} · Enter to pick</div>` : `<div class="hint">Type to search · ↑↓ then Enter</div>`) +
      (list.length ? list.slice(0, 200).map((o, i) => `<div class="it ${i === cur.i ? 'on' : ''} ${o.kind === 'account' ? 'acct' : ''}" data-i="${i}"><span class="lb">${o.v ? hi(o.label, toks) : '<i>' + esc(o.label) + '</i>'}</span>${o.path ? `<span class="pa">${hi(o.path, toks)}</span>` : ''}</div>`).join('') : `<div class="none">No budget line matches “${esc(q)}”.</div>`);
    place();
    const on = pop.querySelector('.it.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function open(sel, inp) {
    cur = { sel, inp, all: options(sel), items: [], i: 0, shown: inp.value };
    const idx = cur.all.findIndex(o => o.v === sel.value); cur.i = Math.max(0, idx);
    draw(); inp.select();
  }
  function close(restore = true) {
    if (pop) { pop.remove(); pop = null; }
    if (cur && restore) cur.inp.value = labelOf(cur.sel);
    cur = null;
  }
  function choose(i) {
    if (!cur) return; const o = cur.items[i]; if (!o) return;
    const { sel, inp } = cur;
    if (sel.value !== o.v) { sel.value = o.v; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    inp.value = labelOf(sel); close(false);
  }
  function enhance(sel) {
    if (sel.dataset.lsDone) return; sel.dataset.lsDone = '1';
    const inp = document.createElement('input');
    inp.className = 'ls-in'; inp.type = 'text'; inp.spellcheck = false; inp.autocomplete = 'off';
    inp.placeholder = 'Search budget lines…'; inp.value = labelOf(sel); inp.disabled = sel.disabled; inp.title = 'Type to search budget lines';
    sel.style.display = 'none'; sel.after(inp);
    let fresh = false;   // the box just opened: the click that opened it should select all text, not place the cursor
    inp.addEventListener('focus', () => { open(sel, inp); fresh = true; });
    inp.addEventListener('mousedown', () => { if (document.activeElement === inp && !cur) { open(sel, inp); fresh = true; } });
    inp.addEventListener('mouseup', e => { if (fresh) { e.preventDefault(); inp.select(); } fresh = false; });
    inp.addEventListener('input', () => { if (!cur) open(sel, inp); cur.shown = null; cur.i = 0; draw(); });
    inp.addEventListener('blur', () => setTimeout(() => { if (cur && cur.inp === inp) close(true); }, 120));
    inp.addEventListener('keydown', e => {
      fresh = false;
      if (!cur) { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); open(sel, inp); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); cur.i = Math.min(cur.items.length - 1, cur.i + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cur.i = Math.max(0, cur.i - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(cur.i); }
      else if (e.key === 'Tab') { if (cur.inp.value !== cur.shown && cur.items.length && cur.inp.value.trim()) choose(cur.i); else close(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); inp.blur(); }
    });
  }
  function scan(root) { (root || document).querySelectorAll('select').forEach(sel => { if (sel.querySelector('option[data-ls]')) enhance(sel); }); }
  new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'SELECT') { if (n.querySelector('option[data-ls]')) enhance(n); } else if (n.querySelector) scan(n); } }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
  scan();
  window.SlateLinePick = { filter, scan };
})();
