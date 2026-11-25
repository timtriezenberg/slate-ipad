/* Slate extension: one-click export of the open budget to a Google-Sheets-ready .xlsx in your Google Drive folder */
(function () {
  const X = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  /* ---- minimal zip (stored) ---- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    for (const [name, text] of files) {
      const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dt, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nb, data);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dt, true); ch.setUint16(14, dd, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
      cen.push(new Uint8Array(ch.buffer), nb); off += 30 + nb.length + data.length;
    }
    const csize = cen.reduce((a, u) => a + u.length, 0);
    const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    const all = parts.concat(cen, [new Uint8Array(end.buffer)]); const out = new Uint8Array(all.reduce((a, u) => a + u.length, 0)); let p = 0; all.forEach(u => { out.set(u, p); p += u.length; }); return out;
  }

  /* ---- sheet xml. cell = {v, s} ; numbers become numeric cells ---- */
  // styles: 0 normal, 1 header, 2 money, 3 bold money, 4 bold, 5 title, 6 muted, 7 total money, 8 total label
  function sheetXml(rows, widths, freezeRow) {
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const sv = freezeRow ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((c, ci) => {
      if (c == null || c === '' || (c && c.v === '')) return '';
      const cell = (typeof c === 'object') ? c : { v: c, s: 0 }; const ref = colName(ci) + (ri + 1);
      if (typeof cell.v === 'number' && isFinite(cell.v)) return `<c r="${ref}" s="${cell.s || 0}"><v>${cell.v}</v></c>`;
      return `<c r="${ref}" s="${cell.s || 0}" t="inlineStr"><is><t xml:space="preserve">${X(cell.v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sv}<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;[Red]\\-&quot;$&quot;#,##0.00"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF777777"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B1D22"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1E7CF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF1B1D22"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  function buildXlsx(b) {
    const memo = calc(); const ph = editPhase(b); const gv = makeGv(b, ph.id);
    const phs = b.phases.filter(p => !p.hidden);
    const val = (p, id) => Math.round(((memo[p.id] && memo[p.id].get(id)) || 0) * 100) / 100;
    const now = new Date();
    const stamp = now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    // Budget sheet
    const H = ['Acct', 'Description', 'Notes', 'Qty', 'Unit', 'Rate', 'Tags'].concat(phs.map(p => p.name)).map(v => ({ v, s: 1 }));
    const rows = [[{ v: b.name, s: 5 }], [{ v: 'Exported from Slate Budget · ' + stamp + ' · snapshot, not live', s: 6 }], [], H];
    walk(b.rows, (r, p, d) => {
      const v = (r.values && r.values[ph.id]) || {}; const isL = r.type === 'line'; const isA = r.type === 'account' || r.type === 'subtotal';
      const ts = isA ? 4 : 0, ms = isA ? 3 : 2;
      const q = isL ? N(v.qty, gv) : null, rate = (isL || r.type === 'markup') && v.rate != null ? N(v.rate, gv) : null;
      rows.push([{ v: r.number || '', s: ts }, { v: '    '.repeat(d) + (r.name || ''), s: ts }, { v: r.notes || '', s: ts }, q ? { v: q, s: ts } : { v: '', s: ts }, { v: isL ? (v.unit || '') : '', s: ts }, rate != null && rate !== '' ? { v: +rate, s: r.type === 'markup' ? ts : ms } : { v: '', s: ts }, { v: (r.tags || []).join(', '), s: ts }]
        .concat(phs.map(p => ({ v: val(p, r.id), s: ms }))));
    });
    rows.push([{ v: '', s: 8 }, { v: 'GRAND TOTAL', s: 8 }, { v: '', s: 8 }, { v: '', s: 8 }, { v: '', s: 8 }, { v: '', s: 8 }, { v: '', s: 8 }].concat(phs.map(p => ({ v: val(p, '__root__'), s: 7 }))));
    const wB = [9, 38, 26, 7, 8, 12, 20].concat(phs.map(() => 16));
    // Top sheet
    const top = b.rows.filter(r => r.type !== 'subtotal');
    const T = [[{ v: b.name + ' · Top Sheet', s: 5 }], [{ v: 'Exported ' + stamp, s: 6 }], [], ['Acct', 'Account'].concat(phs.map(p => p.name)).map(v => ({ v, s: 1 }))];
    top.forEach(r => T.push([{ v: r.number || '', s: 0 }, { v: r.name || '', s: 0 }].concat(phs.map(p => ({ v: val(p, r.id), s: 2 })))));
    T.push([{ v: '', s: 8 }, { v: 'GRAND TOTAL', s: 8 }].concat(phs.map(p => ({ v: val(p, '__root__'), s: 7 }))));
    const wT = [9, 38].concat(phs.map(() => 16));
    // Transactions
    const byRow = {}; walk(b.rows, r => { byRow[r.id] = r; });
    const phName = id => (b.phases.find(p => p.id === id) || {}).name || '';
    const X2 = [['Date', 'Paid to', 'Where purchased', 'Description', 'Budget line', 'Phase', 'Price', 'Tax %', 'Total'].map(v => ({ v, s: 1 }))];
    (b.transactions || []).slice().sort((a, c) => String(a.date).localeCompare(String(c.date))).forEach(t => X2.push([{ v: t.date || '' }, { v: t.payee || '' }, { v: t.where || '' }, { v: t.desc || t.note || '' }, { v: byRow[t.rowId] ? rowLabel(byRow[t.rowId]) : '' }, { v: phName(t.phaseId) }, { v: Math.round((+t.amount || 0) * 100) / 100, s: 2 }, { v: (t.tax != null && t.tax !== '') ? +t.tax : '' }, { v: txTotal(t), s: 2 }]));
    const wX = [12, 22, 26, 34, 30, 14, 14, 9, 14];
    const sheets = [['Top Sheet', sheetXml(T, wT, 4)], ['Budget', sheetXml(rows, wB, 4)], ['Transactions', sheetXml(X2, wX, 1)]];
    const files = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${X(s[0])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', STYLES]
    ].concat(sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', s[1]]));
    return zip(files);
  }
  const fileBase = b => { const d = new Date(), p = n => String(n).padStart(2, '0'); return (b.name || 'Budget').replace(/[\\/:*?"<>|]+/g, '-').trim() + ' – ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

  async function sendToDrive(forceChoose) {
    const b = cur(); if (!b) return;
    let bytes; try { bytes = buildXlsx(b); } catch (e) { return toast('Could not build the spreadsheet: ' + e.message); }
    const name = fileBase(b);
    if (!NATIVE || !NATIVE.driveSave) { // browser mode: plain download
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const a = document.createElement('a'); a.href = url; a.download = name + '.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); return toast('Downloaded ' + name + '.xlsx. Upload it to Google Drive.');
    }
    const info = await NATIVE.driveInfo(); let base = forceChoose ? '' : (info.saved || info.found[0] || '');
    if (!base) return askFolder(info, b);
    const r = await NATIVE.driveSave({ base, name, bytes });
    if (!r.ok) return openModal(`<h2>Couldn’t save to Drive</h2><p class="neg">${esc(r.error)}</p><div class="acts"><button data-mclose>Close</button><button class="primary" data-act="drivechoose">Choose a different folder…</button></div>`);
    const fn = r.file.split(/[\\/]/).pop();
    openModal(`<h2>${r.synced === false ? 'Saved (not in Drive yet)' : 'Sent to Google Drive'}</h2>
      <p><b>${esc(fn)}</b><br><span class="muted">in the “Slate Budgets” folder of your Google Drive</span></p>
      ${r.synced === false ? `<p class="neg" style="font-size:13px"><b>Heads up:</b> this folder doesn’t look like it’s synced by Google Drive, so the file is saved on this computer but <b>won’t show up in Drive</b>. Install Google Drive for desktop and choose its <b>My Drive</b> folder (Command palette → “Choose my Google Drive folder…”).</p>` : ''}
      <p class="muted" style="font-size:12.5px">Google Drive for desktop uploads it in a moment. Your team finds it in Drive under <b>Slate Budgets</b> and opens it with Google Sheets. It’s a snapshot of the budget right now, so export again later for a newer copy. For a native Google Sheet (so people can edit it), open it in Sheets and choose <b>File › Save as Google Sheets</b>.</p>
      <div class="acts"><button data-act="drivereveal" data-file="${esc(r.file)}">Show file</button><button class="primary" data-mclose>Done</button></div>`);
  }
  function askFolder(info, b) {
    openModal(`<h2>Where is your Google Drive folder?</h2>
      <p class="muted" style="font-size:13px">Slate saves the export into your Google Drive folder on this computer, and Google Drive for desktop uploads it. I couldn’t find one automatically. If you haven’t installed <b>Google Drive for desktop</b> (drive.google.com/drive/download), install it and sign in, then try again. Otherwise choose your <b>My Drive</b> folder.</p>
      <div class="acts"><button data-mclose>Cancel</button><button class="primary" data-act="drivechoose">Choose My Drive folder…</button></div>`);
  }
  SlateExt.actions.drivechoose = async () => { const f = await NATIVE.driveChoose(); closeModal(); if (f) sendToDrive(); };
  SlateExt.actions.drivereveal = (el) => { const f = el && el.dataset && el.dataset.file; if (f) NATIVE.reveal(f); };
  SlateExt.actions.drive = () => sendToDrive();
  SlateExt.toolbar.push({ act: 'drive', label: 'Send to Google Drive', title: 'Save a copy of this budget to your Google Drive “Slate Budgets” folder' });
  SlateExt.commands.push({ label: 'Send this budget to Google Drive', run: () => sendToDrive() });
  SlateExt.commands.push({ label: 'Choose my Google Drive folder…', run: () => sendToDrive(true) });
  window.SlateDrive = { buildXlsx, zip, fileBase };
})();
