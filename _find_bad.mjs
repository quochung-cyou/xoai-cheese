import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const f = 'function_plot';
const raw = fs.readFileSync(`${scen}/${f}.html`).toString('utf8');

const CP1252_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
const charToByte = new Map();
for (let b = 0; b < 256; b++) {
  const ch = String.fromCodePoint(CP1252_HIGH[b] ?? b);
  if (!charToByte.has(ch)) charToByte.set(ch, b);
}

// step 1 of the inverse: latin1 encode -> utf8 decode
const s1 = Buffer.from(raw, 'latin1').toString('utf8');
console.log(`raw chars=${[...raw].length} s1 chars=${[...s1].length} U+FFFD in s1=${(s1.match(/\uFFFD/g) || []).length}`);
// locate unmappable chars for step 2 (cp1252 encode)
const bad = [];
for (let i = 0; i < s1.length; i++) {
  if (!charToByte.has(s1[i])) bad.push(i);
}
console.log(`characters not encodable via cp1252 in s1: ${bad.length}`);
for (const i of bad.slice(0, 6)) {
  const ctx = s1.slice(Math.max(0, i - 45), i + 25);
  console.log(`  index ${i} char=${JSON.stringify(s1[i])} U+${s1[i].codePointAt(0).toString(16).toUpperCase()}`);
  console.log(`    context: ${JSON.stringify(ctx)}`);
  console.log(`    codepoints: ${[...ctx].map((c) => c.codePointAt(0).toString(16)).join(' ')}`);
}
// where does index 8229-ish fall in the raw text (line number)?
const lineOf = (t, i) => t.slice(0, i).split('\n').length;
for (const i of bad.slice(0, 6)) {
  // map back approximately: the latin1 step preserves indices
  console.log(`  approx raw line: ${lineOf(raw, i)}`);
}
// how many high (>0xFF) chars in s1? (these indicate already-clean content)
console.log(`s1 chars above U+00FF: ${[...s1].filter((c) => c.codePointAt(0) > 0xff).length} -> ${JSON.stringify([...new Set([...s1].filter((c) => c.codePointAt(0) > 0xff))])}`);
