// 指した要素のあたりを撮る。AI に画面を見せるため
// 本番のアプリでは Electron の内蔵 Chromium で撮る。試作では lab の Playwright と手元の Chrome を借りる
import { chromium } from '../../lab/node_modules/playwright-core/index.mjs'

const VIEWS = { pc: { width: 1280, height: 900 }, sp: { width: 390, height: 844 } }
let browser
// 撮影用のブラウザは、閉じていたら開き直す
export const warm = async () => {
  const current = await browser?.catch(() => null)
  if (!current?.isConnected()) browser = chromium.launch({ channel: 'chrome' })
  return browser
}
export const close = async () => { await (await browser?.catch(() => null))?.close().catch(() => {}) }

// path は body からの子の番号の並び。返すのは画像と、画像の中での要素の位置
export async function shot({ base, slug, path, width, dark }) {
  const page = await (await warm()).newPage({ viewport: VIEWS[width] || VIEWS.pc, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light' })
  try {
    await page.goto(`${base}/copy/${slug}/snapshot.html`, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const rect = await page.evaluate((path) => {
      const el = path.reduce((e, i) => e?.children[i], document.body); if (!el) return null
      scrollTo(0, Math.round(el.getBoundingClientRect().top + scrollY - innerHeight * 0.3))
      const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }, path)
    if (!rect) return null
    const image = await page.screenshot({ type: 'jpeg', quality: 85 })
    return { rect, size: VIEWS[width] || VIEWS.pc, url: `data:image/jpeg;base64,${image.toString('base64')}` }
  } finally { await page.close() }
}

// 記録に残す画像を撮る。元と各案を、2 つの幅で、同じ位置で撮る（あとで同じ位置のまま切り替えて見比べるため）
// options は [{ letter, css, html }]。返すのは [{ name: 'pc-A.jpg', image }]
export async function shotAll({ base, slug, path, dark, options }) {
  const out = []
  for (const [width, viewport] of Object.entries(VIEWS)) {
    const page = await (await warm()).newPage({ viewport, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light' })
    try {
      await page.goto(`${base}/copy/${slug}/snapshot.html`, { waitUntil: 'load' })
      await page.evaluate(() => document.fonts.ready)
      for (const o of options) {
        // 案ごとに開き直して、前の案の変更を残さない
        await page.goto(`${base}/copy/${slug}/snapshot.html`, { waitUntil: 'load' })
        await page.evaluate(() => document.fonts.ready)
        const ok = await page.evaluate(({ path, css, html, edits }) => {
          const el = path.reduce((e, i) => e?.children[i], document.body); if (!el) return false
          el.setAttribute('data-ds-target', ''); el.parentElement.setAttribute('data-ds-parent', '')
          el.querySelectorAll('*').forEach((e, i) => e.setAttribute('data-ds', i + 1))
          const style = document.createElement('style'); style.textContent = css || ''; document.head.append(style)
          if (html) el.innerHTML = html
          else for (const edit of edits || []) { const node = el.querySelector(`[data-ds="${edit.id}"]`); if (node) node.innerHTML = edit.html }
          scrollTo(0, Math.round(el.getBoundingClientRect().top + scrollY - innerHeight * 0.3))
          return true
        }, { path, css: o.css, html: o.html, edits: o.edits })
        if (!ok) continue
        await page.evaluate(() => document.fonts.ready)
        out.push({ name: `${width}-${o.letter}.jpg`, image: await page.screenshot({ type: 'jpeg', quality: 85 }) })
      }
    } finally { await page.close() }
  }
  return out
}
