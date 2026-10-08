// Book path resolution — the real functions, extracted from the generated
// template and exercised in Node.
//
// This exists because a catalog written by hand can spell the path field
// anything, and PDF.js reports a missing path as "Invalid PDF url data: either
// string or URL-object is expected in the url property" — which names neither
// the entry nor the field. That is the failure this guards against.
//
// Run with: node --experimental-strip-types scripts/check-book.mts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, report } from './check-helpers.mts';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = join(FRONTEND, 'public', 'mb-assets', 'scenarios', 'book.html');
const html = readFileSync(BOOK, 'utf8');

/** Pull a top-level function declaration out of the template by name. */
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in book.html`);
  let depth = 0;
  let i = source.indexOf('{', start);
  const from = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name} (from ${from})`);
}

const pdfPathOfSrc = extractFunction(html, 'pdfPathOf');
const resolveBookSrc = extractFunction(html, 'resolveBook');
const resolveBook = new Function(
  `${pdfPathOfSrc}\n${resolveBookSrc}\nreturn resolveBook;`,
)() as (data: unknown, term: string) => Record<string, unknown> | null;
const pdfPathOf = new Function(`${pdfPathOfSrc}\nreturn pdfPathOf;`)() as (
  entry: unknown,
) => string;

console.log('book — the operator hook survived the transform');
{
  check('pdfPathOf exists in the generated template', pdfPathOfSrc.includes('function pdfPathOf'));
  check(
    'a missing entry names the catalog keys',
    html.includes('Các khoá danh mục: '),
  );
  check(
    'a missing path names the entry keys',
    html.includes('không có đường dẫn PDF. Các khoá của mục: '),
  );
}

console.log('book — the PDF is handed to PDF.js as bytes, not a url');
{
  // PDF.js validates `url` with URL.parse(url, window.location). In a sandboxed
  // srcdoc iframe the document URL is `about:srcdoc`, so that parse returns null
  // and PDF.js throws "Invalid PDF url data" before making any request. Passing
  // bytes avoids URL resolution completely.
  check('getDocument receives data, not a url', html.includes('data: pdfBytes,'), html.slice(html.indexOf('getDocument'), html.indexOf('getDocument') + 120));
  check('the url option is gone entirely', !html.includes('url: `/mb-assets/'));
  check('the bytes are fetched explicitly', html.includes('const pdfRes = await fetch(pdfUrl)'));
  // Order matters: pdfBytes must exist before getDocument reads it.
  check(
    'pdfBytes is defined before it is used',
    html.indexOf('const pdfBytes =') > 0 &&
      html.indexOf('const pdfBytes =') < html.indexOf('data: pdfBytes,'),
  );
  check('a non-OK response is reported, not swallowed', html.includes('HTTP \' + pdfRes.status'));
  check('a 404 hints where the file goes', html.includes('public/mb-assets/books/'));
  check('the worker is still local', html.includes('/mb-assets/vendor/pdfjs/pdf.worker.min.mjs'));
  check(
    'cmaps and fonts stay as plain asset urls',
    html.includes('cMapUrl: `/mb-assets/vendor/pdfjs/cmaps/`') &&
      html.includes('/mb-assets/vendor/pdfjs/standard_fonts/'),
  );
  // The transform must not depend on localised copy: it anchors on the
  // getDocument call, so the source's own overlay wording is left untouched.
  check(
    'the transform anchors on code, not on overlay wording',
    html.includes('const pdfUrl =') && html.includes('const pdfRes = await fetch(pdfUrl)'),
  );
  check(
    'the source’s own loading message is preserved',
    /overlayMsg\.textContent = [^;]+;/.test(html),
  );
}

console.log('book — every sensible field spelling resolves');
{
  const paths = [
    { file: 'books/a.pdf' },
    { path: 'books/b.pdf' },
    { pdf: 'books/c.pdf' },
    { src: 'books/d.pdf' },
    { url: 'books/e.pdf' },
  ];
  for (const entry of paths) {
    const expected = Object.values(entry)[0]!;
    check(`${Object.keys(entry)[0]} -> ${expected}`, pdfPathOf(entry) === expected, pdfPathOf(entry));
  }
  check(
    'a pdf-looking value wins even under an unknown key',
    pdfPathOf({ whatever: 'books/f.pdf' }) === 'books/f.pdf',
  );
  check('whitespace is trimmed', pdfPathOf({ file: '  books/g.pdf  ' }) === 'books/g.pdf');
  check('an empty string is not a path', pdfPathOf({ file: '   ' }) === '');
  check('a non-string field is ignored', pdfPathOf({ file: 123 }) === '', pdfPathOf({ file: 123 }));
  check('an empty entry yields nothing', pdfPathOf({}) === '');
  check('null yields nothing', pdfPathOf(null) === '');
  check(
    'precedence: file beats path',
    pdfPathOf({ path: 'books/x.pdf', file: 'books/y.pdf' }) === 'books/y.pdf',
  );
}

console.log('book — resolveBook mirrors the backend rules');
{
  const data = {
    entries: {
      sgk_toan_10_tap_1: { name: 'Toán 10', file: 'books/sgk.pdf' },
      other: { name: 'Vật lý 11', file: 'books/ly.pdf' },
    },
    aliases: { sgk: 'sgk_toan_10_tap_1', 'math 10': 'sgk_toan_10_tap_1' },
  };
  check(
    'entry key match',
    resolveBook(data, 'sgk_toan_10_tap_1')?.file === 'books/sgk.pdf',
  );
  check('alias match', resolveBook(data, 'sgk')?.file === 'books/sgk.pdf');
  check('alias is case-insensitive', resolveBook(data, 'SGK')?.file === 'books/sgk.pdf');
  check('space-normalised key', resolveBook(data, 'Sgk Toan 10 Tap 1')?.file === 'books/sgk.pdf');
  check('name substring match', resolveBook(data, 'vật lý')?.file === 'books/ly.pdf');
  check('empty term -> first entry', resolveBook(data, '')?.file === 'books/sgk.pdf');
  check('no match -> null', resolveBook(data, 'chemistry') === null);
  check('missing entries -> null', resolveBook({}, 'sgk') === null);
}

console.log('book — the shipped catalog resolves');
{
  const catalog = JSON.parse(
    readFileSync(join(FRONTEND, 'public', 'mb-assets', 'books', 'catalog.json'), 'utf8'),
  ) as { entries: Record<string, unknown>; aliases: Record<string, string> };
  const first = Object.keys(catalog.entries)[0]!;
  const entry = resolveBook(catalog, 'sgk');
  check('the "sgk" alias resolves to an entry', entry !== null, String(entry));
  check(
    'that entry has a usable path',
    entry !== null && pdfPathOf(entry) !== '',
    pdfPathOf(entry),
  );
  check(
    'the default (no term) resolves too',
    pdfPathOf(resolveBook(catalog, '')) !== '',
    pdfPathOf(resolveBook(catalog, '')),
  );
  check('the first entry is the documented default', first.length > 0, first);
}

report();
