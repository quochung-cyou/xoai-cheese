// Repair the 5 files damaged by a PowerShell `Get-Content -Raw` (ANSI) read
// followed by a UTF-8 write: that double-encoded every non-ASCII byte.
// Re-decode: read as latin1, reinterpret those bytes as UTF-8.
const fs = require('node:fs');
const path = require('node:path');

const dir = 'code/frontend-src/public/mb-assets/scenarios';
const files = [
  'bubble_sort.html',
  'function_plot.html',
  'pendulum.html',
  'projectile.html',
  'rc_circuit.html',
];

for (const f of files) {
  const p = path.join(dir, f);
  const raw = fs.readFileSync(p);
  const fixed = Buffer.from(raw.toString('latin1'), 'utf8');
  const before = raw.toString('utf8');
  const after = fixed.toString('utf8');
  fs.writeFileSync(p, fixed);
  console.log(
    f.padEnd(22),
    'bytes', raw.length, '->', fixed.length,
    '| U+FFFD', (after.match(/\ufffd/g) || []).length,
    '| mojibake', after.includes('\u00e2\u20ac\u201d') ? 'YES' : 'no',
  );
  void before;
}
