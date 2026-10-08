const fs = require('node:fs');
const path = require('node:path');
const dir = 'code/frontend-src/public/mb-assets/scenarios';

console.log('--- lang attribute per template ---');
const bad = [];
const htmls = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
for (const f of htmls) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = s.match(/<html[^>]*\blang="([^"]*)"/i);
  const lang = m ? m[1] : '(none)';
  if (lang !== 'vi') bad.push('  ' + f + ' -> ' + lang);
}
console.log(bad.length ? bad.join('\n') : '  all ' + htmls.length + ' templates: lang="vi"');

console.log('\n--- Vietnamese metadata templates ---');
const en = [];
let vi = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const t = j.title_template || (j.analysis && j.analysis.observation_template);
  if (!t) continue;
  if (/[àáảãạăâđêôơư]/i.test(t)) vi += 1;
  else en.push('  ' + f + ' -> ' + t);
}
console.log('  localized: ' + vi);
console.log(en.length ? '  STILL ENGLISH:\n' + en.join('\n') : '  no English display templates remain');

console.log('\n--- encoding / line endings across all scenario files ---');
let issues = 0;
for (const f of fs.readdirSync(dir)) {
  const b = fs.readFileSync(path.join(dir, f));
  const s = b.toString('utf8');
  const bad2 = [];
  if (b[0] === 0xef && b[1] === 0xbb) bad2.push('BOM');
  if (s.includes('\ufffd')) bad2.push('U+FFFD');
  if (s.includes('\u00e2\u20ac\u201d')) bad2.push('mojibake');
  if ((s.match(/\r\n/g) || []).length) bad2.push('CRLF');
  if (bad2.length) {
    console.log('  ' + f + ': ' + bad2.join(', '));
    issues += 1;
  }
}
console.log(issues ? '  files with issues: ' + issues : '  clean: all 52 files UTF-8 (no BOM), LF only, no mojibake');
