import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/rsbuild'

export default defineConfig({
  server: { port: 8760, host: '127.0.0.1' },
  // MapLibre 6 starts its worker from a URL the bundler cannot follow: ship the worker files as-is (engine.ts setWorkerUrl).
  output: { copy: [{ from: 'node_modules/maplibre-gl/dist/maplibre-gl-{worker,shared}.mjs', to: 'maplibre/[name][ext]' }] },
  // satellite.js 7 exports optional WASM builds that import Node built-ins; the app uses only its JS SGP4, so leave them out.
  resolve: { alias: { '#wasm-single-thread': false, '#wasm-multi-thread': false } },
  plugins: [pluginReact(), tanstackStart()],
})
