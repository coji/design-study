// 基準を採る: 2 つの幅の画像、表示された HTML、効いている CSS、主な要素の実際の値
import { chromium } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
const [url, out] = process.argv.slice(2)
const VIEWS = { pc: { width: 1280, height: 800 }, sp: { width: 390, height: 844 } }
const b = await chromium.launch({ channel: 'chrome' })
for (const [name, viewport] of Object.entries(VIEWS)) {
  const p = await b.newPage({ viewport, deviceScaleFactor: 1 })
  // 写しを自立させるため、読み込んだフォントと画像を覚えておき、あとで写しに埋め込む
  const assets = new Map()
  p.on('response', async r => { const t = r.request().resourceType(); if ((t === 'font' || t === 'image') && r.ok()) { try { const body = await r.body(); if (body.length < 3_000_000) { const ext = (new URL(r.url()).pathname.match(/\.(\w{2,5})$/) || [, t === 'font' ? 'woff2' : 'img'])[1]; const name = `assets/${createHash('sha1').update(r.url()).digest('hex').slice(0, 12)}.${ext}`; mkdirSync(`${out}/assets`, { recursive: true }); writeFileSync(`${out}/${name}`, body); assets.set(r.url(), name) } } catch {} } })
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  await p.evaluate(async () => { for (const i of document.images) { i.loading = 'eager'; if (!i.complete) await new Promise(r => { i.onload = i.onerror = r }); await i.decode?.().catch(() => {}) } })
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true })
  if (name === 'pc') {
    const snap = await p.evaluate(() => {
      const abs = (text, base) => text.replace(/url\((['"]?)(?!data:|https?:|#)([^'")]+)\1\)/g, (m, q, u) => { try { return `url("${new URL(u, base).href}")` } catch { return m } })
      const css = [...document.styleSheets, ...document.adoptedStyleSheets].map(s => { try { return abs([...s.cssRules].map(r => r.cssText).join('\n'), s.href || location.href) } catch { return `@import url("${s.href}");` } }).join('\n')
      const doc = document.documentElement.cloneNode(true)
      doc.querySelectorAll('script,link[rel=stylesheet],style,link[rel=modulepreload]').forEach(e => e.remove())
      doc.querySelectorAll('[src]').forEach(e => e.setAttribute('src', new URL(e.getAttribute('src'), location.href).href))
      doc.querySelectorAll('[href]').forEach(e => e.setAttribute('href', new URL(e.getAttribute('href'), location.href).href))
      doc.querySelectorAll('img').forEach(e => e.removeAttribute('loading'))
      const imports = css.split('\n').filter(l => l.startsWith('@import')).join('\n'), rest = css.split('\n').filter(l => !l.startsWith('@import')).join('\n')
      const values = [...document.querySelectorAll('h1,h2,h3,p,a,button,li,dt,dd,label,input,textarea,figcaption')].filter(e => e.offsetParent).map(e => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), text: e.innerText.slice(0, 40), x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height), font: `${c.fontWeight} ${c.fontSize}/${c.lineHeight}`, ls: c.letterSpacing, color: c.color, bg: c.backgroundColor, radius: c.borderRadius } })
      const attrs = [...document.documentElement.attributes].map(a => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('')
      return { html: `<!doctype html>\n<html${attrs}>${doc.innerHTML.replace('</head>', `<style>${imports}\n${rest}</style></head>`)}</html>`, values }
    })
    for (const [u, data] of assets) snap.html = snap.html.split(u).join(data).split(u.replace(/&/g, '&amp;')).join(data)
    writeFileSync(`${out}/snapshot.html`, snap.html); writeFileSync(`${out}/values.json`, JSON.stringify(snap.values, null, 1))
    console.log('snapshot', snap.html.length, 'values', snap.values.length)
  }
  await p.close()
}
await b.close()
