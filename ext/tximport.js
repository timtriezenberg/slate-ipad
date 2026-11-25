/* Slate v2.0 feature module: import transactions from a bank file, a pasted list, or screenshots,
   then auto-sort them into budget lines. Loaded after the main script (uses its globals).
   Public test surface: window.SlateTx */
(function () {
'use strict';

/* ===================================================================== text helpers */
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/['\u2019]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const pad2 = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const SlateTx = { now: () => new Date() };

/* ===================================================================== dates */
const MON = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const MON_RE = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const WD_RE = '(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\.?,?\\s+)?';
const DATE_RES = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, f: m => [+m[1], +m[2], +m[3]] },
  { re: /(?<![\d.\/])(\d{1,2})[\/](\d{1,2})[\/](\d{4}|\d{2})(?![\d\/])/, f: m => [yr2(m[3]), +m[1], +m[2]] },
  { re: /(?<![\d.\/-])(\d{1,2})-(\d{1,2})-(\d{4})(?![\d-])/, f: m => [+m[3], +m[1], +m[2]] },
  { re: /(?<![\d.\/])(\d{1,2})\/(\d{1,2})(?![\d\/.]\d)(?![\d])/, f: m => [null, +m[1], +m[2]] },
  { re: new RegExp('\\b' + WD_RE + MON_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i'), f: m => [m[3] ? +m[3] : null, MON.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]] },
  { re: new RegExp('\\b(\\d{1,2})\\s+' + MON_RE + '\\.?(?:,?\\s+(\\d{4}))?\\b', 'i'), f: m => [m[3] ? +m[3] : null, MON.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]] }
];
function yr2(s) { return s.length === 2 ? 2000 + +s : +s; }
function mkDate(y, m, d, now) {
  now = now || SlateTx.now();
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const explicit = y != null;
  if (!explicit) {
    y = now.getFullYear();
    const t = new Date(y, m - 1, d);
    if (t.getTime() > now.getTime() + 7 * 864e5) y -= 1;          // 'Dec 28' seen in early January means last year
  }
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;  // Feb 30 etc.
  return isoOf(dt);
}
/* find the first date in a line -> {iso, start, end} or null */
function findDate(line, now) {
  let best = null;
  for (const { re, f } of DATE_RES) {
    const m = re.exec(line); if (!m) continue;
    const [y, mo, d] = f(m); const iso = mkDate(y, mo, d, now); if (!iso) continue;
    const c = { iso, start: m.index, end: m.index + m[0].length };
    if (!best || c.start < best.start || (c.start === best.start && c.end > best.end)) best = c;
  }
  return best;
}
function parseDate(s, now) { s = String(s == null ? '' : s).trim(); if (!s) return ''; const f = findDate(s, now); return f ? f.iso : ''; }

/* ===================================================================== amounts */
const AMT = String.raw`[-+−–]?\s?\(?\s?[$S§]?\s?`;
const MONEY_RE = new RegExp(
  String.raw`(?<![\w.,])` + '(?:' +
    AMT + String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?` + '|' +        // 1,234.56
    AMT + String.raw`\d+\.\d{2}` + '|' +                             // 48.12
    String.raw`[-+−–]?\s?\(?\s?[$§S]\s?\d+(?:\.\d{1,2})?` +  // $48 / $4812 (dot lost)
  ')' + String.raw`\s?\)?\s?-?(?![\w.])`, 'g');
function ocrFix(s) {
  return String(s)
    .replace(/[|•·]/g, ' ')
    .replace(/(?<=\d)[Oo](?=[\d.,])|(?<=[.,])[Oo](?=\d)|(?<=\d)[Oo](?=\s|$)/g, '0')
    .replace(/(?<![A-Za-z0-9])S(?=\d)/g, '$')
    .replace(/§/g, '$')
    .replace(/[−–—]/g, '-');
}
/* parse ONE money string -> {n (signed as printed), neg, plus, warn} or null */
function parseAmountEx(str, opt) {
  let s = ocrFix(String(str == null ? '' : str)).trim(); if (!s) return null;
  const neg = /^[$\s]*[-(]/.test(s) || /-\s*$/.test(s);
  const plus = /^\+/.test(s);
  const hadCur = /\$/.test(s);
  s = s.replace(/[$+\-()\s]|USD/gi, '');
  if (!/^\d[\d,]*(\.\d+)?$/.test(s)) return null;
  const hadDot = s.includes('.'); const hadComma = s.includes(',');
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');           // 3,50 = 3.50 (European)
  s = s.replace(/,/g, '');
  let warn = '';
  if (opt && opt.fixDot && hadCur && !hadDot && !hadComma && s.length >= 3) { s = s.slice(0, -2) + '.' + s.slice(-2); warn = 'check amount'; }   // "-$4812" = dot lost by OCR
  const v = parseFloat(s); if (isNaN(v)) return null;
  return { n: neg ? -v : v, neg, plus, warn };
}
function parseAmount(str) { const a = parseAmountEx(str); return a ? a.n : null; }
/* CSV cells may be plain integers ("-48") */
function parseCell(str) {
  let s = String(str == null ? '' : str).trim(); if (!s) return null;
  const a = parseAmountEx(s); if (a) return a.n;
  const m = /^[-+(]?\s?[$]?\s?(\d+)\)?-?$/.exec(ocrFix(s)); if (!m) return null;
  const neg = /^-|^\(|-$/.test(ocrFix(s).trim()); return neg ? -(+m[1]) : +m[1];
}

/* ===================================================================== merchants */
const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const PREFIX_RE = /^(?:pos(?: purchase| debit)?|debit(?: card)?(?: purchase)?|purchase|checkcard|check card|recurring|visa|mastercard|ach|card purchase|sq\s*\*|tst\*|sp\s*\*|paypal\s*\*|pp\s*\*|apl\s*\*|amzn mktp us\*?|amazon\.com\*)\s*[:*\-]?\s*/i;
function tailWords(words, aggressive) {
  const w = words.slice();
  while (w.length > 1 && /^(#?\d{4,}|\d{3}-\d{3}-\d{4}|#\d+|no\.?\d*|\d{1,2}\/\d{1,2})$/.test(w[w.length - 1])) w.pop();
  if (w.length >= 3 && STATES.has(w[w.length - 1].toUpperCase())) {
    w.pop();
    if (aggressive && w.length >= 3) { w.pop(); w.pop(); }
  }
  return w;
}
function cleanMerchant(d) {
  let s = String(d == null ? '' : d).replace(/[|•·]/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && PREFIX_RE.test(s); i++) s = s.replace(PREFIX_RE, '');
  s = s.replace(/^amzn mktp us.*/i, 'Amazon').replace(/\s*#\s*\d+/g, ' ').trim();
  s = tailWords(s.split(' ').filter(Boolean), false).join(' ');
  s = s.replace(/[\s*\-:,]+$/, '').trim();
  if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.toLowerCase().replace(/(^|[\s\-\/(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return s || String(d == null ? '' : d).trim();
}
const STOP = new Set('the inc llc co corp store stores of and'.split(' '));
function merchantKey(d) {
  let s = String(d == null ? '' : d).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && PREFIX_RE.test(s); i++) s = s.replace(PREFIX_RE, '');
  s = s.replace(/\s*#\s*\d+/g, ' ');
  const words = tailWords(s.split(' ').filter(Boolean), true).map(norm).join(' ').split(' ')
    .filter(x => x && !/^\d+$/.test(x) && !STOP.has(x));
  if (!words.length) return norm(d).slice(0, 24);
  return (words[0].length >= 7 ? words[0] : words.slice(0, 2).join(' '));
}

/* ===================================================================== OCR words -> text lines */
function rowsFromWords(words) {
  const W = (words || []).filter(w => w && String(w.text).trim()).map(w => ({ t: String(w.text).trim(), x: +w.x, y: +w.y, w: +w.w, h: +w.h }));
  if (!W.length) return [];
  const hs = W.map(w => w.h).sort((a, b) => a - b); const mh = hs[Math.floor(hs.length / 2)] || 0.01;
  W.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const rows = [];
  for (const w of W) {
    const yc = w.y + w.h / 2; const last = rows[rows.length - 1];
    if (last && Math.abs(yc - last.yc) <= 0.6 * mh) { last.items.push(w); last.yc = last.items.reduce((s, i) => s + i.y + i.h / 2, 0) / last.items.length; }
    else rows.push({ yc, items: [w] });
  }
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let out = '';
    r.items.forEach((w, i) => {
      if (i) { const gap = w.x - (r.items[i - 1].x + r.items[i - 1].w); out += gap > 1.2 * mh ? '   ' : ' '; }
      out += w.t;
    });
    return out;
  });
}

/* ===================================================================== line parser (screenshots / pasted text) */
const INCOME_RE = /\b(deposit|payroll|direct dep\w*|refund|credit|payment received|reimburs\w*|transfer from|zelle from|interest paid|cash ?back|rebate|autopay|auto pay|online payment|payment thank you|thank you)\b/i;
const SKIP_RE = /\b(available|ledger|running|ending|beginning|current|pending)?\s*balance\b|\bavailable\b|^\s*(sub)?total\s*:?\s*[-+($S\d]|\bstatement\b|\bsee all\b|\bview all\b/i;
const HEAD_RE = /^(date|description|amount|transactions?|recent activity|activity|search|filter|all transactions|posted|pending|completed|details|merchant|category|credit card|checking|savings|account|today|yesterday)\b[\s:]*$/i;
function dayWord(line, now) {
  const m = /^\s*(today|yesterday)\s*$/i.exec(line); if (!m) return null;
  const d = new Date((now || SlateTx.now()).getTime()); if (/yesterday/i.test(m[1])) d.setDate(d.getDate() - 1); return isoOf(d);
}
function parseLines(lines, opt) {
  opt = opt || {}; const now = opt.now || SlateTx.now(); const src = opt.src || 0;
  const out = []; let cur = null, lastUndated = null;
  for (let raw of lines) {
    raw = String(raw == null ? '' : raw);
    let line = ocrFix(raw).replace(/\s+/g, ' ').trim(); if (!line) continue;
    const dw = dayWord(line, now); if (dw) { cur = dw; continue; }
    const money = [...line.matchAll(MONEY_RE)].map(m => ({ s: m[0], i: m.index }));
    const dt = findDate(line, now);
    if (!money.length) {                                           // header / sub-line
      if (dt) {
        const rest = (line.slice(0, dt.start) + ' ' + line.slice(dt.end)).replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|pending|posted|card|visa|mastercard|\d{4}|[\W_]+/gi, ' ').trim();
        if (!rest || rest.length < 3 || /^[a-z]{0,3}$/i.test(rest)) { cur = dt.iso; if (lastUndated) { lastUndated.date = dt.iso; lastUndated = null; } }
      }
      continue;
    }
    if (SKIP_RE.test(line) || (HEAD_RE.test(line))) continue;
    let pick = money[money.length - 1];
    if (money.length >= 2 && dt && dt.start < money[0].i) pick = money[0];      // "11/04  Chevron  -48.12   1,201.00 (balance)"
    const am = parseAmountEx(pick.s, { fixDot: true }); if (!am) continue;
    let text = line; money.forEach(m => { text = text.replace(m.s, ' '); });
    if (dt) { const dd = findDate(text, now); if (dd) text = text.slice(0, dd.start) + ' ' + text.slice(dd.end); }
    text = text.replace(/[|>›•·]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-:,.*]+|[\s\-:,.*]+$/g, '').trim();
    if (!/[A-Za-z]{2}/.test(text)) continue;
    const date = dt ? dt.iso : (cur || '');
    const row = { date, desc: text, value: Math.abs(am.n), neg: am.neg, plus: am.plus, incomeWord: INCOME_RE.test(text), warn: am.warn || '', src, raw: raw.trim(), inferred: !dt };
    out.push(row); lastUndated = dt ? null : row;
    if (dt) cur = dt.iso;
  }
  const anyNeg = out.some(r => r.neg);
  const today = isoOf(now);
  return out.map(r => {
    const income = r.plus || r.incomeWord || (anyNeg && !r.neg);
    const o = { date: r.date || today, desc: r.desc, payee: cleanMerchant(r.desc), amount: r2(income ? -r.value : r.value), income, src: r.src, raw: r.raw, warn: r.warn };
    if (!r.date) o.warn = (o.warn ? o.warn + ', ' : '') + 'no date found';
    return o;
  });
}

/* ===================================================================== CSV */
function detectDelim(text) {
  const head = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 8).join('\n').replace(/"[^"]*"/g, '');
  const c = d => (head.match(new RegExp(d === '\t' ? '\\t' : '\\' + d, 'g')) || []).length;
  const best = [[',', c(',')], ['\t', c('\t')], [';', c(';')]].sort((a, b) => b[1] - a[1])[0];
  return best[1] ? best[0] : ',';
}
function splitCSV(text, delim) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
function pickCol(heads, tests) {
  for (const t of tests) { const i = heads.findIndex(h => t.test(h)); if (i >= 0) return i; }
  return -1;
}
function looksLikeCSV(text) {
  const first = String(text).split(/\r?\n/).find(l => l.trim()) || '';
  const h = first.toLowerCase();
  return /date|posted/.test(h) && /amount|debit|credit|description|payee|merchant|gross|memo/.test(h) && /[,\t;]/.test(first);
}
function parseCSV(text, opt) {
  opt = opt || {}; const now = opt.now || SlateTx.now();
  text = String(text || '').replace(/^﻿/, '');
  const delim = opt.delim || detectDelim(text);
  const all = splitCSV(text, delim); const info = { delim, headerFound: false, spendNegative: false, skipped: 0 };
  if (all.length < 1) return { rows: [], info };
  let hi = -1;
  for (let i = 0; i < Math.min(all.length, 20); i++) {
    const h = all[i].map(x => norm(x));
    if (h.some(x => /date|posted/.test(x)) && h.some(x => /^(amount|amt|gross|net|debit|credit|withdrawals?|deposits?|description|payee|merchant|name|memo|details|transaction amount|value)/.test(x) || /amount|debit|credit|description|payee/.test(x))) { hi = i; break; }
  }
  let cd, cDesc, cMer, cAmt, cDeb, cCred, cStat, cType = -1, body;
  if (hi >= 0) {
    info.headerFound = true; const h = all[hi].map(x => norm(x)); body = all.slice(hi + 1);
    cd = pickCol(h, [/^(transaction|trans|purchase) date/, /^date$/, /^date/, /posted|posting|post date|settle/, /date/]);
    cDesc = pickCol(h, [/^description$/, /^(payee|merchant name|vendor|name)$/, /desc|details|narrative|memo|note|merchant/]);
    cMer = pickCol(h, [/^(merchant|merchant name|payee|name)$/]); if (cMer === cDesc) cMer = -1;
    cDeb = pickCol(h, [/debit|withdrawal|paid out|money out/]);
    cCred = pickCol(h, [/credit|deposit|paid in|money in/]); if (cCred === cDeb) cCred = -1;
    cAmt = pickCol(h, [/^amount$/, /^(amount|amt|transaction amount|value)\b/, /^gross$/, /^net$/, /amount/]);
    if (cAmt >= 0 && /balance/.test(h[cAmt])) cAmt = -1;
    cStat = pickCol(h, [/status/]); cType = pickCol(h, [/^type$/, /transaction type/]);
    if (cAmt >= 0 && (cDeb >= 0 || cCred >= 0) && !/^amount$/.test(h[cAmt])) cAmt = -1;
  } else {                                                          // headerless export: guess columns from the data
    body = all; const n = Math.max(...all.slice(0, 10).map(r => r.length)); const sample = all.slice(0, 15);
    const rate = (j, f) => sample.filter(r => r[j] != null && f(r[j])).length / sample.length;
    cd = -1; for (let j = 0; j < n; j++) if (rate(j, v => !!parseDate(v, now)) > 0.6) { cd = j; break; }
    cAmt = -1; for (let j = 0; j < n; j++) if (j !== cd && rate(j, v => parseAmountEx(v) && /[.]\d\d/.test(v)) > 0.6) { cAmt = j; break; }
    cDesc = -1; let bestLen = 0; for (let j = 0; j < n; j++) { if (j === cd || j === cAmt) continue; const L = sample.reduce((s, r) => s + String(r[j] || '').length, 0) * (rate(j, v => /[A-Za-z]{3}/.test(v)) > 0.6 ? 1 : 0); if (L > bestLen) { bestLen = L; cDesc = j; } }
    cMer = cDeb = cCred = cStat = -1;
  }
  if (cd < 0 || (cAmt < 0 && cDeb < 0 && cCred < 0)) { info.error = 'I could not find the date and amount columns in that file.'; return { rows: [], info }; }
  const rows = [];
  for (const r of body) {
    const date = parseDate(r[cd], now); if (!date) { info.skipped++; continue; }
    if (cStat >= 0 && /denied|fail|cancel|declin|revers|void/i.test(r[cStat] || '')) { info.skipped++; continue; }
    const desc = String(r[cDesc] != null && cDesc >= 0 ? r[cDesc] : (cMer >= 0 ? r[cMer] : '')).replace(/\s+/g, ' ').trim() || (cMer >= 0 ? String(r[cMer] || '').trim() : '');
    let signed = null, direct = null;
    if (cDeb >= 0 || cCred >= 0) {
      const dv = cDeb >= 0 ? parseCell(r[cDeb]) : null, cv = cCred >= 0 ? parseCell(r[cCred]) : null;
      if (dv) direct = Math.abs(dv); else if (cv) direct = -Math.abs(cv);
      if (cAmt >= 0 && direct == null) signed = parseCell(r[cAmt]);
    } else signed = parseCell(r[cAmt]);
    if (direct == null && (signed == null || signed === 0)) { info.skipped++; continue; }
    if (!desc) { info.skipped++; continue; }
    rows.push({ date, desc, hint: cType >= 0 ? String(r[cType] || '') : '', payee: cMer >= 0 && r[cMer] ? String(r[cMer]).trim() : cleanMerchant(desc), signed, direct, src: opt.src || 0, raw: r.join(delim) });
  }
  const sg = rows.filter(x => x.direct == null);
  const isInc = x => INCOME_RE.test(x.desc + ' ' + x.hint);
  const spendy = sg.filter(x => !isInc(x)), incomey = sg.filter(isInc);
  const neg = spendy.filter(x => x.signed < 0).length, pos = spendy.filter(x => x.signed > 0).length;
  const ineg = incomey.filter(x => x.signed < 0).length, ipos = incomey.filter(x => x.signed > 0).length;
  info.spendNegative = opt.spendNegative != null ? !!opt.spendNegative : (neg !== pos ? neg > pos : ipos > ineg);
  applySign(rows, info.spendNegative);
  return { rows, info };
}
function applySign(rows, spendNegative) {
  rows.forEach(r => { r.amount = r2(r.direct != null ? r.direct : (spendNegative ? -r.signed : r.signed)); r.income = r.amount < 0; });
}

/* ===================================================================== categorizer */
const STOPWORDS = new Set('the and for with from this that store shop llc inc corp payment purchase card debit credit pos online'.split(' '));
function budgetRows(b) {
  const out = [];
  (function go(rows, trail) { (rows || []).forEach(r => { if (r.type === 'line' || r.type === 'account') out.push({ row: r, name: norm(r.name), type: r.type, trail }); if (r.children && r.children.length) go(r.children, trail.concat(norm(r.name))); }); })(b.rows, []);
  return out;
}
const G = (kw, ...rows) => ({ kw: new RegExp(kw, 'i'), rows });
const LABOR = /stylist|artist|operator|assistant|manager|supervisor|mixer|designer|director|producer|editor\b|colorist|gaffer|grip\b|writer|cast|coordinator|captain|driver|\bdp\b|photography|\bac\b|\bpa\b|\bdit\b/;
const GROUPS = [
  G('parking|parkwhiz|spothero|toll|fastrak', /parking/, /transport/, /vehicle|mileage|gas/),
  G('\\b(gas|fuel|shell|chevron|arco|76|mobil|exxon|texaco|valero|costco gas)\\b', /gas|fuel|mileage/, /transport/, /vehicle|car|parking/),
  G('\\b(uber|lyft|taxi|u ?haul|enterprise|hertz|avis|zipcar|turo|rental car|budget rent)\\b', /transport|ride|vehicle|truck/, /mileage|gas|fuel/, /parking/),
  G('permit|film ?la|filmla', /permit/, /location/),
  G('airbnb|vrbo|hotel|motel|marriott|hilton|hyatt|holiday inn|best western|\\binn\\b|lodging', /lodging|hotel|housing/, /travel/),
  G('peerspace|giggster|location', /location fee|location/, /permit/),
  G('doordash|grubhub|ubereats|uber eats|postmates|restaurant|cafe|coffee|starbucks|dunkin|mcdonald|burger|pizza|taco|subway|chipotle|panera|bakery|deli|sushi|grill|diner|donut|bagel|bbq|kfc|popeyes|wendy|in n out|jack in the box|panda express|chick fil', /meal/, /cater/, /craft|food/),
  G('trader joe|whole foods|ralphs|vons|costco|smart and final|grocery|sprouts|safeway|albertsons|food 4 less|craft|catering|water|snack', /craft/, /cater/, /meal|food/),
  G('home depot|lowe|harbor freight|hardware|michaels|party city|ikea|goodwill|thrift|salvation army|hobby lobby|joann|ace hardware|dollar tree|homegoods|home goods|prop|set dec', /prop/, /set dress|dressing/, /art dep|art/, /construct|set/, /expendable/, /misc/),
  G('sandisk|memory|\\bssd\\b|hard drive|samsung t7|seagate|\\bwd\\b|media|\\bcards?\\b', /media|cards|stock/, /camera/, /equipment/),
  G('b and h|adorama|lensrentals|lens rentals|sharegrid|camera|\\blens\\b|rental house|filmtools|cinegear|panavision|keslow|red digital', /camera/, /equipment/, /grip|electric/),
  G('grip|lighting|cinelease|gaffer|sunbelt|lite', /grip|electric/, /expendable/, /equipment/),
  G('insurance|hiscox|tangent|legal|attorney|lawyer|law office', /insurance/, /legal/),
  G('staples|office depot|fedex|ups store|\\bups\\b|usps|printing|kinko|vistaprint|postal|shipping|dhl', /production office|office/, /shipping|postage/, /misc/),
  G('wardrobe|costume|nordstrom|target|ross|tj ?maxx|marshalls|burlington|zara|old navy|uniqlo|macys|kohls|dry clean|h and m', /wardrobe|costume/),
  G('sephora|ulta|makeup|beauty supply|sally beauty|cosmetics', /makeup|hair/, /beauty/),
  G('epidemic|artlist|musicbed|soundstripe|envato|premiumbeat|shutterstock|licens|music', /music|licens/, /post/),
  G('adobe|frame io|dropbox|vimeo|splice', /software|editorial|post/, /deliverable/),
  G('filmfreeway|festival|withoutabox|eventbrite', /festival/, /marketing/),
  G('amazon|amzn|walmart|target|ebay|etsy|aliexpress', /expendable|supplies/, /misc/, /prop/, /set dress/)
];
/* -> rowId or '' . learned rules first, then the row's own name, then keyword groups, then word overlap */
function categorize(b, desc) {
  if (!b) return '';
  const d = norm(desc); if (!d) return '';
  const rows = budgetRows(b); const exist = id => rows.some(x => x.row.id === id);
  // 1. learned rules (longest match wins)
  let best = null;
  (b.rules || []).forEach(r => { const m = norm(r.match); if (m && exist(r.rowId) && (' ' + d + ' ').includes(' ' + m + ' ') && (!best || m.length > norm(best.match).length)) best = r; });
  if (best) return best.rowId;
  // 2. the budget line's own name appears in the description ("craft services deposit")
  const GENERIC = new Set(['other', 'misc', 'miscellaneous', 'expenses', 'labor', 'supplies', 'total', 'fees', 'rental', 'rentals']);
  let hit = null;
  rows.forEach(x => { if (x.name.length >= 5 && !GENERIC.has(x.name) && (' ' + d + ' ').includes(' ' + x.name + ' ') && (!hit || x.name.length > hit.name.length || (x.name.length === hit.name.length && x.type === 'line'))) hit = x; });
  if (hit) return hit.row.id;
  // 3. keyword groups -> rows by name (lines before accounts)
  for (const g of GROUPS) {
    if (!g.kw.test(d)) continue;
    for (const re of g.rows) { const ls = rows.filter(x => x.type === 'line' && re.test(x.name)); const l = ls.find(x => !LABOR.test(x.name)) || ls[0]; if (l) return l.row.id; }
    for (const re of g.rows) { const a = rows.find(x => x.type === 'account' && re.test(x.name)); if (a) return a.row.id; }
  }
  // 4. word overlap
  const toks = d.split(' ').filter(t => t.length >= 4 && !STOPWORDS.has(t));
  let bs = 0, bt = null;
  rows.forEach(x => {
    const nt = x.name.split(' ').filter(t => t.length >= 4);
    let sc = 0; toks.forEach(t => nt.forEach(n => { if (n === t || (t.length >= 5 && n.length >= 5 && n.slice(0, 5) === t.slice(0, 5))) sc++; }));
    if (sc > bs || (sc === bs && sc > 0 && x.type === 'line' && bt && bt.type === 'account')) { bs = sc; bt = x; }
  });
  return bt && bs > 0 ? bt.row.id : '';
}

/* ===================================================================== duplicates */
const similar = (a, b) => { const x = merchantKey(a), y = merchantKey(b); return !x || !y || x === y || x.includes(y) || y.includes(x); };
function markDupes(b, rows) {
  const ex = (b.transactions || []);
  rows.forEach((r, i) => {
    r.dup = false;
    if (ex.some(t => t.date === r.date && Math.abs((+t.amount || 0) - r.amount) < 0.005 && similar(t.payee || t.desc || '', r.desc))) r.dup = true;
    if (!r.dup) for (let j = 0; j < i; j++) { const o = rows[j]; if (o.src !== r.src && o.date === r.date && Math.abs(o.amount - r.amount) < 0.005 && similar(o.desc, r.desc)) { r.dup = true; break; } }
  });
}

SlateTx.rowsFromWords = rowsFromWords; SlateTx.parseLines = parseLines; SlateTx.parseCSV = parseCSV; SlateTx.categorize = categorize;
SlateTx.cleanMerchant = cleanMerchant; SlateTx.merchantKey = merchantKey; SlateTx.parseDate = parseDate; SlateTx.parseAmount = parseAmount;
SlateTx.parseAmountEx = parseAmountEx; SlateTx.findDate = findDate; SlateTx.looksLikeCSV = looksLikeCSV; SlateTx.markDupes = markDupes; SlateTx.applySign = applySign;
window.SlateTx = SlateTx;

/* ===================================================================== UI */
const IM = { mode: 'shot', rows: [], raw: [], csvRows: null, spendNeg: false, busy: '', msg: '', nSrc: 0, pasted: '' };
const ocrFn = () => (typeof NATIVE !== 'undefined' && NATIVE && NATIVE.ocr) ? ((a, m) => NATIVE.ocr(a, m)) : (window.__slateOcr || null);
const actPhase = b => b.phases.find(p => p.type === 'actual');
const IMG_EXT = /\.(png|jpe?g|gif|bmp|webp|tiff?|heic)$/i;

function openImportTx() {
  if (!cur()) return toast('Open a budget first');
  if (U.tab !== 'tx') { U.tab = 'tx'; render(); }
  Object.assign(IM, { rows: [], raw: [], csvRows: null, busy: '', msg: '', nSrc: 0, pasted: '' });
  U.modal = 'importtx'; draw();
}
function setRows(rows) {
  const b = cur();
  rows.forEach(r => { r.rowId = categorize(b, r.desc); r.sug = r.rowId; r.touched = false; });
  markDupes(b, rows);
  rows.forEach(r => { r.inc = !r.income && !r.dup; });
  return rows;
}
function totals() { const inc = IM.rows.filter(r => r.inc); return { n: inc.length, sum: inc.reduce((s, r) => s + (+r.amount || 0), 0) }; }

function draw() {
  const b = cur(); if (!b) return;
  const sc = $('#modalback .im-scroll'); const top = sc ? sc.scrollTop : 0;
  const hasAct = !!actPhase(b); const eng = !!ocrFn(); const T = totals();
  const tab = (k, l) => `<button class="${IM.mode === k ? 'primary' : ''}" data-im-mode="${k}">${l}</button>`;
  let src = '';
  if (IM.mode === 'shot') src = `<div class="im-drop" style="border:2px dashed var(--line2);border-radius:var(--r,8px);padding:16px;text-align:center">
      ${eng ? '' : '<div class="neg" style="margin-bottom:8px">Reading screenshots works in the Slate desktop app only. In a browser, use a bank file or paste the text instead.</div>'}
      <button class="primary" data-im-pick="img" ${eng ? '' : 'disabled'}>Choose screenshots…</button>
      <div class="muted" style="margin-top:8px">or drag images here, or press <kbd>${MOD}V</kbd> to paste a screenshot from your clipboard</div>
      <input type="file" id="im-file-img" accept="image/*" multiple style="display:none"></div>`;
  else if (IM.mode === 'csv') src = `<div class="im-drop" style="border:2px dashed var(--line2);border-radius:var(--r,8px);padding:16px;text-align:center">
      <button class="primary" data-im-pick="csv">Choose bank file…</button>
      <div class="muted" style="margin-top:8px">CSV or TSV export from your bank, card or PayPal. You can also drag the file here.</div>
      <input type="file" id="im-file-csv" accept=".csv,.tsv,.txt,text/csv,text/plain" multiple style="display:none"></div>
      ${IM.csvRows ? `<label style="display:flex;gap:7px;align-items:center;margin-top:8px"><input type="checkbox" id="im-flip" ${IM.spendNeg ? 'checked' : ''}> In this file, spending shows as <b>negative</b> numbers <span class="muted">(Slate guessed; flip it if the amounts look backwards)</span></label>` : ''}`;
  else src = `<textarea id="im-text" rows="7" style="width:100%" placeholder="Paste transactions copied from your bank's website or app…">${esc(IM.pasted)}</textarea>
      <div style="margin-top:6px"><button class="primary" data-im-read="1">Read pasted text</button></div>`;
  const opts = r => rowOptions(b, r.rowId);
  const table = IM.rows.length ? `<div class="im-scroll" style="max-height:38vh;overflow:auto;border:1px solid var(--line);border-radius:var(--r,8px);margin-top:10px">
    <table class="simple"><thead><tr><th style="width:30px"></th><th style="width:130px">Date</th><th>Description</th><th style="width:230px">Budget line</th><th class="num" style="width:110px">Amount</th></tr></thead><tbody>
    ${IM.rows.map((r, i) => `<tr data-im-row="${i}" style="${r.inc ? '' : 'opacity:.55'}"><td><input type="checkbox" data-im-f="inc" data-im-i="${i}" ${r.inc ? 'checked' : ''}></td>
      <td><input type="date" data-im-f="date" data-im-i="${i}" value="${esc(r.date)}"></td>
      <td><input data-im-f="desc" data-im-i="${i}" value="${esc(r.desc)}">${r.dup ? ' <span class="pill">duplicate</span>' : ''}${r.income ? ' <span class="pill">money in</span>' : ''}${r.warn ? ` <span class="pill neg">${esc(r.warn)}</span>` : ''}</td>
      <td><select data-im-f="rowId" data-im-i="${i}">${opts(r)}</select></td>
      <td><input type="number" step="0.01" style="text-align:right" data-im-f="amount" data-im-i="${i}" value="${r.amount}"></td></tr>`).join('')}
    </tbody></table></div>` : '';
  const auto = IM.rows.filter(r => r.rowId).length;
  openModal(`<h2>Import transactions</h2>
    <div class="card" style="padding:10px 14px;margin-bottom:10px"><div class="muted" style="font-size:12px"><b>About bank connections.</b> Linking a bank for live feeds needs a paid bank-data service (the Plaid kind) plus a server in the middle. Slate is a private, offline desktop app and deliberately has neither, so your bank login never touches it. Use a CSV export, pasted text, or a screenshot instead. Screenshot reading is best-effort: <b>check every row before adding</b>.</div></div>
    <div style="display:flex;gap:6px;margin-bottom:10px">${tab('shot', 'Screenshots')}${tab('csv', 'Bank file (CSV)')}${tab('text', 'Paste text')}</div>
    ${src}
    ${IM.busy ? `<div class="pill" style="margin-top:10px">${esc(IM.busy)}</div>` : ''}
    ${IM.msg ? `<div class="${/^(Could|No |Nothing|That|Reading|I )/.test(IM.msg) ? 'neg' : 'muted'}" style="margin-top:10px">${esc(IM.msg)}</div>` : ''}
    ${!hasAct ? '<div class="neg" style="margin-top:10px">This budget has no <b>Actual</b> phase, so there is nowhere to add transactions. Add one in Setup → Phases first.</div>' : ''}
    ${table}
    ${IM.rows.length ? `<div style="display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap"><button data-im-all="1">Select all</button><button data-im-all="0">Select none</button>
      <span class="muted" id="im-sum">${T.n} selected · ${money(T.sum, b)} · auto-sorted ${auto} of ${IM.rows.length}</span></div>` : ''}
    ${IM.raw.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">What Slate read (for troubleshooting)</summary><pre style="white-space:pre-wrap;max-height:160px;overflow:auto;margin:6px 0 0;font-size:11px">${esc(IM.raw.join('\n'))}</pre></details>` : ''}
    <div class="acts"><button data-mclose>Cancel</button><button class="primary" id="im-go" ${T.n && hasAct ? '' : 'disabled'}>Add ${T.n} transaction${T.n === 1 ? '' : 's'}</button></div>`, 'im-modal');
  const m = $('#modalback .modal'); if (m) m.style.width = 'min(1040px,96vw)';
  const sc2 = $('#modalback .im-scroll'); if (sc2) sc2.scrollTop = top;
  bind();
}

function bind() {
  const root = $('#modalback'); if (!root) return;
  root.addEventListener('click', e => {
    const T = e.target;
    const md = T.closest('[data-im-mode]'); if (md) { const ta = $('#im-text'); if (ta) IM.pasted = ta.value; IM.mode = md.dataset.imMode; IM.msg = ''; draw(); return; }
    const pk = T.closest('[data-im-pick]'); if (pk) { const f = $('#im-file-' + pk.dataset.imPick); if (f) f.click(); return; }
    const al = T.closest('[data-im-all]'); if (al) { IM.rows.forEach(r => { r.inc = al.dataset.imAll === '1'; }); draw(); return; }
    if (T.closest('[data-im-read]')) { IM.pasted = ($('#im-text') || {}).value || ''; handleText(IM.pasted, 'pasted text'); return; }
    if (T.closest('#im-go')) confirmAdd();
  });
  root.addEventListener('change', e => {
    const T = e.target;
    if (T.id === 'im-file-img' || T.id === 'im-file-csv') { handleFiles([...T.files]); T.value = ''; return; }
    if (T.id === 'im-flip') { IM.spendNeg = T.checked; if (IM.csvRows) { applySign(IM.csvRows, IM.spendNeg); rebuildCsv(); } return; }
    const f = T.dataset.imF; if (!f) return; const r = IM.rows[+T.dataset.imI]; if (!r) return;
    if (f === 'inc') r.inc = T.checked;
    else if (f === 'amount') { r.amount = r2(parseFloat(T.value) || 0); r.income = r.amount < 0; }
    else if (f === 'rowId') { r.rowId = T.value; r.touched = true; }
    else r[f] = T.value;
    if (f === 'desc' && !r.touched) { const c = categorize(cur(), r.desc); r.rowId = c; r.sug = c; draw(); return; }
    const tr = T.closest('tr'); if (tr) tr.style.opacity = r.inc ? '' : '.55';
    updateSum();
  });
  root.addEventListener('dragover', e => { e.preventDefault(); });
  root.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]); });
}
function updateSum() {
  const b = cur(); const T = totals(); const s = $('#im-sum'); const g = $('#im-go');
  if (s) s.textContent = `${T.n} selected · ${money(T.sum, b)} · auto-sorted ${IM.rows.filter(r => r.rowId).length} of ${IM.rows.length}`;
  if (g) { g.textContent = `Add ${T.n} transaction${T.n === 1 ? '' : 's'}`; g.disabled = !(T.n && actPhase(b)); }
}
function rebuildCsv() { const keep = IM.rows.filter(r => r.src !== 'csv'); IM.rows = keep.concat(setRows(IM.csvRows.map(r => Object.assign({}, r)))); draw(); }

async function handleFiles(files) {
  for (const f of files) {
    try {
      if (f.type.startsWith('image/') || IMG_EXT.test(f.name)) await ocrFile(f);
      else handleText(await f.text(), f.name, true);
    } catch (e) { IM.msg = 'Could not read ' + f.name + ': ' + (e.message || e); }
  }
  IM.busy = ''; draw();
}
async function ocrFile(f) {
  const fn = ocrFn(); if (!fn) { IM.msg = 'Reading screenshots works in the Slate desktop app only.'; return; }
  IM.busy = 'Reading ' + (f.name || 'screenshot') + '…'; draw();
  const bytes = new Uint8Array(await f.arrayBuffer());
  const res = await fn(bytes, f.type || 'image/png');
  if (!res || !res.ok) { IM.msg = 'Could not read that image: ' + ((res && res.error) || 'unknown error'); IM.raw.push('--- ' + (f.name || 'screenshot') + ': failed ---'); return; }
  const lines = rowsFromWords(res.words); const src = IM.nSrc++;
  IM.raw.push('--- ' + (f.name || 'screenshot') + ' (' + res.engine + ') ---', ...lines);
  const rows = parseLines(lines, { src });
  IM.msg = rows.length ? '' : 'No transactions found in that image. Open “What Slate read” below to see what the text reader saw.';
  IM.rows = IM.rows.concat(setRows(rows)); markDupes(cur(), IM.rows); IM.rows.forEach(r => { if (r.dup && !r.touched) r.inc = false; });
}
function handleText(text, name, fromFile) {
  const b = cur(); text = String(text || '');
  if (!text.trim()) { IM.msg = 'Nothing to read yet.'; draw(); return; }
  if (looksLikeCSV(text)) {
    const res = parseCSV(text, { src: 'csv' });
    if (res.info.error) { IM.msg = res.info.error; IM.raw.push('--- ' + name + ': ' + res.info.error + ' ---'); if (!fromFile) draw(); return; }
    IM.csvRows = res.rows; IM.spendNeg = res.info.spendNegative; IM.mode = fromFile ? 'csv' : IM.mode;
    IM.raw.push('--- ' + name + ' (' + res.rows.length + ' rows, ' + res.info.skipped + ' skipped) ---', ...text.split(/\r?\n/).slice(0, 12));
    const rows = setRows(res.rows.map(r => Object.assign({}, r)));
    IM.rows = IM.rows.filter(r => r.src !== 'csv').concat(rows);
    IM.msg = rows.length ? rows.length + ' rows read.' : 'No transactions found in that file.';
  } else {
    const src = IM.nSrc++; const lines = text.split(/\r?\n/);
    IM.raw.push('--- ' + name + ' ---', ...lines.slice(0, 40));
    const rows = parseLines(lines, { src });
    IM.msg = rows.length ? rows.length + ' rows read.' : 'No transactions found in that text.';
    IM.rows = IM.rows.concat(setRows(rows)); markDupes(b, IM.rows);
  }
  if (!fromFile) draw();
}

function confirmAdd() {
  const b = cur(); const ap = actPhase(b);
  if (!ap) return toast('This budget has no Actual phase. Add one in Setup → Phases.');
  const picks = IM.rows.filter(r => r.inc && r.date && isFinite(+r.amount) && +r.amount !== 0);
  if (!picks.length) return;
  mutate(bb => {
    bb.transactions = bb.transactions || []; bb.rules = bb.rules || [];
    picks.forEach(r => {
      bb.transactions.push({ id: uid(), date: r.date, payee: r.payee || cleanMerchant(r.desc), desc: r.desc, rowId: r.rowId || '', phaseId: ap.id, amount: r2(r.amount), source: 'import' });
      if (r.rowId && (r.touched || r.rowId !== r.sug)) {
        const key = merchantKey(r.desc); if (!key) return;
        const ex = bb.rules.find(x => norm(x.match) === key);
        if (ex) ex.rowId = r.rowId; else bb.rules.push({ match: key, rowId: r.rowId });
      }
    });
  });
  closeModal(); U.tab = 'tx'; render();
  toast('Added ' + picks.length + ' transaction' + (picks.length === 1 ? '' : 's') + ' to ' + ap.name + ' (undo with ' + MOD + 'Z)');
}

/* paste a screenshot (or text) anywhere while the dialog is open */
document.addEventListener('paste', e => {
  if (U.modal !== 'importtx') return;
  const cd = e.clipboardData; if (!cd) return;
  const imgs = [...(cd.items || [])].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if (imgs.length) { e.preventDefault(); IM.mode = 'shot'; handleFiles(imgs.map((f, i) => { try { Object.defineProperty(f, 'name', { value: f.name && f.name !== 'image.png' ? f.name : 'pasted screenshot ' + (i + 1) }); } catch (x) { /* keep */ } return f; })); return; }
  const t = e.target; if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
  const text = cd.getData('text'); if (text && text.trim()) { e.preventDefault(); IM.mode = 'text'; IM.pasted = text; handleText(text, 'pasted text'); }
});

/* ===================================================================== registration + Setup card */
SlateExt.txToolbar.push({ act: 'importtx', label: 'Import from bank / screenshot…' });
SlateExt.actions.importtx = openImportTx;
SlateExt.commands.push({ label: 'Import transactions from bank / screenshot…', run: openImportTx });

SlateExt.setupCards.push(b => {
  const rules = b.rules || []; const opt = id => rowOptions(b, id);
  return `<div class="card"><h3>Auto-sort rules</h3><div class="muted" style="margin-bottom:8px">When you import transactions and put a merchant on a budget line, Slate remembers it and files that merchant the same way next time. Edit or remove what it learned here.</div>
  <table class="simple"><thead><tr><th style="width:220px">Merchant contains</th><th>Budget line</th><th style="width:40px"></th></tr></thead><tbody>
  ${rules.map((r, i) => `<tr><td><input data-rule-f="match" data-rule-i="${i}" value="${esc(r.match)}"></td><td><select data-rule-f="rowId" data-rule-i="${i}">${opt(r.rowId)}</select></td><td><button class="ghost danger" data-rule-del="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing learned yet.</td></tr>'}</tbody></table></div>`;
});
document.addEventListener('click', e => { const d = e.target.closest('[data-rule-del]'); if (d) mutate(b => { (b.rules || []).splice(+d.dataset.ruleDel, 1); }); });
document.addEventListener('change', e => {
  const T = e.target; if (T.dataset.ruleF === undefined) return;
  mutate(b => { const r = (b.rules || [])[+T.dataset.ruleI]; if (r) r[T.dataset.ruleF] = T.value; }, { render: false });
});
})();
