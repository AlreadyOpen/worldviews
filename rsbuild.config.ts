import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/rsbuild'

// MapLibre 6 starts its worker from a URL the bundler cannot follow: ship the worker files as-is (engine.ts setWorkerUrl).
const COPY = { copy: [{ from: 'node_modules/maplibre-gl/dist/maplibre-gl-{worker,shared}.mjs', to: 'maplibre/[name][ext]' }] }

export default defineConfig({
  // dev only: ?firehold=local draws the HOLD fire layers from the local CFS preview (fire.ts); production builds never reference it
  server: { port: 8760, host: '127.0.0.1', proxy: { '/cfs-preview': { target: 'http://127.0.0.1:8765', pathRewrite: { '^/cfs-preview': '' } } } },
  // satellite.js 7 exports optional WASM builds that import Node built-ins; the app uses only its JS SGP4, so leave them out.
  resolve: { alias: { '#wasm-single-thread': false, '#wasm-multi-thread': false } },
  // Static sites (Cloudflare Pages, or any static server): the one route is prerendered at build time, so there is no server at
  // runtime. Each edition builds into its own folder; the site is <folder>/client.
  output: { ...COPY, distPath: { root: `dist-${process.env.PUBLIC_EDITION === 'full' ? 'full' : 'libre'}` } },
  plugins: [pluginReact(), tanstackStart({ prerender: { enabled: true, crawlLinks: false, failOnError: true } })],
})
