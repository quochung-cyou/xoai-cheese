import { existsSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const ASSET_PREFIX = '/mb-assets/'
const PUBLIC_DIR = path.resolve(import.meta.dirname, 'public')

/**
 * Serve `public/mb-assets/**` like a plain static host.
 *
 * Two problems this solves, both specific to artifact iframes:
 *
 * 1. **CORS.** Excalidraw builds the iframe's `sandbox` attribute itself and
 *    only adds `allow-same-origin` for its own recognized embed types, so an
 *    artifact document always has an opaque (`null`) origin. Every request it
 *    makes is therefore cross-origin. The ai4edu backend served these assets
 *    with `Access-Control-Allow-Origin: *` for exactly this reason.
 *    `public/_headers` does the same job on Cloudflare Pages.
 *
 * 2. **404s must be 404s.** Vite's SPA fallback happily answers a missing
 *    static file with `index.html` and a 200. A missing book PDF then looks
 *    like a successful download and PDF.js fails on HTML bytes with a confusing
 *    error. Real missing files now return 404, matching production, so the
 *    template's own error reporter names the actual problem.
 */
function assetServer(): Plugin {
  const apply = (
    req: { url?: string; method?: string },
    res: {
      setHeader(k: string, v: string): void
      statusCode: number
      end(body?: string): void
    },
    next: () => void,
  ) => {
    const url = req.url
    if (!url || !url.startsWith(ASSET_PREFIX)) {
      next()
      return
    }

    const rel = decodeURIComponent(url.slice(ASSET_PREFIX.length).split('?')[0] ?? '')
    // Resolve inside public/ and refuse anything that escapes it.
    const target = path.resolve(PUBLIC_DIR, 'mb-assets', rel)
    const root = path.resolve(PUBLIC_DIR, 'mb-assets')
    const contained = target === root || target.startsWith(root + path.sep)

    if (!contained || !existsSync(target)) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`Not found: ${url}\n`)
      return
    }

    res.setHeader('Access-Control-Allow-Origin', '*')
    next()
  }

  return {
    name: 'magic-board-asset-server',
    configureServer(server) {
      server.middlewares.use(apply)
    },
    configurePreviewServer(server) {
      server.middlewares.use(apply)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), assetServer()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
