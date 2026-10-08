// Function-plot parser — the real code, extracted from the generated template
// and executed in Node. Guards the "đồ thị hàm số" (function graph) scenario:
// a hand-written or model-written expression must actually compile and evaluate,
// or the spawned viewer silently draws nothing.
//
// Run with: node --experimental-strip-types scripts/check-function-plot.mts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, report } from './check-helpers.mts';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(
  join(FRONTEND, 'public', 'mb-assets', 'scenarios', 'function_plot.html'),
  'utf8',
);

/** Slice the pure parser region: `const F_IMPL` … end of `compileFn`. */
function sliceParser(source: string): string {
  const from = source.indexOf('const F_IMPL =');
  if (from < 0) throw new Error('F_IMPL not found');
  const fn = source.indexOf('function compileFn(', from);
  if (fn < 0) throw new Error('compileFn not found');
  // Brace-match the compileFn body.
  let depth = 0;
  let i = source.indexOf('{', fn);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(from, i + 1);
}

const parserSrc = sliceParser(html);
// `varName` is declared in the template's DOM section; provide it here.
const compileFn = new Function(
  `${parserSrc}\nreturn compileFn;`,
)() as (src: string) => { f: (x: number) => number; v: string } | null;

/** Evaluate a compiled function at a probe and report null/NaN distinctly. */
function probe(src: string): number | 'compile-fail' | 'NaN' {
  const c = compileFn(src);
  if (!c) return 'compile-fail';
  const y = c.f(2);
  return Number.isFinite(y) ? y : 'NaN';
}

console.log('function_plot — the parser is present and complete');
{
  check('F_IMPL extracted', parserSrc.includes('sin: Math.sin'));
  check('lexer extracted', parserSrc.includes('function lex('));
  check('parser extracted', parserSrc.includes('function primary('));
  check('evaluator extracted', parserSrc.includes('function ev('));
  check('compileFn extracted', parserSrc.includes('function compileFn('));
}

console.log('function_plot — every picker expression compiles and evaluates');
{
  // Exactly the `fn` values the catalog ships.
  const cases: [string, string][] = [
    ['x^2', 'x² parabola'],
    ['sin(x)', 'sine'],
    ['x^3 - 2x', 'cubic'],
    ['e^x', 'exponential'],
    ['sqrt(x)', 'square root'],
  ];
  for (const [src, label] of cases) {
    const y = probe(src);
    check(
      `${label}: ${src}`,
      typeof y === 'number',
      `${src} -> ${y}`,
    );
  }
}

console.log('function_plot — model-written formulas (with "y =", unicode, spacing)');
{
  // The classifier transcribes "as written", so these shapes must survive.
  const mustWork: string[] = [
    'y = x^2',
    'y=x²',
    'y = x^3 - 2x',
    'f(x)=sin(x)',
    'sin x',
    'x²',
    '2x + 1',
    '2x(x-1)',
    'x^2 + 3x - 1',
    'z^4',
    'exp(-x)',
    'cos(2x)',
  ];
  for (const src of mustWork) {
    check(`compiles: ${src}`, probe(src) !== 'compile-fail', `${src} -> ${probe(src)}`);
  }
}

console.log('function_plot — the default still works when fn is missing');
{
  check('default x^3 - 3x compiles', probe('x^3 - 3*x') !== 'compile-fail');
}

report();
