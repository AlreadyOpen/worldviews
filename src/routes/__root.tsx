import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import '../app.css'

// Theme before first paint, so a dark-system visitor never sees a light flash.
const theme = `try{var t=new URLSearchParams(location.search).get('theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}`

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'World views' },
      { name: 'description', content: 'Ask a city a question and see it answer, on open data.' }],
    scripts: [{ children: theme }],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head><HeadContent /></head>
      <body><Outlet /><Scripts /></body>
    </html>
  ),
})
