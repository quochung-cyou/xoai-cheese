// Quick sanity harness for the ported edit engine.
// Run with: node --experimental-strip-types scripts/check-edits.mts
import { applyEdits, applyElementOps, findMatchLine, EditError } from '../src/magic-board/lib/edits.ts';

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

console.log('applyEdits — exact match');
{
  const doc = '<div>\n  <p>hello</p>\n</div>';
  const out = applyEdits(doc, [{ search: '<p>hello</p>', replace: '<p>bye</p>' }]);
  check('single exact replacement', out === '<div>\n  <p>bye</p>\n</div>', JSON.stringify(out));
}
{
  const doc = 'a\nb\nc';
  const out = applyEdits(doc, [{ search: 'a\nb', replace: 'X' }]);
  check('multi-line exact', out === 'X\nc', JSON.stringify(out));
}

console.log('applyEdits — line-normalized fallback (trailing whitespace differs)');
{
  // Search has no trailing spaces; the doc lines do.
  const doc = 'function a() {   \n  return 1;   \n}\n';
  const out = applyEdits(doc, [
    { search: 'function a() {\n  return 1;', replace: 'function a() {\n  return 2;' },
  ]);
  check('whitespace-insensitive match applies', out.includes('return 2;'), JSON.stringify(out));
}
{
  const doc = 'one   \ntwo\nthree';
  const out = applyEdits(doc, [{ search: 'one\ntwo', replace: 'ONE' }]);
  check('trailing-whitespace span replaced cleanly', out === 'ONE\nthree', JSON.stringify(out));
}

console.log('applyEdits — error paths (atomic)');
{
  const doc = 'a\nb';
  let threw = false;
  try {
    applyEdits(doc, [{ search: 'nope', replace: 'x' }]);
  } catch (e) {
    threw = e instanceof EditError;
  }
  check('not-found raises EditError', threw);
}
{
  const doc = 'dup\ndup';
  let threw = false;
  try {
    applyEdits(doc, [{ search: 'dup', replace: 'x' }]);
  } catch (e) {
    threw = e instanceof EditError;
  }
  check('ambiguous raises EditError', threw);
}
{
  const doc = 'a\nb\nc';
  let threw = false;
  try {
    // First edit is valid, second fails -> nothing should be committed.
    applyEdits(doc, [
      { search: 'a', replace: 'A' },
      { search: 'zzz', replace: 'Z' },
    ]);
  } catch {
    threw = true;
  }
  check('batch failure raises', threw);
}

console.log('findMatchLine');
{
  check('exact line number', findMatchLine('a\nb\nc', 'b') === 2, String(findMatchLine('a\nb\nc', 'b')));
  check('no match -> null', findMatchLine('a\nb', 'zz') === null);
  check('normalized line number', findMatchLine('a   \nb\n', 'a') === 1);
}

console.log('applyElementOps');
{
  const els = [{ id: 'r1', type: 'rectangle', x: 0, y: 0 }];
  const out = applyElementOps(els, [{ op: 'update', id: 'r1', patch: { x: 50 } }]);
  check('update patches field', out[0]!.x === 50);
  check('input list not mutated', els[0]!.x === 0);
}
{
  const els = [{ id: 'r1', type: 'rectangle', x: 0, y: 0 }];
  const out = applyElementOps(els, [
    { op: 'add', elements: [{ id: 't1', type: 'text', x: 1, y: 1, text: 'hi' }] },
  ]);
  check('add appends', out.length === 2 && out[1]!.id === 't1');
}
{
  const els = [
    { id: 'r1', type: 'rectangle', x: 0, y: 0 },
    { id: 'r2', type: 'rectangle', x: 9, y: 9 },
  ];
  const out = applyElementOps(els, [{ op: 'remove', ids: ['r1'] }]);
  check('remove drops element', out.length === 1 && out[0]!.id === 'r2');
}
{
  let threw = false;
  try {
    applyElementOps([{ id: 'r1', type: 'rectangle', x: 0, y: 0 }], [
      { op: 'update', id: 'nope', patch: { x: 1 } },
    ]);
  } catch (e) {
    threw = e instanceof EditError;
  }
  check('unknown id raises', threw);
}
{
  let threw = false;
  try {
    applyElementOps([{ id: 'r1', type: 'rectangle', x: 0, y: 0 }], [
      { op: 'add', elements: [{ id: 'r1', type: 'text', x: 0, y: 0 }] },
    ]);
  } catch (e) {
    threw = e instanceof EditError;
  }
  check('duplicate add id raises', threw);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
