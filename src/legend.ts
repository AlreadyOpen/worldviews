// <view-legend>: a reusable leaf (shadow DOM, no framework). Set `.spec` as a property (object props via ref, per the
// web-interop contract). Colours come from the spec; type and ink inherit through CSS custom properties.
export type LegendSpec =
  | { kind: 'ramp'; title: string; colors: string[]; ticks: string[]; note?: string }
  | { kind: 'items'; title: string; items: { label: string; color: string; shape: 'line' | 'dot' | 'ring' }[]; note?: string }

const css = `
:host { display: block; font: inherit; color: var(--ink, currentColor) }
.t { font-size: 0.8125rem; font-weight: 600; margin: 0 0 0.375rem }
.bar { height: 0.625rem; border-radius: 2px }
.ticks { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--ink-2); margin-top: 0.25rem; font-variant-numeric: tabular-nums }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; font-size: 0.8125rem }
li { display: flex; align-items: center; gap: 0.5rem }
.k { flex: none; width: 1.25rem; display: grid; place-items: center }
.line { height: 3px; width: 1.25rem; border-radius: 2px }
.dot { width: 0.625rem; height: 0.625rem; border-radius: 50% }
.ring { width: 0.625rem; height: 0.625rem; border-radius: 50%; border: 1.5px solid; box-sizing: border-box }
.n { font-size: 0.75rem; color: var(--ink-2); margin-top: 0.375rem }
.sk { height: 0.625rem; border-radius: 2px; background: var(--skeleton); animation: p 1.2s ease-in-out infinite alternate }
@keyframes p { to { opacity: 0.45 } }
@media (prefers-reduced-motion: reduce) { .sk { animation: none } }`

class ViewLegend extends HTMLElement {
  #spec?: LegendSpec | null
  constructor() { super(); this.attachShadow({ mode: 'open' }); this.render() }
  set spec(s: LegendSpec | null | undefined) { this.#spec = s; this.render() }
  get spec() { return this.#spec }
  render() {
    const s = this.#spec, esc = (x: string) => x.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
    let body = '<div class="sk" aria-hidden="true"></div>'
    if (s?.kind === 'ramp') body = `<p class="t">${esc(s.title)}</p><div class="bar" role="img" aria-label="${esc(`${s.title}: ${s.ticks[0]} to ${s.ticks.at(-1)}`)}"
      style="background:linear-gradient(to right,${s.colors.join(',')})"></div><div class="ticks">${s.ticks.map(t => `<span>${esc(t)}</span>`).join('')}</div>`
    if (s?.kind === 'items') body = `<p class="t">${esc(s.title)}</p><ul>${s.items.map(i =>
      `<li><span class="k"><span class="${i.shape}" style="${i.shape === 'ring' ? 'border-color' : 'background'}:${i.color}"></span></span>${esc(i.label)}</li>`).join('')}</ul>`
    if (s?.note) body += `<p class="n">${esc(s.note)}</p>`
    this.shadowRoot!.innerHTML = `<style>${css}</style>${body}`
  }
}
if (typeof customElements !== 'undefined' && !customElements.get('view-legend')) customElements.define('view-legend', ViewLegend)
