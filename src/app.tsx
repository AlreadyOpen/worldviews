import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { Checkbox } from '@base-ui/react/checkbox'
import { Popover } from '@base-ui/react/popover'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { Slider } from '@base-ui/react/slider'
import 'iconify-icon'
import './icons'
import './legend'
import type { LegendSpec } from './legend'
import { World, type Pick, type Theme } from './engine'
import { answer, type Answer } from './answers'
import * as D from './data'
import * as Sat from './sats'
import { aemo, auState, NEM_REGION } from './local'
import { HK, SOURCES, VIEWS, VIEW_IDS, type ViewId } from './views'
import { FIRE_DEFAULT, FIRE_MODES, isFireMode, type FireMode } from './fire'

// Every open design option is a URL parameter and a control (eyeball-all-options); the URL holds the whole state.
const OPTIONS = {
  ui: { label: 'Layout', values: { catalog: 'Data catalog (questions and answers)', cs1: 'Simulator, Cities: Skylines 1 style', cs2: 'Simulator, Cities: Skylines II style' } },
  feed: { label: 'News feed (Chirper-style)', values: { on: 'On', off: 'Off' } },
  marks: { label: 'Markers at city zoom', values: { three: '3D objects (three.js)', shapes: '3D shapes (MapLibre extrusions)', '2d': '2D markers' } },
  switch: { label: 'How views switch', values: { v1: 'V1. One view at a time', v2: 'V2. Free layer toggles', v3: 'V3. Base city + one view', v4: 'V4. V3 + compare split', v5: 'V5. Topics with their own maps', v6: 'V6. All data maps grid' } },
  panel: { label: 'City panel', values: { p1: 'P1. None', p2: 'P2. City card', p3: 'P3. City card + a meter per view' } },
  time: { label: 'Time', values: { t1: 'T1. Live only', t2: 'T2. Live + a day slider', t3: 'T3. Live + history' } },
  theme: { label: 'Theme', values: { system: 'Follow the system', light: 'Light', dark: 'Dark' } },
  names: { label: 'View names', values: { question: 'Questions', noun: 'Nouns' } },
} as const
type S = { ui: string; feed: string; marks: string; switch: string; panel: string; time: string; theme: string; names: string; view: ViewId | ''; on: ViewId[]; sub: Partial<Record<ViewId, string>>; b: ViewId; hour: number; day: number; fire: FireMode }
const DEFAULT: S = { ui: 'catalog', feed: 'on', marks: 'three', switch: 'v3', panel: 'p2', time: 't1', theme: 'system', names: 'question', view: 'height', on: ['height'], sub: {}, b: 'hazards', hour: 24, day: 30, fire: FIRE_DEFAULT }
const WORLD = { center: [96, 20] as [number, number], zoom: 1.85, pitch: 0, bearing: 0 }
const isView = (v: any): v is ViewId => VIEW_IDS.includes(v)
// Read once at load: the URL is rewritten from state right after, and `at` (camera) is not part of state.
// at: 'hk', or 'lon,lat,zoom' for any place
const camAt = (at: string | null) => { const n = (at || '').split(',').map(Number); return at === 'hk' ? HK : n.length === 3 && n.every(Number.isFinite) ? { center: [n[0], n[1]] as [number, number], zoom: n[2], pitch: 0, bearing: 0 } : WORLD }
const AT = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('at') : null
const INTRO = typeof location !== 'undefined' && !AT && !new URLSearchParams(location.search).has('view')

function parse(q: URLSearchParams, base: S = DEFAULT): S {
  const s: S = { ...base, sub: { ...base.sub } }
  for (const k of Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]) { const v = q.get(k); if (v && v in OPTIONS[k].values) (s as any)[k] = v }
  if (q.has('view')) s.view = isView(q.get('view')) ? (q.get('view') as ViewId) : ''
  if (q.has('on')) s.on = q.get('on')!.split(',').filter(isView)
  if (isView(q.get('b'))) s.b = q.get('b') as ViewId
  for (const part of (q.get('sub') || '').split(',').filter(Boolean)) { const [v, id] = part.split(':'); if (isView(v)) s.sub[v] = id }
  if (q.has('hour')) s.hour = Math.max(0, Math.min(24, +q.get('hour')!))
  if (q.has('day')) s.day = Math.max(0, Math.min(30, +q.get('day')!))
  if (isFireMode(q.get('fire'))) s.fire = q.get('fire') as FireMode
  return s
}
function serialise(s: S) {
  const q = new URLSearchParams()
  for (const k of ['ui', 'feed', 'marks', 'switch', 'panel', 'time', 'theme', 'names', 'view'] as const) q.set(k, s[k])
  if (s.switch === 'v2') q.set('on', s.on.join(','))
  if (s.switch === 'v4') q.set('b', s.b)
  const sub = Object.entries(s.sub).map(([v, id]) => `${v}:${id}`).join(',')
  if (sub) q.set('sub', sub)
  if (s.time === 't2') q.set('hour', String(s.hour))
  if (s.time === 't3') q.set('day', String(s.day))
  if (s.fire !== FIRE_DEFAULT) q.set('fire', s.fire)
  return q.toString()
}
const name = (v: ViewId, s: S) => (s.names === 'noun' ? VIEWS[v].noun : VIEWS[v].question)
const engineState = (s: S, side: 'a' | 'b') => ({
  views: side === 'b' ? [s.b] : s.switch === 'v2' ? s.on : s.view ? [s.view] : [],
  base: !['v1', 'v2'].includes(s.switch), sub: s.sub, time: s.time as any, hour: s.hour, day: s.day, fire: s.fire, marks: s.marks as any,
})
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches

declare global { interface Window { __ready: boolean; __state: any; __apply: (p: Record<string, string>) => Promise<any> } }

export function App({ sim = false }: { sim?: boolean }) {
  const base: S = sim ? { ...DEFAULT, ui: 'cs1' } : DEFAULT
  // Region view, then city view: with no view asked for, the globe opens on live hazards and the flight lands on height.
  const [s, setS] = useState<S>(() => { const q = new URLSearchParams(location.search), x = parse(q, base); return !AT && !q.has('view') ? { ...x, view: 'hazards', on: ['hazards'] } : x })
  const [sysDark, setSysDark] = useState(systemDark)
  const theme: Theme = s.theme === 'system' ? (sysDark ? 'dark' : 'light') : (s.theme as Theme)
  const elA = useRef<HTMLDivElement>(null), elB = useRef<HTMLDivElement>(null)
  const wA = useRef<World>(), wB = useRef<World>()
  const [ans, setAns] = useState<Partial<Record<string, Answer>>>({})
  const [pick, setPick] = useState<Pick | null>(null)
  const [flying, setFlying] = useState(() => !AT && !reduced())   // the opening flight counts as not ready
  const [flightShown, setFlightShown] = useState(false)
  const [grid, setGrid] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const gl2 = useMemo(() => new URLSearchParams(location.search).get('gl') !== '0' && !!document.createElement('canvas').getContext('webgl2'), [])

  useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'); const f = () => setSysDark(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { history.replaceState(null, '', `${location.pathname}?${serialise(s)}${location.hash}`) }, [s])

  const refresh = useCallback(async () => {
    const a = wA.current
    if (!a) return
    const ids: ViewId[] = s.panel === 'p3' ? VIEW_IDS : [...new Set([...(engineState(s, 'a').views as ViewId[]), 'height' as ViewId, 'transit' as ViewId, ...(s.ui !== 'catalog' ? ['hazards' as ViewId] : [])])]
    const out: Record<string, Answer> = {}
    await Promise.all(ids.map(async v => { out[v] = await answer(a, v) }))
    if (s.switch === 'v4' && wB.current) out['b:' + s.b] = await answer(wB.current, s.b)
    setAns(out)
  }, [s])
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Create the map(s) once; V4 adds a second, camera-synced world.
  useEffect(() => {
    if (!gl2 || !elA.current) return
    const at = AT
    const cam = camAt(at)
    const a = (wA.current = new World(elA.current, theme, cam))
    let t: any
    a.onUpdate = () => { clearTimeout(t); t = setTimeout(() => refreshRef.current(), 150) }
    a.onPick = setPick
    a.apply(engineState(s, 'a'))
    ;(window as any).map = a.map
    if (!at) a.map.once('idle', async () => {
      await D.quakes('day')
      await new Promise(r => a.map.once('idle', r))
      if (reduced()) return
      await new Promise(r => setTimeout(r, 2200))   // let the globe and its live events be seen first
      setFlightShown(true)
      a.map.flyTo({ ...HK, duration: 7000, curve: 1.6 })
      a.map.once('moveend', () => { setFlying(false); setFlightShown(false); if (INTRO) setS(x => (x.view === 'hazards' ? { ...x, view: 'height', on: ['height'] } : x)) })
    })
    return () => { a.map.remove(); wA.current = undefined }
  }, [gl2])

  useEffect(() => {
    if (s.switch !== 'v4' || !elB.current || !wA.current) return
    const a = wA.current, m = a.map
    const b = (wB.current = new World(elB.current, theme, { center: m.getCenter().toArray() as [number, number], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() }))
    b.onUpdate = a.onUpdate
    b.onPick = setPick
    b.apply(engineState(s, 'b'))
    let lock = false
    const sync = (from: World, to: World) => () => { if (lock) return; lock = true; to.map.jumpTo({ center: from.map.getCenter(), zoom: from.map.getZoom(), pitch: from.map.getPitch(), bearing: from.map.getBearing() }); lock = false }
    const fa = sync(a, b), fb = sync(b, a)
    m.on('move', fa); b.map.on('move', fb)
    requestAnimationFrame(() => m.resize())
    return () => { m.off('move', fa); b.map.remove(); wB.current = undefined; requestAnimationFrame(() => m.resize()) }
  }, [s.switch === 'v4', gl2])

  useEffect(() => { wA.current?.setTheme(theme); wB.current?.setTheme(theme) }, [theme])
  useEffect(() => { wA.current?.apply(engineState(s, 'a')); wB.current?.apply(engineState(s, 'b')); refresh() }, [s])

  // The eyeball-all-options contract: __apply sets every parameter, then resolves when what is visible has loaded.
  useEffect(() => {
    window.__ready = false
    let live = true
    ;(async () => {
      await new Promise(r => setTimeout(r, 50))
      await Promise.all([wA.current?.ready(), wB.current?.ready()])
      await refreshRef.current()
      if (live && !flying) {
        const m = wA.current?.map
        window.__state = { ...s, theme: s.theme, appliedTheme: theme, grid, camera: m && { center: m.getCenter().toArray(), zoom: +m.getZoom().toFixed(2) }, fireApplied: wA.current?.fireState() }
        window.__ready = true
      }
    })()
    return () => { live = false }
  }, [s, theme, flying, grid])
  useEffect(() => {
    window.__apply = async (p: Record<string, string>) => {
      const q = new URLSearchParams(p)
      setGrid(q.get('grid') === '1')
      const m = wA.current?.map
      if (m && q.get('at')) { m.stop(); setFlying(false); m.jumpTo(camAt(q.get('at'))) }
      window.__ready = false
      setS(parse(q, base))
      for (let i = 0; i < 600 && !window.__ready; i++) await new Promise(r => setTimeout(r, 100))
      return window.__state
    }
  }, [])

  // Keyboard: number keys switch views, Esc clears, arrow keys pan (when focus is not in a field).
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, [role="slider"], [role="radio"]') || e.metaKey || e.ctrlKey || e.altKey) return
      const n = +e.key
      if (n >= 1 && n <= VIEW_IDS.length) return choose(VIEW_IDS[n - 1])
      if (e.key === 'Escape') { if (grid) return setGrid(false); setPick(null); setS(x => ({ ...x, view: '', on: [] })) }
      const pan = { ArrowLeft: [-120, 0], ArrowRight: [120, 0], ArrowUp: [0, -120], ArrowDown: [0, 120] }[e.key]
      if (pan && !(e.target as HTMLElement).closest('.maplibregl-canvas')) { e.preventDefault(); wA.current?.map.panBy(pan as [number, number], { duration: reduced() ? 0 : 200 }) }
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  })

  const choose = (v: ViewId) => setS(x => x.switch === 'v2' ? { ...x, on: x.on.includes(v) ? x.on.filter(o => o !== v) : [...x.on, v], view: v } : { ...x, view: v, on: [v] })
  const setSub = (v: ViewId, id: string) => setS(x => ({ ...x, view: v, on: [v], sub: { ...x.sub, [v]: id } }))
  const jump = (j: NonNullable<Answer['jump']>) => { const m = wA.current?.map; m?.flyTo({ ...j, duration: reduced() ? 0 : 2500, essential: false }) }
  const active = s.switch === 'v2' ? s.on.at(-1) || '' : s.view

  if (!gl2) return <Fallback s={s} />
  return (
    <main className="app">
      <div className={`maps${s.switch === 'v4' ? ' split' : ''}`}>
        <div className="map" ref={elA} aria-label="Map" >{s.switch === 'v4' && active && <span className="chip float" style={{ padding: '4px 10px', fontSize: '0.8125rem' }}>{name(active, s)}</span>}</div>
        {s.switch === 'v4' && <div className="map" ref={elB}><CompareChip s={s} setS={setS} /></div>}
      </div>

      {s.ui === 'catalog' ? <>
      <TopBar s={s} setS={setS} theme={theme} onPlace={c => wA.current?.map.flyTo({ ...c, duration: reduced() ? 0 : 2500 })} />
      {/* One left column: the picker, then the city card, stacked; the column scrolls inside itself, never over the map's other panels */}
      <div className="leftcol">
        <Picker s={s} choose={choose} setSub={setSub} openGrid={() => setGrid(true)} />
        {s.panel !== 'p1' && <CityCard s={s} ans={ans} choose={choose} />}
      </div>

      <AnswerPanel s={s} setS={setS} view={active} a={active ? ans[active] : undefined} all={ans} pick={pick} clearPick={() => setPick(null)} jump={jump}
        collapsed={collapsed} toggle={() => setCollapsed(c => !c)} card={s.panel !== 'p1' ? <CityCard s={s} ans={ans} choose={choose} inside /> : null} />

      </> : <Sim s={s} setS={setS} theme={theme} view={active} ans={ans} pick={pick} clearPick={() => setPick(null)} choose={choose}
        fly={c => wA.current?.map.flyTo({ ...c, duration: reduced() ? 0 : 2500 })} />}

      {flightShown && <div className="float fly" role="status">Flying to Hong Kong<button className="icon-btn" aria-label="Skip the flight" onClick={() => { wA.current?.map.stop(); wA.current?.map.jumpTo(HK) }}><iconify-icon icon="ph:x" /></button></div>}
      {grid && <AllMaps s={s} w={wA.current!} choose={v => { choose(v); setGrid(false) }} close={() => setGrid(false)} />}
    </main>
  )
}

function TopBar({ s, setS, theme, onPlace }: { s: S; setS: (f: (x: S) => S) => void; theme: Theme; onPlace: (c: { center: [number, number]; zoom: number }) => void }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<{ label: string; kind: string; center: [number, number]; zoom: number }[]>([])
  useEffect(() => {
    if (q.trim().length < 2) return setItems([])
    let live = true
    Promise.all([D.countries(), D.mtr()]).then(([c, m]) => {
      if (!live) return
      const t = q.trim().toLowerCase(), out: typeof items = []
      for (const st of new Map((m.data?.lines || []).flatMap((l: any) => l.stations.map((x: any) => [x[0], x]))).values() as any)
        if (String(st[1]).toLowerCase().includes(t) || String(st[2] || '').includes(q.trim())) out.push({ label: st[1], kind: 'MTR station', center: [st[4], st[5]], zoom: 16 })
      for (const f of c.data?.features || []) if (f.properties.NAME_ENGL.toLowerCase().includes(t)) {
        const xs: number[] = [], ys: number[] = []
        JSON.stringify(f.geometry.coordinates).replace(/\[(-?[\d.]+),(-?[\d.]+)\]/g, (_, x, y) => (xs.push(+x), ys.push(+y), ''))
        out.push({ label: f.properties.NAME_ENGL, kind: 'Country or territory', center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], zoom: 4 })
      }
      setItems(out.slice(0, 8))
    }).catch(e => console.error('search failed', e))
    return () => { live = false }
  }, [q])
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <div className="float bar">
      <span className="mark"><iconify-icon icon="ph:globe-hemisphere-east" width="18" /><span>{D.SITE}</span></span>
      <div className="search" role="search">
        <iconify-icon icon="ph:magnifying-glass" width="15" />
        <label className="sr" htmlFor="q">Search places</label>
        <input id="q" type="search" placeholder="Search places and stations" value={q} onChange={e => setQ(e.target.value)} autoComplete="off"
          onKeyDown={e => { if (e.key === 'Enter' && items[0]) { onPlace(items[0]); setQ('') } }} />
        {q.trim().length >= 2 && (
          <ul className="results float" aria-label="Places">
            {items.length ? items.map(i => <li key={i.kind + i.label}><button onClick={() => { onPlace(i); setQ('') }}>{i.label}<small>{i.kind}</small></button></li>)
              : <li style={{ padding: '6px 8px', fontSize: '0.875rem', color: 'var(--ink-2)' }}>No country or MTR station matches. Street search is not wired yet.</li>}
          </ul>
        )}
      </div>
      <button className="icon-btn" aria-label={`Switch to ${next} theme`} title={`Theme: ${s.theme}`} onClick={() => setS(x => ({ ...x, theme: next }))}>
        <iconify-icon icon={theme === 'dark' ? 'ph:sun' : 'ph:moon'} width="18" />
      </button>
      <Options s={s} setS={setS} />
    </div>
  )
}

function Options({ s, setS }: { s: S; setS: (f: (x: S) => S) => void }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="icon-btn" aria-label="Design options"><iconify-icon icon="ph:sliders-horizontal" width="18" /></Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={10} align="end">
          <Popover.Popup className="opts">
            <Popover.Title render={<h2 />}>Design options</Popover.Title>
            <p>Every choice from the design brief, to compare by eye. Each one is also in the address bar.</p>
            {(Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]).map(k => (
              <fieldset key={k}>
                <legend>{OPTIONS[k].label}</legend>
                <RadioGroup value={s[k]} onValueChange={v => setS(x => ({ ...x, [k]: v as string }))}>
                  {Object.entries(OPTIONS[k].values).map(([v, label]) => (
                    <label className="radio" key={v}><Radio.Root value={v} className="radio-dot" />{label}</label>
                  ))}
                </RadioGroup>
              </fieldset>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Picker({ s, choose, setSub, openGrid }: { s: S; choose: (v: ViewId) => void; setSub: (v: ViewId, id: string) => void; openGrid: () => void }) {
  const row = (v: ViewId, i: number) => [<iconify-icon key="i" icon={VIEWS[v].icon} width="18" />, <span key="n">{name(v, s)}</span>, <kbd key="k" aria-hidden="true">{i + 1}</kbd>]
  if (s.switch === 'v2') return (
    <nav className="float rail" aria-label="Layers">
      <p className="rail-title">Layers, any number at once</p>
      {VIEW_IDS.map((v, i) => (
        <label className="vbtn" key={v} data-checked={s.on.includes(v) || undefined}>
          <Checkbox.Root className="check" checked={s.on.includes(v)} onCheckedChange={() => choose(v)} aria-label={name(v, s)}>
            <Checkbox.Indicator><iconify-icon icon="ph:check-bold" width="11" /></Checkbox.Indicator>
          </Checkbox.Root>
          <span>{name(v, s)}</span><kbd aria-hidden="true">{i + 1}</kbd>
        </label>
      ))}
    </nav>
  )
  if (s.switch === 'v5') return (
    <nav className="float rail" aria-label="Topics">
      <p className="rail-title">Topics</p>
      {VIEW_IDS.map((v, i) => (
        <div className="topic" key={v}>
          <button className="vbtn" aria-pressed={s.view === v} aria-expanded={s.view === v} onClick={() => choose(v)}>
            <iconify-icon icon={VIEWS[v].icon} width="18" /><span>{VIEWS[v].topic}</span><kbd aria-hidden="true">{i + 1}</kbd>
          </button>
          {s.view === v && (
            <div className="subs" role="group" aria-label={`${VIEWS[v].topic} maps`}>
              {VIEWS[v].subs.map(sb => <button key={sb.id} className="sbtn" aria-pressed={(s.sub[v] || VIEWS[v].subs[0].id) === sb.id} onClick={() => setSub(v, sb.id)}>{sb.label}</button>)}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
  return (
    <nav className="float rail" aria-label="Info views">
      {s.switch === 'v6' && <button className="allmaps" onClick={openGrid}><iconify-icon icon="ph:squares-four" width="18" />All data maps</button>}
      <p className="rail-title">{s.switch === 'v1' ? 'One question at a time' : s.switch === 'v6' ? 'Or pick one' : 'Ask the city'}</p>
      <ToggleGroup value={s.view ? [s.view] : []} onValueChange={vals => vals[0] ? choose(vals[0] as ViewId) : null} style={{ display: 'contents' }} aria-label="Info views">
        {VIEW_IDS.map((v, i) => <Toggle key={v} value={v} className="vbtn">{row(v, i)}</Toggle>)}
      </ToggleGroup>
    </nav>
  )
}

function CompareChip({ s, setS }: { s: S; setS: (f: (x: S) => S) => void }) {
  return (
    <label className="chip float" style={{ padding: '4px 6px 4px 10px', fontSize: '0.8125rem', display: 'flex', gap: 6, alignItems: 'center' }}>
      <span className="sr">Compare with</span>
      <select value={s.b} onChange={e => setS(x => ({ ...x, b: e.target.value as ViewId }))} style={{ border: 0, background: 'none', padding: 2 }}>
        {VIEW_IDS.map(v => <option key={v} value={v}>{name(v, s)}</option>)}
      </select>
    </label>
  )
}

function Legend({ spec }: { spec?: LegendSpec }) {
  const ref = useRef<any>(null)
  useEffect(() => { if (ref.current) ref.current.spec = spec ?? null }, [spec])
  return <view-legend ref={ref} />
}

function AnswerPanel({ s, setS, view, a, all, pick, clearPick, jump, collapsed, toggle, card }: {
  s: S; setS: (f: (x: S) => S) => void; view: ViewId | ''; a?: Answer; all: Partial<Record<string, Answer>>; pick: Pick | null; clearPick: () => void
  jump: (j: NonNullable<Answer['jump']>) => void; collapsed: boolean; toggle: () => void; card: React.ReactNode
}) {
  if (!view) return (
    <aside className="float answer" aria-label="Answer" data-collapsed={collapsed}>
      <button className="handle" aria-label={collapsed ? 'Expand' : 'Collapse'} onClick={toggle} />
      <p className="q">No view on</p>
      <p className="detail" style={{ marginTop: 0 }}>Pick a question on the left, or press 1 to {VIEW_IDS.length}. The city recolours to answer it.</p>
      {card}
    </aside>
  )
  const archive = s.time !== 't1' && view !== 'hazards'
  return (
    <aside className="float answer" aria-label="Answer" data-collapsed={collapsed}>
      <button className="handle" aria-label={collapsed ? 'Expand the answer' : 'Collapse the answer'} onClick={toggle} />
      <p className="q"><iconify-icon icon={VIEWS[view].icon} width="15" />{name(view, s)}</p>
      {/* The active view's sub-maps, in every layout (V5 also lists them in the picker; on a phone this is the only place) */}
      {VIEWS[view].subs.length > 1 && (
        <label className={`subpick${s.switch === 'v5' ? ' dup' : ''}`}>
          <span className="sr">Map</span>
          <select value={s.sub[view] || VIEWS[view].subs[0].id} onChange={e => setS(x => ({ ...x, sub: { ...x.sub, [view]: e.target.value } }))}>
            {VIEWS[view].subs.map(sb => <option key={sb.id} value={sb.id}>{sb.label}</option>)}
          </select>
        </label>
      )}
      {view === 'hazards' && ['all', 'fire'].includes(s.sub.hazards || 'all') && (
        <label className="subpick">
          <span style={{ fontSize: '0.8125rem', color: 'var(--ink-2)' }}>Fire layers, South Australia</span>
          <select value={s.fire} onChange={e => setS(x => ({ ...x, fire: e.target.value as FireMode }))}>
            {FIRE_MODES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      )}
      <div aria-live="polite">
        {!a || a.status === 'loading' ? <><div className="sk-line" aria-hidden="true" /><div className="sk-line small" aria-hidden="true" /><span className="sr">Loading</span></>
          : a.status === 'error' ? <p className="note warn">Could not load this view. {a.errors?.join('. ')}. Try again in a minute.</p>
          : <>
            {a.value != null && <p className="headline"><span className="value">{a.value}</span><span className="counts">{a.counts}</span></p>}
            {a.detail && <p className={a.status === 'ok' ? 'detail' : 'note'}>{a.detail}</p>}
            {a.errors?.length ? <p className="note warn">Partly loaded. {a.errors.join('. ')}.</p> : null}
            {a.stale && <p className="note warn">This feed has not updated for over 30 minutes. Showing its last data.</p>}
            {a.jump && a.status !== 'ok' && <button className="jump" onClick={() => jump(a.jump!)}>{a.jump.label}<iconify-icon icon="ph:arrow-right" width="15" /></button>}
          </>}
      </div>
      <Legend spec={a?.legend} />
      {s.switch === 'v2' && s.on.length > 1 && (
        <div className="also" aria-label="Other layers on">
          {s.on.filter(v => v !== view).map(v => <p key={v}><small>{name(v, s)}</small><b>{all[v]?.value ?? '...'}</b>{all[v]?.counts || all[v]?.detail?.split('.')[0]}</p>)}
        </div>
      )}
      {s.switch === 'v4' && (
        <div className="also" aria-label="Right map">
          <p><small>Right map: {name(s.b, s)}</small><b>{all['b:' + s.b]?.value ?? ''}</b>{all['b:' + s.b]?.counts || all['b:' + s.b]?.detail?.split('.')[0] || '...'}</p>
        </div>
      )}
      <TimeBox s={s} setS={setS} a={a} archive={archive} />
      {pick && <PickCard pick={pick} clear={clearPick} />}
      <div className="meta">
        {(SOURCES[view] as any[]).filter(src => { const sb = s.sub[view] || VIEWS[view].subs[0].id; return (!src.sub || src.sub === sb) && src.notSub !== sb }).map(src => <span key={src.name}><a href={src.href} target="_blank" rel="noreferrer">{src.name}</a>. {src.licence}</span>)}
        {a?.credits?.map(src => <span key={src.name}><a href={src.href} target="_blank" rel="noreferrer">{src.name}</a>. {src.licence}</span>)}
      </div>
      {card}
    </aside>
  )
}

function TimeBox({ s, setS, a, archive }: { s: S; setS: (f: (x: S) => S) => void; a?: Answer; archive: boolean }) {
  return (
      <div className="time">
        {s.time === 't1' || archive ? (
          <>
            <span className="live">Live{a?.updated ? `, ${a.updated}` : ''}</span>
            {archive && <p className="note">{s.time === 't2' ? 'A day slider' : 'History'} needs this view's feeds recorded over time by a pipeline. Not built yet, so this view shows now only.</p>}
          </>
        ) : (
          <>
            <div className="time-row">
              <span>{s.time === 't2' ? 'Last 24 hours' : 'Last 30 days'}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.time === 't2' ? (s.hour === 24 ? 'Now' : `${24 - s.hour} h ago`) : (s.day === 30 ? 'Today' : `${30 - s.day} days ago`)}</span>
            </div>
            <Slider.Root value={s.time === 't2' ? s.hour : s.day} min={0} max={s.time === 't2' ? 24 : 30} step={1}
              onValueChange={v => setS(x => (x.time === 't2' ? { ...x, hour: v as number } : { ...x, day: v as number }))}>
              <Slider.Control className="slider"><Slider.Track className="slider-track"><Slider.Indicator className="slider-ind" />
                <Slider.Thumb className="slider-thumb" aria-label={s.time === 't2' ? 'Hour' : 'Day'} getAriaValueText={(_, v) => s.time === 't2' ? `${24 - v} hours ago` : `${30 - v} days ago`} />
              </Slider.Track></Slider.Control>
            </Slider.Root>
            <p className="meta" style={{ marginTop: 6 }}>Earthquakes up to that moment, from the USGS {s.time === 't2' ? 'day' : 'month'} feed. GDACS and EONET show open events now.</p>
          </>
        )}
      </div>
  )
}

function PickCard({ pick, clear, cls = '' }: { pick: Pick; clear: () => void; cls?: string }) {
  return (
    <section className={`pick ${cls}`} aria-label="Selected">
      <h3>{pick.title}<button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Clear selection" onClick={clear}><iconify-icon icon="ph:x" width="14" /></button></h3>
      <dl>{pick.rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {pick.links?.length ? <p className="meta">{pick.links.map(([k, u]) => <a key={k} href={u} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>{k}</a>)}</p> : null}
      <p className="meta">Source: {pick.source}{pick.href && <> · <a href={pick.href} target="_blank" rel="noreferrer">open</a></>}</p>
    </section>
  )
}

// Simulator layouts (Cities: Skylines 1 and II as the reference): the map fills the screen; the city reports through meters,
// a row of info-view tools, one compact panel for the active view, a query card and a news feed. Same data and engine as the catalog.
const CITIES: [string, { center: [number, number]; zoom: number; pitch?: number; bearing?: number }][] = [
  ['Hong Kong', HK], ['Adelaide', { center: [138.6, -34.925], zoom: 12 }], ['Melbourne', { center: [144.963, -37.814], zoom: 13.5, pitch: 55 }],
  ['Taipei', { center: [121.5654, 25.033], zoom: 12.5 }], ['Rotterdam', { center: [4.48, 51.92], zoom: 13.5, pitch: 55 }],
  ['New York', { center: [-73.99, 40.73], zoom: 13, pitch: 55 }], ['The world', WORLD]]

function Sim({ s, setS, theme, view, ans, pick, clearPick, choose, fly }: {
  s: S; setS: (f: (x: S) => S) => void; theme: Theme; view: ViewId | ''; ans: Partial<Record<string, Answer>>
  pick: Pick | null; clearPick: () => void; choose: (v: ViewId) => void; fly: (c: { center: [number, number]; zoom: number }) => void
}) {
  const place = usePlace(s)
  const stat = (k: string) => place?.stats.find(([n]) => n.startsWith(k))?.[1]
  const val = (v: ViewId) => { const a = ans[v]; return a?.status === 'ok' ? (v === 'height' ? a.value : [a.value, a.counts?.replace(/ in view$/, '')].filter(Boolean).join(' ')) : a?.status === 'zoom' ? 'Zoom in' : a?.status === 'outside' || a?.status === 'empty' ? 'None here' : a?.status === 'error' ? 'Unavailable' : '…' }
  const power = stat('Power price')
  // earthquakes in view plus every country feed counted in view (incidents, roadworks, fires); zoomed out it is the world's quakes
  const events = () => { const a = ans.hazards; if (!a || a.status === 'loading') return undefined; if (a.status === 'error') return 'Unavailable'
    const q = a.counts?.includes('worldwide') ? 0 : +(a.value || '0').replace(/,/g, ''); return a.counts?.includes('worldwide') ? `${a.value} quakes worldwide` : `${(q + (a.inView || 0)).toLocaleString('en')}` }
  const meters: [string, string, string | undefined, ViewId?][] = [
    ['ph:users-three', 'Population', stat('Population'), 'people'],
    ['ph:buildings', 'Tallest in view', val('height'), 'height'],
    ['ph:warning-circle', 'Live events in view', events(), 'hazards'],
    ['ph:train', 'Transit', val('transit'), 'transit'],
    ['ph:airplane-takeoff', 'Nearest big airport', stat('Airports nearby'), 'airports'],
    ...(power ? [['ph:lightning', 'Power now', power.split(',')[0]] as [string, string, string]] : []),
  ]
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <div className={`sim ${s.ui}`}>
      <div className="float cs-stats" role="region" aria-label="City">
        <span className="cs-place"><iconify-icon icon="ph:map-pin" width="16" />{place === undefined ? '…' : place?.name || 'Open sea'}</span>
        {meters.map(([icon, label, v, go]) => (
          <button key={label} className="cs-meter" onClick={() => go && choose(go)} disabled={!go} title={label}>
            <iconify-icon icon={icon} width="16" /><span className="k">{label}</span><b aria-label={`${label}: ${v ?? 'loading'}`}>{v ?? '…'}</b>
          </button>
        ))}
      </div>

      <nav className="float cs-tools" aria-label="Info views">
        {VIEW_IDS.map((v, i) => (
          <button key={v} className="cs-tool" aria-pressed={view === v} aria-label={`${VIEWS[v].noun} (${i + 1})`} data-tip={VIEWS[v].noun}
            onClick={() => view === v ? setS(x => ({ ...x, view: '', on: [] })) : choose(v)}>
            <iconify-icon icon={VIEWS[v].icon} width="22" />
          </button>
        ))}
      </nav>

      <div className="float cs-clock">
        <Clock />
        <label className="cs-cities"><span className="sr">Go to</span>
          <select value="" onChange={e => { const c = CITIES.find(([n]) => n === e.target.value); if (c) fly(c[1]) }}>
            <option value="">Go to…</option>{CITIES.map(([n]) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <button className="icon-btn" aria-label={`Switch to ${next} theme`} onClick={() => setS(x => ({ ...x, theme: next }))}>
          <iconify-icon icon={theme === 'dark' ? 'ph:sun' : 'ph:moon'} width="18" />
        </button>
        <Options s={s} setS={setS} />
      </div>

      {view && <InfoPanel s={s} setS={setS} view={view} a={ans[view]} close={() => setS(x => ({ ...x, view: '', on: [] }))} />}
      {pick && <PickCard pick={pick} clear={clearPick} cls="float cs-pick" />}
      {s.feed === 'on' && <Feed fly={fly} />}
    </div>
  )
}

function Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => { const i = setInterval(() => setT(new Date()), 15000); return () => clearInterval(i) }, [])
  return <span className="cs-time"><span className="dot" aria-hidden="true" />Live <b>{t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</b></span>
}

// The active info view, compact: the number and the legend up front; the explanation and the sources one click away.
function InfoPanel({ s, setS, view, a, close }: { s: S; setS: (f: (x: S) => S) => void; view: ViewId; a?: Answer; close: () => void }) {
  const srcs = [...(SOURCES[view] as any[]).filter(src => { const sb = s.sub[view] || VIEWS[view].subs[0].id; return (!src.sub || src.sub === sb) && src.notSub !== sb }), ...(a?.credits || [])]
  return (
    <section className="float cs-info" aria-label={VIEWS[view].noun}>
      <h2><iconify-icon icon={VIEWS[view].icon} width="18" />{VIEWS[view].noun}
        <button className="icon-btn" aria-label="Close this view" onClick={close}><iconify-icon icon="ph:x" width="14" /></button></h2>
      {VIEWS[view].subs.length > 1 && (
        <label className="subpick"><span className="sr">Map</span>
          <select value={s.sub[view] || VIEWS[view].subs[0].id} onChange={e => setS(x => ({ ...x, sub: { ...x.sub, [view]: e.target.value } }))}>
            {VIEWS[view].subs.map(sb => <option key={sb.id} value={sb.id}>{sb.label}</option>)}
          </select>
        </label>
      )}
      {view === 'hazards' && ['all', 'fire'].includes(s.sub.hazards || 'all') && (
        <label className="subpick"><span className="sr">Fire layers, South Australia</span>
          <select value={s.fire} onChange={e => setS(x => ({ ...x, fire: e.target.value as FireMode }))}>
            {FIRE_MODES.map(([k, label]) => <option key={k} value={k}>Fire: {label}</option>)}
          </select>
        </label>
      )}
      <div aria-live="polite">
        {!a || a.status === 'loading' ? <div className="sk-line" aria-hidden="true" />
          : a.status === 'error' ? <p className="note warn">Unavailable now. Try again in a minute.</p>
          : a.value != null ? <p className="headline"><span className="value">{a.value}</span><span className="counts">{a.counts}</span></p>
          : <p className="note">{a.detail?.split('. ')[0]}</p>}
      </div>
      <Legend spec={a?.legend} />
      <details className="cs-more">
        <summary><iconify-icon icon="ph:info" width="14" />About this view and its sources</summary>
        {a?.detail && <p className="detail">{a.detail}</p>}
        {a?.errors?.length ? <p className="note warn">Partly loaded. {a.errors.join('. ')}.</p> : null}
        <p className="meta">{a?.updated ? `Updated ${a.updated}. ` : ''}{srcs.map(src => <span key={src.name}><a href={src.href} target="_blank" rel="noreferrer">{src.name}</a>. {src.licence} </span>)}</p>
      </details>
    </section>
  )
}

// Chirper-style feed: the newest real events (USGS earthquakes, GDACS alerts, NASA EONET), one bubble; open it for the list.
function Feed({ fly }: { fly: (c: { center: [number, number]; zoom: number }) => void }) {
  type Item = { id: string; text: string; t: number; c: [number, number]; src: string }
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    Promise.all([D.quakes('day'), D.gdacs(), D.eonet()]).then(([q, g, e]) => {
      const out: Item[] = []
      for (const f of q.data?.features || []) if (f.properties.mag >= 4.5) out.push({ id: f.id, text: `M${f.properties.mag.toFixed(1)} earthquake, ${f.properties.place}`, t: f.properties.time, c: f.geometry.coordinates.slice(0, 2), src: 'USGS' })
      for (const f of (g.data as any)?.features || []) out.push({ id: 'g' + f.properties.eventid, text: `${f.properties.alertlevel} alert: ${f.properties.name || f.properties.eventname}`, t: Date.parse(f.properties.fromdate), c: f.geometry.coordinates, src: 'GDACS' })
      for (const f of (e.data as any)?.features || []) out.push({ id: 'e' + f.properties.id, text: f.properties.title, t: Date.parse(f.properties.date), c: f.geometry.coordinates, src: 'NASA EONET' })
      if (live) setItems(out.filter(i => Number.isFinite(i.t)).sort((a, b) => b.t - a.t).slice(0, 12))
    }).catch(err => console.error('feed failed', err))
    return () => { live = false }
  }, [])
  const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago` }
  if (!items.length) return null
  const go = (i: Item) => fly({ center: i.c, zoom: 7 })
  return (
    <aside className={`float cs-feed${open ? ' open' : ''}`} aria-label="News feed">
      <button className="cs-feed-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <iconify-icon icon="ph:chat-circle-dots" width="18" /><span className="cs-feed-text">{items[0].text}</span><small>{ago(items[0].t)}</small>
      </button>
      {open && <ul>{items.map(i => <li key={i.id}><button onClick={() => go(i)}><span>{i.text}</span><small>{i.src}, {ago(i.t)}</small></button></li>)}</ul>}
    </aside>
  )
}

// The place under the map centre; over water (a harbour, a bay), the place most of the view's land belongs to, sampled on a 5x5 grid over the screen (a tilted view's bounds reach past the horizon).
async function landAt(fc: any, center: number[]) {
  const hit = await D.placeAt(fc, center)
  const m = (window as any).map
  if (hit || !m) return hit
  const c = m.getCanvas(), w = c.clientWidth, h = c.clientHeight, n: Record<string, [number, any]> = {}
  for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
    const q = await D.placeAt(fc, m.unproject([w * i / 6, h * j / 6]).toArray())
    if (q) n[q.ISO3_CODE] = [(n[q.ISO3_CODE]?.[0] || 0) + 1, q]
  }
  return Object.values(n).sort((x, y) => y[0] - x[0])[0]?.[1] ?? null
}

type Place = { name: string; iso3: string; stats: [string, string][]; year?: string; srcs: string[] }
// The country under the map centre and its figures (World Bank, airports, satellites, RISE, B-READY, AEMO in Australia)
function usePlace(s: S) {
  const [place, setPlace] = useState<Place | null | undefined>(undefined)
  const [center, setCenter] = useState<number[]>()
  useEffect(() => {
    const m = (window as any).map
    if (!m) return
    const f = () => setCenter([...m.getCenter().toArray().map((x: number) => +x.toFixed(4)), m.getZoom() < 3 ? 1 : 0])
    f(); m.on('moveend', f)
    return () => m.off('moveend', f)
  }, [(window as any).map])
  useEffect(() => {
    if (!center) return
    let live = true
    ;(async () => {
      const c = await D.countries()
      const p = center[2] ? { NAME_ENGL: 'The world', ISO3_CODE: 'WLD' } : c.data && await landAt(c.data, center)
      if (!p) return live && setPlace(null)
      const inds = await Promise.all((Object.keys(D.INDICATORS) as D.Indicator[]).map(k => D.worldBank(k)))
      const nf = new Intl.NumberFormat('en', { maximumFractionDigits: 1 }), big = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
      const val = (i: number) => inds[i].data?.by[p.ISO3_CODE]
      const stats: [string, string][] = [
        ['Population', val(1) ? big.format(val(1)!.v) : 'None'], ['People per km²', val(0) ? nf.format(val(0)!.v) : 'None'],
        ['Aged 65+', val(2) ? `${nf.format(val(2)!.v)}%` : 'None'], ['In towns and cities', val(3) ? `${nf.format(val(3)!.v)}%` : 'None']]
      const biz = await D.breadyOverall(p.ISO3_CODE), srcsExtra: string[] = []
      // B-READY publishes no single score: this is the mean of its three pillars across the ten topics
      const la = p.ISO3_CODE !== 'WLD' ? (await D.largeAirports()).data : undefined, near = la && D.nearestLarge(la, center)
      stats.push(['Airports nearby', near ? `${near.a.iata || near.a.icao || near.a.name}, ${Math.round(near.km).toLocaleString('en')} km` : 'None'])
      // Satellites overhead at the map centre (more than 10° up): the open group if the view is on, else the space stations
      if (p.ISO3_CODE !== 'WLD') {
        const grp = s.view === 'satellites' ? s.sub.satellites || 'stations' : 'stations', f = (await Sat.gp(grp)).data, t = new Date(), g = Sat.gstime(t)
        const n = f?.sats.filter(x => { const q = Sat.where(x.rec, t, g); return q && Sat.elevation(q.eci, g, center) > 10 }).length
        stats.push(['Satellites overhead', n != null ? `${n} (${Sat.SAT_GROUPS[grp].toLowerCase()})` : 'None'])
      } else stats.push(['Satellites overhead', 'None'])
      const bec = (await D.rise('BEC')).data?.by[p.ISO3_CODE]
      stats.push(['Building energy codes (RISE score)', bec ? `${nf.format(bec.v)} of 100 (${bec.year})` : 'None'])
      if (import.meta.env.PUBLIC_EDITION === 'full') {
        const bg = (await D.buildingGreen()).data?.countries?.[p.ISO3_CODE]
        stats.push(['Building energy code (Building Green)', bg ? D.BG_SHORT[D.bgStatus(bg)] : 'None'])
      }
      stats.push(['Business (B-READY, mean of pillars)', biz != null ? `${nf.format(biz)} of 100` : 'None'])
      // Australia: the live wholesale electricity price and demand in the NEM region under the map centre (AEMO)
      if (p.ISO3_CODE === 'AUS') {
        const st = (await auState(center)).data, reg = st && NEM_REGION[st.state_code_2021]
        const r = reg && (await aemo()).data?.ELEC_NEM_SUMMARY?.find((x: any) => x.REGIONID === reg)
        stats.push([`Power price now (AEMO${reg ? `, ${reg.slice(0, -1)}` : ''})`, r ? `$${nf.format(r.PRICE)}/MWh, demand ${nf.format(Math.round(r.TOTALDEMAND))} MW (${r.SETTLEMENTDATE.slice(11, 16)} market time)`
          : st && !reg ? `None (${st.state_name_2021} is not in the NEM)` : 'None'])
        if (r && !srcsExtra.includes('AEMO')) srcsExtra.push('AEMO')
      }
      const srcs = [...new Set([0, 1, 2, 3].map(i => val(i)).filter(Boolean).map(r => r!.src || 'World Bank')), ...srcsExtra]
      if (live) setPlace({ name: p.NAME_ENGL, iso3: p.ISO3_CODE, stats, year: val(1)?.year, srcs })
    })()
    return () => { live = false }
  }, [center?.join()])
  return place
}

function CityCard({ s, ans, choose, inside }: { s: S; ans: Partial<Record<string, Answer>>; choose: (v: ViewId) => void; inside?: boolean }) {
  const place = usePlace(s)
  const h = ans.height, t = ans.transit
  // Collapsed to its header by default on short screens, so the picker above it keeps its room (the column scrolls as well)
  const [open, setOpen] = useState(() => typeof innerHeight === 'undefined' || innerHeight >= 760)
  const title = <h2>{place === undefined ? '…' : place?.name || 'Open sea'}</h2>
  const body = (
    <>
      <p className="sub">{place ? place.iso3 === 'WLD' ? 'World Bank, latest year of each figure, all countries' : place.srcs.length ? `${place.srcs.join('; ')}, latest of each figure; None = not published` : 'No published figures for this place' : 'Move the map onto land for its numbers'}</p>
      {place && <dl className="stats">{place.stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        {h?.status === 'ok' && <div><dt>Tallest in view</dt><dd>{h.value}</dd></div>}
        {t?.status === 'ok' && <div><dt>{t.counts === 'MTR lines' ? 'MTR lines' : t.counts === 'MTR stations in view' ? 'MTR stations in view' : 'Bus routes in view'}</dt><dd>{t.value}</dd></div>}
      </dl>}
      {s.panel === 'p3' && (
        <div className="meters" aria-label="Each view, here">
          {VIEW_IDS.map(v => {
            const a = ans[v]
            return <button key={v} className="meter" onClick={() => choose(v)}>
              <iconify-icon icon={VIEWS[v].icon} width="15" /><span>{VIEWS[v].noun}{a?.counts ? `, ${a.counts}` : ''}</span>
              <b>{a?.status === 'ok' || a?.status === 'empty' ? a.value ?? 'None' : a?.status === 'outside' ? 'Not here' : a?.status === 'zoom' ? 'Zoom in' : a?.status === 'error' ? 'Down' : '...'}</b>
            </button>
          })}
        </div>
      )}
    </>
  )
  return inside ? <div className="card-in">{title}{body}</div>
    : <details className="float card" aria-label="Place" open={open} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{title}<iconify-icon icon="ph:caret-down" width="16" aria-hidden="true" /></summary>{body}</details>
}

function AllMaps({ s, w, choose, close }: { s: S; w: World; choose: (v: ViewId) => void; close: () => void }) {
  const [shots, setShots] = useState<Partial<Record<ViewId, { img: string; a: Answer }>>>({})
  useEffect(() => {
    let live = true
    const prev = w.state
    ;(async () => {
      for (const v of VIEW_IDS) {
        w.apply({ ...prev, views: [v], base: true })
        await w.ready()
        const c = document.createElement('canvas'), src = w.map.getCanvas()
        c.width = 480; c.height = 300
        const k = Math.max(c.width / src.width, c.height / src.height)
        c.getContext('2d')!.drawImage(src, (c.width - src.width * k) / 2, (c.height - src.height * k) / 2, src.width * k, src.height * k)
        const a = await answer(w, v)
        if (!live) return
        setShots(x => ({ ...x, [v]: { img: c.toDataURL('image/webp', 0.75), a } }))
      }
      w.apply(prev)
    })()
    return () => { live = false; w.apply(prev) }
  }, [])
  return (
    <section className="grid" aria-label="All data maps">
      <h2>All data maps</h2>
      <p>Every view, drawn for this place. Pick one to open it. Esc closes.</p>
      <div className="tiles">
        {VIEW_IDS.map(v => (
          <button key={v} className="tile" aria-current={s.view === v} onClick={() => choose(v)}>
            {shots[v] ? <img src={shots[v]!.img} alt={`${VIEWS[v].noun} view of the current map`} /> : <span className="ph" aria-hidden="true" />}
            <div><strong>{name(v, s)}</strong><span>{shots[v]?.a.value != null ? `${shots[v]!.a.value} ${shots[v]!.a.counts}` : shots[v] ? shots[v]!.a.detail?.split('.')[0] : 'Drawing...'}</span></div>
          </button>
        ))}
      </div>
      <button className="jump" style={{ marginTop: 24 }} onClick={close}>Back to the map</button>
    </section>
  )
}

// No WebGL2: the same answers as text, where the data allows it without a map.
function Fallback({ s }: { s: S }) {
  const [q, setQ] = useState<any[]>([])
  const [lines, setLines] = useState<any[]>([])
  const [people, setPeople] = useState<[string, string[]][]>([])
  useEffect(() => {
    const nf = new Intl.NumberFormat('en', { maximumFractionDigits: 1, notation: 'compact' })
    Promise.all((Object.keys(D.INDICATORS) as D.Indicator[]).map(k => D.worldBank(k))).then(r =>
      setPeople([['The world', 'WLD'], ['Hong Kong', 'HKG']].map(([n, k]) => [n, r.map(x => x.data?.by[k] ? nf.format(x.data.by[k].v) : 'None')])))
  }, [])
  useEffect(() => { D.quakes('day').then(f => setQ((f.data?.features || []).sort((a: any, b: any) => b.properties.mag - a.properties.mag).slice(0, 15))); D.mtr().then(f => setLines(f.data?.lines || [])) }, [])
  useEffect(() => { window.__state = { ...s, fallback: true }; window.__ready = true }, [q.length])
  return (
    <main className="fallback">
      <h1 style={{ fontSize: '1.5rem' }}>{D.SITE}, as text</h1>
      <p>This browser has no WebGL2, so the map cannot draw. Here are the same answers as lists.</p>
      <h2 style={{ fontSize: '1.125rem' }}>{name('hazards', s)}</h2>
      <table><thead><tr><th>Magnitude</th><th>Where</th><th>When</th></tr></thead>
        <tbody>{q.map(f => <tr key={f.id}><td>M{f.properties.mag}</td><td>{f.properties.place}</td><td>{new Date(f.properties.time).toLocaleString()}</td></tr>)}</tbody></table>
      <p className="meta">USGS earthquakes M2.5+, last 24 hours. Public domain.</p>
      <h2 style={{ fontSize: '1.125rem' }}>{name('transit', s)}</h2>
      <table><thead><tr><th>MTR line</th><th>Stations</th><th>From</th><th>To</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.line + l.branch}><td>{l.line}{l.branch ? ` (${l.branch})` : ''}</td><td>{l.stations.length}</td><td>{l.stations[0][1]}</td><td>{l.stations.at(-1)[1]}</td></tr>)}</tbody></table>
      <p className="meta">hk-transit, Government of the HKSAR data.</p>
      <h2 style={{ fontSize: '1.125rem' }}>{name('people', s)}</h2>
      <table><thead><tr><th>Place</th>{Object.values(D.INDICATORS).map(i => <th key={i.id}>{i.label}</th>)}</tr></thead>
        <tbody>{people.map(([place, vals]) => <tr key={place}><td>{place}</td>{vals.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody></table>
      <p className="meta">World Bank indicators, latest year. CC BY 4.0.</p>
      <h2 style={{ fontSize: '1.125rem' }}>{name('height', s)}</h2>
      <p>Building heights need the 3D map. The data is open: <a href="https://huggingface.co/datasets/alreadyopen/world-buildings">world-buildings on Hugging Face</a>.</p>
    </main>
  )
}
