/* ============================================================
   Slate Budget · production features (feature module, loaded after the main script)
   - Commercial bid template (AICP-style layout)
   - POs & Petty Cash tab (feeds the Actual phase)
   - Script / schedule import (Fountain, Final Draft .fdx, schedule CSV) -> budget lines
   - Union & payroll fringe presets
   - "Working with a team" note
   Uses only the main script's globals and the SlateExt hooks.
   ============================================================ */
(function () {
  'use strict';
  if (typeof SlateExt === 'undefined') return;

  /* ---------- small helpers ---------- */
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const tc = s => String(s).toLowerCase().replace(/(^|[\s.\-(\/])([a-z])/g, (m, a, c) => a + c.toUpperCase()).replace(/\b([od]')([a-z])/g, (m, a, c) => a + c.toUpperCase()).replace(/\bmc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
  const num = v => { const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return isNaN(n) ? 0 : n; };
  const plural = (n, w) => n + ' ' + (n === 1 ? w : (/(ch|sh|s|x)$/.test(w) ? w + 'es' : w + 's'));

  /* one-time styles (colors come from the app's CSS variables only) */
  (function injectStyle() {
    if (document.getElementById('px-style')) return;
    const st = document.createElement('style'); st.id = 'px-style';
    st.textContent = `
.px-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.px-stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--r,8px);padding:12px 14px}
.px-stat small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.px-stat b{display:block;font-size:20px;font-variant-numeric:tabular-nums;margin-top:2px}
.px-stat span{color:var(--muted);font-size:11.5px}
.px-head{display:flex;align-items:center;gap:10px;margin:6px 0 10px}
.px-head h1,.px-head h2{margin:0;flex:1}
.px-note{color:var(--muted);margin:0 0 10px}
.px-tablewrap{overflow-x:auto}
table.simple.px td{vertical-align:middle}
table.simple.px input[type=checkbox]{width:auto}
.px-pill{display:inline-block;border-radius:99px;padding:0 8px;font-size:11px;line-height:18px;border:1px solid var(--line2);background:var(--head)}
.px-ok{color:var(--ok)} .px-bad{color:var(--danger)}
.px-sticky{position:sticky;bottom:0;background:var(--panel);padding:10px 0 2px;margin-top:10px}
.px-rev{max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:var(--r,8px)}
.px-rev table{margin:0}
.px-po h2{margin:0 0 2px;letter-spacing:2px}
.px-po table{width:100%;border-collapse:collapse;margin-top:10px}
.px-po td{padding:8px 4px;border-bottom:1px solid var(--line2);vertical-align:top}
.px-po td:first-child{width:150px;color:var(--muted)}
.px-sig{margin-top:34px;display:flex;gap:30px}
.px-sig div{flex:1;border-top:1px solid var(--text);padding-top:4px;color:var(--muted);font-size:11.5px}
@media print{
  body.po-printing #app,body.po-printing #toast,body.po-printing #sug{display:none!important}
  body.po-printing{background:#fff!important;color:#000!important}
  body.po-printing #modalback{position:static!important;background:none!important;padding:0!important;display:block!important}
  body.po-printing .modal{box-shadow:none!important;border:0!important;max-height:none!important;width:auto!important;padding:0!important;overflow:visible!important;background:#fff!important;color:#000!important}
  body.po-printing .modal *{color:#000!important;border-color:#000!important}
  body.po-printing .noprint{display:none!important}
}`;
    document.head.appendChild(st);
  })();

  /* ============================================================
     1) UNION / PAYROLL FRINGE PRESETS (shared with the commercial template)
     Rates are approximate starting points taken from published labor-guide figures
     (mostly 2021-22 agreements). They change with every contract: confirm before use.
     ============================================================ */
  const PRESETS = [
    {name:'PRTAX', rate:18, color:'sky', desc:'Payroll taxes & workers comp (estimate, check with your payroll company)', pick:'Payroll tax'},
    {name:'SAG-AFTRA', rate:21, color:'rose', desc:'SAG-AFTRA pension & health, principal performers ≈21% (background ≈20.5%); some contracts have per-performer ceilings. Starting point, verify the current agreement.', pick:'SAG-AFTRA P&H'},
    {name:'DGA', rate:33.5, color:'violet', desc:'DGA ≈19% pension + 14.5% health/vacation (2021 figures). Starting point, verify the current agreement.', pick:'DGA P&H'},
    {name:'WGA', rate:22.75, color:'amber', desc:'WGA ≈11.25% pension + 11.5% health (ceilings apply per project). Starting point, verify the current agreement.', pick:'WGA P&H'},
    {name:'IATSE', rate:25, color:'teal', desc:'IATSE ≈6% pension + hourly health & welfare + vacation/holiday. Blended estimate, varies by local and rate: enter your local’s figure.', pick:'IATSE P&H'},
    {name:'TEAMSTERS', rate:24, color:'orange', desc:'Teamsters Local 399 ≈8% pension + hourly health & welfare. Blended estimate, varies by rate: verify.', pick:'Teamsters P&H'}
  ];
  const presetFringe = p => ({id:uid(), name:p.name, desc:p.desc, rate:p.rate, unit:'%', cutoff:0, color:p.color});

  /* ============================================================
     2) COMMERCIAL BID TEMPLATE (AICP-style layout)
     ============================================================ */
  function makeCommercial() {
    const b = blankBudget('Commercial Bid');
    b.phases = [
      {id:'bid', name:'Bid', color:'amber', type:'estimate', hidden:false, locked:false, formula:'', ot:{qty:true, x:true}},
      {id:'actual', name:'Actual', color:'violet', type:'actual', hidden:false, locked:false, formula:'', ot:{}},
      {id:'variance', name:'Variance', color:'emerald', type:'rollup', hidden:false, locked:false, formula:'@{bid} - @{actual}', ot:{}}
    ];
    b.units = ['Day', 'Week', 'Hour', 'Flat', 'Allow', 'Spot'];
    b.globals = [
      {symbol:'SD', description:'Shoot days', formula:'1', unit:'days', vary:{}},
      {symbol:'PD', description:'Prep days', formula:'3', unit:'days', vary:{}},
      {symbol:'WD', description:'Wrap days', formula:'1', unit:'days', vary:{}},
      {symbol:'SPOTS', description:'Number of spots / versions', formula:'1', unit:'spots', vary:{}},
      {symbol:'CAP', description:'Client budget cap (shows a meter on the Top Sheet)', formula:'0', unit:'', vary:{}}
    ];
    b.fringes = [PRESETS[0], PRESETS[1], PRESETS[4]].map(presetFringe);
    b.tags = [
      {name:'Labor', color:'sky'}, {name:'Location & Travel', color:'teal'}, {name:'Props & Sets', color:'orange'},
      {name:'Equipment & Media', color:'violet'}, {name:'Creative & Talent', color:'rose'}, {name:'Post', color:'green'}, {name:'Other', color:'slate'}
    ];
    const FR = ['PRTAX'];
    // [name, unit, qty (number or '=GLOBAL' formula), fringes]
    const L = (n, u, q, f) => [n, u, q, f || []];
    const SECTIONS = [
      ['A', 'Pre-production & wrap labor', 'Labor', [
        L('Executive Producer', 'Flat', 1), L('Producer', 'Day', '=PD+SD+WD', FR), L('Line Producer', 'Day', '=PD+SD+WD', FR),
        L('Production Coordinator', 'Day', '=PD+SD+WD', FR), L('Director prep (non-fee days)', 'Day', '=PD', FR),
        L('1st AD prep', 'Day', '=PD', FR), L('Production Designer prep', 'Day', '=PD', FR),
        L('Location Scout / Manager', 'Day', '=PD', FR), L('Casting Director & session', 'Day', 2, FR),
        L('DP prep / pre-light', 'Day', 1, FR), L('Wrap labor / returns', 'Day', '=WD', FR)]],
      ['B', 'Shooting crew labor', 'Labor', [
        L('Director of Photography', 'Day', '=SD', FR), L('Camera Operator', 'Day', '=SD', FR), L('1st AC', 'Day', '=SD', FR), L('2nd AC', 'Day', '=SD', FR),
        L('DIT / Data Wrangler', 'Day', '=SD', FR), L('Gaffer', 'Day', '=SD', FR), L('Best Boy Electric', 'Day', '=SD', FR), L('Electrician', 'Day', '=SD', FR),
        L('Key Grip', 'Day', '=SD', FR), L('Best Boy Grip', 'Day', '=SD', FR), L('Grip', 'Day', '=SD', FR),
        L('Sound Mixer', 'Day', '=SD', FR), L('Boom Operator', 'Day', '=SD', FR), L('Hair & Make-up', 'Day', '=SD', FR),
        L('Wardrobe Stylist', 'Day', '=SD', FR), L('Script Supervisor', 'Day', '=SD', FR), L('1st AD', 'Day', '=SD', FR), L('2nd AD', 'Day', '=SD', FR),
        L('Production Assistants', 'Day', '=SD*3', FR), L('Craft Services', 'Day', '=SD', FR), L('Set Medic', 'Day', '=SD', FR)]],
      ['C', 'Location & travel', 'Location & Travel', [
        L('Location fees', 'Day', '=SD'), L('Permits & fire / safety officer', 'Flat', 1), L('Parking & shuttles', 'Day', '=SD'),
        L('Security / police', 'Day', '=SD'), L('Air travel', 'Allow', 1), L('Hotel / lodging', 'Allow', 1), L('Per diem', 'Day', '=SD'),
        L('Ground transportation & vehicles', 'Day', '=SD'), L('Fuel & mileage', 'Allow', 1)]],
      ['D', 'Props, wardrobe & animals', 'Props & Sets', [
        L('Props (purchase / rental)', 'Allow', 1), L('Set dressing', 'Allow', 1), L('Wardrobe purchases & rentals', 'Allow', 1),
        L('Picture vehicles', 'Day', '=SD'), L('Animals & wrangler', 'Day', '=SD'), L('Special effects', 'Allow', 1)]],
      ['E', 'Studio rental & set construction', 'Props & Sets', [
        L('Stage rental (shoot)', 'Day', '=SD'), L('Stage prep / strike days', 'Day', '=PD+WD'), L('Set construction labor', 'Day', '=PD'),
        L('Set construction materials', 'Allow', 1), L('Paint & scenic', 'Allow', 1), L('Power & utilities', 'Day', '=SD')]],
      ['F', 'Equipment rental', 'Equipment & Media', [
        L('Camera package', 'Day', '=SD'), L('Lens package', 'Day', '=SD'), L('Lighting package', 'Day', '=SD'), L('Grip package', 'Day', '=SD'),
        L('Sound package', 'Day', '=SD'), L('Generator', 'Day', '=SD'), L('Walkie-talkies', 'Day', '=SD'), L('Dolly / jib / specialty', 'Day', '=SD'), L('Expendables', 'Allow', 1)]],
      ['G', 'Film / digital stock & processing', 'Equipment & Media', [
        L('Camera media (cards / drives)', 'Allow', 1), L('Backup drives & storage', 'Allow', 1), L('Dailies / data management', 'Day', '=SD'), L('Film stock & lab (if shooting film)', 'Allow', 0)]],
      ['H', 'Miscellaneous', 'Other', [
        L('Catering & meals', 'Day', '=SD'), L('Production office & supplies', 'Allow', 1), L('Messengers & shipping', 'Allow', 1), L('Phones & internet', 'Allow', 1),
        L('Cleaning & trash', 'Allow', 1), L('Payroll service fees', 'Allow', 1), L('Petty cash', 'Allow', 1)]]
    ];
    const AFTER = [
      ['I', 'Director / creative fees', 'Creative & Talent', [
        L('Director fee', 'Flat', 1), L('Director travel & expenses', 'Allow', 1), L('Creative / agency expenses', 'Allow', 1), L('Storyboards & treatments', 'Allow', 1)]],
      ['J', 'Talent (cast) & expenses', 'Creative & Talent', [
        L('Principal talent', 'Day', '=SD', ['SAG-AFTRA']), L('Supporting talent', 'Day', '=SD', ['SAG-AFTRA']), L('Background / extras', 'Day', '=SD', ['SAG-AFTRA']),
        L('Wardrobe fittings & rehearsals', 'Day', 1, ['SAG-AFTRA']), L('Agent / casting fees', 'Allow', 1), L('Talent travel & per diem', 'Allow', 1)]],
      ['K', 'Editorial, post & finishing', 'Post', [
        L('Editor', 'Week', 1, FR), L('Assistant Editor', 'Week', 1, FR), L('Offline edit suite', 'Week', 1), L('Color grade', 'Day', 1), L('Online / finishing', 'Day', 1),
        L('Sound design & mix', 'Day', 1), L('Music / licensing', 'Allow', 1), L('Graphics / VFX', 'Allow', 1), L('Deliverables & cutdowns', 'Spot', '=SPOTS')]]
    ];
    const build = (num, name, tag, lines) => {
      const a = blankRow('account'); a.number = num; a.name = name; a.tags = [tag];
      lines.forEach(([n, u, q, f]) => {
        const l = blankRow('line'); l.name = n; l.fringes = f.slice(); l.values.bid = {unit:u, qty:q}; a.children.push(l);
      });
      return a;
    };
    SECTIONS.forEach(s => b.rows.push(build(...s)));
    const st = blankRow('subtotal'); st.name = 'Total production costs (A–H)'; b.rows.push(st);
    const mk = (name, rate) => { const m = blankRow('markup'); m.name = name; m.values.bid = {rate}; return m; };
    b.rows.push(mk('Production fee', 20));
    b.rows.push(mk('Insurance (% of A–H)', 2));
    b.rows.push(mk('Contingency (% of A–H)', 5));
    AFTER.forEach(s => b.rows.push(build(...s)));
    return b;
  }
  SlateExt.templates.push({
    id: 'commercial-aicp',
    name: 'Commercial bid (AICP-style)',
    desc: 'Fast bid for spots and branded content: sections A–H, production fee, insurance and contingency on A–H, then director, talent and post. Follows the common AICP bid layout; it is not an official AICP form.',
    make: makeCommercial
  });

  /* ============================================================
     3) PURCHASE ORDERS & PETTY CASH
     ============================================================ */
  const PO_STATUS = [['open', 'Open'], ['approved', 'Approved'], ['invoiced', 'Invoiced'], ['paid', 'Paid'], ['void', 'Void']];
  const poActual = s => s === 'invoiced' || s === 'paid';
  const poCommitted = s => s === 'open' || s === 'approved';
  function nextPONum(b) {
    let mx = 0; (b.pos || []).forEach(p => { const m = String(p.num || '').match(/(\d+)\s*$/); if (m) mx = Math.max(mx, parseInt(m[1], 10)); });
    return 'PO-' + String(mx + 1).padStart(4, '0');
  }
  /* Invoiced/Paid POs and petty-cash spends are "actual" money. */
  SlateExt.actuals.push(b => {
    const out = [];
    (b.pos || []).forEach(p => { if (poActual(p.status) && p.rowId) out.push({rowId:p.rowId, phaseId:p.phaseId || '', amount:+p.amount || 0}); });
    (b.petty || []).forEach(p => { if (p.type === 'spend' && p.rowId) out.push({rowId:p.rowId, phaseId:p.phaseId || '', amount:+p.amount || 0}); });
    return out;
  });
  function poTotals(b) {
    const t = {committed:0, actual:0, voidN:0, unassigned:0, count:0};
    (b.pos || []).forEach(p => {
      const a = +p.amount || 0;
      if (p.status === 'void') { t.voidN++; return; }
      t.count++;
      if (poCommitted(p.status)) t.committed += a; else if (poActual(p.status)) t.actual += a;
      if (!p.rowId) t.unassigned++;
    });
    return t;
  }
  function pcTotals(b) {
    const t = {funded:0, spent:0, missing:0, unassigned:0};
    (b.petty || []).forEach(p => {
      const a = +p.amount || 0;
      if (p.type === 'fund') t.funded += a;
      else { t.spent += a; if (!p.receipt) t.missing++; if (!p.rowId) t.unassigned++; }
    });
    t.onHand = t.funded - t.spent; return t;
  }
  function statsHTML(b) {
    const a = poTotals(b), c = pcTotals(b);
    return `<div class="px-stat"><small>Committed (open + approved POs)</small><b>${money(a.committed, b)}</b><span>not yet in Actual</span></div>
    <div class="px-stat"><small>Actual to date (invoiced + paid POs)</small><b>${money(a.actual, b)}</b><span>counted in the Actual phase</span></div>
    <div class="px-stat"><small>All POs</small><b>${money(a.committed + a.actual, b)}</b><span>${plural(a.count, 'PO')}${a.voidN ? ' · ' + a.voidN + ' void' : ''}${a.unassigned ? ' · <span class="px-bad">' + a.unassigned + ' without a budget line</span>' : ''}</span></div>
    <div class="px-stat"><small>Petty cash on hand</small><b class="${c.onHand < -0.004 ? 'neg' : ''}">${money(c.onHand, b)}</b><span>${money(c.funded, b)} in − ${money(c.spent, b)} out${c.missing ? ' · <span class="px-bad">' + plural(c.missing, 'missing receipt') + '</span>' : ''}</span></div>`;
  }
  function pettyRunning(b) {
    let bal = 0; return (b.petty || []).map(p => { bal += (p.type === 'fund' ? 1 : -1) * (+p.amount || 0); return bal; });
  }
  function poHTML(b) {
    const pos = b.pos || [], pty = b.petty || [], bal = pettyRunning(b), c = pcTotals(b);
    const acts = b.phases.filter(p => p.type === 'actual');
    const poRows = pos.map((p, i) => `<tr data-porow="${i}">
      <td><input data-po="${i}" data-f="num" value="${esc(p.num || '')}" style="width:96px"></td>
      <td><input type="date" data-po="${i}" data-f="date" value="${esc(p.date || '')}"></td>
      <td><input data-po="${i}" data-f="vendor" value="${esc(p.vendor || '')}" placeholder="Vendor"></td>
      <td><input data-po="${i}" data-f="desc" value="${esc(p.desc || '')}" placeholder="What is it for?"></td>
      <td><select data-po="${i}" data-f="rowId">${rowOptions(b, p.rowId)}</select></td>
      <td><input type="number" step="0.01" style="text-align:right;width:110px" data-po="${i}" data-f="amount" value="${p.amount ?? ''}"></td>
      <td><select data-po="${i}" data-f="status">${PO_STATUS.map(([k, l]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input data-po="${i}" data-f="notes" value="${esc(p.notes || '')}" placeholder="Notes"></td>
      <td style="white-space:nowrap"><button class="ghost" data-poprint="${i}" title="Print this PO">Print</button><button class="ghost danger" data-podel="${i}" title="Delete">✕</button></td></tr>`).join('');
    const pcRows = pty.map((p, i) => `<tr>
      <td><input type="date" data-pc="${i}" data-f="date" value="${esc(p.date || '')}"></td>
      <td><select data-pc="${i}" data-f="type"><option value="fund" ${p.type === 'fund' ? 'selected' : ''}>Cash in</option><option value="spend" ${p.type !== 'fund' ? 'selected' : ''}>Spent</option></select></td>
      <td><input data-pc="${i}" data-f="desc" value="${esc(p.desc || '')}" placeholder="Description"></td>
      <td><select data-pc="${i}" data-f="rowId" ${p.type === 'fund' ? 'disabled' : ''}>${rowOptions(b, p.rowId)}</select></td>
      <td style="text-align:center"><input type="checkbox" data-pc="${i}" data-f="receipt" ${p.receipt ? 'checked' : ''} ${p.type === 'fund' ? 'disabled' : ''} title="Receipt in hand"></td>
      <td><input type="number" step="0.01" style="text-align:right;width:110px" data-pc="${i}" data-f="amount" value="${p.amount ?? ''}"></td>
      <td class="num" data-pcbal="${i}">${money(bal[i], b)}</td>
      <td><button class="ghost danger" data-pcdel="${i}" title="Delete">✕</button></td></tr>`).join('');
    return `<div class="page"><div class="hero" style="max-width:1200px">
    <div class="px-head"><h1>POs &amp; Petty Cash</h1></div>
    <div class="px-stats" id="px-stats">${statsHTML(b)}</div>
    ${acts.length ? '' : '<div class="banner" style="margin:0 0 12px">This budget has no <b>Actual</b> phase, so POs and petty cash will not show up in your totals. Add one in Setup → Phases.</div>'}
    <div class="card"><div class="px-head"><h3 style="margin:0;flex:1">Purchase orders</h3><button class="primary" data-poadd>+ New PO <kbd>${MOD}I</kbd></button></div>
    <p class="px-note">Open and Approved POs are <b>committed</b>. When a PO is marked <b>Invoiced</b> or <b>Paid</b> it counts toward the Actual phase and Variance. Don’t also enter that bill under Transactions or it will count twice. Void POs are ignored.</p>
    <div class="px-tablewrap"><table class="simple px"><thead><tr><th>PO #</th><th style="width:140px">Date</th><th>Vendor</th><th>Description</th><th style="width:220px">Budget line</th><th class="num">Amount</th><th style="width:110px">Status</th><th>Notes</th><th style="width:96px"></th></tr></thead><tbody>
    ${poRows || '<tr><td colspan="9" class="muted" style="padding:18px;text-align:center">No purchase orders yet. Press <kbd>' + MOD + 'I</kbd> or “New PO”.</td></tr>'}</tbody></table></div></div>
    <div class="card" id="pc-section"><div class="px-head"><h3 style="margin:0;flex:1">Petty cash ledger</h3><button data-pcadd="fund">+ Cash in</button><button class="primary" data-pcadd="spend">+ Spend</button></div>
    <p class="px-note">Log each time the envelope is funded and each purchase. Spends count toward the Actual phase. Reconcile: <b>${money(c.funded, b)}</b> funded − <b>${money(c.spent, b)}</b> spent = <b class="${c.onHand < -0.004 ? 'neg' : ''}">${money(c.onHand, b)}</b> should be in the envelope.</p>
    <div class="px-tablewrap"><table class="simple px"><thead><tr><th style="width:140px">Date</th><th style="width:100px">Type</th><th>Description</th><th style="width:220px">Budget line</th><th style="width:70px;text-align:center">Receipt</th><th class="num">Amount</th><th class="num">Balance</th><th style="width:40px"></th></tr></thead><tbody>
    ${pcRows || '<tr><td colspan="8" class="muted" style="padding:18px;text-align:center">No petty cash entries yet.</td></tr>'}</tbody></table></div></div></div></div>`;
  }
  SlateExt.tabs.push({key:'po', label:'POs & Petty Cash', after:'tx', html: poHTML});

  function refreshPO() {
    const b = cur(); if (!b) return;
    const st = $('#px-stats'); if (st) st.innerHTML = statsHTML(b);
    const bal = pettyRunning(b); $$('[data-pcbal]').forEach(td => { td.textContent = money(bal[+td.dataset.pcbal], b); });
    const c = pcTotals(b); const note = $('#pc-section .px-note');
    if (note) note.innerHTML = `Log each time the envelope is funded and each purchase. Spends count toward the Actual phase. Reconcile: <b>${money(c.funded, b)}</b> funded − <b>${money(c.spent, b)}</b> spent = <b class="${c.onHand < -0.004 ? 'neg' : ''}">${money(c.onHand, b)}</b> should be in the envelope.`;
  }
  function addPO(focus = true) {
    const b0 = cur(); if (!b0) return; U.tab = 'po';
    const act = b0.phases.find(p => p.type === 'actual');
    mutate(b => { (b.pos = b.pos || []).push({id:uid(), num:nextPONum(b), date:today(), vendor:'', desc:'', rowId:'', amount:0, status:'open', notes:'', phaseId:act ? act.id : ''}); });
    if (focus) { const rows = $$('[data-porow]'); const r = rows[rows.length - 1]; const i = r && r.querySelector('[data-f="vendor"]'); if (i) { i.focus(); r.scrollIntoView({block:'nearest'}); } }
  }
  function addPetty(type, focus = true) {
    const b0 = cur(); if (!b0) return; U.tab = 'po';
    const act = b0.phases.find(p => p.type === 'actual');
    mutate(b => { (b.petty = b.petty || []).push({id:uid(), date:today(), type: type === 'fund' ? 'fund' : 'spend', desc: type === 'fund' ? 'Petty cash envelope' : '', rowId:'', amount:0, receipt:false, notes:'', phaseId:act ? act.id : ''}); });
    if (focus) { const rows = $$('[data-pc][data-f="desc"]'); const i = rows[rows.length - 1]; if (i) { i.focus(); i.scrollIntoView({block:'nearest'}); } }
  }
  function printPO(i) {
    const b = cur(); const p = (b.pos || [])[i]; if (!p) return;
    const f = b.rows && find(b, p.rowId); const line = f ? pathOf(b, p.rowId).map(rowLabel).join(' › ') : '(no budget line yet)';
    U.modal = 'po-print';
    openModal(`<div id="po-print" class="px-po"><h2>PURCHASE ORDER</h2><div style="font-size:15px"><b>${esc(b.name)}</b></div>
      <table><tr><td>PO number</td><td><b>${esc(p.num || '')}</b></td></tr><tr><td>Date</td><td>${esc(p.date ? fmtDate(p.date + 'T12:00:00') : '')}</td></tr>
      <tr><td>Vendor</td><td>${esc(p.vendor || '')}</td></tr><tr><td>Description</td><td>${esc(p.desc || '')}</td></tr>
      <tr><td>Budget line</td><td>${esc(line)}</td></tr><tr><td>Amount</td><td style="font-size:18px"><b>${money(+p.amount || 0, b)}</b></td></tr>
      <tr><td>Status</td><td>${esc((PO_STATUS.find(s => s[0] === p.status) || ['', p.status])[1])}</td></tr>${p.notes ? `<tr><td>Notes</td><td>${esc(p.notes)}</td></tr>` : ''}</table>
      <div class="px-sig"><div>Approved by</div><div>Date</div><div>Vendor signature</div></div></div>
      <div class="acts noprint"><button data-mclose>Close</button><button class="primary" id="po-doprint">Print</button></div>`);
    $('#po-doprint').onclick = () => {
      document.body.classList.add('po-printing');
      const done = () => { document.body.classList.remove('po-printing'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      try { window.print(); } finally { setTimeout(done, 1500); }
    };
  }

  document.addEventListener('change', e => {
    const T = e.target; if (!cur()) return;
    if (T.dataset.po !== undefined && T.dataset.f) {
      const i = +T.dataset.po, f = T.dataset.f;
      mutate(b => { const p = b.pos[i]; if (!p) return; p[f] = f === 'amount' ? num(T.value) : T.value; }, {render:false});
      refreshPO();
    } else if (T.dataset.pc !== undefined && T.dataset.f) {
      const i = +T.dataset.pc, f = T.dataset.f;
      mutate(b => { const p = b.petty[i]; if (!p) return; p[f] = f === 'amount' ? num(T.value) : (f === 'receipt' ? T.checked : T.value); if (f === 'type' && T.value === 'fund') { p.rowId = ''; p.receipt = false; } }, {render: f === 'type'});
      refreshPO();
    }
  });
  document.addEventListener('click', e => {
    const T = e.target; if (!cur() || U.tab !== 'po') return;
    let x;
    if (T.closest('[data-poadd]')) addPO();
    else if ((x = T.closest('[data-pcadd]'))) addPetty(x.dataset.pcadd);
    else if ((x = T.closest('[data-podel]'))) { mutate(b => b.pos.splice(+x.dataset.podel, 1)); }
    else if ((x = T.closest('[data-pcdel]'))) { mutate(b => b.petty.splice(+x.dataset.pcdel, 1)); }
    else if ((x = T.closest('[data-poprint]'))) printPO(+x.dataset.poprint);
  });
  document.addEventListener('keydown', e => {
    if (!cur() || U.tab !== 'po' || U.modal) return;
    const mod = (typeof isMac !== 'undefined' && isMac) ? e.metaKey : e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('#pc-section')) addPetty('spend'); else addPO();
    }
  });
  SlateExt.commands.push(
    {label:'Go to POs & Petty Cash', run:() => { U.tab = 'po'; render(); }},
    {label:'New purchase order', run:() => addPO()},
    {label:'New petty cash spend', run:() => addPetty('spend')},
    {label:'Import script or schedule…', run:() => scriptImport()}
  );

  /* ============================================================
     4) SCRIPT / SCHEDULE IMPORT
     ============================================================ */
  const TIME_RX = /^(DAY|NIGHT|MORNING|EVENING|AFTERNOON|DAWN|DUSK|SUNSET|SUNRISE|LATER|CONTINUOUS|CONT'D|MOMENTS LATER|SAME|SAME TIME|MAGIC HOUR|NOON|MIDNIGHT|D\/N|FLASHBACK|DAY\s*\d+|NIGHT\s*\d+|LATER THAT (DAY|NIGHT)|SUNDOWN|PRE-?DAWN|TWILIGHT|EARLY MORNING|LATE NIGHT|LATE AFTERNOON|DAY\/NIGHT|\d+\s*(DAYS?|YEARS?|HOURS?|MINUTES?)\s*(LATER|EARLIER|AGO))$/i;
  const HEAD_RX = /^\s*(?:(?:INT|EXT|EST)\.?\s*\/\s*(?:INT|EXT)|I\s*\/\s*E|INT|EXT|EST)(?:\.|\s)\s*/i;
  const TRANSITION_RX = /(TO:|FADE IN:?|FADE OUT\.?|THE END|CUT TO BLACK|SMASH CUT|DISSOLVE|FADE TO BLACK|MATCH CUT|INTERCUT|BACK TO|CONTINUED|MONTAGE|END OF|TITLE CARD|SUPER:|TITLE:)/;

  function locationOf(headingText) {
    let t = String(headingText).replace(/^\./, '').replace(/#[^#]*#\s*$/, '').replace(HEAD_RX, '').trim();
    t = t.replace(/\s+[–—]\s+/g, ' - ');
    let parts = t.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
    while (parts.length > 1 && TIME_RX.test(parts[parts.length - 1])) parts.pop();
    let loc = (parts[0] || t || 'UNKNOWN').toUpperCase().replace(/[.,]+$/, '').trim();
    loc = loc.replace(/\s*\((?:DAY|NIGHT|CONT'?D?\.?|CONTINUOUS)\)\s*$/i, '').trim();
    return loc || 'UNKNOWN';
  }
  const cleanCue = s => String(s).replace(/^@/, '').replace(/\^$/, '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/[.:]+$/, '').replace(/\s+/g, ' ').trim().toUpperCase();

  /* Accumulator shared by the Fountain and FDX readers */
  function Acc() {
    this.scenes = 0; this.sceneIdx = -1; this.locs = new Map(); this.chars = new Map();
  }
  Acc.prototype.heading = function (text) {
    this.sceneIdx++; this.scenes++;
    const loc = locationOf(text); const o = this.locs.get(loc) || {scenes:new Set()}; o.scenes.add(this.sceneIdx); this.locs.set(loc, o);
  };
  Acc.prototype.cue = function (name) {
    name = cleanCue(name); if (!name || name.length > 36 || !/[A-Z]/.test(name)) return;
    const si = Math.max(0, this.sceneIdx); const o = this.chars.get(name) || {speeches:0, scenes:new Set()};
    o.speeches++; o.scenes.add(si); this.chars.set(name, o);
  };
  Acc.prototype.result = function (src) {
    return {
      src, scenes:this.scenes, days:null, daysEstimated:true,
      locations:[...this.locs.entries()].map(([name, o]) => ({name, scenes:o.scenes.size, days:null})).sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name)),
      characters:[...this.chars.entries()].map(([name, o]) => ({name, speeches:o.speeches, scenes:o.scenes.size})).sort((a, b) => b.speeches - a.speeches || b.scenes - a.scenes || a.name.localeCompare(b.name))
    };
  };

  function parseFountain(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n');
    // drop a Fountain title page (key: value block at the top) and boneyard/notes
    let start = 0;
    if (/^\s*(title|credit|author|authors|source|draft date|contact|copyright)\s*:/i.test(lines[0] || '')) { while (start < lines.length && lines[start].trim() !== '') start++; }
    const acc = new Acc();
    const blank = i => i < 0 || i >= lines.length || lines[i].trim() === '';
    for (let i = start; i < lines.length; i++) {
      const raw = lines[i]; const ln = raw.trim(); if (!ln) continue;
      if (/^\.[A-Za-z0-9]/.test(ln) && !/^\.\./.test(ln)) { if (blank(i - 1) || i === start) acc.heading(ln); continue; }
      if (HEAD_RX.test(ln) && (blank(i - 1) || i === start)) { acc.heading(ln); continue; }
      if (/^(=|#|>|~|\[\[)/.test(ln) && !ln.startsWith('@')) continue;               // sections, synopses, centered, lyrics, notes
      const forced = ln.startsWith('@');
      const isCaps = !/[a-z]/.test(ln) && /[A-Z]/.test(ln);
      if ((forced || isCaps) && blank(i - 1) && !blank(i + 1) && !/^\(/.test(ln)) {
        if (!forced && (TRANSITION_RX.test(ln) || HEAD_RX.test(ln))) continue;
        const base = cleanCue(ln);
        if (!base || base.split(' ').length > 4) continue;
        acc.cue(ln);
      }
    }
    return acc.result('script');
  }
  function parseFDX(text) {
    const doc = new DOMParser().parseFromString(String(text), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('That file isn’t valid Final Draft XML');
    const acc = new Acc();
    let prev = '';
    doc.querySelectorAll('Content > Paragraph, Paragraph').forEach((p, idx, all) => {
      if (p.parentElement && p.parentElement.tagName === 'ScriptNote') return;
      const type = p.getAttribute('Type') || '';
      const txt = [...p.querySelectorAll('Text')].map(t => t.textContent).join('').trim(); if (!txt) return;
      if (/^Scene Heading$/i.test(type)) acc.heading(txt);
      else if (/^Character$/i.test(type)) acc.cue(txt);
    });
    return acc.result('script');
  }

  function parseCSVRows(text) {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', '\t', ';'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(x => x.trim() !== '')) rows.push(row);
    return rows;
  }
  function parseSchedule(text) {
    const rows = parseCSVRows(text);
    const COL = {
      day: /^(shoot\s*)?day(\s*(#|no\.?|number))?$|^day\s*#?$|^dy$|^shoot\s*day/i,
      scene: /^(scene|scenes|sc\.?|sc\s*#|scene\s*#|scn)\b/i,
      loc: /^(location|locations|set|sets|loc|setting|set\s*\/\s*location|location\s*\/\s*set)\b/i,
      cast: /^(cast|cast\s*(members|ids?|#s?)|characters?|talent)$/i,
      pages: /^(pages?|pgs?)$/i, dn: /^(d\s*\/\s*n|day\s*\/\s*night|d\/n)$/i, ie: /^(int\s*\/\s*ext|i\s*\/\s*e|int|ext)$/i
    };
    let hi = -1, map = null;
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
      const m = {}; rows[r].forEach((h, ci) => { const t = h.trim(); for (const k in COL) if (!(k in m) && COL[k].test(t)) m[k] = ci; });
      if (Object.keys(m).length >= 2 && ('loc' in m || 'scene' in m || 'cast' in m)) { hi = r; map = m; break; }
    }
    if (hi < 0) throw new Error('Couldn’t find column headings (Day, Scene, Location, Cast…) in that CSV');
    const locs = new Map(), chars = new Map(), days = new Set(), scenes = new Set();
    let curDay = '', n = 0;
    rows.slice(hi + 1).forEach((r, ri) => {
      const g = k => (k in map ? String(r[map[k]] ?? '').trim() : '');
      const dayCell = g('day'); if (dayCell) curDay = dayCell;
      if (/^(end of day|day off|company move|lunch|total)/i.test(g('scene')) || /^(end of day|day off)/i.test(dayCell)) return;
      const sc = g('scene'), loc = g('loc'), cast = g('cast');
      if (!sc && !loc && !cast) return;
      const sceneKey = sc || ('row' + ri); if (scenes.has(sceneKey + '|' + curDay)) { /* duplicate row for same scene */ }
      scenes.add(sceneKey + '|' + curDay); n++;
      if (curDay) days.add(curDay);
      if (loc) {
        const name = locationOf('INT. ' + loc);
        const o = locs.get(name) || {scenes:new Set(), days:new Set()}; o.scenes.add(sceneKey + '|' + curDay); if (curDay) o.days.add(curDay); locs.set(name, o);
      }
      if (cast) cast.split(/[,;/&+]|\band\b/i).map(s => s.trim()).filter(Boolean).forEach(nm => {
        const name = /^\d+$/.test(nm) ? 'CAST #' + nm : nm.toUpperCase();
        const o = chars.get(name) || {speeches:0, scenes:new Set(), days:new Set()}; o.scenes.add(sceneKey + '|' + curDay); if (curDay) o.days.add(curDay); chars.set(name, o);
      });
    });
    return {
      src:'schedule', scenes:n, days: days.size || null, daysEstimated: !days.size,
      locations:[...locs.entries()].map(([name, o]) => ({name, scenes:o.scenes.size, days:o.days.size || null})).sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name)),
      characters:[...chars.entries()].map(([name, o]) => ({name, speeches:0, scenes:o.scenes.size, days:o.days.size || null})).sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name))
    };
  }
  function parseAny(text, fileName, kind) {
    const t = String(text); const head = t.slice(0, 400).trim();
    let k = kind || 'auto';
    if (k === 'auto') {
      if (/\.fdx$/i.test(fileName || '') || /^<\?xml|^<FinalDraft/i.test(head)) k = 'fdx';
      else if (/\.csv$/i.test(fileName || '') || (/^[^\n]*,[^\n]*,/.test(head) && /(scene|location|cast|day)/i.test(head.split('\n')[0]))) k = 'csv';
      else k = 'script';
    }
    const res = k === 'fdx' ? parseFDX(t) : k === 'csv' ? parseSchedule(t) : parseFountain(t);
    if (res.days == null && res.scenes) { res.days = Math.max(1, Math.ceil(res.scenes / 4)); res.daysEstimated = true; }
    return res;
  }

  /* ---- turning a parse result into proposed lines ---- */
  function findAccount(b, rx) { let hit = null; walk(b.rows, r => { if (!hit && r.type === 'account' && rx.test(r.name || '')) hit = r; }); return hit; }
  function proposeItems(b, res) {
    const hasSD = b.globals.some(g => g.symbol === 'SD');
    const items = [];
    res.locations.forEach(l => {
      const q = l.days || Math.max(1, Math.ceil(l.scenes / 4));
      items.push({kind:'loc', on:true, name:'Location fee – ' + tc(l.name), unit:'Day', qty:String(q), note: plural(l.scenes, 'scene') + ' (from ' + (res.src === 'schedule' ? 'schedule' : 'script') + ')'});
    });
    res.characters.forEach((c, i) => {
      const top = i < 4; const days = c.days || c.scenes || 1;
      items.push({kind:'cast', on:true, name:tc(c.name), unit:'Day', qty: top && hasSD ? '=SD' : String(Math.max(1, days)),
        note: (c.speeches ? plural(c.speeches, 'speech') + ', ' : '') + plural(c.scenes, 'scene') + ' (from ' + (res.src === 'schedule' ? 'schedule' : 'script') + ')'});
    });
    return items;
  }
  function applyImport(b, res, items, setSD) {
    const ph = primaryPhase(b); const phId = ph.id;
    const unitOf = u => b.units.find(z => z.toLowerCase() === u.toLowerCase()) || (b.units.push(u), u);
    let added = 0, skipped = 0;
    const target = (kind) => {
      const rx = kind === 'loc' ? /location/i : /cast|talent/i;
      let a = findAccount(b, rx);
      if (!a) {
        a = blankRow('account'); a.number = nextNumber(b.rows); a.name = kind === 'loc' ? 'Locations' : 'Cast';
        let at = b.rows.findIndex(r => r.type === 'subtotal' || r.type === 'markup'); if (at < 0) at = b.rows.length;
        b.rows.splice(at, 0, a);
      }
      return a;
    };
    const accts = {};
    items.forEach(it => {
      if (!it.on) return;
      const a = accts[it.kind] || (accts[it.kind] = target(it.kind));
      const exists = new Set(); walk(a.children, r => exists.add((r.name || '').trim().toLowerCase()));
      if (exists.has(it.name.trim().toLowerCase())) { skipped++; return; }
      const l = blankRow('line'); l.name = it.name; l.notes = it.note || '';
      const q = String(it.qty).trim();
      l.values[phId] = {unit: unitOf(it.unit), qty: q[0] === '=' ? q : (isNaN(parseFloat(q)) ? 1 : parseFloat(q))};
      a.children.push(l); added++;
    });
    if (setSD && res.days) {
      let g = b.globals.find(z => z.symbol === 'SD');
      if (g) { g.formula = String(res.days); if (g.vary) delete g.vary[phId]; }
      else b.globals.unshift({symbol:'SD', description:'Shoot days', formula:String(res.days), unit:'days', vary:{}});
    }
    return {added, skipped};
  }

  function curSD() { const g = (cur() && cur().globals || []).find(z => z.symbol === 'SD'); return g ? g.formula : 'not set'; }
  function scriptImport() {
    const b0 = cur(); if (!b0) return toast('Open a budget first');
    const ph = primaryPhase(b0);
    if (!ph || ph.type !== 'estimate') return toast('This budget needs an Estimate phase to receive lines');
    const S0 = {res:null, items:[], fname:''};
    U.modal = 'scriptimport';
    const draw = () => {
      const r = S0.res;
      const review = !r ? '' : `<div class="card" style="padding:10px 14px;margin:12px 0 8px">
        <b>${plural(r.scenes, 'scene')}</b> · <b>${plural(r.locations.length, 'location')}</b> · <b>${plural(r.characters.length, 'speaking role')}</b>${r.src === 'schedule' ? '' : ''} ·
        <b>${r.days ? plural(r.days, 'shoot day') : '—'}</b> <span class="muted">${r.days ? (r.daysEstimated ? '(estimated at about 4 scenes a day)' : '(from the schedule)') : ''}</span>
        <div class="muted" style="margin-top:4px">This is a <b>draft</b> built from your ${r.src === 'schedule' ? 'schedule' : 'script'}. Quantities (days) are estimates. Adjust them here or later in the budget; rates are left blank for you.</div></div>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" id="si-sd" ${r.days && !r.daysEstimated ? 'checked' : ''} ${r.days ? '' : 'disabled'}> Set the <b>SD</b> (shoot days) global to <b>${r.days || '—'}</b> <span class="muted">(currently ${esc(curSD())})</span></label>
        <div style="display:flex;gap:8px;margin:6px 0"><button data-siall="1">Select all</button><button data-siall="0">Select none</button><span class="sp"></span><span class="muted" id="si-count"></span></div>
        <div class="px-rev"><table class="simple px"><thead><tr><th style="width:30px"></th><th>Line</th><th style="width:74px">Unit</th><th style="width:90px">Qty</th><th>Why</th></tr></thead><tbody>
        ${['loc', 'cast'].map(k => `<tr><td colspan="5" style="background:var(--head);font-weight:600">${k === 'loc' ? 'Locations' : 'Cast'}</td></tr>` + S0.items.map((it, i) => it.kind === k ? `<tr><td><input type="checkbox" data-sion="${i}" ${it.on ? 'checked' : ''}></td><td>${esc(it.name)}</td><td>${esc(it.unit)}</td><td><input data-siqty="${i}" value="${esc(it.qty)}"></td><td class="muted">${esc(it.note)}</td></tr>` : '').join('') || '').join('')}
        </tbody></table></div>`;
      openModal(`<h2>Import a script or schedule</h2>
        <p class="muted" style="margin:0 0 8px">Pick a Final Draft file (<b>.fdx</b>), a <b>.fountain</b> or <b>.txt</b> script, or a schedule exported as <b>.csv</b> (columns like Day, Scene, Location, Cast). You can also paste text. PDFs can’t be read: export your script as Fountain or .fdx first.</p>
        <div class="row"><input type="file" id="si-file" accept=".fdx,.fountain,.txt,.csv,.spmd,text/plain,text/csv"><select id="si-kind" title="File type"><option value="auto">Detect automatically</option><option value="script">Script (Fountain / plain text)</option><option value="fdx">Final Draft (.fdx)</option><option value="csv">Schedule (CSV)</option></select></div>
        <textarea id="si-text" rows="${r ? 3 : 7}" style="width:100%" placeholder="…or paste a script or schedule here">${esc(S0.pasted || '')}</textarea>
        <div class="row"><button id="si-go">Analyze</button><span class="muted" id="si-msg">${esc(S0.msg || (S0.fname ? S0.fname : ''))}</span></div>
        ${review}
        <div class="acts px-sticky"><button data-mclose>Cancel</button><button class="primary" id="si-apply" ${r ? '' : 'disabled'}>Add selected lines to budget</button></div>`);
      const count = () => { const n = S0.items.filter(i => i.on).length; const e = $('#si-count'); if (e) e.textContent = n + ' selected'; const a = $('#si-apply'); if (a) a.textContent = n ? 'Add ' + plural(n, 'line') + ' to budget' : 'Add selected lines to budget'; };
      count();
      const analyze = (text, name) => {
        S0.msg = ''; S0.fname = name || '';
        try {
          if (!String(text).trim()) throw new Error('Nothing to read yet: choose a file or paste some text');
          const res = parseAny(text, name, $('#si-kind') ? $('#si-kind').value : 'auto');
          if (!res.scenes && !res.characters.length) throw new Error('No scenes or characters found. Check the file type, or paste a script that uses INT./EXT. scene headings.');
          S0.res = res; S0.items = proposeItems(cur(), res); S0.pasted = '';
        } catch (e) { S0.msg = e.message; S0.res = null; S0.items = []; }
        draw();
      };
      $('#si-file').onchange = ev => { const f = ev.target.files[0]; if (f) f.text().then(t => { S0.kindSel = $('#si-kind').value; analyze(t, f.name); }); };
      $('#si-go').onclick = () => { S0.pasted = $('#si-text').value; analyze(S0.pasted, ''); };
      $$('[data-sion]').forEach(c => c.onchange = () => { S0.items[+c.dataset.sion].on = c.checked; count(); });
      $$('[data-siqty]').forEach(c => c.oninput = () => { S0.items[+c.dataset.siqty].qty = c.value; });
      $$('[data-siall]').forEach(bn => bn.onclick = () => { S0.items.forEach(i => i.on = bn.dataset.siall === '1'); draw(); });
      const ap = $('#si-apply');
      if (ap) ap.onclick = () => {
        const setSD = $('#si-sd') && $('#si-sd').checked; let out;
        mutate(b => { out = applyImport(b, S0.res, S0.items, setSD); });
        closeModal(); U.tab = 'budget'; render();
        toast(out.added + ' line' + (out.added === 1 ? '' : 's') + ' added' + (out.skipped ? ', ' + out.skipped + ' skipped (already in the budget)' : '') + (setSD ? ' · shoot days updated' : ''));
      };
    };
    draw();
  }
  SlateExt.toolbar.push({act:'scriptimport', label:'Import script…', title:'Turn a script or schedule into budget lines'});
  SlateExt.actions.scriptimport = scriptImport;

  /* ============================================================
     5) SETUP CARDS: union presets + team note
     ============================================================ */
  SlateExt.setupCards.push(b => `<div class="card"><h3>Union &amp; payroll presets</h3>
    <div class="muted" style="margin-bottom:8px">One click adds a fringe you can then type into any line’s Fringes cell. The percentages are <b>approximate starting points</b> from published labor guides (mostly 2021–22 agreements). <b>Rates change with every contract</b>, so confirm them with the current agreement or your payroll company and edit the fringe above.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${PRESETS.map(p => {
      const has = b.fringes.some(f => f.name === p.name);
      return `<button data-pxpreset="${esc(p.name)}" ${has ? 'disabled' : ''} title="${esc(p.desc)}">${has ? '✓ ' : '+ '}${esc(p.pick)} · ${p.rate}%</button>`;
    }).join('')}</div></div>
    <div class="card"><h3>Working with a team</h3>
    <div class="muted">Everyone signs in with their own name on their own computer. To share budgets, point everyone at the same cloud folder (OneDrive, Dropbox, Google Drive or iCloud) using <b>Sync</b>. Changes show up a few seconds after the cloud service finishes syncing. If two people edit at the same moment the <b>last save wins</b>, so agree on who edits what. Live cursors and simultaneous editing are not included.</div></div>`);
  document.addEventListener('click', e => {
    const bt = e.target.closest('[data-pxpreset]'); if (!bt || !cur()) return;
    const p = PRESETS.find(x => x.name === bt.dataset.pxpreset); if (!p) return;
    mutate(b => { if (!b.fringes.some(f => f.name === p.name)) b.fringes.push(presetFringe(p)); });
    toast(p.pick + ' fringe added (edit the rate above)');
  });

  window.SlatePX = {makeCommercial, parseFountain, parseFDX, parseSchedule, parseAny, proposeItems, applyImport, poTotals, pcTotals, PRESETS, locationOf};
})();
