// Download server for Anonymo: serves installers from the R2 bucket via Cloudflare's edge.
// Routes:  /            → download page (Slovak)
//          /windows     → latest Windows installer
//          /mac         → latest macOS (Apple Silicon) installer
//          /v0.1.0/...  → exact files (supports HEAD and Range for resumable downloads)

interface Env {
  RELEASES: R2Bucket
}

// Bump on each release (files are uploaded to R2 under v<version>/).
const VERSION = '0.1.1'
const FILES = {
  windows: `v${VERSION}/Anonymo-Setup-${VERSION}.exe`,
  mac: `v${VERSION}/Anonymo-${VERSION}-arm64.dmg`,
  sums: `v${VERSION}/SHA256SUMS.txt`
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''))

    if (path === '') return page(req, env)
    if (path === 'sukromie' || path === 'privacy') return privacy(req)
    if (path === 'windows' || path === 'mac') return Response.redirect(`${url.origin}/${FILES[path]}`, 302)
    if (path === 'favicon.ico' || path === 'favicon.svg') return new Response(ICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } })
    if (!/^v\d+\.\d+\.\d+\/[\w.\-]+$/.test(path)) return new Response('Nenájdené', { status: 404 })

    const range = parseRange(req.headers.get('range'))
    const obj = req.method === 'HEAD' ? await env.RELEASES.head(path) : await env.RELEASES.get(path, range ? { range } : {})
    if (!obj) return new Response('Nenájdené', { status: 404 })

    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('etag', obj.httpEtag)
    headers.set('accept-ranges', 'bytes')
    // Versioned paths never change → cache aggressively at the edge and in browsers.
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    headers.set('x-content-type-options', 'nosniff')

    if (req.method === 'HEAD') {
      headers.set('content-length', String(obj.size))
      return new Response(null, { headers })
    }
    const body = (obj as R2ObjectBody).body
    if (range && 'offset' in range && range.offset !== undefined) {
      const start = range.offset
      const end = range.length !== undefined ? start + range.length - 1 : obj.size - 1
      headers.set('content-range', `bytes ${start}-${end}/${obj.size}`)
      headers.set('content-length', String(end - start + 1))
      return new Response(body, { status: 206, headers })
    }
    if (range && 'suffix' in range) {
      const start = Math.max(0, obj.size - range.suffix)
      headers.set('content-range', `bytes ${start}-${obj.size - 1}/${obj.size}`)
      headers.set('content-length', String(obj.size - start))
      return new Response(body, { status: 206, headers })
    }
    headers.set('content-length', String(obj.size))
    return new Response(body, { headers })
  }
} satisfies ExportedHandler<Env>

function parseRange(h: string | null): R2Range | undefined {
  const m = h && /^bytes=(\d*)-(\d*)$/.exec(h.trim())
  if (!m) return undefined
  if (m[1] === '' && m[2] !== '') return { suffix: +m[2] }
  if (m[1] !== '') return m[2] === '' ? { offset: +m[1] } : { offset: +m[1], length: +m[2] - +m[1] + 1 }
  return undefined
}

const mb = (n: number) => `${Math.round(n / 1e6)} MB`

async function page(req: Request, env: Env): Promise<Response> {
  const [win, mac, sums] = await Promise.all([env.RELEASES.head(FILES.windows), env.RELEASES.head(FILES.mac), env.RELEASES.get(FILES.sums)])
  const sumsText = sums ? await sums.text() : ''
  const html = `<!doctype html>
<html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anonymo – stiahnuť</title>
<meta name="description" content="Offline anonymizácia PDF, Word a Excel dokumentov pred vložením do ChatGPT alebo Claude.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${STYLE}</head><body><div class="wrap">
<header>${ICON}<div><h1>Anonymo</h1><p>by Shanoon</p></div></header>
<span class="badge">100 % offline · verzia ${VERSION}</span>
<p class="lead">Anonymizujte dokumenty pred vložením do ChatGPT alebo Claude.</p>
<p class="sub">PDF, Word a Excel. Mená, rodné čísla, IČO, IBAN, adresy a ďalšie údaje nahradí značkami ako [OSOBA_1]. Všetko prebieha na vašom počítači, žiadne dáta sa neodosielajú.</p>
<div class="grid">
  <div class="card"><h2>Windows</h2><p>Windows 10 a 11 (64-bit)${win ? ` · ${mb(win.size)}` : ''}</p>
    <a class="btn" href="/windows" ${win ? '' : 'aria-disabled="true"'}>Stiahnuť pre Windows</a></div>
  <div class="card"><h2>macOS</h2><p>Apple Silicon (M1 a novšie)${mac ? ` · ${mb(mac.size)}` : ''}</p>
    <a class="btn" href="/mac" ${mac ? '' : 'aria-disabled="true"'}>Stiahnuť pre Mac</a></div>
</div>
<p class="note"><b>Prvé spustenie:</b> na Windows môže SmartScreen zobraziť „Neznámy vydavateľ“ – kliknite na <i>Ďalšie informácie → Spustiť aj tak</i>. Na Macu otvorte aplikáciu pravým klikom → <i>Otvoriť</i>.</p>
${sumsText ? `<details><summary>Kontrolné súčty SHA-256</summary><pre>${escapeHtml(sumsText)}</pre></details>` : ''}
<footer><span>Všetko prebieha lokálne na vašom počítači. · <a href="/sukromie">Ochrana súkromia</a></span><span>Powered by <a href="https://shanoon.sk">SHANOON</a></span></footer>
</div></body></html>`
  return new Response(req.method === 'HEAD' ? null : html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' }
  })
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Anonymo mark (same as resources/brand/icon.svg): Shanoon teal + Lucide "hat-glasses" (ISC).
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="115" fill="#0f766e"/><g transform="translate(106 106) scale(12.5)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18a2 2 0 0 0-4 0"/><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11"/><path d="M2 11h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/></g></svg>`

const STYLE = `<style>
:root{--bg:#fff;--muted:#f8fafc;--border:#e2e8f0;--ink:#0f172a;--body:#475569;--meta:#64748b;--primary:#0f766e;--primary-hover:#0d9488;--primary-light:#f0fdfa;--gold:#b58a3e;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#14181a;--muted:#1b2023;--border:#ffffff1a;--ink:#ece7dc;--body:#c9c5ba;--meta:#9a978c;--primary:#2dd4bf;--primary-hover:#5eead4;--primary-light:#123330;--gold:#c99a4a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--body);font:15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:48px 16px 32px}
header{display:flex;align-items:center;gap:12px;margin-bottom:40px}
header svg{width:40px;height:40px;flex:none}
h1{margin:0;font-size:20px;color:var(--ink);letter-spacing:-.01em}header p{margin:0;font-size:13px;color:var(--meta)}
.lead{font-size:clamp(26px,5vw,36px);line-height:1.2;color:var(--ink);font-weight:700;letter-spacing:-.02em;margin:0 0 12px}
.sub{margin:0 0 32px;max-width:560px}
.badge{display:inline-flex;gap:6px;align-items:center;border:1px solid color-mix(in oklab,var(--primary) 25%,transparent);background:var(--primary-light);color:var(--primary);border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.card{border:1px solid var(--border);border-radius:13px;padding:20px;background:var(--muted)}
.card h2{margin:0 0 2px;font-size:16px;color:var(--ink)}.card p{margin:0 0 16px;font-size:13px;color:var(--meta)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border-radius:9px;background:var(--primary);color:#fff;font-weight:600;text-decoration:none}
@media (prefers-color-scheme:dark){.btn{color:#0d1512}}
.btn:hover{background:var(--primary-hover)}.btn[aria-disabled=true]{opacity:.5;pointer-events:none}
.note{margin-top:28px;font-size:13px;color:var(--meta)}.note b{color:var(--ink);font-weight:600}
details{margin-top:20px;font-size:13px}summary{cursor:pointer;color:var(--meta)}pre{overflow-x:auto;background:var(--muted);border:1px solid var(--border);border-radius:9px;padding:12px;font-size:11px}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--meta)}
footer a{color:var(--ink);font-weight:600;text-decoration:none}footer a:hover{color:var(--primary)}
</style>`

function privacy(req: Request): Response {
  const html = `<!doctype html>
<html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ochrana súkromia – Anonymo</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${STYLE}
<style>.doc h2{color:var(--ink);font-size:17px;margin:28px 0 6px}.doc p,.doc li{max-width:640px}.doc ul{padding-left:20px}</style>
</head><body><div class="wrap doc">
<header>${ICON}<div><h1>Anonymo</h1><p>by Shanoon</p></div></header>
<p class="lead">Zásady ochrany súkromia</p>
<p class="sub">Platné od 2. 11. 2026 pre aplikáciu Anonymo (Windows, macOS).</p>

<h2>Stručne</h2>
<p>Aplikácia spracúva vaše dokumenty výlučne na vašom počítači. Žiadne dokumenty, ich obsah ani nájdené údaje sa nikam neodosielajú a aplikácia neobsahuje žiadnu analytiku, telemetriu ani reklamu.</p>

<h2>Aké údaje aplikácia spracúva</h2>
<ul>
<li><b>Dokumenty, ktoré vyberiete</b> (PDF, Word, Excel) – načítajú sa do pamäte počítača, anonymizujú sa a výsledok sa uloží do priečinka, ktorý určíte. Pôvodné súbory aplikácia nemení.</li>
<li><b>Nájdené citlivé údaje</b> (mená, rodné čísla, IBAN a pod.) a ich priradenie k značkám ako [OSOBA_1] existujú iba v pamäti počas spracovania a po jeho skončení sa zahodia.</li>
<li><b>Vlastné výrazy</b>, ktoré zadáte, sa neukladajú.</li>
<li><b>Nastavenia</b> – aplikácia si lokálne v počítači pamätá iba to, ktoré typy údajov máte zaškrtnuté a do ktorého priečinka sa majú výsledky ukladať.</li>
</ul>

<h2>Sieť</h2>
<p>Aplikácia na spracovanie nepotrebuje internet a sieťovú komunikáciu aktívne blokuje. Rozpoznávanie mien (AI model) aj rozpoznávanie textu v naskenovaných PDF (OCR) sú súčasťou inštalácie a bežia lokálne. Model sa na vašich dokumentoch nič neučí. Jediný odkaz von je odkaz „Powered by Shanoon“, ktorý na vaše kliknutie otvorí web shanoon.sk v prehliadači.</p>

<h2>Táto stránka na stiahnutie</h2>
<p>Stránku a súbory na stiahnutie prevádzkuje Cloudflare. Ako každý webový server môže pri návšteve technicky spracovať vašu IP adresu a údaje o prehliadači na účely doručenia a ochrany pred zneužitím. Nepoužívame žiadne cookies ani analytické nástroje.</p>

<h2>Kontakt</h2>
<p>Otázky k ochrane súkromia: <a href="mailto:info@shanoon.sk">info@shanoon.sk</a></p>

<footer><span><a href="/">← Späť na stiahnutie</a></span><span>Powered by <a href="https://shanoon.sk">SHANOON</a></span></footer>
</div></body></html>`
  return new Response(req.method === 'HEAD' ? null : html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' }
  })
}
