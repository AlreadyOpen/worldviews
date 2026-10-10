import { createFileRoute, ClientOnly } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

// The map is browser-only (WebGL, window), so the app renders after hydration.
const App = lazy(() => import('../app').then(m => ({ default: m.App })))

export const Route = createFileRoute('/')({
  component: () => (
    <ClientOnly fallback={<main className="app" aria-busy="true" />}>
      <Suspense fallback={<main className="app" aria-busy="true" />}><App /></Suspense>
    </ClientOnly>
  ),
})
