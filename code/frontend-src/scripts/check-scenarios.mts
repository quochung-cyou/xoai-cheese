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
  check('the book reader is excluded (needs PDFs not in the repo)', !ids.includes('book'));
  check('anatomy_3d is present (3D heart)', ids.includes('anatomy_3d'));
  check('the 3D shape family is present', ['sphere', 'cone', 'torus', 'knot', 'mobius', 'platonic'].every((i) => ids.includes(i)));
  check('the equation plot is present', ids.includes('function_plot'));
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
  check(
    'the named 3D heart preset exists',
    src.includes("'3D heart'") && src.includes("'heart'"),
  );
}

report();
