import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const head = `${process.env.TEMP}/vn-head-en`;
const f = process.argv[2] || 'function_plot';
const WRITE = process.argv.includes('--write');
const table = JSON.parse(fs.readFileSync(`${process.env.TEMP}/vn-reapply-kit/_reapply_vn.json`, 'utf8'));

// --- rebuild the validated content (HEAD + exported reporter + table + lang="vi") ---
const headText = fs.readFileSync(`${head}/${f}.html`, 'utf8');
const reporter = (fs.readFileSync(`${scen}/pendulum.html`, 'utf8').match(/<head>\s*<script>[\s\S]*?<\/script>/) || [''])[0]
  .replace("||'Yêu cầu thất bại';", "||'Request failed';");
const baseline = headText.replace(/<head>\s*<script>[\s\S]*?<\/script>/, () => reporter);
let candidate = baseline;
for (const [oldS, newS, n] of table[`${f}.html`]) {
  const want = n === undefined ? 1 : n;
  if (candidate.split(oldS).length - 1 !== want) { console.log(`MISSING source string: ${JSON.stringify(oldS.slice(0, 50))}`); process.exit(1); }
  candidate = candidate.split(oldS).join(newS);
}
candidate = candidate.replace(/^<html>(?=\r?\n)/m, '<html lang="vi">');

const current = fs.readFileSync(`${scen}/${f}.html`).toString('utf8');

// --- 1. ASCII skeleton must match (any other edits would show up here) ---
const skel = (s) => s.replace(/[^\x00-\x7F]/g, '\u0000');
const candLines = candidate.split('\n'), curLines = current.split('\n');
console.log(`lines: candidate=${candLines.length} onDisk=${curLines.length}`);
let skelDiff = 0;
const skelDiffs = [];
for (let i = 0; i < Math.max(candLines.length, curLines.length); i++) {
  if (skel(candLines[i] ?? '') !== skel(curLines[i] ?? '')) { skelDiff++; if (skelDiffs.length < 5) skelDiffs.push(i + 1); }
}
console.log(`lines whose ASCII skeleton differs: ${skelDiff} (${skelDiffs.join(', ')})`);
if (skelDiff) {
  for (const ln of skelDiffs) {
    console.log(`  line ${ln}\n    cand: ${JSON.stringify((candLines[ln - 1] ?? '').slice(0, 120))}\n    disk: ${JSON.stringify((curLines[ln - 1] ?? '').slice(0, 120))}`);
  }
}

// --- 2. derive the per-character damage map from aligned non-ASCII runs ---
const NON_ASCII = /[^\x00-\x7F]+/g;
const map = new Map();      // candidate char -> on-disk string
const reverse = new Map();  // on-disk string -> candidate char
let pairs = 0, inconsistent = 0;
for (let i = 0; i < Math.min(candLines.length, curLines.length); i++) {
  const aRuns = candLines[i].match(NON_ASCII) || [];
  const bRuns = curLines[i].match(NON_ASCII) || [];
  if (aRuns.length !== bRuns.length) { inconsistent++; continue; }
  for (let r = 0; r < aRuns.length; r++) {
    const a = [...aRuns[r]], b = bRuns[r];
    // walk: each candidate char consumes a prefix of b
    let bi = 0;
    for (const ch of a) {
      // try progressively longer on-disk substrings until the map is consistent
      let matched = null;
      for (let len = 1; len <= b.length - bi; len++) {
        const sub = b.slice(bi, bi + len).join('');
        if (map.has(ch)) { if (map.get(ch) === sub) { matched = sub; break; } }
        else if (!reverse.has(sub)) { matched = sub; map.set(ch, sub); reverse.set(sub, ch); break; }
      }
      if (!matched) { inconsistent++; break; }
      bi += [...matched].length;
      pairs++;
    }
    if (bi !== b.length) inconsistent++;
  }
}
console.log(`\nderived map entries: ${map.size}, char pairs consumed: ${pairs}, inconsistencies: ${inconsistent}`);
console.log(`sample mapping: ${[...map.entries()].slice(0, 12).map(([a, b]) => `${a}->${JSON.stringify(b)}`).join('  ')}`);

// --- 3. forward check: applying the map to the candidate must reproduce the on-disk file ---
let rebuilt = '';
let missing = 0;
for (const ch of candidate) {
  if (ch.codePointAt(0) < 0x80) { rebuilt += ch; continue; }
  const m = map.get(ch);
  if (m === undefined) { missing++; rebuilt += ch; continue; }
  rebuilt += m;
}
const exact = rebuilt === current;
console.log(`\nforward check (candidate mapped -> on-disk): exact=${exact} missingMappings=${missing}`);
if (!exact) {
  const a = rebuilt.split('\n'), b = current.split('\n');
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  console.log(`  differing lines: ${d}`);
}

const clean = !(candidate.match(/(Ã.|Â.|áº|á»|Ä‘|Æ¡|â€|ï¿½)/g) || []).length;
console.log(`candidate clean (no mojibake): ${clean}, langVi=${/<html lang="vi">/.test(candidate)}, bytes=${Buffer.byteLength(candidate)}`);
console.log(`header: ${(candidate.match(/<header>.*?<\/header>/) || ['(none)'])[0]}`);

if (exact && clean && skelDiff === 0) {
  console.log('\nPROOF: the candidate maps character-for-character onto the on-disk file -> it is the exact pre-damage content.');
  if (WRITE) { fs.writeFileSync(`${scen}/${f}.html`, candidate, 'utf8'); console.log('WROTE repaired file (utf8, LF, no BOM)'); }
  else console.log('(dry run — nothing written)');
} else {
  console.log('\nNOT PROVEN — not writing.');
  process.exit(1);
}
