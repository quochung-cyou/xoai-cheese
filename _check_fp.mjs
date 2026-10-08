import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const head = `${process.env.TEMP}/vn-head-en`;
const f = 'function_plot';
const table = JSON.parse(fs.readFileSync(`${process.env.TEMP}/vn-reapply-kit/_reapply_vn.json`, 'utf8'));

const raw = fs.readFileSync(`${scen}/${f}.html`);
const s = raw.toString('utf8');
const bom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
const crlf = (raw.toString('latin1').match(/\r\n/g) || []).length;
const moji = (s.match(/(Ã.|Â.|áº|á»|Ä‘|Æ¡|â€|ï¿½)/g) || []).length;
const ff = (s.match(/\uFFFD/g) || []).length;
console.log(`bytes=${raw.length} bom=${bom} crlf=${crlf} mojibake=${moji} U+FFFD=${ff}`);
console.log(`langVi=${/<html lang="vi">/.test(s)}  plainHtml=${/^<html>[ \t]*$/m.test(s)}`);
console.log(`header: ${(s.match(/<header>.*?<\/header>/) || ['(none)'])[0]}`);
console.log(`buttons: ${JSON.stringify([...s.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim()))}`);
console.log(`title/lang line: ${JSON.stringify((s.match(/<html[^>]*>/) || [''])[0])}`);
const st = (fs.statSync(`${scen}/${f}.html`));
console.log(`mtime=${st.mtime.toISOString()}`);

// reverse-apply my validated table -> must reproduce the English baseline
let baseline = s;
let ok = true;
for (const [oldS, newS, n] of table[`${f}.html`]) {
  const want = n === undefined ? 1 : n;
  const got = baseline.split(newS).length - 1;
  if (got !== want) { ok = false; console.log(`  MISMATCH want ${want} got ${got}: ${JSON.stringify(newS.slice(0, 60))}`); break; }
  baseline = baseline.split(newS).join(oldS);
}
console.log(`reverse table applies exactly (all counts): ${ok}`);

// compare reverse-applied baseline against git HEAD, ignoring the injected error-reporter block
const headText = fs.readFileSync(`${head}/${f}.html`, 'utf8');
const strip = (t) => t.replace(/<head><script>[\s\S]*?<\/script>/, '<head><script>REPORTER</script>');
const a = strip(baseline).split('\n');
const b = strip(headText).split('\n');
const diffs = [];
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diffs.push([i + 1, a[i], b[i]]);
console.log(`baseline vs HEAD, ignoring the head error-reporter: ${diffs.length} differing line(s)`);
for (const [ln, x, y] of diffs.slice(0, 6))
  console.log(`  line ${ln}\n    baseline: ${JSON.stringify((x ?? '').slice(0, 140))}\n    HEAD    : ${JSON.stringify((y ?? '').slice(0, 140))}`);
console.log(diffs.length === 0 ? 'RESULT: content is exactly the validated translation (+ lang="vi")' : 'RESULT: residual differences above need review');
