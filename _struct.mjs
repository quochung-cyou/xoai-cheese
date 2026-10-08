import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const head = `${process.env.TEMP}/vn-head-en`;
const f = 'function_plot';

const disk = fs.readFileSync(`${scen}/${f}.html`, 'utf8');
const headT = fs.readFileSync(`${head}/${f}.html`, 'utf8');

const stats = (label, s) => {
  const lines = s.split('\n');
  console.log(`${label}: bytes=${Buffer.byteLength(s)} lines=${lines.length} blank=${lines.filter((l) => /^\s*$/.test(l)).length}`);
  for (const pat of ['<!DOCTYPE', '<script', '</script>', '</html>', '(function(){', 'addEventListener', '// Name the URL']) {
    console.log(`   ${pat.padEnd(20)} x${(s.split(pat).length - 1)}`);
  }
};
stats('on-disk DAMAGED', disk);
stats('git HEAD  EN', headT);

// line-level diff (skeleton) between the damaged file and HEAD
const skel = (s) => s.replace(/[^\x00-\x7F]/g, '#');
const a = disk.split('\n').map(skel), b = headT.split('\n').map(skel);
// simple LCS table (files are small)
const n = a.length, m = b.length;
const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
  dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
let i = 0, j = 0;
const ops = [];
while (i < n && j < m) {
  if (a[i] === b[j]) { i++; j++; }
  else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['DISK-ONLY', i + 1, disk.split('\n')[i]]); i++; }
  else { ops.push(['HEAD-ONLY', j + 1, headT.split('\n')[j]]); j++; }
}
while (i < n) { ops.push(['DISK-ONLY', i + 1, disk.split('\n')[i]]); i++; }
while (j < m) { ops.push(['HEAD-ONLY', j + 1, headT.split('\n')[j]]); j++; }
const diskOnly = ops.filter((o) => o[0] === 'DISK-ONLY');
const headOnly = ops.filter((o) => o[0] === 'HEAD-ONLY');
console.log(`\nline diff vs HEAD: on-disk-only=${diskOnly.length}, head-only=${headOnly.length}`);
console.log('--- on-disk-only lines beyond the reporter region (line > 32) ---');
for (const [, ln, t] of diskOnly.filter((o) => o[1] > 32).slice(0, 40)) console.log(`  ${ln}: ${JSON.stringify(t.slice(0, 130))}`);
console.log('--- HEAD-only lines beyond the reporter region (line > 34) ---');
for (const [, ln, t] of headOnly.filter((o) => o[1] > 34).slice(0, 40)) console.log(`  ${ln}: ${JSON.stringify(t.slice(0, 130))}`);
