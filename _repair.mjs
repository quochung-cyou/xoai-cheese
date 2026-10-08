import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const head = `${process.env.TEMP}/vn-head-en`;
const files = ['pendulum', 'projectile', 'rc_circuit', 'bubble_sort', 'function_plot'];
const WRITE = process.argv.includes('--write');

// ---- explicit CP1252 table (WHATWG windows-1252), byte -> char ----
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

const cp1252Decode = (buf) => [...buf].map((b) => byteToChar.get(b)).join('');
const cp1252Encode = (s) => {
  const out = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) {
    const b = charToByte.get(s[i]);
    if (b === undefined) throw new Error(`unmappable cp1252 char ${JSON.stringify(s[i])} U+${s[i].codePointAt(0).toString(16).toUpperCase()} at index ${i}`);
    out[i] = b;
  }
  return out;
};

// corruption: S -utf8-> -cp1252 decode-> S1 -utf8-> -latin1 decode-> S2   (S2 written as utf8)
// inverse:   S2 -latin1 encode-> -utf8 decode-> S1 -cp1252 encode-> -utf8 decode-> S
function undoDouble(text) {
  for (const ch of text) if (ch.codePointAt(0) > 0xff) throw new Error(`char above U+00FF (${JSON.stringify(ch)})`);
  const s1 = Buffer.from(text, 'latin1').toString('utf8');
  return cp1252Encode(s1).toString('utf8');
}
// forward (what the corrupting tool did) — used to prove the inverse
function redoDouble(s) {
  const s1 = cp1252Decode(Buffer.from(s, 'utf8'));
  const s2 = Buffer.from(s1, 'utf8').toString('latin1');
  return s2;
}

const VN_REAL = /[ăâêôơưđĂÂÊÔƠƯĐ]|[ắằẳẵặấầẩẫậếềểễệốồổỗộớờởỡợứừửữựýỳỷỹỵ]/;
const MOJI = /(Ã.|Â.|áº|á»|Ä‘|Æ¡|â€|ï¿½)/;
const table = JSON.parse(fs.readFileSync(`${process.env.TEMP}/vn-reapply-kit/_reapply_vn.json`, 'utf8'));

let problems = 0;
const bad = (m) => { problems++; console.log('  FAIL ' + m); };

for (const f of files) {
  console.log(`\n===== ${f}.html =====`);
  const rawBytes = fs.readFileSync(`${scen}/${f}.html`);
  const bom = rawBytes.length >= 3 && rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf;
  const crlf = (rawBytes.toString('latin1').match(/\r\n/g) || []).length;
  const damaged = rawBytes.toString('utf8');

  let repaired;
  try { repaired = undoDouble(damaged); } catch (e) { bad(`inverse failed: ${e.message}`); continue; }

  // PROOF: re-applying the corruption to the repair must reproduce the damaged text byte-for-byte
  const rebuilt = redoDouble(repaired);
  const proof = Buffer.from(rebuilt, 'utf8').equals(rawBytes) && rebuilt === damaged;
  console.log(`  round-trip proof (repair -> re-corrupt == damaged bytes): ${proof}`);
  if (!proof) bad('round-trip proof failed');

  const ff = (repaired.match(/\uFFFD/g) || []).length;
  const moji = (repaired.match(MOJI) || []).length;
  const vnChars = (repaired.match(new RegExp(VN_REAL, 'g')) || []).length;
  const aboveFF = [...repaired].filter((c) => c.codePointAt(0) > 0xff).length;
  const langVi = /<html lang="vi">/.test(repaired);
  console.log(`  U+FFFD=${ff} mojibake=${moji} realVnChars=${vnChars} charsAboveU+FF>=${aboveFF} langVi=${langVi}`);
  if (ff) bad('repair still contains U+FFFD');
  if (moji) bad('repair still contains mojibake signatures');
  if (vnChars < 3) bad('repair has too little Vietnamese text');
  if (!aboveFF) bad('repair has no precomposed Vietnamese codepoints (suspicious)');
  if (!langVi) bad('lang="vi" missing after repair');
  if (bom) bad('BOM present in damaged file');
  if (crlf) bad(`CRLF present (${crlf})`);

  // reverse-apply my validated table -> must reproduce the English baseline the table was built for
  let baseline = repaired;
  let tableOk = true;
  for (const [oldS, newS, n] of table[`${f}.html`]) {
    const want = n === undefined ? 1 : n;
    const got = baseline.split(newS).length - 1;
    if (got !== want) { tableOk = false; bad(`table reverse mismatch (want ${want}, got ${got}) for ${JSON.stringify(newS.slice(0, 50))}`); break; }
    baseline = baseline.split(newS).join(oldS);
  }
  console.log(`  reverse table reproduces English baseline: ${tableOk}`);

  const headFile = `${head}/${f}.html`;
  if (fs.existsSync(headFile)) {
    const headText = fs.readFileSync(headFile, 'utf8');
    if (headText === baseline) console.log('  baseline == git HEAD (byte-identical)');
    else {
      const a = baseline.split('\n'), b = headText.split('\n');
      const diffs = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diffs.push([i + 1, a[i], b[i]]);
      console.log(`  baseline vs git HEAD: ${diffs.length} differing line(s); lengths ${baseline.length} vs ${headText.length}`);
      for (const [ln, x, y] of diffs.slice(0, 3)) console.log(`    line ${ln}\n      baseline: ${JSON.stringify((x ?? '').slice(0, 160))}\n      HEAD    : ${JSON.stringify((y ?? '').slice(0, 160))}`);
    }
  }

  const keys = [
    (repaired.match(/<header>.*?<\/header>/) || ['(no header)'])[0],
    ...[...repaired.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim()),
  ];
  console.log(`  visible: ${JSON.stringify(keys)}`);

  if (WRITE) {
    fs.writeFileSync(`${scen}/${f}.html`, repaired, 'utf8');
    console.log('  WROTE repaired file (utf8, LF, no BOM)');
  }
}
console.log(problems ? `\nPROBLEMS: ${problems}` : `\nALL REPAIR CHECKS PASS${WRITE ? '' : ' (dry run — nothing written)'}`);
process.exit(problems ? 1 : 0);
