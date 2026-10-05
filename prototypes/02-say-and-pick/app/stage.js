// 左の画面。写しを入れた枠（iframe）を開いたままにして、見方を変えるときは大きさと位置だけを動かす。
// 見方を切り替えるたびに写しを読み込み直すと、白く光り、位置合わせが遅れる。開いたままなら、切り替えは一瞬で済む。
//
// 枠は最大 4 つ。0 番は「指すための枠」で、案を並べるときは「元のまま」の役もする。1〜3 番は案を当てる枠。
import { h } from './dom.js'
import { resolve, clean, isRegion, measure, TEXTY, BOXY } from './measure.js'

export const WIDTHS = { pc: 1280, sp: 390 }
const TAG = 28, GAP = 16

// 指すときだけ、枠で示す。白と黒を重ねて、明るい画面でも暗い画面でも見えるようにする
const POINTING_STYLE = '[data-ds-hover]{outline:2px dashed #fff;box-shadow:0 0 0 2px #1a1a1a;cursor:pointer}[data-ds-selected]{outline:3px solid #fff;box-shadow:0 0 0 6px #1a1a1a}'

export class Stage {
  // on: { point(el), cell(letter), key(event), loaded() }
  constructor(root, on) {
    this.root = root; this.on = on
    this.frames = []            // { cell, tag, wrap, iframe, veil, doc, win, ready, target, option, shown, letter, label }
    this.slug = null; this.width = 'pc'
    this.mode = 'single'        // single（指す）/ grid（並べる）/ look（1 つを大きく見る）
    this.looking = null         // look のときに見ている枠
    this.pointing = true; this.path = null; this.zoom = null
  }

  // ---- 枠を作る、読み込む ----
  make(index) {
    const iframe = h('iframe', { title: '画面の写し', tabindex: '-1' })
    const veil = h('div', { class: 'veil' }, h('span', { class: 'dot' }), h('span', { class: 'veil-text' }, ''))
    const wrap = h('div', { class: 'frame' }, iframe, veil)
    const tag = h('div', { class: 'tag' })
    const cell = h('div', { class: 'cell' }, tag, wrap)
    cell.addEventListener('click', () => { if (this.mode === 'grid' && frame.letter) this.on.cell(frame.letter) })
    cell.addEventListener('keydown', (e) => { if (this.mode === 'grid' && frame.letter && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.on.cell(frame.letter) } })
    const frame = { index, cell, tag, wrap, iframe, veil, doc: null, win: null, ready: null, target: null, option: null, shown: true, letter: null, label: '', pending: false }
    this.frames[index] = frame; this.root.append(cell)
    return frame
  }
  load(frame) {
    this.veil(frame, '画面を読み込んでいます')
    frame.doc = frame.win = frame.target = frame.option = null
    frame.ready = new Promise((done) => {
      frame.iframe.addEventListener('load', async () => {
        const doc = frame.iframe.contentDocument
        frame.doc = doc; frame.win = frame.iframe.contentWindow
        doc.addEventListener('click', (e) => e.preventDefault(), true)
        // 枠の中をクリックすると、キー入力が枠の中に行く。外と同じように受ける
        doc.addEventListener('keydown', (e) => this.on.key(e))
        if (frame.index === 0) this.listen(frame)
        await doc.fonts.ready
        if (!frame.pending) this.veil(frame, null)
        done(frame)
      }, { once: true })
    })
    frame.iframe.src = `/copy/${this.slug}/snapshot.html`
    this.setWidth(this.width, false)
    return frame.ready
  }
  // 画面を開く。前の画面の枠は捨てる
  async open(slug) {
    this.slug = slug; this.path = null; this.zoom = null; this.mode = 'single'; this.looking = null; this.pointing = true
    this.frames.forEach(f => f.cell.remove()); this.frames = []
    const base = this.make(0)
    this.layout()
    await this.load(base)
    this.layout(); this.on.loaded()
  }
  // 案を当てる枠（1〜3 番）を用意する。待っている間に、裏で読み込んでおく
  prepare() {
    for (const i of [1, 2, 3]) if (!this.frames[i]) { const f = this.make(i); this.load(f).then(() => { this.aim(f); this.layout() }) }
  }

  // ---- 指す ----
  listen(frame) {
    const doc = frame.doc
    doc.head.append(h('style', {}, POINTING_STYLE))
    // 文字や部品を先に探し、なければ、その場所の入れ物（余白やすき間を指したいとき）を選ぶ
    const pickable = (t) => t.closest?.(TEXTY) || t.closest?.(BOXY) || null
    const unhover = () => doc.querySelectorAll('[data-ds-hover]').forEach(x => x.removeAttribute('data-ds-hover'))
    doc.addEventListener('mouseover', (e) => { unhover(); if (this.pointing && this.mode === 'single') pickable(e.target)?.setAttribute('data-ds-hover', '') })
    doc.addEventListener('mouseleave', unhover)
    doc.addEventListener('click', (e) => { const el = pickable(e.target); if (!el || !this.pointing || this.mode !== 'single') return; unhover(); this.mark(null); this.on.point(el); this.mark(this.pointed()) })
  }
  mark(el) {
    const doc = this.frames[0]?.doc; if (!doc) return
    doc.querySelectorAll('[data-ds-selected]').forEach(e => e.removeAttribute('data-ds-selected'))
    el?.setAttribute('data-ds-selected', '')
  }
  // いま指している要素（0 番の枠の中）
  pointed() { const f = this.frames[0]; return f?.doc && this.path ? resolve(f.doc, this.path) : null }
  setPath(path) { this.path = path; this.zoom = null; this.frames.forEach(f => { this.strip(f); this.aim(f) }) }

  // ---- 案を当てる、外す ----
  // 枠の中で、指した要素を探して印を付ける。中の要素には番号を振る（AI は、この番号で要素を指して変える）
  aim(frame) {
    if (!frame.doc || !this.path) return null
    if (frame.target?.isConnected) return frame.target
    const el = resolve(frame.doc, this.path); if (!el) return null
    el.setAttribute('data-ds-target', ''); el.parentElement.setAttribute('data-ds-parent', '')
    el.querySelectorAll('*').forEach((e, i) => e.setAttribute('data-ds', i + 1))
    frame.original = el.innerHTML; frame.target = el
    return el
  }
  // 案と印をすべて外して、取り込んだときの状態に戻す
  strip(frame) {
    if (!frame.doc) return
    frame.doc.getElementById('ds-patch')?.remove()
    const el = frame.target
    const o = frame.option
    if (el?.isConnected) { if (o && (o.html || o.edits?.length)) el.innerHTML = frame.original; el.removeAttribute('data-ds-target'); el.parentElement?.removeAttribute('data-ds-parent'); el.querySelectorAll('[data-ds]').forEach(e => e.removeAttribute('data-ds')) }
    frame.target = frame.option = null; frame.shown = true
  }
  apply(frame, option) {
    const el = this.aim(frame); if (!el) return
    frame.option = option; frame.shown = true
    let style = frame.doc.getElementById('ds-patch')
    if (!style) { style = frame.doc.createElement('style'); style.id = 'ds-patch'; frame.doc.head.append(style) }
    style.textContent = option.css || ''; style.disabled = false
    this.content(frame, true)
  }
  content(frame, on) {
    const o = frame.option, el = frame.target; if (!o || !el || (!o.html && !o.edits?.length)) return
    el.innerHTML = frame.original
    if (!on) return
    if (o.html) el.innerHTML = clean(o.html)
    else for (const edit of o.edits) { const node = el.querySelector(`[data-ds="${edit.id}"]`); if (node) node.innerHTML = clean(String(edit.html)) }
  }
  // 同じ枠の中で、案と元を切り替える。位置は動かない
  show(frame, on) {
    if (!frame.option || frame.shown === on) return
    frame.shown = on
    const style = frame.doc.getElementById('ds-patch'); if (style) style.disabled = !on
    this.content(frame, on)
  }
  measure(frame) { return frame.target?.isConnected ? measure(frame.target) : null }
  byLetter(letter) { return this.frames.find(f => f?.letter === letter) }

  // ---- 「作っています」の覆い ----
  veil(frame, text) {
    frame.veil.hidden = text == null
    if (text != null) frame.veil.querySelector('.veil-text').textContent = text
  }

  // ---- 幅 ----
  setWidth(width, relayout = true) {
    this.width = width; this.zoom = null
    for (const f of this.frames) if (f) f.iframe.style.width = `${WIDTHS[width]}px`
    if (relayout) this.layout()
  }

  // ---- 並べ方 ----
  set(mode, looking = null) {
    // 大きく見ている案を切り替えるときは、縦の位置を引き継ぐ。同じ位置のまま見比べられるようにする
    const y = this.mode === 'look' && mode === 'look' && this.looking?.win ? this.looking.win.scrollY : null
    this.mode = mode; this.looking = looking
    // 並べたり大きく見たりするあいだは、指したときの枠線を出さない（見比べの邪魔になる）
    if (mode === 'single') this.mark(this.pointed()); else this.mark(null)
    this.layout()
    if (mode === 'look' && looking?.win) { if (y != null) looking.win.scrollTo(0, y); else this.scrollTo(looking, looking.win.innerHeight * 0.3) }
  }
  // 拡大のしかたは、元の要素の大きさから決めて、4 枚で同じにする。同じ位置で見比べるため
  zoomFor(cw, ch, w) {
    if (this.zoom) return this.zoom
    const el = this.frames[0]?.target ?? this.pointed()
    if (!el) return { scale: cw / w, x: 0, above: (ch / (cw / w)) * 0.3, zoomed: false }
    // 小さい部品は周りも見せる（2.5 倍の範囲）。範囲を指したときは、範囲がほぼ枠いっぱいになるようにする
    const region = isRegion(el), k = region ? 1.2 : 2.5, r = el.getBoundingClientRect()
    // 小さい部品は、ほとんど拡大にならないなら全体を見せる。範囲は、少しでも大きく見えるほうを取る
    const need = Math.max(r.width * k, r.height * k * (cw / ch), 320, cw / 2), rw = !region && need > w * 0.8 ? w : Math.min(w, need), scale = cw / rw
    return this.zoom = { scale, x: Math.max(0, Math.min(w - rw, r.x + r.width / 2 - rw / 2)), above: rw === w ? (ch / scale) * 0.3 : Math.max(0, (ch / scale - r.height) / 2), zoomed: rw < w }
  }
  // 使わない枠は、消さずに見えなくする（.off）。消すと中の大きさが 0 になり、あとで値を測れない
  place(frame, { left, top, width, height, scale, x = 0, tag = false }) {
    frame.cell.classList.remove('off')
    frame.cell.style.cssText = `left:${left}px;top:${top}px;width:${width}px`
    frame.tag.hidden = !tag
    frame.wrap.style.cssText = `width:${width}px;height:${height}px`
    frame.iframe.style.height = `${height / scale}px`
    frame.iframe.style.transform = `translate(${-x * scale}px, 0) scale(${scale})`
  }
  scrollTo(frame, above) {
    const el = frame.target; if (!el?.isConnected) return
    frame.win.scrollTo(0, Math.round(el.getBoundingClientRect().top + frame.win.scrollY - above))
  }
  layout() {
    const W = this.root.clientWidth, H = this.root.clientHeight, w = WIDTHS[this.width]
    if (!W || !H) return
    const full = () => { const scale = Math.min(1, W / w), fw = w * scale; return { left: (W - fw) / 2, top: 0, width: fw, height: H, scale } }
    this.zoomed = false
    for (const f of this.frames) {
      if (!f) continue
      const interactive = this.mode !== 'grid'
      f.iframe.inert = !interactive; f.iframe.style.pointerEvents = interactive ? 'auto' : 'none'
      f.cell.classList.toggle('pickable', this.mode === 'grid' && !!f.letter && !f.pending)
      f.cell.tabIndex = this.mode === 'grid' && f.letter && !f.pending ? 0 : -1
      if (this.mode === 'grid' && f.letter) f.cell.setAttribute('role', 'button'); else f.cell.removeAttribute('role')
    }
    if (this.mode === 'single') {
      this.frames.forEach((f, i) => { if (!f) return; if (i === 0) this.place(f, full()); else f.cell.classList.add('off') })
      return
    }
    if (this.mode === 'look') {
      for (const f of this.frames) { if (!f) continue; if (f === this.looking) this.place(f, full()); else f.cell.classList.add('off') }
      return
    }
    // 並べる: PC 幅は 2×2、スマホ幅は 4 つ横並び
    const shown = this.frames.filter(f => f?.letter).sort((a, b) => a.letter.localeCompare(b.letter))
    this.frames.forEach(f => { if (f && !f.letter) f.cell.classList.add('off') })
    const cols = this.width === 'pc' ? 2 : 4, rows = Math.ceil(shown.length / cols) || 1
    const cw = Math.min(w, (W - GAP * (cols - 1)) / cols), ch = (H - GAP * (rows - 1)) / rows - TAG, x0 = (W - (cw * cols + GAP * (cols - 1))) / 2
    const z = this.zoomFor(cw, ch, w); this.zoomed = z.zoomed
    shown.forEach((f, i) => {
      this.place(f, { left: x0 + (i % cols) * (cw + GAP), top: Math.floor(i / cols) * (ch + TAG + GAP), width: cw, height: ch, scale: z.scale, x: z.x, tag: true })
      this.scrollTo(f, z.above)
    })
  }
  // ---- 枠の見出し（A、B…）----
  label(frame, { letter, text = '', picked = false }) {
    frame.letter = letter; frame.label = text
    frame.tag.replaceChildren(...[h('b', {}, letter), text ? h('span', {}, text + (picked ? '（選んだ）' : '')) : null].filter(Boolean))
    frame.cell.classList.toggle('picked', picked)
    frame.cell.setAttribute('aria-label', text ? `${letter}: ${text}` : `案 ${letter}`)
  }
  // 並びを解いて、指す状態に戻す
  reset() {
    for (const f of this.frames) { if (!f) continue; this.strip(f); f.letter = null; f.pending = false; f.cell.classList.remove('picked'); this.veil(f, null) }
    this.path = null; this.zoom = null; this.pointing = true
    this.set('single')
  }
}
