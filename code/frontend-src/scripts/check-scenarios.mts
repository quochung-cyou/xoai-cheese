// Verifies the exported scenario templates and the item catalog stay in sync.
// Run with: node --experimental-strip-types scripts/check-scenarios.mts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, report } from './check-helpers.mts';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCEN = join(FRONTEND, 'public', 'mb-assets', 'scenarios');
const ATLAS = join(FRONTEND, 'public', 'mb-assets', 'atlas');
const CATALOG_SRC = join(FRONTEND, 'src', 'magic-board', 'lib', 'catalog.ts');

const htmlFiles = readdirSync(SCEN).filter((f) => f.endsWith('.html'));
const jsonFiles = readdirSync(SCEN).filter((f) => f.endsWith('.json'));
const ids = htmlFiles.map((f) => f.replace(/\.html$/, '')).sort();
const metaIds = jsonFiles.map((f) => f.replace(/\.json$/, '')).sort();

console.log('templates — exported set');
{
  check('templates were exported', ids.length > 0, String(ids.length));
  check('every template has metadata', JSON.stringify(ids) === JSON.stringify(metaIds), `html=${ids.length} json=${metaIds.length}`);
  check('anatomy_3d is present (3D heart)', ids.includes('anatomy_3d'));
  check('the 3D shape family is present', ['sphere', 'cone', 'torus', 'knot', 'mobius', 'platonic'].every((i) => ids.includes(i)));
  check('the equation plot is present', ids.includes('function_plot'));
  check('the book reader is present', ids.includes('book'));
}

console.log('book — viewer wired, PDF supplied by the operator');
{
  const html = readFileSync(join(SCEN, 'book.html'), 'utf8');
  // Both libraries must resolve to our local vendor tree, absolutely.
  check(
    'PageFlip loads from the local vendor copy',
    html.includes("from '/mb-assets/vendor/page-flip/page-flip.module.js'"),
  );
  check(
    'PDF.js loads from the local vendor copy',
    html.includes("'/mb-assets/vendor/pdfjs/pdf.min.mjs'"),
  );
  check(
    'the PDF.js worker is local too',
    html.includes('/mb-assets/vendor/pdfjs/pdf.worker.min.mjs'),
  );
  check('CMaps and standard fonts are local', html.includes('cmaps/') && html.includes('standard_fonts/'));
  check('the catalog is fetched absolutely', html.includes('`/mb-assets/books/catalog.json`'));
  // The artifact bridge must use this app's names or the reader never gets its state.
  check(
    'the bridge uses this app’s names',
    html.includes('__MAGIC_BOARD_ARTIFACT_ID__') && !html.includes('__AI4EDU_'),
  );
  check(
    'postMessage uses the magic-board source',
    html.includes("source: 'magic-board'") && html.includes("d.source === 'magic-board'"),
  );

  // The libraries really are on disk, and the PDF is the one operator-supplied
  // file — it is copyrighted, so it is expected to be absent from the repo.
  for (const f of [
    'vendor/page-flip/page-flip.module.js',
    'vendor/pdfjs/pdf.min.mjs',
    'vendor/pdfjs/pdf.worker.min.mjs',
    'books/catalog.json',
  ]) {
    check(`vendor asset present: ${f}`, existsSync(join(FRONTEND, 'public', 'mb-assets', f)));
  }

  const catalog = JSON.parse(
    readFileSync(join(FRONTEND, 'public', 'mb-assets', 'books', 'catalog.json'), 'utf8'),
  ) as { entries?: Record<string, { file?: string }>; aliases?: Record<string, string> };
  const entries = Object.values(catalog.entries ?? {});
  check('the catalog lists a book', entries.length > 0, String(entries.length));
  check(
    'every catalog file path is a books/ path',
    entries.every((en) => typeof en.file === 'string' && en.file.startsWith('books/')),
    JSON.stringify(entries.map((en) => en.file)),
  );
  check('aliases point at real entries', Object.values(catalog.aliases ?? {}).every((k) => k in (catalog.entries ?? {})));
  const pdfPresent = entries.some((en) => en.file && existsSync(join(FRONTEND, 'public', 'mb-assets', en.file)));
  console.log(
    pdfPresent
      ? '  ok   the book PDF is present'
      : '  note the book PDF is not in the repo yet — drop it at public/mb-assets/books/ (viewer is ready)',
  );
}

console.log('standalone simulations — small wrappers, local source files');
{
  for (const [id, source] of [
    ['faraday_vi', 'faraday-vi'],
    ['faraday_en', 'faraday-en'],
    ['ph_scale_en', 'ph-scale-en'],
  ]) {
    const html = readFileSync(join(SCEN, `${id}.html`), 'utf8');
    const sourcePath = join(FRONTEND, 'public', 'mb-assets', 'simulations', `${source}.html`);
    check(`${id} preserves standalone simulation on disk`, existsSync(sourcePath));
    check(`${id} uses a lightweight local wrapper`, html.includes(`src="/mb-assets/simulations/${source}.html"`) && html.length < 5000);
    check(`${id} credits source and license`, html.includes('PhET Interactive Simulations') && html.includes('CC BY-NC 4.0'));
  }
  const vi = readFileSync(join(SCEN, 'faraday_vi.html'), 'utf8');
  check('Vietnamese Faraday permits progress storage in nested iframe', vi.includes('allow-same-origin'));
}

console.log('templates — no leftover backend references');
{
  const problems: string[] = [];
  for (const f of htmlFiles) {
    const html = readFileSync(join(SCEN, f), 'utf8');
    if (html.includes('__API_BASE__')) problems.push(`${f}: __API_BASE__`);
    if (!html.includes('__PARAMS__')) problems.push(`${f}: missing __PARAMS__`);
    if (/["'`]\/api\/assets\//.test(html)) problems.push(`${f}: absolute /api/assets/`);
  }
  check('all templates clean', problems.length === 0, problems.join('; '));
}

console.log('templates — three.js comes from the CDN');
{
  const threeTemplates = htmlFiles.filter((f) =>
    readFileSync(join(SCEN, f), 'utf8').includes('type="importmap"'),
  );
  check('3D templates use an import map', threeTemplates.length >= 14, String(threeTemplates.length));
  const bad = threeTemplates.filter((f) => {
    const html = readFileSync(join(SCEN, f), 'utf8');
    return !html.includes('cdn.jsdelivr.net/npm/three@');
  });
  check('import maps point at jsDelivr', bad.length === 0, bad.join(', '));
  // The addons directory must map onto the package's examples/jsm/ folder.
  const addonBad = threeTemplates.filter((f) => {
    const html = readFileSync(join(SCEN, f), 'utf8');
    return html.includes('three/addons/"') && !html.includes('examples/jsm/');
  });
  check('addons map to examples/jsm/', addonBad.length === 0, addonBad.join(', '));

  // Regression: the templates call TransformControls.getHelper(), which only
  // exists from r169 (their own comment says "r169+ API"). Serving an older
  // revision breaks every 3D viewer with "gizmo.getHelper is not a function".
  const versions = new Set(
    threeTemplates.flatMap((f) =>
      [...readFileSync(join(SCEN, f), 'utf8').matchAll(/npm\/three@([0-9.]+)\//g)].map(
        (m) => m[1]!,
      ),
    ),
  );
  check('exactly one three.js revision is pinned', versions.size === 1, [...versions].join(', '));
  const [ver] = [...versions];
  const revision = Number(String(ver).split('.')[1] ?? 0);
  check(
    `pinned three.js r${revision} supports getHelper() (needs r>=169)`,
    revision >= 169,
    `pinned ${ver}`,
  );
  const usesGetHelper = htmlFiles.filter((f) =>
    readFileSync(join(SCEN, f), 'utf8').includes('getHelper()'),
  );
  check('templates do use getHelper()', usesGetHelper.length > 0, String(usesGetHelper.length));
}

console.log('templates — srcdoc documents use absolute asset URLs');
{
  // An artifact iframe is rendered with `srcdoc`: no URL of its own
  // (`about:srcdoc`) and an opaque origin. Document-relative paths therefore
  // resolve against the parent's URL and land on `/atlas/...`, which 404s.
  // The only robust answer is an origin-absolute URL — no base tag, no runtime
  // shim, nothing that can silently fail to run.
  const relative: string[] = [];
  const missingAbsolute: string[] = [];
  for (const f of htmlFiles) {
    const html = readFileSync(join(SCEN, f), 'utf8');
    for (const m of html.matchAll(/['"`]\.\.?\/+(?:atlas|vendor|books|scenarios|mb-assets)\//g)) {
      relative.push(`${f}: ${m[0]}`);
    }
    if (html.includes('${API}') || html.includes('const API =')) {
      missingAbsolute.push(`${f}: still interpolates a runtime base`);
    }
  }
  check('no document-relative asset URLs remain', relative.length === 0, relative.join('; '));
  check('no runtime base constant remains', missingAbsolute.length === 0, missingAbsolute.join('; '));

  // The atlas is the one deep-asset consumer; both of its URLs must be absolute.
  const anatomy = readFileSync(join(SCEN, 'anatomy_3d.html'), 'utf8');
  check(
    'atlas data loads from an absolute URL',
    anatomy.includes('`/mb-assets/atlas/structures.json`'),
  );
  check(
    'atlas chunks load from an absolute URL',
    anatomy.includes('`/mb-assets/${chunk.url}`'),
  );

  // A load failure must be visible rather than leaving a spinner forever.
  const noReporter = htmlFiles.filter(
    (f) => !readFileSync(join(SCEN, f), 'utf8').includes("addEventListener('unhandledrejection'"),
  );
  check('every template reports load failures', noReporter.length === 0, noReporter.join(', '));

  // And every static asset URL the templates reference must exist on disk.
  const notOnDisk: string[] = [];
  for (const f of htmlFiles) {
    const html = readFileSync(join(SCEN, f), 'utf8');
    for (const m of html.matchAll(/['"`](\/mb-assets\/[^'"`\s]*?)['"`]/g)) {
      const url = m[1]!;
      if (url.includes('${')) continue; // runt
      if (!existsSync(join(FRONTEND, 'public', url.replace(/^\//, '')))) {
        notOnDisk.push(`${f}: ${url}`);
      }
    }
  }
  check('every static asset URL exists on disk', notOnDisk.length === 0, notOnDisk.join('; '));

  // The asset host must send a wildcard CORS header, because a null origin
  // always makes a cross-origin request. Required on Cloudflare Pages too.
  const headers = readFileSync(join(FRONTEND, 'public', '_headers'), 'utf8');
  check(
    'Cloudflare Pages _headers sets CORS on the asset tree',
    headers.includes('/mb-assets/*') && headers.includes('Access-Control-Allow-Origin: *'),
  );
  const viteConfig = readFileSync(join(FRONTEND, 'vite.config.ts'), 'utf8');
  check(
    'the dev server sets the same header',
    viteConfig.includes("'Access-Control-Allow-Origin'") && viteConfig.includes('/mb-assets/'),
  );
}

console.log('templates — anatomy data resolves locally');
{
  const html = readFileSync(join(SCEN, 'anatomy_3d.html'), 'utf8');
  check('anatomy still references its data file', html.includes('atlas/structures.json'));
  check('anatomy has no backend asset paths', !html.includes('/api/assets/'));

  check('structures.json was copied', existsSync(join(ATLAS, 'structures.json')));
  const chunks = readdirSync(ATLAS).filter((f) => f.endsWith('.bin.gz'));
  check('atlas chunks were copied', chunks.length >= 15, String(chunks.length));

  // Every chunk the data file references must exist next to it, since the
  // template now resolves them relative to the asset root.
  const data = JSON.parse(readFileSync(join(ATLAS, 'structures.json'), 'utf8')) as {
    chunks?: { url?: string }[];
  };
  const missing = (data.chunks ?? [])
    .map((c) => String(c.url ?? ''))
    .filter((u) => u && !existsSync(join(FRONTEND, 'public', 'mb-assets', u)));
  check('every referenced chunk exists', missing.length === 0, missing.join(', '));
}

console.log('catalog — entries match exported scenarios');
{
  const src = readFileSync(CATALOG_SRC, 'utf8');
  const scenarioRefs = [...src.matchAll(/scenario:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]!);
  check('catalog references scenarios', scenarioRefs.length > 0, String(scenarioRefs.length));

  const unknown = [...new Set(scenarioRefs)].filter((s) => !ids.includes(s));
  check('no catalog entry points at a missing template', unknown.length === 0, unknown.join(', '));

  const itemIds = [...src.matchAll(/^\s*id:\s*'([^']+)'/gm)].map((m) => m[1]!);
  const dupes = itemIds.filter((id, i) => itemIds.indexOf(id) !== i);
  check('catalog ids are unique', dupes.length === 0, dupes.join(', '));

  // Every catalogued item should be reachable from at least one category.
  const anatomyRefs = [...src.matchAll(/anatomy\(\s*'([^']+)'/g)].map((m) => m[1]!);
  check('anatomy presets are declared', anatomyRefs.length >= 5, String(anatomyRefs.length));
  // Structural, not literal: the catalog is localised, so assert the wiring —
  // an anatomy preset focused on the heart, and a matching quick chip — rather
  // than any particular spelling of the label.
  check(
    'a 3D heart preset exists',
    /anatomy\(\s*'[^']+',\s*'[^']*',\s*'heart'/.test(src),
  );
  check('a heart quick chip exists', /\{\s*label:\s*'[^']*',\s*focus:\s*'heart'\s*\}/.test(src));
  check(
    'the textbook item points at the book template',
    // The item helper takes the scenario id positionally, so match that shape.
    /item\(\s*'[^']*',\s*'[^']*',\s*'book'/.test(src),
  );
}

report();
