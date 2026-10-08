// Sanity harness for the ported refine marker scanner.
// Run with: node --experimental-strip-types scripts/check-scanner.mts
import { EditStreamScanner, type ScanEvent } from '../src/magic-board/lib/editsStream.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

/** Feed a whole response text through the scanner in fixed-size chunks so we
 *  exercise marker/line splits mid-token, exactly as a real stream arrives. */
function scanAll(text: string, chunk = 7): ScanEvent[] {
  const sc = new EditStreamScanner();
  const out: ScanEvent[] = [];
  for (let i = 0; i < text.length; i += chunk) {
    out.push(...sc.feed(text.slice(i, i + chunk)));
  }
  out.push(...sc.flush());
  return out;
}

const types = (evs: ScanEvent[]) => evs.map((e) => e.type);

console.log('scanner — SEARCH/REPLACE lifecycle');
{
  const text =
    'PLAN: bump gravity.\n' +
    '<<<<<<< SEARCH\n' +
    'const g = 9.8;\n' +
    '=======\n' +
    'const g = 20;\n' +
    '>>>>>>> REPLACE\n' +
    'SUMMARY: done.\n';
  const evs = scanAll(text);
  check('emits edit-start', types(evs).includes('edit-start'), JSON.stringify(types(evs)));
  check('emits edit-search', types(evs).includes('edit-search'));
  check('emits edit-end', types(evs).includes('edit-end'));
  const end = evs.find((e) => e.type === 'edit-end') as Extract<ScanEvent, { type: 'edit-end' }>;
  check('search text captured verbatim', end?.search === 'const g = 9.8;', JSON.stringify(end?.search));
  check('replace text captured verbatim', end?.replace === 'const g = 20;', JSON.stringify(end?.replace));
  const narration = evs
    .filter((e): e is Extract<ScanEvent, { type: 'narration' }> => e.type === 'narration')
    .map((e) => e.delta)
    .join('');
  check('narration keeps prose', narration.includes('PLAN: bump gravity.'), JSON.stringify(narration));
  check('narration keeps summary', narration.includes('SUMMARY: done.'));
  check('markers never leak into narration', !narration.includes('<<<<<<<'), JSON.stringify(narration));
}

console.log('scanner — two edits numbered in order');
{
  const text =
    '<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n' +
    '<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n';
  const evs = scanAll(text, 3);
  const starts = evs.filter((e) => e.type === 'edit-start') as Extract<ScanEvent, { type: 'edit-start' }>[];
  const ends = evs.filter((e) => e.type === 'edit-end') as Extract<ScanEvent, { type: 'edit-end' }>[];
  check('two edit-starts', starts.length === 2, JSON.stringify(starts));
  check('indexes are 1 then 2', starts[0]?.index === 1 && starts[1]?.index === 2);
  check('two edit-ends', ends.length === 2);
  check('first pair intact', ends[0]?.search === 'a' && ends[0]?.replace === 'A');
  check('second pair intact', ends[1]?.search === 'b' && ends[1]?.replace === 'B');
}

console.log('scanner — REWRITE block');
{
  const text = 'Rewriting now.\n<<<<<<< REWRITE\n<html>\n<body>hi</body>\n</html>\n>>>>>>> END\n';
  const evs = scanAll(text, 5);
  check('emits rewrite-start', types(evs).includes('rewrite-start'));
  check('emits rewrite-progress', types(evs).includes('rewrite-progress'));
  const end = evs.find((e) => e.type === 'rewrite-end') as Extract<ScanEvent, { type: 'rewrite-end' }>;
  check('rewrite code captured', end?.code.includes('<body>hi</body>'), JSON.stringify(end?.code));
}

console.log('scanner — incomplete block is NOT emitted');
{
  const text = '<<<<<<< SEARCH\nconst g = 9.8;\n=======\nconst g = 20;\n';
  const evs = scanAll(text);
  check('no edit-end for unterminated block', !types(evs).includes('edit-end'), JSON.stringify(types(evs)));
  check('search was still located', types(evs).includes('edit-search'));
}

console.log('scanner — code fences are dropped, not narrated');
{
  const text = '```html\n<div>x</div>\n```\nDone.\n';
  const evs = scanAll(text, 4);
  const narration = evs
    .filter((e): e is Extract<ScanEvent, { type: 'narration' }> => e.type === 'narration')
    .map((e) => e.delta)
    .join('');
  check('fence markers dropped', !narration.includes('```'), JSON.stringify(narration));
  check('body text kept', narration.includes('Done.'), JSON.stringify(narration));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
