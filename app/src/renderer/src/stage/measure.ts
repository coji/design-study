// 写しの中の要素を測る。指したときも、案を当てたあとも、同じ測り方をする。
// 値は、デザインの言葉（「太さ 700、68px、行送り 85px」）で返す。人が見るのはこの値で、CSS そのものではない。

/** 測った値。名前（「文字」「字間」など）と、その値 */
export type Values = Record<string, string>

/** 指した要素の説明。AI に渡し、記録にも残す */
export interface Described {
  region: boolean
  tag: string
  text: string
  values: Values
  viewport: string
  html: string
  parentHtml: string
  parentValues: Values
}

/** 文字や部品。指されたら、その要素そのものを選ぶ */
export const TEXTY = 'h1,h2,h3,h4,p,a,button,dt,dd,label,figcaption,img'
/** 入れ物。余白やすき間を指したいときに選ぶ */
export const BOXY = 'li,section,header,footer,nav,ul,ol,div,main'

const px = (value: string): number => parseFloat(value) || 0
const bare = (name: string): string => name.trim().replace(/^["']|["']$/g, '')
const styleOf = (el: Element): CSSStyleDeclaration =>
  el.ownerDocument.defaultView!.getComputedStyle(el)

/** 色は #rrggbb で出す。半透明のときは、濃さを添える */
export function hex(rgb: string): string {
  const m = rgb.match(/[\d.]+/g)
  if (!m || m.length < 3) return rgb
  const code =
    '#' +
    m
      .slice(0, 3)
      .map((n) => Math.round(+n).toString(16).padStart(2, '0'))
      .join('')
  return m.length > 3 && +m[3] < 1 ? `${code}（濃さ ${Math.round(+m[3] * 100)}%）` : code
}

/** body からの子の番号の並び。別の枠の中で、同じ要素を探すのに使う */
export function pathOf(el: Element): number[] {
  const path: number[] = []
  for (let e = el; e.parentElement && e.tagName !== 'BODY'; e = e.parentElement) {
    path.unshift([...e.parentElement.children].indexOf(e))
  }
  return path
}
export function resolve(doc: Document, path: number[]): HTMLElement | null {
  let el: Element | undefined = doc.body
  for (const index of path) el = el?.children[index]
  return (el as HTMLElement | undefined) ?? null
}

/** AI が返した HTML から、動くもの（スクリプト、イベントの属性）を取り除く */
export function clean(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

/** 中にいくつも要素が入った入れ物は「範囲」として扱う。値ではなく、中の要素の数や種類を数える */
export const isRegion = (el: Element): boolean =>
  el.matches(BOXY) && el.querySelectorAll('*').length >= 3

const visible = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}
const ownText = (el: Element): boolean =>
  [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
const hasFill = (c: CSSStyleDeclaration): boolean => c.backgroundColor !== 'rgba(0, 0, 0, 0)'

/** 範囲の中を数える。ごちゃごちゃの原因（数、種類、左端、箱）を、値で言えるようにする */
export function census(el: Element): Values {
  const sizes = new Set<number>()
  const weights = new Set<number>()
  const colors = new Set<string>()
  const lefts = new Set<number>()
  let blocks = 0
  let boxes = 0
  let controls = 0
  for (const e of el.querySelectorAll('*')) {
    if (!visible(e) || e.closest('svg')) continue
    const c = styleOf(e)
    if (ownText(e)) {
      blocks++
      sizes.add(px(c.fontSize))
      weights.add(+c.fontWeight)
      colors.add(hex(c.color))
      lefts.add(Math.round(e.getBoundingClientRect().left))
    }
    if (hasFill(c) || px(c.borderTopWidth) > 0) boxes++
    if (e.matches('a,button,input,select,textarea')) controls++
  }
  const list = (set: Set<number>, unit: string): string =>
    `${set.size} 種（${[...set].sort((a, b) => a - b).join('、')}${unit}）`
  return {
    文字のかたまり: `${blocks} 個`,
    文字サイズ: list(sizes, 'px'),
    文字の太さ: list(weights, ''),
    文字の色: `${colors.size} 色`,
    左端: `${lefts.size} 本`,
    囲みや地のある箱: `${boxes} 個`,
    押せるもの: `${controls} 個`
  }
}

/** 範囲の中身を、番号と値つきの短い HTML にして AI に渡す。AI は、この番号で要素を指して変える */
export function outline(el: Element): string {
  const clone = el.cloneNode(true) as Element
  const originals = [...el.querySelectorAll('*')]
  ;[...clone.querySelectorAll('*')].forEach((e, i) => {
    const o = originals[i]
    const c = styleOf(o)
    const r = o.getBoundingClientRect()
    for (const a of [...e.attributes]) e.removeAttribute(a.name)
    e.setAttribute('data-ds', String(i + 1))
    const type = ownText(o) ? `${c.fontSize} ${c.fontWeight} ${hex(c.color)} ` : ''
    const fill = hasFill(c) ? ` 地${hex(c.backgroundColor)}` : ''
    const border = px(c.borderTopWidth) > 0 ? ' 枠' : ''
    e.setAttribute(
      'data-v',
      visible(o)
        ? `${type}${Math.round(r.width)}×${Math.round(r.height)}${fill}${border}`
        : '見えない'
    )
  })
  clone.querySelectorAll('svg').forEach((e) => e.replaceChildren())
  for (const a of [...clone.attributes]) clone.removeAttribute(a.name)
  clone.setAttribute('data-ds-target', '')
  return clone.outerHTML.slice(0, 20000)
}

/** 指定した太さがフォントにないと、ブラウザは近い太さで代わりに描く。実際に描かれる太さを出す */
export function drawnWeight(
  el: Element,
  c: CSSStyleDeclaration
): { drawn: number; have: number[] } | null {
  const family = bare(c.fontFamily.split(',')[0])
  const have = new Set<number>()
  for (const face of el.ownerDocument.fonts) {
    if (bare(face.family) !== family) continue
    const [low, high] = face.weight
      .replace('normal', '400')
      .replace('bold', '700')
      .split(' ')
      .map(Number)
    // 太さを自由に変えられるフォントは、どの太さでも描ける
    if (high) return null
    have.add(low)
  }
  const weights = [...have].sort((a, b) => a - b)
  const want = +c.fontWeight
  if (!weights.length || weights.includes(want)) return null
  const below = weights.filter((w) => w < want).at(-1)
  const above = weights.find((w) => w > want)
  // ブラウザの決まり: 400〜500 は 500 までの重いほうを先に探し、それ以外は指定に近い側から探す
  const drawn =
    want >= 400 && want <= 500
      ? (weights.find((w) => w > want && w <= 500) ?? below ?? above)
      : want < 400
        ? (below ?? above)
        : (above ?? below)
  return drawn == null ? null : { drawn, have: weights }
}

/** 行数は、文字が実際に並んでいる段を数える。高さを行送りで割ると、ボタンの上下の空きまで行に数えてしまう */
function countLines(el: Element): number {
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  let lines = 0
  let bottom = -Infinity
  const rects = [...range.getClientRects()].filter((r) => r.width > 0).sort((a, b) => a.top - b.top)
  for (const r of rects) {
    if (r.top >= bottom - 2) {
      lines++
      bottom = r.bottom
    } else bottom = Math.max(bottom, r.bottom)
  }
  return Math.max(1, lines)
}

export function measure(el: HTMLElement): Values {
  const c = styleOf(el)
  const r = el.getBoundingClientRect()
  const region = isRegion(el)
  const values: Values = {}

  if (!region) {
    const fallback = drawnWeight(el, c)
    const note = fallback
      ? `（このフォントにあるのは ${fallback.have.join('、')} だけなので、${fallback.drawn} で描かれます）`
      : ''
    values.文字数 = `${el.innerText.trim().length} 字`
    values.文字 = `太さ ${c.fontWeight}${note}、${c.fontSize}、行送り ${c.lineHeight}`
    values.字間 = c.letterSpacing
    values.色 = hex(c.color)
    values.フォント = bare(c.fontFamily.split(',')[0])
    if (c.fontStyle !== 'normal') values.字体 = c.fontStyle === 'italic' ? '斜体' : c.fontStyle
    if (c.textDecorationLine !== 'none')
      values.線 = c.textDecorationLine === 'underline' ? '下線' : c.textDecorationLine
    if (c.textTransform !== 'none') values.大文字と小文字 = c.textTransform
  }
  values.幅 = `${Math.round(r.width)}px`
  values.高さ = `${Math.round(r.height)}px`
  if (!region) {
    const lines = countLines(el)
    if (lines > 1) {
      const inner =
        r.width -
        px(c.paddingLeft) -
        px(c.paddingRight) -
        px(c.borderLeftWidth) -
        px(c.borderRightWidth)
      values.行数 = `${lines} 行`
      values['1 行の字数'] = `約 ${Math.floor(inner / (px(c.fontSize) + px(c.letterSpacing)))} 字`
    }
    if (c.textAlign !== 'start' && c.textAlign !== 'left') values.そろえ = c.textAlign
  }
  if (px(c.paddingTop) + px(c.paddingRight) + px(c.paddingBottom) + px(c.paddingLeft) > 0)
    values.内側の余白 = c.padding
  if (region) {
    values.並べ方 = c.display
    if (c.gap !== 'normal') values.すき間 = c.gap
    Object.assign(values, census(el))
  }
  if (hasFill(c)) values.背景 = hex(c.backgroundColor)
  if (c.borderRadius !== '0px') values.角丸 = c.borderRadius
  if (px(c.borderTopWidth) > 0) values.枠 = `${c.borderTopWidth} ${hex(c.borderTopColor)}`
  if (c.outlineStyle !== 'none') values.輪郭 = `${c.outlineWidth} ${hex(c.outlineColor)}`
  if (c.boxShadow !== 'none') values.影 = c.boxShadow
  if (c.opacity !== '1') values.濃さ = c.opacity
  return values
}

/** 元と案の値を比べて、変わったところを「名前: 元 → 案」の形で返す */
export function changes(from: Values, to: Values): string[] {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])]
  return keys
    .filter((k) => from[k] !== to[k])
    .map((k) => `${k}: ${from[k] ?? 'なし'} → ${to[k] ?? 'なし'}`)
}

/** 指した要素を説明する。viewport は「PC幅 1280px」のような、いま見ている幅の呼び名 */
export function describe(el: HTMLElement, viewport: string): Described {
  const region = isRegion(el)
  const clone = el.cloneNode(true) as Element
  clone.removeAttribute('data-ds-hover')
  clone.removeAttribute('data-ds-selected')
  clone.setAttribute('data-ds-target', '')
  // 中身の長い入れ物は番号つきの短い形に、長い要素は途中で切って渡す
  const html = region
    ? outline(el)
    : clone.outerHTML.length > 3000
      ? clone.outerHTML.slice(0, 3000) + '…（省略）'
      : clone.outerHTML

  const parent = el.parentElement!
  const pc = styleOf(parent)
  const open = parent.cloneNode(false) as Element
  open.setAttribute('data-ds-parent', '')
  return {
    region,
    tag: el.tagName.toLowerCase(),
    text: el.innerText.trim(),
    values: measure(el),
    viewport,
    html,
    parentHtml: open.outerHTML.replace(/<\/\w+>$/, ''),
    parentValues: {
      幅: `${Math.round(parent.getBoundingClientRect().width)}px`,
      並べ方: pc.display,
      すき間: pc.gap
    }
  }
}
