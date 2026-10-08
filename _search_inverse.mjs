import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const f = process.argv[2] || 'function_plot';
const WRITE = process.argv.includes('--write');
const table = JSON.parse(fs.readFileSync(`${process.env.TEMP}/vn-reapply-kit/_reapply_vn.json`, 'utf8'));

const CP1252_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
const byteToChar = new Map();
for (let b = 0; b < 256; b++) byteToChar.set(b, String.fromCodePoint(CP1252_HIGH[b] ?? b));
const charToByte = new Map();
for (const [b, ch] of byteToChar) if (!charToByte.has(ch)) charToByte.set(ch, b);

const allLow = (t) => [...t].every((c) => c.codePointAt(0) <= 0xff);
const canCp = (t) => [...t].every((c) => charToByte.has(c));
const invL = (t) => (allLow(t) ? Buffer.from(t, 'latin1').toString('utf8') : null);
const invC = (t) => {
  if (!canCp(t)) return null;
  const out = Buffer.alloc(t.length);
  for (let i = 0; i < t.length; i++) out[i] = charToByte.get(t[i]);
  return out.toString('utf8');
};
// also try cp1252→latin1 hybrid steps where printable C1 controls are treated as raw bytes
const invC1 = (t) => {
  if (![...t].every((c) => c.codePointAt(0) <= 0xff)) return null;
  const out = Buffer.alloc(t.length);
  for (let i = 0; i < t.length; i++) {
    const cp = t.codePointAt(0);
    const b = charToByte.get(t[i]);
    out[i] = b !== undefined ? b : cp; // fall back to the raw latin1 byte for C1 controls
  }
  return out.toString('utf8');
};

const MOJI = /(Ã.|Â.|áº|á»|Ä‘|Æ¡|â€|ï¿½)/;
const VN_REAL = /[ăâêôơưĐ]|[ắằẳẵặấầẩẫậếềểễệốồổỗộớờởỡợứừửữựýỳỷỹỵ]/g;

function tableReverseOk(text) {
  let probe = text;
  for (const [oldS, newS, n] of table[`${f}.html`]) {
    const want = n === undefined ? 1 : n;
    if (probe.split(newS).length - 1 !== want) return false;
    probe = probe.split(newS).join(oldS);
  }
  return true;
}

const raw = fs.readFileSync(`${scen}/${f}.html`).toString('utf8');
const SENT = '\u0001';
const protectedChars = [...new Set([...raw].filter((c) => c.codePointAt(0) > 0xff))];
const shielded = protectedChars.reduce((t, ch) => t.split(ch).join(SENT), raw);
console.log(`file=${f}.html bytes=${Buffer.byteLength(raw)} protectedHighChars=${JSON.stringify(protectedChars)}`);
console.log('searching inverse chains (L=latin1, C=cp1252, C1=cp1252-with-raw-C1), depth<=4…\n');

const steps = [['L', invL], ['C', invC], ['C1', invC1]];
const found = [];
const seen = new Set();
const walk = (text, path, depth) => {
  if (seen.has(text)) return;
  seen.add(text);
  if (text.includes('<html')) {
    let clean = text;
    for (const ch of protectedChars) { /* sentinel already in place */ }
    const cand = protectedChars.reduce((t, ch, i) => t.split(SENT).join(ch), clean);
    const moji = (cand.match(MOJI) || []).length;
    const ff = (cand.match(/\uFFFD/g) || []).length;
    let tok = false;
    try { tok = tableReverseOk(cand); } catch { tok = false; }
    const vn = (cand.match(VN_REAL) || []).length;
    if (tok && !moji && !ff) found.push({ path: path.join('>'), cand, moji, ff, vn });
    if (depth <= 4 && (moji || !tok)) console.log(`  depth ${depth} ${(path.join('>') || '(none)').padEnd(14)} mojibake=${String(moji).padEnd(4)} U+FFFD=${String(ff).padEnd(3)} vnChars=${String(vn).padEnd(4)} tableReverseOk=${tok}`);
  }
  if (depth === 4) return;
  for (const [name, fn] of steps) {
    let next = null;
    try { next = fn(text); } catch { next = null; }
    if (!next || next === text) continue;
    walk(next, [...path, name], depth + 1);
  }
};
walk(shielded, [], 0);

if (!found.length) { console.log('\nNO CANDIDATE FOUND'); process.exit(1); }
found.sort((a, b) => a.path.length - b.path.length);
const w = found[0];
console.log(`\nWINNER path=${w.path} vnChars=${w.vn}`);
console.log(`header: ${(w.cand.match(/<header>.*?<\/header>/) || ['(none)'])[0]}`);
console.log(`buttons: ${JSON.stringify([...w.cand.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim()))}`);
console.log(`langVi=${/<html lang="vi">/.test(w.cand)}  statusLine=${JSON.stringify((/^[ \t]*status\.textContent = '([^']*)'/m.exec(w.cand) || [, ''])[1])}`);

// independent rebuild from git HEAD + exported head reporter + validated table
const head = `${process.env.TEMP}/vn-head-en`;
const headText = fs.readFileSync(`${head}/${f}.html`, 'utf8');
const reporter = (fs.readFileSync(`${scen}/pendulum.html`, 'utf8').match(/<head><script>[\s\S]*?<\/script>/) || [''])[0];
let indep = headText.replace(/<head><script>[\s\S]*?<\/script>/, reporter);
let ok = true;
for (const [oldS, newS, n] of table[`${f}.html`]) {
  const want = n === undefined ? 1 : n;
  if (indep.split(oldS).length - 1 !== want) { ok = false; break; }
  indep = indep.split(oldS).join(newS);
}
console.log(`independent rebuild matches winner: ${ok && indep === w.cand}`);

if (WRITE) {
  fs.writeFileSync(`${scen}/${f}.html`, w.cand, 'utf8');
  console.log('WROTE repaired file (utf8, LF, no BOM)');
}
