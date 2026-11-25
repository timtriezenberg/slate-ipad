/* Slate extension: receipt photos on transactions. Photos are saved in the Slate folder (Receipts/…),
   so they sync with the budgets. Slate can read the amount, date and store name off the photo. */
(function () {
  const st = document.createElement('style');
  st.textContent = `.rc-btn{padding:3px 7px !important;font-size:14px;line-height:1}.rc-btn.has{border-color:var(--accent) !important}
  .rc-view{display:block;max-width:100%;max-height:58vh;margin:0 auto 10px;border:1px solid var(--line);background:#fff;object-fit:contain}
  .rc-drop{border:2px dashed var(--line);padding:26px;text-align:center;border-radius:var(--r,6px);margin:8px 0}.rc-drop.on{border-color:var(--accent);background:var(--head)}`;
  document.head.appendChild(st);

  const today = () => new Date().toISOString().slice(0, 10);
  const extOf = f => { const m = /\.([a-z0-9]+)$/i.exec(f.name || ''); return (m ? m[1] : (f.type.split('/')[1] || 'jpg')).toLowerCase(); };

  // Phone photos are big: shrink to 1600px JPEG (about 200–400 KB) so the synced folder stays small.
  function prepare(file) {
    return new Promise(res => {
      if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) { file.arrayBuffer().then(buf => res({ bytes: new Uint8Array(buf), ext: 'pdf', mime: 'application/pdf' })); return; }
      if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) { file.arrayBuffer().then(buf => res({ bytes: new Uint8Array(buf), ext: 'heic', mime: 'image/heic', raw: true })); return; }
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(bl => bl.arrayBuffer().then(buf => res({ bytes: new Uint8Array(buf), ext: 'jpg', mime: 'image/jpeg' })), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); file.arrayBuffer().then(buf => res({ bytes: new Uint8Array(buf), ext: extOf(file), mime: file.type || 'application/octet-stream', raw: true })); };
      img.src = url;
    });
  }

  /* ---- read a receipt: total, date, store ---- */
  function linesFromWords(words) {
    const ws = words.slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
    const lines = [];
    ws.forEach(w => { const cy = w.y + w.h / 2; const L = lines.find(l => Math.abs(l.cy - cy) < Math.max(0.008, w.h * 0.6)); if (L) { L.ws.push(w); L.cy = (L.cy * (L.ws.length - 1) + cy) / L.ws.length; } else lines.push({ cy, ws: [w] }); });
    return lines.map(l => l.ws.sort((a, b) => a.x - b.x).map(w => w.text).join(' '));
  }
  const AMT = /(?:^|[^\d.])\$?\s?(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})(?!\d)/g;
  function amountsIn(s) { const out = []; let m; AMT.lastIndex = 0; while ((m = AMT.exec(s))) out.push(parseFloat(m[1].replace(/,/g, '') + '.' + m[2])); return out; }
  function readReceipt(words) {
    const lines = linesFromWords(words); const text = lines.join('\n');
    let total = null;
    const pri = [/grand\s*total|amount\s*due|balance\s*due|total\s*due|amount\s*paid|total\s*charged/i, /(^|\s)total(?!\s*(savings|items|qty|tax))/i, /(visa|mastercard|amex|debit|credit|card)/i];
    for (const re of pri) {
      for (let i = 0; i < lines.length && total == null; i++) {
        if (!re.test(lines[i]) || /sub\s*-?\s*total/i.test(lines[i]) && re === pri[1]) continue;
        let a = amountsIn(lines[i]); if (!a.length && lines[i + 1]) a = amountsIn(lines[i + 1]);
        if (a.length) total = Math.max(...a);
      }
      if (total != null) break;
    }
    if (total == null) { const all = amountsIn(text); if (all.length) total = Math.max(...all); }
    let date = '';
    try { for (const l of lines) { const d = window.SlateTx && SlateTx.findDate ? SlateTx.findDate(l) : null; const iso = d && (d.iso || d); if (iso && /^\d{4}-\d\d-\d\d$/.test(iso)) { date = iso; break; } } } catch (e) {}
    let store = '';
    for (const l of lines.slice(0, 6)) { const t = l.replace(/[^A-Za-z&' .-]/g, ' ').replace(/\s+/g, ' ').trim(); if (t.length >= 3 && /[A-Za-z]{3}/.test(t) && !/receipt|welcome|thank|store\s*#|tel|phone|www\.|http/i.test(t)) { store = t.slice(0, 40); break; } }
    if (store) store = store.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    return { total, date, store, text };
  }
  async function ocrFill(bytes, mime) {
    if (!NATIVE || !NATIVE.ocr || !/^image\//.test(mime || '')) return null;
    try { const r = await NATIVE.ocr(bytes, mime); if (!r || !r.ok || !r.words || !r.words.length) return null; return readReceipt(r.words); } catch (e) { return null; }
  }

  // Receipts being read right now (by transaction id), so the row can show a small "reading" mark.
  const reading = new Set(); const queue = []; let qBusy = false;
  async function attach(i, file, fill = true) {
    const b0 = cur(); const t0 = b0 && (b0.transactions || [])[i]; if (!t0) return;
    if (!t0.id) mutate(b => { b.transactions[i].id = uid(); }, {render: false});
    const txId = cur().transactions[i].id;
    const p = await prepare(file);
    const r = await NATIVE.receiptSave({ budgetId: b0.id, txId, bytes: p.bytes, ext: p.ext });
    if (!r.ok) return toast('Couldn’t save the receipt: ' + r.error);
    // Attach right away: the receipt shows on the row immediately.
    mutate(b => { const t = (b.transactions || []).find(x => x.id === txId); if (t) t.receipt = r.rel; });
    toast(fill ? 'Receipt attached · reading it…' : 'Receipt attached');
    if (fill) { reading.add(txId); queue.push({ budgetId: b0.id, txId, rel: r.rel, bytes: p.bytes, mime: p.mime }); refreshMarks(); pump(); }
  }
  // Read receipts one at a time in the background, so attaching never waits on it.
  async function pump() {
    if (qBusy) return; qBusy = true;
    while (queue.length) {
      const job = queue.shift(); let info = null;
      try {
        if (NATIVE.receiptOcr) { const o = await NATIVE.receiptOcr(job.rel); if (o && o.ok && o.words && o.words.length) info = readReceipt(o.words); }
        else info = await ocrFill(job.bytes, job.mime);
      } catch (e) {}
      reading.delete(job.txId);
      const b = S.budgets.find(x => x.id === job.budgetId); const t = b && (b.transactions || []).find(x => x.id === job.txId);
      if (b && t && info && (info.total != null || info.date || info.store)) {
        const apply = bb => { const tt = (bb.transactions || []).find(x => x.id === job.txId); if (tt) applyInfo(bb, tt, info, false); };
        if (cur() === b && !U.editing) mutate(apply); else { apply(b); b.updated = Date.now(); save(); }
        toast('Read the receipt' + (info.total != null ? ': ' + money(info.total, b) : '') + '. Check it.');
      } else if (b && t) toast('Couldn’t read that receipt; it’s attached, just type the amount.');
      refreshMarks();
    }
    qBusy = false;
  }
  function refreshMarks() { $$('[data-rc-view]').forEach(bn => { const t = cur() && cur().transactions[+bn.dataset.rcView]; bn.textContent = t && reading.has(t.id) ? '⏳' : '🧾'; bn.title = t && reading.has(t.id) ? 'Reading the receipt…' : 'View receipt'; }); }
  function applyInfo(b, t, info, overwrite) {
    if (info.total != null && (overwrite || !(+t.amount))) { t.amount = info.total; t.tax = 0; }   // a receipt total already includes tax
    if (info.date && (overwrite || !t.date || t.date === today())) t.date = info.date;
    if (info.store && (overwrite || !t.payee)) t.payee = info.store;
    if (info.store && (overwrite || !t.where)) t.where = info.store;
    if (!t.rowId && window.SlateTx && SlateTx.categorize) { try { const r = SlateTx.categorize(b, (info.store || '') + ' ' + (t.desc || '')); const id = r && (r.rowId || r); if (typeof id === 'string' && id) t.rowId = id; } catch (e) {} }
  }
  function pick(multi) { return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,.pdf,.heic'; i.multiple = !!multi; i.onchange = () => res([...i.files]); i.click(); }); }

  async function view(i) {
    const b = cur(); const t = (b.transactions || [])[i]; if (!t || !t.receipt) return;
    const r = await NATIVE.receiptRead(t.receipt);
    const isPdf = /\.pdf$/i.test(t.receipt), mime = isPdf ? 'application/pdf' : /\.png$/i.test(t.receipt) ? 'image/png' : 'image/jpeg';
    let body;
    if (!r.ok) body = `<p class="neg">${esc(r.error)}</p>`;
    else if (isPdf) body = `<p>This receipt is a PDF.</p>`;
    else { const url = URL.createObjectURL(new Blob([r.bytes], { type: mime })); body = `<img class="rc-view" src="${url}">`; }
    U.modal = 'receipt';
    openModal(`<h2>Receipt</h2><div class="muted" style="margin-bottom:8px">${esc(t.payee || t.desc || 'Transaction')} · ${t.date ? esc(t.date) : 'no date'} · ${money(+t.amount || 0, b)}</div>${body}
      <div class="acts" style="flex-wrap:wrap"><button class="ghost danger" id="rc-rm">Remove from this transaction</button><button id="rc-show">Show file</button><button id="rc-rep">Replace…</button>${r.ok && (NATIVE.receiptOcr || (!isPdf && NATIVE.ocr)) ? '<button id="rc-read">Read amount, date &amp; store</button>' : ''}<button class="primary" data-mclose>Done</button></div>`);
    $('#rc-rm').onclick = () => { closeModal(); mutate(bb => { delete bb.transactions[i].receipt; }); toast('Receipt removed (the photo file is kept in the Receipts folder)'); };
    $('#rc-show').onclick = () => NATIVE.receiptShow(t.receipt);
    $('#rc-rep').onclick = async () => { const fs = await pick(false); if (fs[0]) { closeModal(); attach(i, fs[0], false); } };
    const rd = $('#rc-read'); if (rd) rd.onclick = async () => { rd.disabled = true; rd.textContent = 'Reading…'; let info = null; if (NATIVE.receiptOcr) { const o = await NATIVE.receiptOcr(t.receipt); if (o && o.ok && o.words && o.words.length) info = readReceipt(o.words); } else info = await ocrFill(r.bytes, mime); closeModal(); if (!info) return toast('Couldn’t read text on that photo'); mutate(bb => applyInfo(bb, bb.transactions[i], info, true)); toast('Filled in from the receipt' + (info.total != null ? ': ' + money(info.total, b) : '') + '. Check it.'); };
  }

  async function batch() {
    const b0 = cur(); if (!b0) return;
    if (!b0.phases.some(p => p.type === 'actual')) return toast('Add an Actual phase in Setup first');
    U.modal = 'rcbatch';
    openModal(`<h2>Add transactions from receipt photos</h2><div class="muted">Each photo becomes a transaction with the receipt attached. Slate reads the total, date and store name, so check them after.</div>
      <div class="rc-drop" id="rc-drop">Drop receipt photos here<br><button style="margin-top:10px" id="rc-pick">Choose photos…</button></div><div id="rc-msg" class="muted"></div>
      <div class="acts"><button data-mclose>Close</button></div>`);
    const run = async files => {
      files = files.filter(f => /^image\//.test(f.type) || /\.(pdf|heic|jpe?g|png)$/i.test(f.name)); if (!files.length) return;
      let n = 0; const msg = $('#rc-msg');
      for (const f of files) {
        if (msg) msg.textContent = 'Reading ' + (n + 1) + ' of ' + files.length + '…';
        const acts = cur().phases.filter(p => p.type === 'actual');
        mutate(b => { (b.transactions = b.transactions || []).push({ id: uid(), date: today(), payee: '', desc: 'Receipt', rowId: '', phaseId: acts[0] ? acts[0].id : '', amount: 0 }); }, { render: false });
        await attach(cur().transactions.length - 1, f, true); n++;
      }
      closeModal(); U.tab = 'tx'; render(); refreshMarks(); toast(n + ' receipt' + (n === 1 ? '' : 's') + ' added. Slate is reading them now; amounts fill in as each one is read.');
    };
    $('#rc-pick').onclick = async () => run(await pick(true));
    const dz = $('#rc-drop');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('on'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('on'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('on'); run([...e.dataTransfer.files]); });
  }

  if (!window.slateNative) return;   // receipts need the desktop app (files on disk)
  /* ---- missing-receipt reminders ----
     A transaction "needs a receipt" when it's a purchase (money out) at or above the budget's
     threshold, has no receipt attached, and hasn't been marked "no receipt needed". */
  const minOf = b => { const v = parseFloat(b.receiptMin); return isFinite(v) && v > 0 ? v : 0.01; };
  const amt = t => (typeof txTotal === 'function' ? txTotal(t) : (+t.amount || 0));
  const needs = (b, t) => !t.receipt && !t.noReceipt && amt(t) >= minOf(b);
  const missing = b => (b.transactions || []).filter(t => needs(b, t));
  SlateExt.txCells.push((t, i, b) => t.receipt
    ? `<button class="ghost rc-btn has" data-rc-view="${i}" title="${reading.has(t.id) ? 'Reading the receipt…' : 'View receipt'}">${reading.has(t.id) ? '⏳' : '🧾'}</button>`
    : t.noReceipt
      ? `<button class="ghost rc-btn rc-none" data-rc-need="${i}" title="Marked “no receipt needed”. Click to require one again.">⊘</button>`
      : needs(b, t)
        ? `<button class="ghost rc-btn rc-need" data-rc-add="${i}" title="Needs a receipt. Click to attach one, or drop a photo on this row.">📎</button><button class="ghost rc-btn rc-skip" data-rc-none="${i}" title="No receipt needed for this one (bank fee, payroll…)">⊘</button>`
        : `<button class="ghost rc-btn" data-rc-add="${i}" title="Attach a receipt photo">📎</button>`);
  const st2 = document.createElement('style');
  st2.textContent = `.rc-need{border-color:var(--danger) !important;background:color-mix(in srgb,var(--danger) 14%,transparent) !important;animation:rcpulse 2.4s ease-in-out infinite}
  @keyframes rcpulse{50%{box-shadow:0 0 0 3px color-mix(in srgb,var(--danger) 25%,transparent)}} @media (prefers-reduced-motion:reduce){.rc-need{animation:none}}
  .rc-skip,.rc-none{font-size:12px !important;opacity:.55} .rc-skip:hover,.rc-none:hover{opacity:1}
  tr.needrc td{background:color-mix(in srgb,var(--danger) 6%,transparent)} tr.needrc td:first-child{box-shadow:inset 4px 0 0 var(--danger)}
  .tab .rcbadge{display:inline-block;margin-left:6px;min-width:18px;padding:0 5px;border-radius:9px;background:var(--danger);color:#fff;font:700 10.5px var(--font-mono,monospace);line-height:17px;text-align:center}
  #rcbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 16px;background:color-mix(in srgb,var(--danger) 10%,var(--panel));border-bottom:1.5px solid var(--text);font-size:13px}
  #rcbar input{width:80px;text-align:right}
  .bcard .rcl{font:600 11px var(--font-mono,monospace);letter-spacing:.03em;color:var(--danger);margin:-2px 0 8px}`;
  document.head.appendChild(st2);
  SlateExt.banners.push(b => {
    if (U.tab !== 'tx') return '';
    const m = missing(b); if (!m.length && !U.rcOnly) return '';
    const sum = m.reduce((a, t) => a + amt(t), 0);
    return `<div id="rcbar">${m.length ? `<b>🧾 ${m.length} purchase${m.length === 1 ? '' : 's'} still need${m.length === 1 ? 's' : ''} a receipt</b><span class="muted">(${money(sum, b)})</span>` : '<b>All receipts are in.</b>'}
      <button data-act="rconly">${U.rcOnly ? 'Show all transactions' : 'Show only missing'}</button>
      <span style="flex:1"></span><label class="muted" style="display:flex;gap:6px;align-items:center">Remind me for purchases of $<input id="rc-min" type="number" min="0" step="1" value="${b.receiptMin ?? ''}" placeholder="any"> or more</label></div>`;
  });
  SlateExt.cardExtras.push(b => { const n = missing(b).length; return n ? `<div class="rcl">🧾 ${n} RECEIPT${n === 1 ? '' : 'S'} MISSING</div>` : ''; });
  function paintNeed() {
    const b = cur(); if (!b) return;
    const n = missing(b).length;
    const tab = $('.tab[data-tab="tx"]'); if (tab) { let bd = tab.querySelector('.rcbadge'); if (n) { if (!bd) { bd = document.createElement('span'); bd.className = 'rcbadge'; tab.appendChild(bd); } bd.textContent = n; bd.title = n + ' receipts missing'; } else if (bd) bd.remove(); }
    if (U.tab !== 'tx') return;
    $$('[data-tx][data-f="amount"]').forEach(inp => {
      const i = +inp.dataset.tx; const t = b.transactions[i]; const tr = inp.closest('tr'); if (!t || !tr) return;
      const need = needs(b, t); tr.classList.toggle('needrc', need);
      tr.style.display = U.rcOnly && !need ? 'none' : '';
    });
  }
  SlateExt.afterRender.push(paintNeed);
  SlateExt.actions.rconly = () => { U.rcOnly = !U.rcOnly; render(); };
  SlateExt.commands.push({ label: 'Show transactions missing receipts', run: () => { U.tab = 'tx'; U.rcOnly = true; render(); } });
  document.addEventListener('change', e => {
    if (e.target.id === 'rc-min') { const v = parseFloat(e.target.value); mutate(b => { if (e.target.value.trim() === '' || !isFinite(v) || v <= 0) delete b.receiptMin; else b.receiptMin = v; }); return; }
    if (e.target.dataset && e.target.dataset.tx != null && (e.target.dataset.f === 'amount' || e.target.dataset.f === 'tax')) setTimeout(() => { if (!$('#rcbar') !== !missing(cur()).length) render(); else paintNeed(); }, 0);
  });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-rc-none]'); if (a) { mutate(b => { b.transactions[+a.dataset.rcNone].noReceipt = true; }); toast('Marked “no receipt needed”'); return; }
    const c = e.target.closest('[data-rc-need]'); if (c) { mutate(b => { delete b.transactions[+c.dataset.rcNeed].noReceipt; }); }
  });
  // Once per session, a gentle nudge when you open a budget that's missing receipts.
  const nudged = new Set();
  SlateExt.afterRender.push(b => { if (!b || nudged.has(b.id)) return; nudged.add(b.id); const n = missing(b).length; if (n) setTimeout(() => toast('🧾 ' + n + ' purchase' + (n === 1 ? '' : 's') + ' in “' + b.name + '” still need' + (n === 1 ? 's' : '') + ' a receipt (Transactions tab)'), 900); });
  SlateExt.txToolbar.push({ act: 'rcbatch', label: 'Add from receipt photos…' });
  SlateExt.actions.rcbatch = batch;
  SlateExt.commands.push({ label: 'Add transactions from receipt photos…', run: batch });
  document.addEventListener('click', async e => {
    const v = e.target.closest('[data-rc-view]'); if (v) { view(+v.dataset.rcView); return; }
    const a = e.target.closest('[data-rc-add]'); if (a) { const fs = await pick(false); if (fs[0]) attach(+a.dataset.rcAdd, fs[0], true); }
  });
  // Drop a photo straight onto a transaction row.
  document.addEventListener('dragover', e => { if (U.tab === 'tx' && e.target.closest && e.target.closest('tr') && e.target.closest('tr').querySelector('[data-rc-add],[data-rc-view]')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (U.tab !== 'tx' || U.modal) return; const tr = e.target.closest && e.target.closest('tr'); const btn = tr && tr.querySelector('[data-rc-add],[data-rc-view]'); if (!btn) return;
    e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) attach(+(btn.dataset.rcAdd ?? btn.dataset.rcView), f, true);
  });
  window.SlateReceipts = { readReceipt, linesFromWords, amountsIn, attach, busy: () => reading.size + queue.length, missing };
})();
