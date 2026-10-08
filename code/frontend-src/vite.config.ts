import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Serve `public/mb-assets/**` with a wildcard CORS header.
 *
 * The generated simulations run inside sandboxed iframes. Excalidraw builds
 * the iframe's `sandbox` attribute itself and only adds `allow-same-origin` for
 * its own recognized embed types, so an artifact document always has an opaque
 * (`null`) origin — which makes every request it makes cross-origin. The ai4edu
 * backend served these assets with `Access-Control-Allow-Origin: *` for exactly
 * this reason. `public/_headers` does the same job on Cloudflare Pages; this
 * keeps dev and preview in step.
 */
function assetCors(): Plugin {
  const apply = (
    req: { url?: string },
    res: { setHeader(k: string, v: string): void },
    next: () => void,
  ) => {
    if (req.url?.startsWith('/mb-assets/')) {
      res.setHeader('Access-Control-Allow-Origin', '*')
    }
    next()
  }
  return {
    name: 'magic-board-asset-cors',
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
  plugins: [react(), tailwindcss(), assetCors()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
