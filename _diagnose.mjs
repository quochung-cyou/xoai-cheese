import fs from 'node:fs';

const root = 'C:/Users/LENOVO/Documents/GitHub/aitc2026-team-377-xoai-cheese';
const scen = `${root}/code/frontend-src/public/mb-assets/scenarios`;
const head = `${process.env.TEMP}/vn-head-en`;
const files = ['pendulum', 'projectile', 'rc_circuit', 'bubble_sort', 'function_plot'];

const VN = /[ăâêôơưđĂÂÊÔƠƯĐáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/;
// mojibake signatures: sequences produced when UTF-8 bytes are read as latin1/cp1252
const MOJI = /(Ã[\u0080-\u00BF\u2013\u2014\u2018\u2019\u201C\u201D\u2020\u2022\u20AC]|Â[\u0080-\u00BF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u20AC\u00A0]|áº|á»|Ä‘|Æ¡|á»¯|áº¯|â€|ï¿½)/;

const dec1252 = new TextDecoder('windows-1252', { fatal: false });
const inv = {
  latin1: (s) => Buffer.from(s, 'latin1').toString('utf8'),
  cp1252: (s) => dec1252.decode(Buffer.from(s, 'latin1')),
  latin1x2: (s) => inv.latin1(inv.latin1(s)),
  cp1252x2: (s) => inv.cp1252(inv.cp1252(s)),
};

const table = JSON.parse(fs.readFileSync(`${process.env.TEMP}/vn-reapply-kit/_reapply_vn.json`, 'utf8'));

for (const f of files) {
  const raw = fs.readFileSync(`${scen}/${f}.html`);
  const s = raw.toString('utf8');
  const codes = [...s].map((c) => c.codePointAt(0));
  const maxCode = Math.max(...codes);
  const hasHigh = codes.some((c) => c > 0xff);
  const htmlLine = (s.match(/<html[^>]*>/) || ['(none)'])[0];
  console.log(`\n===== ${f}.html =====`);
  console.log(`  bytes=${raw.length} maxCodePoint=U+${maxCode.toString(16).toUpperCase()} hasCharAboveFF=${hasHigh}`);
  console.log(`  <html> line: ${JSON.stringify(htmlLine)}`);
  console.log(`  mojibake signatures in damaged text: ${(s.match(MOJI) || []).length}`);
  console.log(`  VN chars in damaged text: ${(s.match(new RegExp(VN, 'g')) || []).length}`);
  // sample of the first non-ASCII run
  const m = s.match(/[^\x00-\x7F]{2,}[^\n]{0,20}/);
  if (m) console.log(`  sample: ${JSON.stringify(m[0])}  codepoints: ${[...m[0]].slice(0, 12).map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ')}`);

  for (const [name, fn] of Object.entries(inv)) {
    let out;
    try { out = fn(s); } catch (e) { console.log(`  inverse ${name}: THREW ${e.message}`); continue; }
    const rt = Buffer.from(out, 'utf8').toString('latin1');
    const roundTrip = rt === s;
    const moji = (out.match(MOJI) || []).length;
    const vn = (out.match(new RegExp(VN, 'g')) || []).length;
    const replacement = (out.match(/\uFFFD/g) || []).length;
    // does the table apply cleanly to the candidate (in reverse: new -> old) ?
    let tableOk = true;
    let probe = out;
    for (const [oldS, newS, n] of table[`${f}.html`]) {
      const want = n === undefined ? 1 : n;
      const got = probe.split(newS).length - 1;
      if (got !== want) { tableOk = false; break; }
      probe = probe.split(newS).join(oldS);
    }
    const baseline = `${head}/${f}.html`;
    const headText = fs.existsSync(baseline) ? fs.readFileSync(baseline, 'utf8') : null;
    const matchesHead = headText !== null && probe === headText;
    console.log(`  inverse ${name.padEnd(9)} roundTrip=${roundTrip} mojibake=${moji} vnChars=${vn} U+FFFD=${replacement} tableReverseApplies=${tableOk} equalsHEAD=${matchesHead}`);
  }
}
