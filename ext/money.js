/* Slate extension: budget cap + funds raised (how much is left, in $ and %), cost report by shoot day,
   and a clean Top Sheet PDF. Data lives on the budget as b.money, b.company, b.logo. */
(function () {
  const css = `
.mn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:14px}
.mn-stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--r,8px);padding:12px 14px}
.mn-stat small{display:block;color:var(--muted);font:600 10.5px var(--font-mono,monospace);text-transform:uppercase;letter-spacing:.08em}
.mn-stat b{display:block;font:700 24px var(--font-display,inherit);letter-spacing:.01em;margin-top:4px}
.mn-stat span{color:var(--muted);font-size:12px}
.mn-bar{height:12px;border:1.5px solid var(--text);background:var(--panel);position:relative;margin:8px 0 4px;border-radius:2px;overflow:hidden}
.mn-bar i{position:absolute;left:0;top:0;bottom:0;background:var(--accent)}
.mn-bar i.ok{background:var(--ok,#2f8f4e)} .mn-bar i.warn{background:#d99a1e} .mn-bar i.over{background:var(--neg,#c0392b)}
.mn-bar em{position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--text)}
.mn-left{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px}
.mn-big{font:700 30px var(--font-display,inherit)}
.pill.mn{font-family:var(--font-mono,monospace);cursor:pointer}
.pill.mn.warn{border-color:#d99a1e;color:#b07a10} .pill.mn.over{border-color:var(--neg,#c0392b);color:var(--neg,#c0392b)}
.bcard .mnl{font:600 11px var(--font-mono,monospace);letter-spacing:.04em;margin:-2px 0 8px;color:var(--muted)} .bcard .mnl.over{color:var(--neg,#c0392b)}
table.simple td.st-ok{color:var(--ok,#2f8f4e)} table.simple td.st-warn{color:#b07a10;font-weight:700} table.simple td.st-over{color:var(--neg,#c0392b);font-weight:700}
.rb-move{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-left:4px solid var(--accent);margin-bottom:8px;background:var(--panel)}
.rb-move .amt{font:700 18px var(--font-mono,monospace);min-width:110px;text-align:right}
.rb-move .why{flex:1;font-size:13px}.rb-move .why small{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.rb-short{border-left-color:var(--neg,#c0392b)}
table.simple tr.sub td:nth-child(2){padding-left:26px;color:var(--muted)}
.mn-mini{display:inline-block;width:90px;height:8px;border:1px solid var(--line);vertical-align:middle;position:relative;background:var(--panel)} .mn-mini i{position:absolute;left:0;top:0;bottom:0}
`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const num = v => { const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return isFinite(n) ? n : 0; };
  const pct = (a, b) => b > 0 ? a / b * 100 : 0;
  const p1 = n => (Math.abs(n) >= 100 || Number.isInteger(n) ? Math.round(n) : Math.round(n * 10) / 10) + '%';
  const M = b => { b.money = b.money || {}; b.money.sources = b.money.sources || []; b.money.shoot = b.money.shoot || { dates: [] }; return b.money; };
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------- the numbers ---------- */
  function totals(b) {
    const memo = (cur() === b) ? calc() : computeAll(b);
    const root = p => p ? ((memo[p.id] && memo[p.id].get('__root__')) || 0) : 0;
    const est = primaryPhase(b), act = b.phases.find(p => p.type === 'actual');
    const m = b.money || {}; let cap = num(m.cap);
    if (!(cap > 0)) { try { cap = makeGv(b, est.id)('CAP') || 0; } catch (e) { cap = 0; } }
    const srcs = (m.sources || []);
    const raised = srcs.filter(s => s.status !== 'pledged').reduce((a, s) => a + num(s.amount), 0);
    const pledged = srcs.filter(s => s.status === 'pledged').reduce((a, s) => a + num(s.amount), 0);
    return { memo, est, act, E: root(est), A: root(act), cap: cap > 0 ? cap : 0, raised, pledged };
  }
  // What "left" means: the cap if you set one, otherwise the money you've raised.
  function leftInfo(t) {
    const base = t.cap > 0 ? t.cap : (t.raised > 0 ? t.raised : 0);
    if (!base) return null;
    const left = base - t.A, lp = pct(left, base);
    return { base, label: t.cap > 0 ? 'cap' : 'raised', left, lp, cls: left < 0 ? 'over' : lp < 10 ? 'warn' : 'ok' };
  }
  const bar = (used, total, mark) => { const w = total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : 0; const c = used > total ? 'over' : w > 90 ? 'warn' : 'ok'; return `<div class="mn-bar"><i class="${c}" style="width:${w}%"></i>${mark != null && total > 0 ? `<em style="left:${Math.min(100, mark / total * 100)}%"></em>` : ''}</div>`; };

  /* ---------- summary (Top Sheet + Money tab) ---------- */
  function summaryHTML(b, withLinks = true) {
    const t = totals(b);
    const capCard = t.cap > 0 ? `<div class="mn-stat"><small>Budget cap</small><b>${money(t.cap, b)}</b>${bar(t.A, t.cap, t.E)}
      <div class="mn-left"><span>Spent ${money(t.A, b)} · ${p1(pct(t.A, t.cap))}</span><span class="${t.cap - t.A < 0 ? 'neg' : ''}"><b style="display:inline;font:inherit;font-weight:700">${money(t.cap - t.A, b)}</b> left · ${p1(pct(t.cap - t.A, t.cap))}</span></div>
      <span>${t.E > t.cap ? `<span class="neg">Plan is ${money(t.E - t.cap, b)} over the cap</span>` : `Plan (${esc(t.est.name)}) uses ${p1(pct(t.E, t.cap))} of the cap`}</span></div>`
      : `<div class="mn-stat"><small>Budget cap</small><b class="muted">Not set</b><span>${withLinks ? '<a data-tab="money" style="cursor:pointer;text-decoration:underline">Set a cap</a> to see what’s left' : ''}</span></div>`;
    const raisedCard = (t.raised > 0 || t.pledged > 0) ? `<div class="mn-stat"><small>Funds raised</small><b>${money(t.raised, b)}</b>${bar(t.A, t.raised)}
      <div class="mn-left"><span>Spent ${p1(pct(t.A, t.raised))}</span><span class="${t.raised - t.A < 0 ? 'neg' : ''}"><b style="display:inline;font:inherit;font-weight:700">${money(t.raised - t.A, b)}</b> left · ${p1(pct(t.raised - t.A, t.raised))}</span></div>
      <span>${t.pledged ? money(t.pledged, b) + ' more pledged · ' : ''}${t.E > t.raised + t.pledged ? 'Still to raise for the plan: <b>' + money(t.E - t.raised - t.pledged, b) + '</b>' : 'Plan is fully funded'}</span></div>`
      : `<div class="mn-stat"><small>Funds raised</small><b class="muted">$0</b><span>${withLinks ? '<a data-tab="money" style="cursor:pointer;text-decoration:underline">Add money raised</a>' : ''}</span></div>`;
    return `<div class="mn-grid">
      <div class="mn-stat"><small>Planned · ${esc(t.est.name)}</small><b>${money(t.E, b)}</b><span>${t.act ? 'Spent so far: ' + money(t.A, b) + ' (' + p1(pct(t.A, t.E)) + ')' : 'No Actual phase'}</span></div>
      ${capCard}${raisedCard}</div>`;
  }

  /* ---------- Money tab ---------- */
  function moneyHTML(b) {
    const m = M(b); const t = totals(b);
    const srcRows = m.sources.map((s, i) => `<tr>
      <td><input type="date" data-mny="src" data-i="${i}" data-f="date" value="${esc(s.date || '')}"></td>
      <td><input data-mny="src" data-i="${i}" data-f="source" value="${esc(s.source || '')}" placeholder="e.g. Seed & Spark, Mom, LLC"></td>
      <td><select data-mny="src" data-i="${i}" data-f="kind">${['Investor', 'Crowdfunding', 'Grant', 'Donation', 'Our own money', 'Sponsor', 'Other'].map(k => `<option ${s.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
      <td><select data-mny="src" data-i="${i}" data-f="status"><option value="received" ${s.status !== 'pledged' ? 'selected' : ''}>Received</option><option value="pledged" ${s.status === 'pledged' ? 'selected' : ''}>Pledged</option></select></td>
      <td><input type="number" step="0.01" style="text-align:right" data-mny="src" data-i="${i}" data-f="amount" value="${s.amount ?? ''}"></td>
      <td><input data-mny="src" data-i="${i}" data-f="note" value="${esc(s.note || '')}"></td>
      <td><button class="ghost danger" data-mny-del="${i}">✕</button></td></tr>`).join('');
    return `<div class="page"><div class="hero" style="max-width:1100px">
      <div style="display:flex;align-items:center;gap:10px"><h1 style="margin:6px 0 14px;flex:1">Money</h1><button data-act="mnpdf">Top Sheet PDF…</button></div>
      ${summaryHTML(b, false)}
      <div class="card"><h3>Budget cap</h3><div class="muted" style="margin-bottom:8px">The most you can spend on this project. Slate shows how much of it is left as you spend (from Transactions, POs and petty cash).</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><label class="muted">Cap</label><input id="mn-cap" type="number" step="0.01" min="0" value="${m.cap ?? ''}" placeholder="e.g. 25000" style="width:180px;text-align:right">
        <span class="muted">${t.cap > 0 ? 'Left: <b>' + money(t.cap - t.A, b) + '</b> · ' + p1(pct(t.cap - t.A, t.cap)) : 'Leave empty for no cap.'}</span></div></div>
      <div class="card"><h3>Money raised</h3><div class="muted" style="margin-bottom:8px">Everything that came in for this budget. <b>Received</b> money counts toward what’s left; <b>pledged</b> money is promised but not in hand yet.</div>
        <table class="simple"><thead><tr><th style="width:140px">Date</th><th>From</th><th style="width:150px">Type</th><th style="width:120px">Status</th><th class="num" style="width:130px">Amount</th><th>Note</th><th style="width:40px"></th></tr></thead><tbody>
        ${srcRows || '<tr><td colspan="7" class="muted" style="text-align:center;padding:18px">Nothing raised yet. Add the first amount below.</td></tr>'}
        <tr class="tot"><td colspan="4">Received${t.pledged ? ' (plus ' + money(t.pledged, b) + ' pledged)' : ''}</td><td class="num">${money(t.raised, b)}</td><td colspan="2"></td></tr></tbody></table>
        <div style="margin-top:8px"><button class="primary" data-act="mnadd">+ Add money raised</button></div></div>
    </div></div>`;
  }

  /* ---------- Even out the budget: where to move money ----------
     Each top-level account has a limit: its spending cap, or (no cap) its estimate.
     It will probably cost the larger of its estimate and what's already spent.
     Short = that minus the limit. Spare = the limit minus that (only accounts with a cap can give).
     Money in the overall budget cap (Money tab) that isn't given to any account can give too. */
  function rebalPlan(b) {
    const memo = (cur() === b) ? calc() : computeAll(b);
    const est = primaryPhase(b), act = b.phases.find(p => p.type === 'actual' && !p.hidden) || b.phases.find(p => p.type === 'actual');
    const v = (p, id) => p ? ((memo[p.id] && memo[p.id].get(id)) || 0) : 0;
    const units = [];
    let used = 0;
    b.rows.forEach(r => {
      if (r.type === 'subtotal') return;
      const planned = v(est, r.id), spent = v(act, r.id), expected = Math.max(planned, spent);
      if (r.type !== 'account') { used += expected; return; }
      const capped = +r.cap > 0, limit = capped ? +r.cap : planned;
      used += limit;
      units.push({ r, capped, limit, planned, spent, expected, short: Math.max(0, expected - limit), spare: capped ? Math.max(0, limit - expected) : 0 });
    });
    const pc = totals(b).cap; const unassigned = pc > 0 ? Math.max(0, pc - used) : 0;
    const donors = [];
    if (unassigned >= 1) donors.push({ pool: true, spare: Math.floor(unassigned), label: 'Unassigned money in your total cap (' + money(pc, b) + ')' });
    units.filter(u => u.spare >= 1).sort((a, c) => c.spare - a.spare).forEach(u => donors.push({ u, spare: Math.floor(u.spare), label: rowLabel(u.r) }));
    const needs = units.filter(u => u.short >= 0.005).sort((a, c) => c.short - a.short);
    const moves = [];
    needs.forEach(n => {
      let want = Math.ceil(n.short);
      for (const d of donors) { if (want <= 0) break; if (d.spare <= 0) continue; const amt = Math.min(want, d.spare); d.spare -= amt; want -= amt; moves.push({ from: d, to: n, amt }); }
      n.left = want;
    });
    const stillShort = needs.reduce((a, n) => a + (n.left || 0), 0);
    const spareLeft = donors.reduce((a, d) => a + d.spare, 0);
    return { units, needs, donors, moves, stillShort, spareLeft, est, act, anyCap: units.some(u => u.capped) };
  }
  let lastMoves = [];
  function rebalHTML(b) {
    const P = rebalPlan(b); lastMoves = P.moves;
    const why = u => `${u.capped ? 'cap ' + money(u.limit, b) : 'no cap, estimate ' + money(u.limit, b)} · ${u.spent > u.planned ? 'already spent ' + money(u.spent, b) : 'estimate ' + money(u.planned, b) + (u.spent ? ', spent ' + money(u.spent, b) : '')}`;
    if (!P.act) return '<div class="muted">Add an Actual phase (Setup → Phases) so Slate can compare spending with your caps.</div>';
    const head = `<div class="muted" style="margin-bottom:10px;font-size:13px">Each account is expected to cost its <b>${esc(P.est.name)}</b> or what’s already spent, whichever is higher. Accounts expected to go past their cap need money; accounts with a cap that won’t all be used have spare. Moving money changes the two accounts’ caps; your total stays the same.</div>`;
    let body = '';
    if (P.moves.length) body += P.moves.map((m, i) => `<div class="rb-move"><div class="amt">${money(m.amt, b).replace(/\.00$/, '')}</div><div class="why">From <b>${esc(m.from.label)}</b> to <b>${esc(rowLabel(m.to.r))}</b>
        <small>${esc(rowLabel(m.to.r))}: ${m.to.spent > m.to.planned ? 'cost more than expected' : 'planned above its cap'}, short ${money(m.to.short, b)} (${esc(why(m.to))}).${m.from.u ? '<br>' + esc(m.from.label) + ': ' + money(m.from.u.spare, b) + ' spare (' + esc(why(m.from.u)) + ').' : ''}</small></div><button class="primary" data-rb-apply="${i}">Move it</button></div>`).join('');
    if (P.stillShort >= 1) body += `<div class="rb-move rb-short"><div class="amt neg">${money(P.stillShort, b).replace(/\.00$/, '')}</div><div class="why"><b>Still short after using all the spare money.</b><small>${P.needs.filter(n => n.left >= 1).map(n => esc(rowLabel(n.r)) + ' needs ' + money(n.left, b)).join(' · ')}. Options: raise your total budget, or lower estimates in these accounts.</small></div></div>`;
    if (!P.needs.length) body += `<div class="rb-move" style="border-left-color:var(--ok,#2f8f4e)"><div class="why"><b>Nothing is expected to go over its cap.</b><small>${P.donors.length ? 'Spare money you could use elsewhere: ' + P.donors.map(d => esc(d.label) + ' ' + money(d.spare, b)).join(' · ') : P.anyCap ? 'No spare money either. Every cap is fully planned.' : 'Set caps on your accounts (double-click an account) to get suggestions.'}</small></div></div>`;
    else if (P.spareLeft >= 1 && P.moves.length) body += `<div class="muted" style="font-size:12.5px;margin-top:4px">Spare money left after these moves: ${P.donors.filter(d => d.spare >= 1).map(d => esc(d.label) + ' ' + money(d.spare, b)).join(' · ')}</div>`;
    const all = P.moves.length > 1 ? `<button data-rb-apply="all">Make all ${P.moves.length} moves</button>` : '';
    return head + body + (all ? `<div style="margin-top:8px">${all}</div>` : '');
  }
  function applyMoves(list) {
    if (!list.length) return;
    mutate(bb => {
      list.forEach(m => {
        const to = find(bb, m.to.r.id); if (to) to.row.cap = Math.round(((+to.row.cap > 0 ? +to.row.cap : m.to.limit) + m.amt) * 100) / 100;
        if (m.from.u) { const fr = find(bb, m.from.u.r.id); if (fr) fr.row.cap = Math.round(Math.max(0, (+fr.row.cap > 0 ? +fr.row.cap : m.from.u.limit) - m.amt) * 100) / 100; }
      });
    });
    toast(list.length === 1 ? 'Moved ' + money(list[0].amt, cur()) + ' to ' + rowLabel(list[0].to.r) + ' (undo with ' + MOD + 'Z)' : list.length + ' moves made (undo with ' + MOD + 'Z)');
  }
  function rebalModal() {
    const b = cur(); if (!b) return; U.modal = 'rebal';
    openModal(`<h2>Even out the budget</h2><div id="rb-body">${rebalHTML(b)}</div><div class="acts"><button data-mclose class="primary">Done</button></div>`);
  }

  /* ---------- Cost report ---------- */
  function spendItems(b) {
    const items = [];
    (b.transactions || []).forEach(t => items.push({ date: t.date || '', amount: (typeof txTotal === 'function' ? txTotal(t) : num(t.amount)), rowId: t.rowId, what: t.payee || t.desc || 'Transaction' }));
    (b.pos || []).forEach(p => { if (p.status === 'invoiced' || p.status === 'paid') items.push({ date: p.date || '', amount: num(p.amount), rowId: p.rowId, what: 'PO ' + (p.num || '') }); });
    (b.petty || []).forEach(p => { if (p.type === 'spend') items.push({ date: p.date || '', amount: num(p.amount), rowId: p.rowId, what: 'Petty cash' }); });
    // Lines whose actual was typed in on the budget page: that number replaces their receipts, and has no date.
    const act = b.phases.find(p => p.type === 'actual'); const typed = new Map();
    if (act) walk(b.rows, r => { const v = r.type === 'line' && r.values && r.values[act.id]; if (v && v.man != null && v.man !== '') typed.set(r.id, +v.man || 0); });
    if (!typed.size) return items;
    return items.filter(it => !typed.has(it.rowId)).concat([...typed.values()].map(a => ({ date: '', amount: a, rowId: null, what: 'Typed-in actual' })));
  }
  function costHTML(b) {
    const m = M(b); const t = totals(b); const dates = (m.shoot.dates || []).filter(Boolean).slice().sort();
    const items = spendItems(b);
    // Caps: the overall cap (Money tab) if set, otherwise the account caps added up, otherwise the estimate.
    const memo0 = t.memo, capSumAll = b.rows.reduce((a, r) => a + ((r.type === 'account' || r.type === 'line') && +r.cap > 0 ? +r.cap : 0), 0);
    const base = t.cap > 0 ? t.cap : capSumAll > 0 ? capSumAll : t.E; const baseLbl = t.cap > 0 ? 'cap' : capSumAll > 0 ? 'caps' : 'estimate';
    // bucket every dated spend into prep / a shoot day / wrap & post
    const buckets = [{ k: 'prep', label: 'Prep', date: dates.length ? 'before ' + fmtDate(dates[0] + 'T12:00:00') : '', sum: 0, n: 0 }];
    dates.forEach((d, i) => buckets.push({ k: d, label: 'Day ' + (i + 1), date: fmtDate(d + 'T12:00:00'), sum: 0, n: 0, isDay: true }));
    buckets.push({ k: 'post', label: 'Wrap & post', date: dates.length ? 'after ' + fmtDate(dates[dates.length - 1] + 'T12:00:00') : '', sum: 0, n: 0 });
    const undated = { sum: 0, n: 0 };
    items.forEach(it => {
      if (!it.date) { undated.sum += it.amount; undated.n++; return; }
      let bk;
      if (!dates.length || it.date < dates[0]) bk = buckets[0];
      else if (it.date > dates[dates.length - 1]) { const last = new Date(dates[dates.length - 1] + 'T12:00:00'); last.setDate(last.getDate() + 1); bk = it.date <= last.toISOString().slice(0, 10) ? buckets[buckets.length - 2] : buckets[buckets.length - 1]; }
      else { let j = 0; dates.forEach((d, i) => { if (d <= it.date) j = i; }); bk = buckets[j + 1]; }
      bk.sum += it.amount; bk.n++;
    });
    let run = undated.sum;
    const td = today();
    const dayRows = buckets.map(bk => {
      run += bk.sum;
      const future = bk.isDay && bk.k > td && !bk.n;
      return `<tr${future ? ' class="muted"' : ''}><td><b>${bk.label}</b></td><td>${esc(bk.date)}</td><td class="num">${bk.n ? money(bk.sum, b) : '<span class="muted">—</span>'}</td><td class="num">${money(run, b)}</td>
        <td class="num">${base > 0 ? p1(pct(run, base)) : '—'}</td><td class="num ${base - run < 0 ? 'neg' : ''}">${base > 0 ? money(base - run, b) : '—'}</td></tr>`;
    }).join('');
    // per account: cap, estimate and spent. "Left" and "Used" go off the cap when there is one, otherwise the estimate.
    const memo = t.memo;
    const list = []; b.rows.forEach(r => { if (r.type === 'account' || r.type === 'line') { list.push({ r, d: 0 }); if (r.type === 'account') walk(r.children || [], (x, p, d) => { if (x.type === 'account' && +x.cap > 0) list.push({ r: x, d: d + 1 }); }); } });
    const tot = { cap: 0, e: 0, a: 0, left: 0, anyCap: false };
    const accRows = list.map(({ r, d }) => {
      const e = (memo[t.est.id] && memo[t.est.id].get(r.id)) || 0, a = t.act ? ((memo[t.act.id] && memo[t.act.id].get(r.id)) || 0) : 0;
      const cap = (r.type === 'account' || r.type === 'line') && +r.cap > 0 ? +r.cap : 0;
      if (!e && !a && !cap) return '';
      const lim = cap || e, left = lim - a;
      if (!d) { tot.e += e; tot.a += a; tot.cap += cap; tot.left += left; if (cap) tot.anyCap = true; }
      const used = lim > 0 ? a / lim * 100 : (a > 0 ? 999 : 0);
      const cls = a > lim + 0.004 ? 'over' : used >= 80 ? 'warn' : 'ok';
      const estOver = cap && e > cap + 0.004;
      const status = cls === 'over' ? (cap ? 'Over cap' : 'Over estimate') : estOver ? 'Plan over cap' : cls === 'warn' ? 'Close' : 'OK';
      const mark = cap && e > 0 ? `<em style="position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--text);left:${Math.min(100, e / cap * 100)}%" title="Estimate"></em>` : '';
      return `<tr class="${d ? 'sub' : ''}"><td>${esc(r.number || '')}</td><td>${esc(r.name || '')}</td><td class="num">${cap ? money(cap, b) : '<span class="muted">—</span>'}</td><td class="num">${money(e, b)}</td><td class="num">${money(a, b)}</td><td class="num ${left < 0 ? 'neg' : ''}">${money(left, b)}${cap ? '' : ' <span class="muted" title="No cap: left of the estimate">est.</span>'}</td>
        <td><span class="mn-mini"><i style="width:${Math.min(100, used)}%;background:${cls === 'over' ? 'var(--neg,#c0392b)' : cls === 'warn' ? '#d99a1e' : 'var(--ok,#2f8f4e)'}"></i>${mark}</span> ${lim > 0 ? p1(used) : (a > 0 ? 'unplanned' : '')}</td>
        <td class="st-${estOver && cls === 'ok' ? 'warn' : cls}">${status}</td></tr>`;
    }).join('') + (list.length ? `<tr class="tot"><td></td><td>Total</td><td class="num">${tot.anyCap ? money(tot.cap, b) : ''}</td><td class="num">${money(tot.e, b)}</td><td class="num">${money(tot.a, b)}</td><td class="num ${tot.left < 0 ? 'neg' : ''}">${money(tot.left, b)}</td><td colspan="2"></td></tr>` : '');
    const overCap = list.filter(({ r, d }) => !d && (r.type === 'account' || r.type === 'line') && +r.cap > 0 && (t.act ? ((memo[t.act.id] && memo[t.act.id].get(r.id)) || 0) : 0) > +r.cap + 0.004);
    const overs = [];
    walk(b.rows, r => { if (r.type !== 'line') return; const e = (memo[t.est.id] && memo[t.est.id].get(r.id)) || 0, a = t.act ? ((memo[t.act.id] && memo[t.act.id].get(r.id)) || 0) : 0; if (a > e + 0.004) overs.push({ r, e, a }); });
    overs.sort((x, y) => (y.a - y.e) - (x.a - x.e));
    const dateRows = (m.shoot.dates || []).map((d, i) => `<span style="display:inline-flex;gap:4px;align-items:center;margin:0 10px 6px 0"><span class="muted" style="font:600 11px var(--font-mono,monospace)">DAY ${i + 1}</span><input type="date" data-mny="day" data-i="${i}" value="${esc(d)}" style="width:150px"><button class="ghost danger" data-mny-dday="${i}" title="Remove this day">✕</button></span>`).join('');
    return `<div class="page"><div class="hero" style="max-width:1100px">
      <div style="display:flex;align-items:center;gap:10px"><h1 style="margin:6px 0 14px;flex:1">Cost report</h1><button data-act="print">Print</button></div>
      <div class="mn-grid">
        <div class="mn-stat"><small>Spent so far</small><b>${money(t.A, b)}</b><span>${base > 0 ? p1(pct(t.A, base)) + ' of the ' + baseLbl : ''}</span></div>
        <div class="mn-stat"><small>Left in the ${baseLbl}</small><b class="${base - t.A < 0 ? 'neg' : ''}">${base > 0 ? money(base - t.A, b) : '—'}</b><span>${base > 0 ? p1(pct(base - t.A, base)) + ' left' : ''}</span></div>
        <div class="mn-stat"><small>${esc(t.est.name)} (planned)</small><b>${money(t.E, b)}</b><span>${tot.anyCap ? 'Caps add up to ' + money(tot.cap, b) : 'Double-click an account to set its cap'}</span></div>
        <div class="mn-stat"><small>Over their cap</small><b class="${overCap.length ? 'neg' : ''}">${overCap.length}</b><span>${overs.length ? overs.length + ' line' + (overs.length === 1 ? '' : 's') + ' over estimate' : 'No lines over estimate'}</span></div>
      </div>
      <div class="card"><div style="display:flex;align-items:center;gap:10px"><h3 style="flex:1;margin:0">Even out the budget</h3><span class="muted" style="font-size:12px">Suggestions update as you spend</span></div><div style="margin-top:10px">${rebalHTML(b)}</div></div>
      <div class="card"><h3>Shoot days</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px"><label class="muted">First day</label><input type="date" id="mn-start" value="${esc((m.shoot.dates || [])[0] || '')}" style="width:160px"><label class="muted">Number of days</label><input type="number" id="mn-ndays" min="1" max="120" value="${(m.shoot.dates || []).length || ''}" style="width:80px"><label class="muted" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="mn-skipwk" ${m.shoot.skipWeekends ? 'checked' : ''}> skip weekends</label><button data-act="mnfill">Set dates</button></div>
        ${dateRows ? '<div>' + dateRows + '</div><button class="ghost" data-act="mnaddday">+ Add a day</button>' : '<div class="muted">Enter your first shoot day and how many days, then Set dates. Spending is grouped into prep, each shoot day, and wrap &amp; post by its date.</div>'}</div>
      <div class="card"><h3>Day by day</h3><div class="muted" style="margin-bottom:8px">Spending by date, from Transactions, invoiced/paid POs and petty cash. Spending on an off day (like a weekend) counts with the shoot day before it.${undated.n ? ` <b>${undated.n}</b> item${undated.n === 1 ? ' has' : 's have'} no date (${money(undated.sum, b)}) and ${undated.n === 1 ? 'is' : 'are'} counted in the running total from the start.` : ''}</div>
        <table class="simple"><thead><tr><th style="width:130px"></th><th>Date</th><th class="num">Spent</th><th class="num">Running total</th><th class="num">% of ${baseLbl}</th><th class="num">Left after</th></tr></thead><tbody>${dayRows}</tbody></table></div>
      <div class="card"><h3>By account: cap, estimate and spent</h3><div class="muted" style="margin-bottom:8px"><b>Left</b> and <b>Used</b> go off each account’s spending cap. Accounts without a cap use the <b>${esc(t.est.name)}</b> instead (marked “est.”). The black tick on the bar is the estimate. “Close” means 80% or more used.</div>
        <table class="simple"><thead><tr><th style="width:70px">Acct</th><th>Account</th><th class="num">Cap</th><th class="num">${esc(t.est.name)}</th><th class="num">Spent</th><th class="num">Left</th><th style="width:160px">Used</th><th style="width:110px"></th></tr></thead><tbody>${accRows || '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">No numbers yet.</td></tr>'}</tbody></table></div>
      ${overs.length ? `<div class="card"><h3>Lines over estimate</h3><table class="simple"><thead><tr><th>Line</th><th class="num">Estimate</th><th class="num">Spent</th><th class="num">Over by</th></tr></thead><tbody>${overs.map(o => `<tr><td>${esc(rowLabel(o.r))}</td><td class="num">${money(o.e, b)}</td><td class="num">${money(o.a, b)}</td><td class="num neg">${money(o.a - o.e, b)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div></div>`;
  }

  /* ---------- Top Sheet PDF ---------- */
  function pdfDialog() {
    const b = cur(); if (!b) return;
    U.modal = 'pdf';
    openModal(`<h2>Top Sheet PDF</h2>
      <div class="row"><label>Company</label><input id="pdf-co" value="${esc(b.company ?? 'Pink Moose Productions')}" style="flex:1"></div>
      <div class="row"><label>Logo</label><span style="flex:1;display:flex;gap:8px;align-items:center">${b.logo ? `<img src="${b.logo}" style="height:34px;max-width:120px;object-fit:contain;background:#fff;border:1px solid var(--line)">` : '<span class="muted">none</span>'}<button id="pdf-logo">Choose image…</button>${b.logo ? '<button class="ghost danger" id="pdf-nologo">Remove</button>' : ''}</span></div>
      <div class="row"><label>Include</label><span style="flex:1"><label style="display:block"><input type="checkbox" id="pdf-money" checked> Cap, money raised and what’s left</label><label style="display:block"><input type="checkbox" id="pdf-tags" checked> Totals by tag</label></span></div>
      <div class="row"><label>Notes</label><textarea id="pdf-notes" rows="3" style="flex:1" placeholder="Optional, shown at the bottom">${esc(b.pdfNotes || '')}</textarea></div>
      <div class="acts"><button data-mclose>Cancel</button><button class="primary" id="pdf-go">Save PDF</button></div>`);
    $('#pdf-logo').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const f = i.files[0]; if (!f) return; const url = await shrink(f, 500); if (!url) return toast('Couldn’t read that image'); keepFields(); mutate(bb => { bb.logo = url; }, {render:false}); pdfDialog(); }; i.click(); };
    const nl = $('#pdf-nologo'); if (nl) nl.onclick = () => { keepFields(); mutate(bb => { delete bb.logo; }, {render:false}); pdfDialog(); };
    function keepFields() { const co = $('#pdf-co').value, no = $('#pdf-notes').value; mutate(bb => { bb.company = co; bb.pdfNotes = no; }, {render:false}); }
    $('#pdf-go').onclick = async () => {
      keepFields();
      const html = pdfHTML(cur(), { money: $('#pdf-money').checked, tags: $('#pdf-tags').checked });
      const name = cur().name + ' – Top Sheet ' + today();
      if (NATIVE && NATIVE.pdf) {
        const go = $('#pdf-go'); go.disabled = true; go.textContent = 'Making PDF…';
        const r = await NATIVE.pdf({ html, name }); closeModal();
        if (r.ok) toast('Saved ' + r.file.split(/[\\/]/).pop()); else if (!r.canceled) toast('Couldn’t make the PDF: ' + r.error);
      } else { closeModal(); const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print'); w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
    };
  }
  function shrink(file, max) {
    return new Promise(res => { const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); }; img.onerror = () => res(null); img.src = r.result; }; r.onerror = () => res(null); r.readAsDataURL(file); });
  }
  function pdfHTML(b, opt) {
    const t = totals(b); const memo = t.memo;
    const phs = b.phases.filter(p => !p.hidden);
    const val = (p, id) => (memo[p.id] && memo[p.id].get(id)) || 0;
    const fd = (NATIVE && NATIVE.fontDir) ? NATIVE.fontDir() : 'fonts/';
    const top = b.rows.filter(r => r.type !== 'subtotal');
    const rows = top.map(r => `<tr><td class="no">${esc(r.number || '')}</td><td>${r.type === 'markup' ? '<i>' + esc(r.name) + '</i>' : esc(r.name)}</td>${phs.map(p => `<td class="n">${money(val(p, r.id), b)}</td>`).join('')}</tr>`).join('');
    let tagRows = '';
    if (opt.tags && b.tags.length) {
      const tt = {}; phs.forEach(p => { const m = memo[p.id] || new Map(); (function go(rs) { rs.forEach(r => { if (r.type === 'subtotal') return; if ((r.tags || []).length) r.tags.forEach(tg => { (tt[tg] = tt[tg] || {})[p.id] = (tt[tg][p.id] || 0) + (m.get(r.id) || 0); }); else go(r.children || []); }); })(b.rows); });
      tagRows = b.tags.filter(tg => tt[tg.name]).map(tg => `<tr><td>${esc(tg.name)}</td>${phs.map(p => `<td class="n">${money((tt[tg.name] || {})[p.id] || 0, b)}</td>`).join('')}</tr>`).join('');
    }
    const box = (k, v, s, cls = '') => `<div class="box"><small>${k}</small><b class="${cls}">${v}</b>${s ? `<span>${s}</span>` : ''}</div>`;
    const boxes = opt.money ? [
      box('Planned (' + esc(t.est.name) + ')', money(t.E, b)),
      t.act ? box('Spent to date', money(t.A, b), t.E ? p1(pct(t.A, t.E)) + ' of plan' : '') : '',
      t.cap > 0 ? box('Budget cap', money(t.cap, b), money(t.cap - t.A, b) + ' left · ' + p1(pct(t.cap - t.A, t.cap)), '') : '',
      (t.raised || t.pledged) ? box('Funds raised', money(t.raised, b), (t.pledged ? money(t.pledged, b) + ' pledged · ' : '') + money(t.raised - t.A, b) + ' left') : ''
    ].join('') : '';
    const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.name)} Top Sheet</title><style>
@font-face{font-family:BS;src:url('${fd}BigShoulders-Bold.ttf')}@font-face{font-family:IS;src:url('${fd}InstrumentSans-Regular.ttf')}@font-face{font-family:IS;font-weight:700;src:url('${fd}InstrumentSans-Bold.ttf')}@font-face{font-family:PM;src:url('${fd}IBMPlexMono-Regular.ttf')}@font-face{font-family:PM;font-weight:700;src:url('${fd}IBMPlexMono-Bold.ttf')}
*{box-sizing:border-box}body{margin:0;font:11px IS,Helvetica,Arial,sans-serif;color:#1b1d22}
.stripe{height:12px;background:repeating-linear-gradient(-45deg,#1b1d22 0 12px,#fff 12px 24px);border:1.5px solid #1b1d22}
header{display:flex;align-items:center;gap:14px;padding:14px 0 10px;border-bottom:2px solid #1b1d22;margin-bottom:14px}
header img{max-height:54px;max-width:160px;object-fit:contain}
header .t{flex:1}header .co{font:700 10px PM,monospace;letter-spacing:.14em;text-transform:uppercase;color:#d4401c}
header h1{margin:2px 0 0;font:700 30px BS,Impact,sans-serif;text-transform:uppercase;letter-spacing:.01em;line-height:1}
header .d{text-align:right;font:10px PM,monospace;color:#555;text-transform:uppercase;letter-spacing:.06em}
.boxes{display:flex;gap:10px;margin-bottom:14px}.box{flex:1;border:1.5px solid #1b1d22;padding:8px 10px}.box small{display:block;font:700 8.5px PM,monospace;letter-spacing:.1em;text-transform:uppercase;color:#555}.box b{display:block;font:700 20px BS,Impact,sans-serif;margin-top:2px}.box span{font-size:9.5px;color:#555}
table{width:100%;border-collapse:collapse;margin-bottom:14px}th{font:700 8.5px PM,monospace;letter-spacing:.1em;text-transform:uppercase;text-align:left;background:#1b1d22;color:#fff;padding:6px 8px}th.n{text-align:right}
td{padding:5px 8px;border-bottom:1px solid #ddd}td.n{text-align:right;font-family:PM,monospace;white-space:nowrap}td.no{font-family:PM,monospace;width:56px}
tr.tot td{border-top:2px solid #1b1d22;border-bottom:0;font-weight:700}h2{font:700 13px BS,Impact,sans-serif;text-transform:uppercase;letter-spacing:.04em;margin:4px 0 6px}
.notes{border-left:3px solid #d4401c;padding:4px 10px;white-space:pre-wrap;margin-bottom:14px}footer{font:9px PM,monospace;color:#777;letter-spacing:.06em;text-transform:uppercase;border-top:1px solid #ccc;padding-top:6px}
</style></head><body><div class="stripe"></div>
<header>${b.logo ? `<img src="${b.logo}">` : ''}<div class="t"><div class="co">${esc(b.company ?? 'Pink Moose Productions')}</div><h1>${esc(b.name)}</h1></div><div class="d">Top Sheet<br>${esc(date)}</div></header>
${boxes ? `<div class="boxes">${boxes}</div>` : ''}
<table><thead><tr><th>Acct</th><th>Description</th>${phs.map(p => `<th class="n">${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${rows}
<tr class="tot"><td></td><td>Grand total</td>${phs.map(p => `<td class="n">${money(val(p, '__root__'), b)}</td>`).join('')}</tr></tbody></table>
${tagRows ? `<h2>By tag</h2><table><thead><tr><th>Tag</th>${phs.map(p => `<th class="n">${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${tagRows}</tbody></table>` : ''}
${b.pdfNotes ? `<div class="notes">${esc(b.pdfNotes)}</div>` : ''}
<footer>${esc(b.company ?? 'Pink Moose Productions')} · ${esc(b.name)} · prepared ${esc(date)}</footer></body></html>`;
  }

  /* ---------- wiring ---------- */
  SlateExt.tabs.push({ key: 'money', label: 'Money', after: 'top', html: moneyHTML });
  SlateExt.tabs.push({ key: 'cost', label: 'Cost Report', after: 'money', html: costHTML });
  SlateExt.topCards.push(b => summaryHTML(b, true));
  SlateExt.topButtons = SlateExt.topButtons || []; SlateExt.topButtons.push(() => `<button data-act="mnpdf">PDF…</button>`);
  SlateExt.headerPills.push(b => {
    const li = leftInfo(totals(b)); if (!li) return '';
    return `<span class="pill mn ${li.cls}" data-tab="money" title="Left of your ${li.label}: ${money(li.left, b)} (${p1(li.lp)}). Click for details.">Left ${money(li.left, b).replace(/\.\d\d$/, '')} · ${p1(li.lp)}</span>`;
  });
  SlateExt.cardExtras.push(b => {
    try { const t = totals(b); const li = leftInfo(t); if (!li) return ''; return `<div class="mnl ${li.cls === 'over' ? 'over' : ''}">${money(li.left, b).replace(/\.\d\d$/, '')} LEFT OF ${li.label.toUpperCase()} · ${p1(li.lp)}</div>`; } catch (e) { return ''; }
  });
  SlateExt.actions.mnpdf = pdfDialog;
  SlateExt.actions.rebal = rebalModal;
  SlateExt.toolbar.push({ act: 'rebal', label: '⚖ Rebalance', title: 'Suggestions for moving money between account caps to even out the budget' });
  SlateExt.commands.push({ label: 'Even out the budget (rebalance suggestions)', run: rebalModal });
  SlateExt.actions.mnadd = () => { mutate(b => { M(b).sources.push({ id: uid(), date: today(), source: '', kind: 'Investor', status: 'received', amount: 0, note: '' }); }); const r = $$('[data-mny="src"][data-f="source"]'); const i = r[r.length - 1]; if (i) i.focus(); };
  SlateExt.actions.mnfill = () => {
    const st = $('#mn-start').value, n = Math.max(1, Math.min(120, parseInt($('#mn-ndays').value, 10) || 0)), skip = $('#mn-skipwk').checked;
    if (!st) return toast('Pick the first shoot day');
    const out = []; const d = new Date(st + 'T12:00:00');
    while (out.length < n) { const wd = d.getDay(); if (!skip || (wd !== 0 && wd !== 6)) out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    mutate(b => { const m = M(b); m.shoot.dates = out; m.shoot.skipWeekends = skip; });
    toast(n + ' shoot day' + (n === 1 ? '' : 's') + ' set');
  };
  SlateExt.actions.mnaddday = () => mutate(b => { const ds = M(b).shoot.dates; const last = ds.length ? new Date(ds[ds.length - 1] + 'T12:00:00') : new Date(); last.setDate(last.getDate() + 1); ds.push(last.toISOString().slice(0, 10)); });
  SlateExt.commands.push({ label: 'Money: set budget cap / money raised', run: () => { U.tab = 'money'; render(); } });
  SlateExt.commands.push({ label: 'Cost report by shoot day', run: () => { U.tab = 'cost'; render(); } });
  SlateExt.commands.push({ label: 'Top Sheet PDF…', run: pdfDialog });

  document.addEventListener('change', e => {
    const T = e.target; if (!cur()) return;
    if (T.id === 'mn-cap') { const v = T.value.trim(); mutate(b => { M(b).cap = v === '' ? '' : num(v); }); return; }
    if (T.dataset.mny === 'src') { const i = +T.dataset.i, f = T.dataset.f; mutate(b => { const s = M(b).sources[i]; if (!s) return; s[f] = f === 'amount' ? num(T.value) : T.value; }, { render: f !== 'note' && f !== 'source' && f !== 'date' }); return; }
    if (T.dataset.mny === 'day') { const i = +T.dataset.i; mutate(b => { const ds = M(b).shoot.dates; if (T.value) ds[i] = T.value; ds.sort(); }); }
  });
  document.addEventListener('click', e => {
    const d = e.target.closest('[data-mny-del]'); if (d) { mutate(b => { M(b).sources.splice(+d.dataset.mnyDel, 1); }); return; }
    const dd = e.target.closest('[data-mny-dday]'); if (dd) { mutate(b => { M(b).shoot.dates.splice(+dd.dataset.mnyDday, 1); }); return; }
    const ra = e.target.closest('[data-rb-apply]'); if (ra) { const k = ra.dataset.rbApply; applyMoves(k === 'all' ? lastMoves.slice() : [lastMoves[+k]].filter(Boolean)); const box = $('#rb-body'); if (box) box.innerHTML = rebalHTML(cur()); return; }
  });
  window.SlateMoney = { totals, leftInfo, pdfHTML, summaryHTML, rebalPlan, rebalModal };
})();
