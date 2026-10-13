import { createFileRoute, ClientOnly } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

// The simulator page: the same app, opening on the Cities: Skylines-style layout (ui=cs1; cs2 and catalog in the options).
const App = lazy(() => import('../app').then(m => ({ default: m.App })))

export const Route = createFileRoute('/sim')({
  component: () => (
    <ClientOnly fallback={<main className="app" aria-busy="true" />}>
      <Suspense fallback={<main className="app" aria-busy="true" />}><App sim /></Suspense>
    </ClientOnly>
  ),
})
