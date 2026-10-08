import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const head = `${process.env.TEMP}/vn-head-en`;
const f = process.argv[2] || 'function_plot';
const WRITE = process.argv.includes('--write');
const table = JSON.parse(fs.readFileSync(`${process.env.TEMP}/vn-reapply-kit/_reapply_vn.json`, 'utf8'));

// ---- cp1252 tables ----
const CP1252_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
const byteToChar = new Map();
for (let b = 0; b < 256; b++) byteToChar.set(b, String.fromCodePoint(CP1252_HIGH[b] ?? b));
const cp1252Decode = (buf) => [...buf].map((b) => byteToChar.get(b)).join('');
const latin1Decode = (buf) => buf.toString('latin1');
const utf8Encode = (s) => Buffer.from(s, 'utf8');
const utf8Decode = (buf) => buf.toString('utf8');
const cL = (s) => latin1Decode(utf8Encode(s));   // read as latin1, write as utf8
const cC = (s) => cp1252Decode(utf8Encode(s));   // read as cp1252, write as utf8

// ---- rebuild the correct content: git HEAD + exported head reporter (English fallback) + validated table ----
const headText = fs.readFileSync(`${head}/${f}.html`, 'utf8');
// the exported reporter lives in my repaired files, but its fallback string is already translated
const reporter = (fs.readFileSync(`${scen}/pendulum.html`, 'utf8').match(/<head>\s*<script>[\s\S]*?<\/script>/) || [''])[0]
  .replace("||'Yêu cầu thất bại';", "||'Request failed';");
const baseline = headText.replace(/<head>\s*<script>[\s\S]*?<\/script>/, () => reporter);
let candidate = baseline;
let ok = true;
for (const [oldS, newS, n] of table[`${f}.html`]) {
  const want = n === undefined ? 1 : n;
  if (candidate.split(oldS).length - 1 !== want) { ok = false; console.log(`  MISSING source string in HEAD: ${JSON.stringify(oldS.slice(0, 60))}`); break; }
  candidate = candidate.split(oldS).join(newS);
}
// the parent added lang="vi" to these files; the validated content must carry it too
candidate = candidate.replace(/^<html>(?=\r?\n)/m, '<html lang="vi">');
console.log(`table applied to (HEAD + exported reporter): ${ok}`);

const VN_REAL = /[ăâêôơưĐ]|[ắằẳẵặấầẩẫậếềểễệốồổỗộớờởỡợứừửữựýỳỷỹỵ]/g;
const MOJI = /(Ã.|Â.|áº|á»|Ä‘|Æ¡|â€|ï¿½)/;
const candMoji = (candidate.match(MOJI) || []).length;
const candVn = (candidate.match(VN_REAL) || []).length;
const candAbove = [...candidate].filter((c) => c.codePointAt(0) > 0xff).length;
console.log(`candidate: bytes=${Buffer.byteLength(candidate)} mojibake=${candMoji} vnChars=${candVn} charsAboveU+FF>=${candAbove} langVi=${/<html lang="vi">/.test(candidate)}`);
console.log(`           (dry-run reference of the verified repair: vnChars=117 charsAboveU+FF>=153)`);
console.log(`header: ${(candidate.match(/<header>.*?<\/header>/) || ['(none)'])[0]}`);
console.log(`buttons: ${JSON.stringify([...candidate.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim()))}`);

// ---- find the corruption sequence that turns candidate into the current on-disk text ----
const current = fs.readFileSync(`${scen}/${f}.html`).toString('utf8');
const SENT = '\u0001';
const highChars = [...new Set([...current].filter((c) => c.codePointAt(0) > 0xff))];
const shieldedCurrent = highChars.reduce((t, ch) => t.split(ch).join(SENT), current);
const shieldedCandidate = highChars.reduce((t, ch) => t.split(ch).join(SENT), candidate);
console.log(`\ncurrent on-disk high chars (already correct, shielded): ${JSON.stringify(highChars)}`);

const seqs = [];
for (const a of ['L', 'C']) { seqs.push([a]); for (const b of ['L', 'C']) { seqs.push([a, b]); for (const c of ['L', 'C']) seqs.push([a, b, c]); } }
let matched = null;
for (const seq of seqs) {
  let t = shieldedCandidate;
  for (const s of seq) t = (s === 'L' ? cL : cC)(t);
  if (t === shieldedCurrent) { matched = seq; break; }
}
console.log(`corruption sequence reproducing the current bytes: ${matched ? matched.join('->') : 'NONE FOUND'}`);
if (!matched) {
  // report closest
  let best = null;
  for (const seq of seqs) {
    let t = shieldedCandidate;
    for (const s of seq) t = (s === 'L' ? cL : cC)(t);
    const a = t.split('\n'), b = shieldedCurrent.split('\n');
    let d = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d++;
    if (!best || d < best.d) best = { seq, d };
  }
  console.log(`closest: ${best.seq.join('->')} with ${best.d} differing line(s)`);
}

if (candMoji === 0 && matched) {
  console.log('\nPROOF COMPLETE: candidate is exactly the pre-corruption content of the on-disk file.');
  if (WRITE) { fs.writeFileSync(`${scen}/${f}.html`, candidate, 'utf8'); console.log('WROTE repaired file (utf8, LF, no BOM)'); }
  else console.log('(dry run — nothing written)');
} else {
  console.log('\nNOT PROVEN — not writing.');
  process.exit(1);
}
