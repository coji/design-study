// 写しの中の要素を測る。指したときも、案を当てたあとも、同じ測り方をする

// 色は #rrggbb で出す。半透明のときは、濃さを添える
export const hex = (rgb) => { const m = rgb.match(/[\d.]+/g); if (!m || m.length < 3) return rgb; const code = '#' + m.slice(0, 3).map(n => Math.round(+n).toString(16).padStart(2, '0')).join(''); return m.length > 3 && +m[3] < 1 ? `${code}（濃さ ${Math.round(+m[3] * 100)}%）` : code }
export const pathOf = (el) => { const p = []; for (let e = el; e.parentElement && e.tagName !== 'BODY'; e = e.parentElement) p.unshift([...e.parentElement.children].indexOf(e)); return p }
export const resolve = (doc, path) => path.reduce((e, i) => e?.children[i], doc.body)
export const clean = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
export const TEXTY = 'h1,h2,h3,h4,p,a,button,dt,dd,label,figcaption,img', BOXY = 'li,section,header,footer,nav,ul,ol,div,main'
// 中にいくつも要素が入った入れ物は「範囲」として扱う。値ではなく、中の要素の数や種類を数える
export const isRegion = (el) => el.matches(BOXY) && el.querySelectorAll('*').length >= 3
export const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
export const ownText = (e) => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
// 範囲の中を数える。ごちゃごちゃの原因（数、種類、左端、箱）を、値で言えるようにする
export function census(el) {
  const view = el.ownerDocument.defaultView, sizes = new Set(), weights = new Set(), colors = new Set(), lefts = new Set(); let blocks = 0, boxes = 0, controls = 0
  for (const e of el.querySelectorAll('*')) {
    if (!visible(e) || e.closest('svg')) continue
    const c = view.getComputedStyle(e)
    if (ownText(e)) { blocks++; sizes.add(parseFloat(c.fontSize)); weights.add(c.fontWeight); colors.add(hex(c.color)); lefts.add(Math.round(e.getBoundingClientRect().left)) }
    if (c.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(c.borderTopWidth) > 0) boxes++
    if (e.matches('a,button,input,select,textarea')) controls++
  }
  const list = (set, unit) => `${set.size} 種（${[...set].sort((x, y) => x - y).join('、')}${unit}）`
  return { 文字のかたまり: `${blocks} 個`, 文字サイズ: list(sizes, 'px'), 文字の太さ: list(weights, ''), 文字の色: `${colors.size} 色`, 左端: `${lefts.size} 本`, 囲みや地のある箱: `${boxes} 個`, 押せるもの: `${controls} 個` }
}
// 範囲の中身を、番号と値つきの短い HTML にして AI に渡す
export function outline(el) {
  const view = el.ownerDocument.defaultView, clone = el.cloneNode(true), originals = [...el.querySelectorAll('*')]
  ;[...clone.querySelectorAll('*')].forEach((e, i) => {
    const o = originals[i], c = view.getComputedStyle(o), r = o.getBoundingClientRect()
    for (const a of [...e.attributes]) e.removeAttribute(a.name)
    e.setAttribute('data-ds', i + 1)
    if (!visible(o)) e.setAttribute('data-v', '見えない')
    else e.setAttribute('data-v', `${ownText(o) ? `${c.fontSize} ${c.fontWeight} ${hex(c.color)} ` : ''}${Math.round(r.width)}×${Math.round(r.height)}${c.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ` 地${hex(c.backgroundColor)}` : ''}${parseFloat(c.borderTopWidth) > 0 ? ' 枠' : ''}`)
  })
  clone.querySelectorAll('svg').forEach(e => e.replaceChildren())
  for (const a of [...clone.attributes]) clone.removeAttribute(a.name)
  clone.setAttribute('data-ds-target', '')
  return clone.outerHTML.slice(0, 20000)
}
// 指定した太さがフォントにないと、ブラウザは近い太さで代わりに描く。実際に描かれる太さを出す
export function drawnWeight(el, c) {
  const bare = (x) => x.trim().replace(/^["']|["']$/g, ''), family = bare(c.fontFamily.split(',')[0]), have = new Set()
  for (const f of el.ownerDocument.fonts) if (bare(f.family) === family) { const [lo, hi] = f.weight.replace('normal', '400').replace('bold', '700').split(' ').map(Number); if (hi) return null; have.add(lo) }
  const ws = [...have].sort((x, y) => x - y), w = +c.fontWeight; if (!ws.length || ws.includes(w)) return null
  const below = ws.filter(x => x < w).at(-1), above = ws.find(x => x > w)
  const drawn = w >= 400 && w <= 500 ? (ws.find(x => x > w && x <= 500) ?? below ?? above) : w < 400 ? (below ?? above) : (above ?? below)
  return { drawn, have: ws }
}
export function measure(el) {
  const c = el.ownerDocument.defaultView.getComputedStyle(el), r = el.getBoundingClientRect(), text = el.innerText.trim(), px = (v) => parseFloat(v) || 0
  const size = px(c.fontSize), ls = px(c.letterSpacing), lh = px(c.lineHeight) || size * 1.2, box = isRegion(el)
  const iw = r.width - px(c.paddingLeft) - px(c.paddingRight) - px(c.borderLeftWidth) - px(c.borderRightWidth)
  // 行数は、文字が実際に並んでいる段を数える。高さを行送りで割ると、ボタンの上下の空きまで行に数えてしまう
  const range = el.ownerDocument.createRange(); range.selectNodeContents(el)
  let lines = 0, bottom = -Infinity
  for (const q of [...range.getClientRects()].filter(q => q.width > 0).sort((x, y) => x.top - y.top)) if (q.top >= bottom - 2) { lines++; bottom = q.bottom } else bottom = Math.max(bottom, q.bottom)
  lines = Math.max(1, lines); const values = {}
  if (!box) {
    const fallback = drawnWeight(el, c)
    Object.assign(values, { 文字数: `${text.length} 字`, 文字: `太さ ${c.fontWeight}${fallback ? `（このフォントにあるのは ${fallback.have.join('、')} だけなので、${fallback.drawn} で描かれます）` : ''}、${c.fontSize}、行送り ${c.lineHeight}`, 字間: c.letterSpacing, 色: hex(c.color), フォント: c.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '') })
    if (c.fontStyle !== 'normal') values.字体 = c.fontStyle === 'italic' ? '斜体' : c.fontStyle
    if (c.textDecorationLine !== 'none') values.線 = c.textDecorationLine === 'underline' ? '下線' : c.textDecorationLine
    if (c.textTransform !== 'none') values.大文字と小文字 = c.textTransform
  }
  Object.assign(values, { 幅: `${Math.round(r.width)}px`, 高さ: `${Math.round(r.height)}px` })
  if (!box && lines > 1) { values.行数 = `${lines} 行`; values['1 行の字数'] = `約 ${Math.floor(iw / (size + ls))} 字` }
  if (!box && c.textAlign !== 'start' && c.textAlign !== 'left') values.そろえ = c.textAlign
  if (px(c.paddingTop) + px(c.paddingRight) + px(c.paddingBottom) + px(c.paddingLeft) > 0) values.内側の余白 = c.padding
  if (box) { values.並べ方 = c.display; if (c.gap !== 'normal') values.すき間 = c.gap; Object.assign(values, census(el)) }
  if (c.backgroundColor !== 'rgba(0, 0, 0, 0)') values.背景 = hex(c.backgroundColor)
  if (c.borderRadius !== '0px') values.角丸 = c.borderRadius
  if (px(c.borderTopWidth) > 0) values.枠 = `${c.borderTopWidth} ${hex(c.borderTopColor)}`
  if (c.outlineStyle !== 'none') values.輪郭 = `${c.outlineWidth} ${hex(c.outlineColor)}`
  if (c.boxShadow !== 'none') values.影 = c.boxShadow
  if (c.opacity !== '1') values.濃さ = c.opacity
  return values
}
export const changes = (from, to) => [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(k => from[k] !== to[k]).map(k => `${k}: ${from[k] ?? 'なし'} → ${to[k] ?? 'なし'}`)
// viewport は「PC幅 1280px」のような、いま見ている幅の呼び名
export function describe(el, viewport) {
  const text = el.innerText.trim(), values = measure(el)
  const clone = el.cloneNode(true); clone.removeAttribute('data-ds-hover'); clone.removeAttribute('data-ds-selected'); clone.setAttribute('data-ds-target', '')
  const parent = el.parentElement, pc = parent.ownerDocument.defaultView.getComputedStyle(parent), open = parent.cloneNode(false); open.setAttribute('data-ds-parent', '')
  // 中身の長い入れ物は、HTML を途中で切って渡す
  const region = isRegion(el), html = region ? outline(el) : clone.outerHTML.length > 3000 ? clone.outerHTML.slice(0, 3000) + '…（省略）' : clone.outerHTML
  return { region, tag: el.tagName.toLowerCase(), text, values, viewport, html, parentHtml: open.outerHTML.replace(/<\/\w+>$/, ''), parentValues: { 幅: `${Math.round(parent.getBoundingClientRect().width)}px`, 並べ方: pc.display, すき間: pc.gap } }
}
