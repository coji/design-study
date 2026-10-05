// 画面を、練習用の写しとして取り込む。
//
// 写しは、表示された HTML、効いている CSS、フォント、画像を 1 つのフォルダにまとめた静的なページで、スクリプトは外す。
// 機械で固めるだけで、ほとんどのサイトは元と画素単位で一致する（docs/design-memo.md の下調べ）。
// 取り込みは、アプリの中のブラウザ（Chromium）で行う。ログインが要る画面は、窓を開いてログインしてもらってから取り込む。
import { BrowserWindow, session, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Page } from '@shared/schema'
import { copiesDir } from './store'

// 取り込み用のブラウザは、アプリの画面とは別の入れ物にする。ログインの状態は、ここに残る
const PARTITION = 'persist:capture'
const MAX_ASSET = 3_000_000

/** 取り込んだ画面の一覧。古い順 */
export async function list(): Promise<Page[]> {
  const pages: Page[] = []
  for (const slug of await readdir(copiesDir()).catch(() => [] as string[])) {
    try {
      pages.push(
        Page.parse(JSON.parse(await readFile(join(copiesDir(), slug, 'meta.json'), 'utf8')))
      )
    } catch {
      // 写しでないフォルダは飛ばす
    }
  }
  return pages.sort((a, b) => a.at.localeCompare(b.at))
}

/** 写しの HTML。中の相対パス（assets/…）が copy:// を指すように、基準の場所を書き足す */
export async function html(slug: string): Promise<string> {
  if (!/^[\w-]+$/.test(slug)) throw new Error('写しの名前が正しくありません')
  const text = await readFile(join(copiesDir(), slug, 'snapshot.html'), 'utf8')
  return text.replace(/<head([^>]*)>/i, `<head$1><base href="copy://${slug}/">`)
}

export async function remove(slug: string): Promise<void> {
  if (!/^[\w-]+$/.test(slug)) throw new Error('写しの名前が正しくありません')
  await rm(join(copiesDir(), slug), { recursive: true, force: true })
}

// ページの中で動かす処理。表示された DOM と、効いている CSS を集めて、スクリプトを外した HTML にする
const SNAPSHOT = `(async () => {
  await document.fonts.ready
  // 遅れて読む画像も、いま読ませる。画面に出ている大きさのものを 1 つに決める
  for (const img of document.images) {
    img.loading = 'eager'
    if (!img.complete) await new Promise((done) => { img.onload = img.onerror = done; setTimeout(done, 5000) })
    await img.decode?.().catch(() => {})
  }
  const abs = (text, base) => text.replace(/url\\((['"]?)(?!data:|https?:|#)([^'")]+)\\1\\)/g, (m, q, u) => { try { return 'url("' + new URL(u, base).href + '")' } catch { return m } })
  const css = [...document.styleSheets, ...document.adoptedStyleSheets].map((sheet) => {
    try { return abs([...sheet.cssRules].map((rule) => rule.cssText).join('\\n'), sheet.href || location.href) }
    catch { return sheet.href ? '@import url("' + sheet.href + '");' : '' }
  }).join('\\n')
  const current = new Map([...document.images].map((img, i) => [i, img.currentSrc || img.src]))
  const doc = document.documentElement.cloneNode(true)
  doc.querySelectorAll('script,link[rel=stylesheet],style,link[rel=modulepreload],link[rel=preload],noscript,base').forEach((e) => e.remove())
  ;[...doc.querySelectorAll('img')].forEach((img, i) => { const src = current.get(i); if (src) img.setAttribute('src', src); img.removeAttribute('srcset'); img.removeAttribute('sizes'); img.removeAttribute('loading') })
  doc.querySelectorAll('picture source').forEach((e) => e.remove())
  doc.querySelectorAll('[src]').forEach((e) => { try { e.setAttribute('src', new URL(e.getAttribute('src'), location.href).href) } catch {} })
  doc.querySelectorAll('[href]').forEach((e) => { try { e.setAttribute('href', new URL(e.getAttribute('href'), location.href).href) } catch {} })
  const attrs = [...document.documentElement.attributes].map((a) => ' ' + a.name + '="' + a.value.replace(/"/g, '&quot;') + '"').join('')
  return { attrs, inner: doc.innerHTML, css, title: document.title, url: location.href }
})()`

const hash = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 12)
const extension = (url: string, fallback: string): string =>
  new URL(url).pathname.match(/\.(\w{2,5})$/)?.[1] ?? fallback

/** いま開いているページを、写しとして保存する */
async function snapshot(contents: WebContents): Promise<Page> {
  const ses = contents.session
  const snap = (await contents.executeJavaScript(SNAPSHOT)) as {
    attrs: string
    inner: string
    css: string
    title: string
    url: string
  }
  const url = new URL(snap.url)
  const slug =
    (url.host + url.pathname)
      .replace(/^www\./, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'page'
  const dir = join(copiesDir(), slug)
  await rm(dir, { recursive: true, force: true })
  await mkdir(join(dir, 'assets'), { recursive: true })

  // 別の出どころの CSS（中身を読めなかったもの）は、取ってきて埋め込む
  let css = snap.css
  for (const [line, href] of [...css.matchAll(/^@import url\("([^"]+)"\);$/gm)].map(
    (m) => [m[0], m[1]] as const
  )) {
    try {
      const text = await (await ses.fetch(href)).text()
      const absolute = text.replace(/url\((['"]?)(?!data:|https?:|#)([^'")]+)\1\)/g, (m, _q, u) => {
        try {
          return `url("${new URL(u, href).href}")`
        } catch {
          return m
        }
      })
      css = css.replace(line, absolute)
    } catch {
      // 取れなければ、@import のまま残す
    }
  }

  // フォントと画像を写しの中に持つ。別の場所から開いても、同じ見た目になるように
  const found = new Set<string>()
  for (const m of css.matchAll(/url\("(https?:[^"]+)"\)/g)) found.add(m[1])
  for (const m of snap.inner.matchAll(/<(?:img|video|source)[^>]*?\ssrc="(https?:[^"]+)"/g))
    found.add(m[1].replace(/&amp;/g, '&'))
  let inner = snap.inner
  await Promise.all(
    [...found].map(async (asset) => {
      try {
        const response = await ses.fetch(asset)
        if (!response.ok) return
        const body = Buffer.from(await response.arrayBuffer())
        if (body.length > MAX_ASSET) return
        const type = response.headers.get('content-type') ?? ''
        const name = `assets/${hash(asset)}.${extension(asset, type.includes('font') ? 'woff2' : 'img')}`
        await writeFile(join(dir, name), body)
        css = css.split(asset).join(name)
        inner = inner.split(asset).join(name).split(asset.replace(/&/g, '&amp;')).join(name)
      } catch {
        // 取れなかったものは、元の場所を指したままにする
      }
    })
  )

  // CSS は head の最後に入れる
  const page = `<!doctype html>\n<html${snap.attrs}>${inner.replace('</head>', () => `<style>${css}</style></head>`)}</html>`
  const meta: Page = {
    slug,
    url: snap.url,
    title: snap.title.trim().slice(0, 40) || url.host,
    at: new Date().toISOString()
  }
  await writeFile(join(dir, 'snapshot.html'), page)
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 1))
  return meta
}

/** 読み込みが落ち着くまで待つ */
async function settle(contents: WebContents): Promise<void> {
  if (contents.isLoading())
    await new Promise<void>((done) => contents.once('did-stop-loading', () => done()))
  await new Promise((done) => setTimeout(done, 800))
}

/** URL を開いて取り込む。窓は出さない */
export async function capture(input: string): Promise<Page> {
  const url = /^https?:\/\//.test(input) ? input : `https://${input}`
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    useContentSize: true,
    webPreferences: { partition: PARTITION }
  })
  try {
    await window.loadURL(url)
    await settle(window.webContents)
    return await snapshot(window.webContents)
  } finally {
    window.destroy()
  }
}

// ログインが要る画面のための窓。開いて、使う人がログインして目的の画面まで進んでから、取り込む
let browser: BrowserWindow | null = null
export async function openBrowser(input: string): Promise<void> {
  const url = /^https?:\/\//.test(input) ? input : `https://${input}`
  browser?.destroy()
  browser = new BrowserWindow({
    width: 1280,
    height: 860,
    useContentSize: true,
    title: '取り込む画面を開いてください',
    webPreferences: { partition: PARTITION }
  })
  browser.on('closed', () => (browser = null))
  await browser.loadURL(url).catch(() => {})
}
/** 開いている窓の、いまの画面を取り込む */
export async function captureBrowser(): Promise<Page> {
  if (!browser) throw new Error('取り込む画面の窓が開いていません')
  await settle(browser.webContents)
  const page = await snapshot(browser.webContents)
  browser.destroy()
  return page
}
export const browserOpen = (): boolean => !!browser

/** 取り込み用のブラウザに残っているログインの状態を消す */
export async function clearLogins(): Promise<void> {
  await session.fromPartition(PARTITION).clearStorageData()
}
