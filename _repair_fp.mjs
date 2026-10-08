import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const head = `${process.env.TEMP}/vn-head-en`;
const f = process.argv[2] || 'function_plot';
const WRITE = process.argv.includes('--write');
const table = JSON.parse(fs.readFileSync(`${process.env.TEMP}/vn-reapply-kit/_reapply_vn.json`, 'utf8'));

// ---- CP1252 table ----
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
    if (b === undefined) throw new Error(`unmappable ${JSON.stringify(s[i])} at ${i}`);
    out[i] = b;
  }
  return out;
};
const undoDouble = (t) => cp1252Encode(Buffer.from(t, 'latin1').toString('utf8')).toString('utf8');
const redoDouble = (t) => Buffer.from(cp1252Decode(Buffer.from(t, 'utf8')), 'utf8').toString('latin1');

let problems = 0;
const bad = (m) => { problems++; console.log('  FAIL ' + m); };

const current = fs.readFileSync(`${scen}/${f}.html`).toString('utf8');
console.log(`=== repairing ${f}.html ===`);
console.log(`  on-disk bytes=${fs.statSync(`${scen}/${f}.html`).size}, chars above U+00FF=${[...current].filter((c) => c.codePointAt(0) > 0xff).length}`);

// protect the already-correct characters (they are not part of the double-encoded chain)
const SENT = '\u0001';
const protectedCount = [...current].filter((c) => c.codePointAt(0) > 0xff).length;
const shielded = current.split('—').join(SENT);
if ([...shielded].some((c) => c.codePointAt(0) > 0xff)) { bad('there are high chars beyond the shield'); }

let repaired;
try { repaired = undoDouble(shielded).split(SENT).join('—'); } catch (e) { bad('inverse failed: ' + e.message); }
if (!repaired) { console.log('aborting'); process.exit(1); }

// ---- check 1: cleanliness + metrics ----
const moji = (repaired.match(/(Ã.|Â.|áº|á»|Ä‘|Æ¡|â€|ï¿½)/g) || []).length;
const ff = (repaired.match(/\uFFFD/g) || []).length;
const VN_REAL = /[ăâêôơưĐ]|[ắằẳẵặấầẩẫậếềểễệốồổỗộớờởỡợứừửữựýỳỷỹỵ]/g;
const vnChars = (repaired.match(VN_REAL) || []).length;
const aboveFF = [...repaired].filter((c) => c.codePointAt(0) > 0xff).length;
console.log(`  check1 clean: mojibake=${moji} U+FFFD=${ff} realVnChars=${vnChars} charsAboveU+FF>=${aboveFF}`);
console.log(`         (dry-run reference from my earlier verified repair: realVnChars=117 charsAboveU+FF>=153)`);
if (moji || ff) bad('repair is not clean');

// ---- check 2: reverse table reproduces the English baseline ----
let baseline = repaired;
let tableOk = true;
for (const [oldS, newS, n] of table[`${f}.html`]) {
  const want = n === undefined ? 1 : n;
  const got = baseline.split(newS).length - 1;
  if (got !== want) { tableOk = false; bad(`reverse table mismatch (want ${want} got ${got}): ${JSON.stringify(newS.slice(0, 50))}`); break; }
  baseline = baseline.split(newS).join(oldS);
}
console.log(`  check2 reverse table applies exactly: ${tableOk}`);

// ---- check 3: re-corrupting the repair reproduces the on-disk text except the shielded chars ----
const rec = redoDouble(repaired);
const recExpected = current.split('—').join('\u0001'); // on-disk version of the shielded text
const linesA = rec.split('\n'), linesB = recExpected.split('\n');
const diffs = [];
for (let i = 0; i < Math.max(linesA.length, linesB.length); i++) if (linesA[i] !== linesB[i]) diffs.push(i + 1);
console.log(`  check3 re-corruption matches on-disk text: ${diffs.length === 0} (differing lines: ${diffs.slice(0, 5).join(', ') || 'none'})`);
if (diffs.length) bad('re-corruption does not reproduce the on-disk bytes');

// ---- check 4: independent reconstruction from git HEAD + exported head reporter + my table ----
const headText = fs.readFileSync(`${head}/${f}.html`, 'utf8');
const reporter = (fs.readFileSync(`${scen}/pendulum.html`, 'utf8').match(/<head><script>[\s\S]*?<\/script>/) || [''])[0];
const headWithExportReporter = headText.replace(/<head><script>[\s\S]*?<\/script>/, reporter);
let independent = headWithExportReporter;
for (const [oldS, newS, n] of table[`${f}.html`]) {
  const want = n === undefined ? 1 : n;
  if (independent.split(oldS).length - 1 !== want) { bad(`independent rebuild: HEAD does not contain expected source string ${JSON.stringify(oldS.slice(0, 45))}`); independent = null; break; }
  independent = independent.split(oldS).join(newS);
}
const independentMatches = independent === repaired;
console.log(`  check4 independent rebuild (git HEAD + exported head reporter + validated table) matches: ${independentMatches}`);
if (!independentMatches) bad('independent reconstruction differs');
console.log(`  lang="vi" present: ${/<html lang="vi">/.test(repaired)}`);
console.log(`  header: ${(repaired.match(/<header>.*?<\/header>/) || ['(none)'])[0]}`);

if (WRITE && !problems) {
  fs.writeFileSync(`${scen}/${f}.html`, repaired, 'utf8');
  console.log('  WROTE repaired file (utf8, LF, no BOM)');
}
console.log(problems ? `PROBLEMS: ${problems}` : `ALL CHECKS PASS${WRITE ? '' : ' (dry run)'}`);
process.exit(problems ? 1 : 0);
