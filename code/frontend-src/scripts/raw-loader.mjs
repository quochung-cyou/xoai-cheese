/**
 * Node loader hooks so the browser modules can be exercised by the
 * `scripts/check-*.mts` harnesses.
 *
 * Two things Vite does that plain Node does not:
 *   1. `./prompts/foo.txt?raw` resolves to the file's text. Node has no idea
 *      what that query means, which is why modules importing prompts were
 *      previously untestable outside the bundle.
 *   2. Extensionless relative imports (`./settings`, `../lib/types`) resolve to
 *      `.ts` / `.tsx`. Node requires the extension.
 *
 * Used via:  node --import ./scripts/raw-loader.mjs …
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '/index.ts'];

export async function resolve(specifier, context, next) {
  // Keep the `?raw` marker so `load` knows to read the file as text.
  const query = specifier.indexOf('?raw');
  if (query !== -1) {
    const resolved = await resolveBare(specifier.slice(0, query), context, next);
    return { ...resolved, url: resolved.url + '?raw', shortCircuit: true };
  }
  return resolveBare(specifier, context, next);
}

async function resolveBare(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    // Only retry for relative specifiers that look extensionless.
    if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw e;
    for (const ext of EXTENSIONS) {
      try {
        return await next(specifier + ext, context);
      } catch {
        /* try the next extension */
      }
    }
    throw e;
  }
}

export async function load(url, context, next) {
  if (url.includes('?raw')) {
    const path = fileURLToPath(url.slice(0, url.indexOf('?raw')));
    const source = await readFile(path, 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }

  const result = await next(url, context);
  if (result.format !== 'module' || typeof result.source === 'undefined') {
    return result;
  }

  // Vite injects `import.meta.env`; give Node an empty one so modules that
  // read build-time defaults (lib/settings.ts) can be imported and tested.
  const source =
    typeof result.source === 'string'
      ? result.source
      : Buffer.from(result.source).toString('utf8');
  return {
    ...result,
    source: `import.meta.env ||= {};\n${source}`,
  };
}
