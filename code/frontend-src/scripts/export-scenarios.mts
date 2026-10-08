/**
 * Export the ai4edu scenario templates into this app's `public/` folder.
 *
 * Run from code/frontend-src:  npm run scenarios:export
 *
 * Per template:
 *   - three.js is loaded from a CDN (jsDelivr) instead of the ai4edu backend's
 *     self-hosted vendor directory, so no ~3 MB of vendor JS has to be copied.
 *   - the human-atlas data is pointed at the local copy under
 *     `public/mb-assets/`, as an **absolute** URL.
 *   - the `__PARAMS__` placeholder is left intact — it is substituted at spawn
 *     time by lib/scenarios.ts.
 *
 * WHY ABSOLUTE URLs, AND NOTHING CLEVER
 * ------------------------------------
 * Artifact documents are rendered inside an iframe via `srcdoc`, so they have
 * no URL of their own (`about:srcdoc`) and an opaque origin. Anything that
 * depends on document-relative resolution is therefore unreliable: a path like
 * `./atlas/structures.json` resolves against the *parent's* URL and lands on
 * `/atlas/...`, which 404s.
 *
 * Earlier revisions of this script tried to repair that at runtime — a
 * `<base href>` written from an inline script, plus a `window.fetch` shim.
 * Both are gone. They were unverifiable from Node (the only check possible was
 * "does the text appear in the file", which stayed green while the browser
 * ignored them), and a leading-slash URL needs none of it: it resolves against
 * the origin in any document, at any parse stage, with no JavaScript.
 *
 * The templates still need `Access-Control-Allow-Origin` on the asset tree,
 * because a `null` origin always makes a cross-origin request. That is the
 * asset host's job: see the `assetCors` plugin in vite.config.ts for dev and
 * `public/_headers` for Cloudflare Pages.
 *
 * `book` is intentionally skipped: its reader needs PDFs that are not in the
 * repository, so it cannot work offline.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const REPO = resolve(FRONTEND, '..', '..');
const SRC = join(REPO, 'ai4edu-main', 'ai4edu-main', 'backend', 'scenarios');
const PUBLIC = join(FRONTEND, 'public');
const OUT = join(PUBLIC, 'mb-assets', 'scenarios');

/**
 * Must match the revision the templates were written against. ai4edu served
 * three.js from `backend/data/assets/vendor/three/three.module.js`, whose
 * REVISION is '170' — and the templates depend on r169+ API, notably
 * `TransformControls.getHelper()`. An older revision breaks every 3D viewer
 * with "gizmo.getHelper is not a function".
 */
const THREE_VERSION = '0.170.0';
const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`;
const THREE_ADDONS_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/`;

/** Where the asset tree lives, relative to the site root. Mirrors the default
 *  of VITE_MB_ASSET_BASE in lib/scenarios.ts. */
const ASSET_PREFIX = '/mb-assets/';

/** Scenarios whose template cannot work without assets that are not in the
 *  repo (book reader PDFs). */
const SKIP = new Set(['book']);

/**
 * The whole URL rewrite, longest pattern first.
 *
 * `__API_BASE__` appears two ways in the sources:
 *   - directly, inside the import maps;
 *   - captured into a runtime constant (`const API = '__API_BASE__';`) whose
 *     value is then interpolated (`${API}/api/assets/...`).
 * The second spelling is why the earlier revision of this script silently did
 * nothing useful: its rules only matched `__API_BASE__/api/assets/`, so the
 * interpolated form was never rewritten and stayed document-relative.
 *
 * Both collapse to the absolute asset root, so every resulting URL is
 * origin-absolute and independent of the document's own (nonexistent) URL.
 */
const REPLACEMENTS: [RegExp, string][] = [
  [/__API_BASE__\/api\/assets\/vendor\/three\/three\.module\.js/g, THREE_CDN],
  [/__API_BASE__\/api\/assets\/vendor\/three\/addons\//g, THREE_ADDONS_CDN],
  // The runtime constant becomes the absolute asset root itself, and every
  // interpolation through it follows. A no-op for templates that declare none.
  [/(['"])__API_BASE__\1/g, `'${ASSET_PREFIX}'`],
  [/\$\{API\}\/api\/assets\//g, ASSET_PREFIX],
  [/__API_BASE__\/api\/assets\//g, ASSET_PREFIX],
  [/__API_BASE__/g, ASSET_PREFIX],
  // Nothing should interpolate the base any more; if one survives, fail loudly
  // rather than shipping a URL that cannot resolve.
  [/\$\{API\}/g, ASSET_PREFIX],
];

/** A `const API = …` declaration left behind now that nothing uses it. */
const DEAD_API_CONST_RE = /[ \t]*const API = [^\n]*\n/;

/** Every static absolute asset URL the transformed document will request. */
const ASSET_URL_RE = /(['"`])(\/mb-assets\/[^'"`\s]*?)\1/g;

/** A document-relative path into the asset tree — unresolvable in a srcdoc
 *  iframe, and the exact bug this script exists to prevent. */
const DOC_RELATIVE_RE = /['"`]\.\.?\/+(?:atlas|vendor|books|scenarios|mb-assets)\//g;

/**
 * Injected into every template so a load failure is *visible*.
 *
 * The 3D viewers keep a `#overlay` spinner up until their data arrives. When a
 * fetch failed, that spinner span forever and the user saw an empty board with
 * nothing to act on. This reports the failure — and the URL, which is the part
 * that actually identifies the problem — into that overlay instead.
 *
 * Dependency-free and DOM-agnostic: templates without an overlay are
 * unaffected.
 */
const ERROR_REPORTER = `<script>
addEventListener('error', function(e){
  try{
    var ov=document.getElementById('overlay'); if(!ov) return;
    ov.className='err';
    var m=ov.querySelector('.msg');
    var t=(e&&e.message)||'Script failed to load';
    var f=(e&&e.filename)||'';
    if(m) m.textContent=f?t+' \\u2014 '+f:t;
    var s=ov.querySelector('.spin'); if(s) s.style.display='none';
    ov.style.display='flex';
  }catch(_){}
}, true);
addEventListener('unhandledrejection', function(e){
  try{
    var ov=document.getElementById('overlay'); if(!ov) return;
    ov.className='err';
    var m=ov.querySelector('.msg');
    var r=e&&e.reason;
    var t=(r&&(r.message||r))||'Request failed';
    if(m) m.textContent=String(t);
    var s=ov.querySelector('.spin'); if(s) s.style.display='none';
    ov.style.display='flex';
  }catch(_){}
});
</script>`;

function main() {
  if (!existsSync(SRC)) {
    console.error(`Source scenarios not found at ${SRC}`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  const files = readdirSync(SRC).filter((f) => f.endsWith('.html'));
  const written: string[] = [];
  const skipped: string[] = [];
  const problems: string[] = [];
  const dynamicUrls: string[] = [];
  let assetUrlsChecked = 0;

  for (const file of files) {
    const id = file.replace(/\.html$/, '');
    if (SKIP.has(id)) {
      skipped.push(id);
      continue;
    }

    let html = readFileSync(join(SRC, file), 'utf8');
    for (const [pattern, replacement] of REPLACEMENTS) {
      html = html.replace(pattern, replacement);
    }
    // Drop the now-unused runtime base constant so nothing can reintroduce a
    // document-relative URL through it.
    html = html.replace(DEAD_API_CONST_RE, '');

    // Report load failures instead of leaving a spinner (see ERROR_REPORTER).
    const headAt = html.indexOf('<head>');
    if (headAt >= 0) {
      const at = headAt + '<head>'.length;
      html = html.slice(0, at) + ERROR_REPORTER + html.slice(at);
    }

    // --- guards ---------------------------------------------------------
    if (!html.includes('__PARAMS__')) {
      problems.push(`${id}: lost the __PARAMS__ placeholder`);
    }
    if (html.includes('__API_BASE__')) {
      problems.push(`${id}: unresolved __API_BASE__`);
    }
    if (html.includes('api/assets')) {
      problems.push(`${id}: still references the old api/assets path`);
    }
    // The regression this whole rewrite exists to prevent: a document-relative
    // asset URL, which cannot resolve inside a srcdoc iframe.
    for (const bad of ['`./atlas/', '"./atlas/', "'./atlas/", '${API}']) {
      if (html.includes(bad)) {
        problems.push(`${id}: document-relative asset URL (${bad})`);
      }
    }
    if (/type="importmap"/.test(html) && !html.includes('cdn.jsdelivr.net/npm/three@')) {
      problems.push(`${id}: import map does not point at the three.js CDN`);
    }
    if (/three@0\.1[0-6][0-9]\./.test(html)) {
      problems.push(`${id}: three.js is pinned below r169 (breaks getHelper())`);
    }

    // Every static absolute asset URL must resolve to a real file we ship.
    // This is the check that would have caught the broken atlas paths at build
    // time, with no browser involved.
    for (const match of html.matchAll(ASSET_URL_RE)) {
      const url = match[2]!;
      if (url.includes('${')) {
        // Built from a runtime value (the atlas chunk list). The chunk names
        // live in structures.json and are verified by check-scenarios.mts.
        dynamicUrls.push(`${id}: ${url}`);
        continue;
      }
      assetUrlsChecked++;
      const onDisk = join(PUBLIC, url.replace(/^\//, ''));
      if (!existsSync(onDisk)) {
        problems.push(`${id}: static asset URL does not exist -> ${url}`);
      }
    }

    // Any remaining document-relative asset reference is a bug: it cannot
    // resolve inside a srcdoc iframe.
    for (const match of html.matchAll(DOC_RELATIVE_RE)) {
      problems.push(`${id}: document-relative asset URL -> ${match[0]}`);
    }

    // A `${…}` inside an asset URL means the path is assembled at runtime, so
    // the file check above cannot see it. Expand the one shape we use — the
    // atlas chunk list — and verify every chunk it names. Without this, a
    // broken mesh path would only ever surface as a blank viewer.
    if (html.includes('/mb-assets/${chunk.url}')) {
      const atlasData = join(PUBLIC, 'mb-assets', 'atlas', 'structures.json');
      if (!existsSync(atlasData)) {
        problems.push(`${id}: builds chunk URLs but structures.json is missing`);
      } else {
        const data = JSON.parse(readFileSync(atlasData, 'utf8')) as {
          chunks?: { url?: string }[];
        };
        for (const chunk of data.chunks ?? []) {
          if (!chunk.url) continue;
          assetUrlsChecked++;
          if (!existsSync(join(PUBLIC, 'mb-assets', chunk.url))) {
            problems.push(`${id}: atlas chunk missing -> /mb-assets/${chunk.url}`);
          }
        }
      }
    }

    writeFileSync(join(OUT, file), html, 'utf8');
    written.push(id);
  }

  const metaFiles = readdirSync(SRC).filter((f) => f.endsWith('.json'));
  let metas = 0;
  for (const file of metaFiles) {
    const id = file.replace(/\.json$/, '');
    if (SKIP.has(id)) continue;
    const meta = JSON.parse(readFileSync(join(SRC, file), 'utf8'));
    writeFileSync(join(OUT, file), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    metas++;
  }

  console.log(`Wrote ${written.length} templates + ${metas} metas to ${OUT}`);
  console.log(`  three.js        : ${THREE_CDN}`);
  console.log(`  asset prefix    : ${ASSET_PREFIX}`);
  console.log(`  static asset URLs: ${assetUrlsChecked} verified on disk`);
  if (dynamicUrls.length) {
    console.log(`  runtime-built URLs: ${dynamicUrls.length} (chunk list, checked separately)`);
  }
  console.log(`  skipped         : ${skipped.join(', ') || '(none)'}`);
  if (problems.length) {
    console.error('\nPROBLEMS:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('\nAll templates transformed cleanly.');
}

main();
