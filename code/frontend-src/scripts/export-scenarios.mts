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
 *  repo. Currently empty — `book` is included, but it needs its PDF dropped
 *  into `public/mb-assets/books/` (see the note in that folder). */
const SKIP = new Set<string>();

/**
 * Renames applied to every template so they speak this app's protocol rather
 * than ai4edu's. These are the artifact↔host globals: `lib/artifactDoc.ts`
 * injects `__MAGIC_BOARD_ARTIFACT_ID__` and `lib/artifacts.ts` listens for
 * `source: 'magic-board'`, so a template using the old names would never
 * receive its saved state.
 */
const BRIDGE_RENAMES: [RegExp, string][] = [
  [/__AI4EDU_ARTIFACT_ID__/g, '__MAGIC_BOARD_ARTIFACT_ID__'],
  // Both the outgoing `source:` field and the incoming comparison.
  [/'ai4edu'/g, "'magic-board'"],
];

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

/**
 * Book-only hardening.
 *
 * The reader is the one template whose data comes from a file an operator is
 * expected to edit (`books/catalog.json`), so its entry shape is not really
 * fixed: `file` may be spelled `path` / `pdf` / `src`, and a hand-made catalog
 * can easily produce an entry with no usable path at all.
 *
 * PDF.js reports a missing path as `Invalid PDF url data: either string or
 * URL-object is expected in the url property`, which names neither the entry
 * nor the field. This hook normalizes the known spellings and, when there is
 * still no path, reports the catalog shape instead — so the failure points at
 * the catalog rather than at PDF.js.
 */
const BOOK_TRANSFORMS: [string, string][] = [
  [
    'async function main() {',
    `function pdfPathOf(entry) {
  // Accept the sensible spellings; first non-empty string wins.
  for (const k of ['file', 'path', 'pdf', 'src', 'url']) {
    const v = entry && entry[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // Last resort: any string value in the entry that looks like a PDF path.
  for (const v of Object.values(entry || {})) {
    if (typeof v === 'string' && /\\.pdf(\\?|$)/i.test(v)) return v;
  }
  return '';
}

async function main() {`,
  ],
  [
    'const entry = resolveBook(data, PARAMS.book);',
    `const entry = resolveBook(data, PARAMS.book);
  // Name the exact problem instead of letting PDF.js report a bare type error.
  if (!entry) {
    const known = Object.keys(data && data.entries ? data.entries : {});
    fail('No catalog entry for "' + String(PARAMS.book) +
      '". Catalog keys: ' + (known.join(', ') || '(none)'));
    return;
  }
  const pdfPath = pdfPathOf(entry);
  if (!pdfPath) {
    fail('Catalog entry "' + (entry.name || '?') +
      '" has no PDF path. Entry keys: ' + Object.keys(entry).join(', '));
    return;
  }`,
  ],
  [
    'url: `/mb-assets/${entry.file}`,',
    'data: pdfBytes,',
  ],
  [
    'if (!entry || !entry.file) {',
    'if (!entry || !pdfPathOf(entry)) {',
  ],
  // Fetch the bytes explicitly. PDF.js validates `url` with
  // `URL.parse(url, window.location)`; inside a sandboxed `srcdoc` iframe the
  // document URL is `about:srcdoc`, which is not a valid base, so that parse
  // returns null and PDF.js throws "Invalid PDF url data..." WITHOUT making a
  // request. It is the same opaque-origin problem that affects every other
  // asset lookup in these documents.
  //
  // Passing `data:` sidesteps URL resolution entirely, and a 404 then surfaces
  // as a readable message instead of a type error. `cMapUrl` /
  // `standardFontDataUrl` stay as strings — PDF.js loads those through a plain
  // fetch, which resolves relative asset paths fine.
  //
  // Anchored on the `getDocument` call, not on surrounding copy, because the
  // overlay wording is localised (and localisation must not break the export).
  [
    'const doc = await pdfjsLib.getDocument({',
    `const pdfUrl = \`/mb-assets/\${pdfPath}\`;
  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) {
    fail(pdfUrl + ' -> HTTP ' + pdfRes.status +
      (pdfRes.status === 404
        ? ' (thiếu tệp: hãy đặt PDF vào public/mb-assets/books/)'
        : ''));
    return;
  }
  const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
  const doc = await pdfjsLib.getDocument({`,
  ],
];

/** Every static absolute asset URL the transformed document will request. */
const ASSET_URL_RE = /(['"`])(\/mb-assets\/[^'"`\s]*?)\1/g;

/**
 * Asset files that are legitimately absent from the repo and must be supplied
 * by the operator. `book` ships its viewer and catalog but not the PDF itself
 * (the book is copyrighted material), so its URL is reported, not enforced.
 */
const OPERATOR_SUPPLIED = [/^\/mb-assets\/books\/.*\.pdf$/i];

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
(function(){
  var ov=function(){ return document.getElementById('overlay'); };
  var show=function(text){
    try{
      var o=ov(); if(!o) return;
      o.className='err';
      var m=o.querySelector('.msg');
      if(m) m.textContent=text;
      var s=o.querySelector('.spin'); if(s) s.style.display='none';
      o.style.display='flex';
    }catch(_){}
  };
  // Name the URL that failed. "Failed to fetch" alone identifies nothing —
  // the path is what points at the missing or mis-pathed asset.
  var detail=function(e){
    var r=e&&e.reason!==undefined?e.reason:(e||{});
    var msg=(r&&(r.message||r))||'Request failed';
    msg=String(msg);
    if(r&&r.url&&msg.indexOf(r.url)<0) return msg+' — '+r.url;
    if(e&&e.filename) return msg+' — '+e.filename;
    return msg;
  };
  addEventListener('error',function(e){ show(detail(e)); },true);
  addEventListener('unhandledrejection',function(e){ show(detail(e)); });
})()
</script>`;

/**
 * Vietnamese diacritics. Used only to *detect* localised copy — the exporter
 * itself is language-agnostic and never rewrites prose.
 *
 * Covers the base-vowel diacritic ranges (à á ả ã ạ è é … ỹ) plus the
 * Vietnamese-only letters đ and the horned/breve vowels ơ ư ă. `â ê ô` are
 * deliberately excluded: they are common in French and Portuguese, so on their
 * own they are not evidence of Vietnamese.
 */
const VN_CHARS =
  /[đĐơƠưƯăĂ]|[\u00e0-\u00e5\u00e8-\u00eb\u00ec-\u00ef\u00f2-\u00f6\u00f9-\u00fc\u00fd\u00ff]|[\u1ea0-\u1ef9]/;

/**
 * A hard stop before overwriting localised templates.
 *
 * `npm run scenarios:export` regenerates every file in `public/mb-assets/` from
 * the English templates under `ai4edu-main/`. Those exported files are
 * **committed to git** and their UI copy is Vietnamese, so a routine export
 * silently reverts the whole localization — which is exactly what happened once
 * already: a single export wiped 16 hand-translated templates with no error and
 * no diff to review.
 *
 * The guard compares the copy that is about to be written against what is
 * already on disk. If the outgoing template is unlocalised while the shipped one
 * is localised, that is a regression, and the run aborts listing the files
 * instead of destroying the work.
 *
 * Translate the templates under `SCENARIOS_SRC` and re-export to clear this;
 * set `MB_ALLOW_UNLOCALIZED_EXPORT=1` to override deliberately (e.g. when you
 * are about to re-apply the localization afterwards).
 */
function guardLocalizedOverwrite(
  outDir: string,
  ids: string[],
  rendered: Map<string, string>,
  ext: string,
): string[] {
  const regressions: string[] = [];
  for (const id of ids) {
    const file = join(outDir, `${id}${ext}`);
    if (!existsSync(file)) continue;
    const onDisk = readFileSync(file, 'utf8');
    const next = rendered.get(id) ?? '';
    if (VN_CHARS.test(onDisk) && !VN_CHARS.test(next)) regressions.push(`${id}${ext}`);
  }
  return regressions;
}

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
  const operatorSupplied = new Set<string>();
  const rendered = new Map<string, string>();
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
    for (const [pattern, replacement] of BRIDGE_RENAMES) {
      html = html.replace(pattern, replacement);
    }
    // Per-template hardening, applied after the generic rewrites.
    if (id === 'book') {
      let applied = 0;
      for (const [needle, replacement] of BOOK_TRANSFORMS) {
        if (html.includes(needle)) {
          html = html.replace(needle, replacement);
          applied++;
        } else {
          problems.push(`book: expected snippet not found -> ${needle.slice(0, 60)}`);
        }
      }
      if (applied !== BOOK_TRANSFORMS.length) {
        problems.push(`book: only ${applied}/${BOOK_TRANSFORMS.length} transforms applied`);
      }
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
        if (OPERATOR_SUPPLIED.some((re) => re.test(url))) {
          operatorSupplied.add(url);
        } else {
          problems.push(`${id}: static asset URL does not exist -> ${url}`);
        }
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

    rendered.set(id, html);
    written.push(id);
  }

  // Render the metadata up front so the guard below can see it too.
  const metaFiles = readdirSync(SRC).filter((f) => f.endsWith('.json'));
  const renderedMeta = new Map<string, string>();
  const metaIds: string[] = [];
  for (const file of metaFiles) {
    const id = file.replace(/\.json$/, '');
    if (SKIP.has(id)) continue;
    const meta = JSON.parse(readFileSync(join(SRC, file), 'utf8'));
    renderedMeta.set(id, JSON.stringify(meta, null, 2) + '\n');
    metaIds.push(id);
  }

  // Refuse to clobber localised templates (see guardLocalizedOverwrite).
  if (!process.env.MB_ALLOW_UNLOCALIZED_EXPORT) {
    const regressions = [
      ...guardLocalizedOverwrite(OUT, written, rendered, '.html'),
      ...guardLocalizedOverwrite(OUT, metaIds, renderedMeta, '.json'),
    ];
    if (regressions.length) {
      console.error(
        '\nREFUSING TO EXPORT — this run would replace Vietnamese files with English ones:\n',
      );
      for (const name of regressions) console.error(`  - ${name}`);
      console.error(
        `\n${regressions.length} of ${written.length + metaIds.length} files would regress.` +
          '\nThe shipped files under public/mb-assets/scenarios are committed and localized.' +
          '\nTranslate the templates in the source tree first, or set' +
          '\nMB_ALLOW_UNLOCALIZED_EXPORT=1 to override.\n',
      );
      process.exit(1);
    }
  }

  for (const id of written) {
    writeFileSync(join(OUT, `${id}.html`), rendered.get(id)!, 'utf8');
  }
  for (const id of metaIds) {
    writeFileSync(join(OUT, `${id}.json`), renderedMeta.get(id)!, 'utf8');
  }
  let metas = metaIds.length;

  console.log(`Wrote ${written.length} templates + ${metas} metas to ${OUT}`);
  console.log(`  three.js        : ${THREE_CDN}`);
  console.log(`  asset prefix    : ${ASSET_PREFIX}`);
  console.log(`  static asset URLs: ${assetUrlsChecked} verified on disk`);
  if (dynamicUrls.length) {
    console.log(`  runtime-built URLs: ${dynamicUrls.length} (chunk list, checked separately)`);
  }
  if (operatorSupplied.size) {
    console.log(
      `  awaiting operator  : ${[...operatorSupplied].join(', ')} (drop the file in public/)`,
    );
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
