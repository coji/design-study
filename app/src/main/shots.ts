// 写しを撮る。AI に画面を見せるためと、記録に元と各案の画像を残すため。
// 窓は出さずに、裏で描いて撮る。
import { BrowserWindow, type WebContents } from 'electron'
import type { RecordOption, WidthKey } from '@shared/schema'
import type { Shot } from './ai'

const VIEWS: Record<WidthKey, { width: number; height: number }> = {
  pc: { width: 1280, height: 900 },
  sp: { width: 390, height: 844 }
}

interface Patch {
  css?: string | null
  html?: string | null
  edits?: { id: number; html: string }[] | null
}

/** 写しを裏の窓で開く */
async function open(slug: string, width: WidthKey): Promise<BrowserWindow> {
  const view = VIEWS[width]
  const window = new BrowserWindow({
    show: false,
    ...view,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  await window.loadURL(`copy://${slug}/snapshot.html`)
  await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  return window
}

// ページの中で動かす処理。指した要素に案を当てて、決まった位置まで動かし、要素の位置を返す。画面側（stage.ts）と同じ当て方をする
const APPLY = (path: number[], patch: Patch): string => `(() => {
  const path = ${JSON.stringify(path)}, patch = ${JSON.stringify(patch)}
  const el = path.reduce((e, i) => e && e.children[i], document.body)
  if (!el) return null
  el.setAttribute('data-ds-target', ''); el.parentElement.setAttribute('data-ds-parent', '')
  el.querySelectorAll('*').forEach((e, i) => e.setAttribute('data-ds', i + 1))
  const style = document.createElement('style'); style.textContent = patch.css || ''; document.head.append(style)
  // AI が返した HTML から、動くもの（スクリプト、イベントの属性）を取り除く
  const clean = (html) => String(html).replace(/<script[\\s\\S]*?<\\/script>/gi, '').replace(/\\son\\w+\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)/gi, '')
  if (patch.html) el.innerHTML = clean(patch.html)
  else for (const edit of patch.edits || []) { const node = el.querySelector('[data-ds="' + edit.id + '"]'); if (node) node.innerHTML = clean(edit.html) }
  scrollTo(0, Math.round(el.getBoundingClientRect().top + scrollY - innerHeight * 0.3))
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
})()`

async function jpeg(contents: WebContents, width: number): Promise<Buffer> {
  // 描き終わるのを少し待つ（位置を動かした直後は、まだ前の絵のことがある）
  await new Promise((done) => setTimeout(done, 200))
  let image = await contents.capturePage()
  // 高精細の画面では 2 倍の大きさで撮れる。等倍にそろえる
  if (image.getSize().width > width) image = image.resize({ width })
  return image.toJPEG(85)
}

/** 指した要素のあたりを撮る。AI に画面を見せるため */
export async function shot(slug: string, path: number[], width: WidthKey): Promise<Shot | null> {
  const window = await open(slug, width)
  try {
    const rect = await window.webContents.executeJavaScript(APPLY(path, {}))
    if (!rect) return null
    const image = await jpeg(window.webContents, VIEWS[width].width)
    return { rect, size: VIEWS[width], url: `data:image/jpeg;base64,${image.toString('base64')}` }
  } finally {
    window.destroy()
  }
}

/**
 * 記録に残す画像を撮る。元と各案を、2 つの幅で、同じ位置で撮る（あとで同じ位置のまま切り替えて見比べるため）。
 * 写しはあとで取り込み直されるかもしれないので、そのときの画面を画像で持つ。
 */
export async function shotAll(
  slug: string,
  path: number[],
  options: RecordOption[]
): Promise<{ name: string; image: Buffer }[]> {
  const out: { name: string; image: Buffer }[] = []
  for (const width of ['pc', 'sp'] as const) {
    for (const option of options) {
      // 案ごとに開き直して、前の案の変更を残さない
      const window = await open(slug, width)
      try {
        const rect = await window.webContents.executeJavaScript(APPLY(path, option))
        if (rect)
          out.push({
            name: `${width}-${option.letter}.jpg`,
            image: await jpeg(window.webContents, VIEWS[width].width)
          })
      } finally {
        window.destroy()
      }
    }
  }
  return out
}
