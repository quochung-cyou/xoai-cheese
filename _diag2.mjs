import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const f = process.argv[2] || 'function_plot';
const s = fs.readFileSync(`${scen}/${f}.html`).toString('utf8');

const counts = new Map();
for (const ch of s) {
  const cp = ch.codePointAt(0);
  if (cp > 0x7f) counts.set(ch, (counts.get(ch) || 0) + 1);
}
console.log(`file=${f}.html  chars>ASCII distinct=${counts.size}`);
console.log(`chars above U+00FF: ${[...counts.keys()].filter((c) => c.codePointAt(0) > 0xff).map((c) => `${JSON.stringify(c)}(U+${c.codePointAt(0).toString(16).toUpperCase()})x${counts.get(c)}`).join(' ') || '(none)'}`);
console.log(`top Latin-1 chars: ${[...counts.entries()].filter(([c]) => c.codePointAt(0) <= 0xff).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([c, n]) => `${JSON.stringify(c)}x${n}`).join(' ')}`);

const lines = s.split('\n');
console.log('\n--- sample lines ---');
for (const idx of [1, 52, 56, 57, 58, 59, 60, 226, 241]) {
  const t = lines[idx];
  if (t !== undefined) console.log(`${idx + 1}: ${JSON.stringify(t.slice(0, 160))}`);
}
console.log('\n--- codepoints of the header line ---');
const hdr = lines.find((l) => l.includes('<header>')) || '';
console.log([...hdr.slice(0, 40)].map((c) => `${c}(U+${c.codePointAt(0).toString(16).toUpperCase()})`).join(' '));
