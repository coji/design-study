// 左の画面。写しを入れた枠（iframe）を開いたままにして、見方を変えるときは大きさと位置だけを動かす。
// 見方を切り替えるたびに写しを読み込み直すと、白く光り、位置合わせが遅れる。開いたままなら、切り替えは一瞬で済む。
//
// 枠は最大 4 つ。0 番は「指すための枠」で、案を並べるときは「元のまま」の役もする。1〜3 番は案を当てる枠。
// ここは React を通さず、DOM を直接扱う。iframe の中を測って書き換える処理が中心で、React を挟んでも得がないため。
import { BOXY, TEXTY, clean, isRegion, measure, resolve, type Values } from './measure'

export type Width = 'pc' | 'sp'
export const WIDTHS: Record<Width, number> = { pc: 1280, sp: 390 }

/** single（指す）/ grid（並べる）/ look（1 つを大きく見る） */
export type Mode = 'single' | 'grid' | 'look'

/** 案が写しに加える変更。css は足す規則、html は指した要素の中身、edits は範囲の中の要素ごとの中身 */
export interface Patch {
  css?: string | null
  html?: string | null
  edits?: { id: number; html: string }[] | null
}

export interface Frame {
  index: number
  cell: HTMLDivElement
  tag: HTMLDivElement
  wrap: HTMLDivElement
  iframe: HTMLIFrameElement
  veil: HTMLDivElement
  doc: Document | null
  win: Window | null
  ready: Promise<Frame>
  /** 指した要素（この枠の中での） */
  target: HTMLElement | null
  /** 指した要素の、取り込んだときの中身 */
  original: string
  patch: Patch | null
  /** 案を出しているか（false なら、同じ枠で元を出している） */
  shown: boolean
  letter: string | null
  label: string
  pending: boolean
}

export interface StageEvents {
  /** 要素が指された */
  point(el: HTMLElement): void
  /** 並べた案がクリックされた */
  cell(letter: string): void
  /** 枠の中でキーが押された（外と同じように受けるため） */
  key(event: KeyboardEvent): void
}

interface Zoom {
  scale: number
  x: number
  above: number
  zoomed: boolean
}
interface Box {
  left: number
  top: number
  width: number
  height: number
  scale: number
  x?: number
  tag?: boolean
}

const TAG = 28
const GAP = 16

// 指すときだけ、枠で示す。白と黒を重ねて、明るい画面でも暗い画面でも見えるようにする
const POINTING_STYLE =
  '[data-ds-hover]{outline:2px dashed #fff;box-shadow:0 0 0 2px #1a1a1a;cursor:pointer}' +
  '[data-ds-selected]{outline:3px solid #fff;box-shadow:0 0 0 6px #1a1a1a}'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...kids)
  return node
}

export class Stage {
  frames: Frame[] = []
  width: Width = 'pc'
  mode: Mode = 'single'
  looking: Frame | null = null
  /** 指せる状態か */
  pointing = true
  path: number[] | null = null
  /** 並べたときに、指したところを拡大しているか */
  zoomed = false
  private html = ''
  private zoom: Zoom | null = null
  private resize: ResizeObserver

  constructor(
    private root: HTMLElement,
    private on: StageEvents
  ) {
    this.resize = new ResizeObserver(() => this.layout())
    this.resize.observe(root)
  }
  dispose(): void {
    this.resize.disconnect()
    this.frames.forEach((f) => f.cell.remove())
    this.frames = []
  }

  // ---- 枠を作る、読み込む ----
  private make(index: number): Frame {
    const iframe = el('iframe')
    iframe.title = '画面の写し'
    iframe.tabIndex = -1
    const veil = el('div', 'veil', el('span', 'dot'), el('span', 'veil-text'))
    const wrap = el('div', 'frame', iframe, veil)
    const tag = el('div', 'tag')
    const cell = el('div', 'cell', tag, wrap)
    const frame: Frame = {
      index,
      cell,
      tag,
      wrap,
      iframe,
      veil,
      doc: null,
      win: null,
      ready: Promise.resolve(null as unknown as Frame),
      target: null,
      original: '',
      patch: null,
      shown: true,
      letter: null,
      label: '',
      pending: false
    }
    cell.addEventListener('click', () => {
      if (this.mode === 'grid' && frame.letter) this.on.cell(frame.letter)
    })
    cell.addEventListener('keydown', (e) => {
      if (this.mode !== 'grid' || !frame.letter || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault()
      this.on.cell(frame.letter)
    })
    this.frames[index] = frame
    this.root.append(cell)
    return frame
  }
  private load(frame: Frame): Promise<Frame> {
    this.veil(frame, '画面を読み込んでいます')
    frame.doc = frame.win = frame.target = frame.patch = null
    frame.ready = new Promise((done) => {
      frame.iframe.addEventListener(
        'load',
        async () => {
          const doc = frame.iframe.contentDocument!
          frame.doc = doc
          frame.win = frame.iframe.contentWindow
          doc.addEventListener('click', (e) => e.preventDefault(), true)
          // 枠の中をクリックすると、キー入力が枠の中に行く。外と同じように受ける
          doc.addEventListener('keydown', (e) => this.on.key(e))
          if (frame.index === 0) this.listen(frame)
          await doc.fonts.ready
          if (!frame.pending) this.veil(frame, null)
          done(frame)
        },
        { once: true }
      )
    })
    // srcdoc に入れた iframe は親と同じ出どころになるので、中の DOM に触れる
    frame.iframe.srcdoc = this.html
    frame.iframe.style.width = `${WIDTHS[this.width]}px`
    return frame.ready
  }
  /** 画面を開く。html は写しの HTML。前の画面の枠は捨てる */
  async open(html: string): Promise<void> {
    this.html = html
    this.path = null
    this.zoom = null
    this.mode = 'single'
    this.looking = null
    this.pointing = true
    this.frames.forEach((f) => f.cell.remove())
    this.frames = []
    const base = this.make(0)
    this.layout()
    await this.load(base)
    this.layout()
  }
  /** 案を当てる枠（1〜3 番）を用意する。待っている間に、裏で読み込んでおく */
  prepare(): void {
    for (const i of [1, 2, 3]) {
      if (this.frames[i]) continue
      const frame = this.make(i)
      void this.load(frame).then(() => {
        this.aim(frame)
        this.layout()
      })
    }
  }

  // ---- 指す ----
  private listen(frame: Frame): void {
    const doc = frame.doc!
    doc.head.append(el('style', '', POINTING_STYLE))
    // 文字や部品を先に探し、なければ、その場所の入れ物（余白やすき間を指したいとき）を選ぶ
    const pickable = (t: EventTarget | null): HTMLElement | null =>
      // 枠の中の要素は、枠の中の Element から作られている（外の Element とは別物）
      t instanceof (frame.win as Window & typeof globalThis).Element
        ? ((t.closest(TEXTY) || t.closest(BOXY)) as HTMLElement | null)
        : null
    const unhover = (): void =>
      doc.querySelectorAll('[data-ds-hover]').forEach((x) => x.removeAttribute('data-ds-hover'))
    const active = (): boolean => this.pointing && this.mode === 'single'
    doc.addEventListener('mouseover', (e) => {
      unhover()
      if (active()) pickable(e.target)?.setAttribute('data-ds-hover', '')
    })
    doc.addEventListener('mouseleave', unhover)
    doc.addEventListener('click', (e) => {
      const target = pickable(e.target)
      if (!target || !active()) return
      unhover()
      // 値を測るあいだは枠線を外す（枠線が値に混ざらないように）。測り終えたら付け直す
      this.mark(null)
      this.on.point(target)
      this.mark(this.pointed())
    })
  }
  mark(target: Element | null): void {
    const doc = this.frames[0]?.doc
    if (!doc) return
    doc.querySelectorAll('[data-ds-selected]').forEach((e) => e.removeAttribute('data-ds-selected'))
    target?.setAttribute('data-ds-selected', '')
  }
  /** いま指している要素（0 番の枠の中） */
  pointed(): HTMLElement | null {
    const doc = this.frames[0]?.doc
    return doc && this.path ? resolve(doc, this.path) : null
  }
  setPath(path: number[]): void {
    this.path = path
    this.zoom = null
    for (const frame of this.frames) {
      this.strip(frame)
      this.aim(frame)
    }
  }

  // ---- 案を当てる、外す ----
  /** 枠の中で、指した要素を探して印を付ける。中の要素には番号を振る（AI は、この番号で要素を指して変える） */
  private aim(frame: Frame): HTMLElement | null {
    if (!frame.doc || !this.path) return null
    if (frame.target?.isConnected) return frame.target
    const target = resolve(frame.doc, this.path)
    if (!target) return null
    target.setAttribute('data-ds-target', '')
    target.parentElement?.setAttribute('data-ds-parent', '')
    target.querySelectorAll('*').forEach((e, i) => e.setAttribute('data-ds', String(i + 1)))
    frame.original = target.innerHTML
    frame.target = target
    return target
  }
  /** 案と印をすべて外して、取り込んだときの状態に戻す */
  strip(frame: Frame): void {
    if (!frame.doc) return
    frame.doc.getElementById('ds-patch')?.remove()
    const target = frame.target
    if (target?.isConnected) {
      if (frame.patch && (frame.patch.html || frame.patch.edits?.length))
        target.innerHTML = frame.original
      target.removeAttribute('data-ds-target')
      target.parentElement?.removeAttribute('data-ds-parent')
      target.querySelectorAll('[data-ds]').forEach((e) => e.removeAttribute('data-ds'))
    }
    frame.target = frame.patch = null
    frame.shown = true
  }
  apply(frame: Frame, patch: Patch): void {
    if (!this.aim(frame) || !frame.doc) return
    frame.patch = patch
    frame.shown = true
    let style = frame.doc.getElementById('ds-patch') as HTMLStyleElement | null
    if (!style) {
      style = frame.doc.createElement('style')
      style.id = 'ds-patch'
      frame.doc.head.append(style)
    }
    style.textContent = patch.css || ''
    style.disabled = false
    this.content(frame, true)
  }
  /** 文章の変更を当てる、外す。外すときは、元の中身に戻す */
  private content(frame: Frame, on: boolean): void {
    const patch = frame.patch
    const target = frame.target
    if (!patch || !target || (!patch.html && !patch.edits?.length)) return
    target.innerHTML = frame.original
    if (!on) return
    if (patch.html) target.innerHTML = clean(patch.html)
    else {
      for (const edit of patch.edits ?? []) {
        const node = target.querySelector(`[data-ds="${edit.id}"]`)
        if (node) node.innerHTML = clean(String(edit.html))
      }
    }
  }
  /** 同じ枠の中で、案と元を切り替える。位置は動かない */
  show(frame: Frame, on: boolean): void {
    if (!frame.patch || !frame.doc || frame.shown === on) return
    frame.shown = on
    const style = frame.doc.getElementById('ds-patch') as HTMLStyleElement | null
    if (style) style.disabled = !on
    this.content(frame, on)
  }
  measure(frame: Frame): Values | null {
    return frame.target?.isConnected ? measure(frame.target) : null
  }
  byLetter(letter: string | null): Frame | undefined {
    return this.frames.find((f) => f.letter === letter)
  }

  // ---- 「作っています」の覆い ----
  veil(frame: Frame, text: string | null): void {
    frame.veil.hidden = text == null
    if (text != null) frame.veil.querySelector('.veil-text')!.textContent = text
  }

  // ---- 幅。写しは読み込み直さず、枠の幅だけを変える ----
  setWidth(width: Width): void {
    this.width = width
    this.zoom = null
    for (const frame of this.frames) frame.iframe.style.width = `${WIDTHS[width]}px`
    this.layout()
  }

  // ---- 並べ方 ----
  set(mode: Mode, looking: Frame | null = null): void {
    // 大きく見ている案を切り替えるときは、縦の位置を引き継ぐ。同じ位置のまま見比べられるようにする
    const y =
      this.mode === 'look' && mode === 'look' && this.looking?.win ? this.looking.win.scrollY : null
    this.mode = mode
    this.looking = looking
    // 並べたり大きく見たりするあいだは、指したときの枠線を出さない（見比べの邪魔になる）
    this.mark(mode === 'single' ? this.pointed() : null)
    this.layout()
    if (mode === 'look' && looking?.win) {
      if (y != null) looking.win.scrollTo(0, y)
      else this.scrollTo(looking, looking.win.innerHeight * 0.3)
    }
  }
  /** 拡大のしかたは、元の要素の大きさから決めて、4 枚で同じにする。同じ位置で見比べるため */
  private zoomFor(cw: number, ch: number, w: number): Zoom {
    if (this.zoom) return this.zoom
    const target = this.frames[0]?.target ?? this.pointed()
    if (!target) return { scale: cw / w, x: 0, above: (ch / (cw / w)) * 0.3, zoomed: false }
    // 小さい部品は周りも見せる（2.5 倍の範囲）。範囲を指したときは、範囲がほぼ枠いっぱいになるようにする
    const region = isRegion(target)
    const k = region ? 1.2 : 2.5
    const r = target.getBoundingClientRect()
    const need = Math.max(r.width * k, r.height * k * (cw / ch), 320, cw / 2)
    // 小さい部品は、ほとんど拡大にならないなら全体を見せる。範囲は、少しでも大きく見えるほうを取る
    const rw = !region && need > w * 0.8 ? w : Math.min(w, need)
    const scale = cw / rw
    this.zoom = {
      scale,
      x: Math.max(0, Math.min(w - rw, r.x + r.width / 2 - rw / 2)),
      above: rw === w ? (ch / scale) * 0.3 : Math.max(0, (ch / scale - r.height) / 2),
      zoomed: rw < w
    }
    return this.zoom
  }
  /** 使わない枠は、消さずに見えなくする（.off）。消すと中の大きさが 0 になり、あとで値を測れない */
  private place(frame: Frame, box: Box): void {
    frame.cell.classList.remove('off')
    frame.cell.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px`
    frame.tag.hidden = !box.tag
    frame.wrap.style.cssText = `width:${box.width}px;height:${box.height}px`
    frame.iframe.style.height = `${box.height / box.scale}px`
    frame.iframe.style.transform = `translate(${-(box.x ?? 0) * box.scale}px, 0) scale(${box.scale})`
  }
  private scrollTo(frame: Frame, above: number): void {
    const target = frame.target
    if (!target?.isConnected || !frame.win) return
    frame.win.scrollTo(
      0,
      Math.round(target.getBoundingClientRect().top + frame.win.scrollY - above)
    )
  }
  layout(): void {
    const W = this.root.clientWidth
    const H = this.root.clientHeight
    const w = WIDTHS[this.width]
    if (!W || !H) return
    const full = (): Box => {
      const scale = Math.min(1, W / w)
      return { left: (W - w * scale) / 2, top: 0, width: w * scale, height: H, scale }
    }
    this.zoomed = false
    for (const f of this.frames) {
      const inGrid = this.mode === 'grid'
      f.iframe.inert = inGrid
      f.iframe.style.pointerEvents = inGrid ? 'none' : 'auto'
      const pickable = inGrid && !!f.letter && !f.pending
      f.cell.classList.toggle('pickable', pickable)
      f.cell.tabIndex = pickable ? 0 : -1
      if (inGrid && f.letter) f.cell.setAttribute('role', 'button')
      else f.cell.removeAttribute('role')
    }
    if (this.mode !== 'grid') {
      const front = this.mode === 'look' ? this.looking : this.frames[0]
      for (const f of this.frames) {
        if (f === front) this.place(f, full())
        else f.cell.classList.add('off')
      }
      return
    }
    // 並べる: PC 幅は 2×2、スマホ幅は 4 つ横並び
    const shown = this.frames
      .filter((f) => f.letter)
      .sort((a, b) => a.letter!.localeCompare(b.letter!))
    for (const f of this.frames) if (!f.letter) f.cell.classList.add('off')
    const cols = this.width === 'pc' ? 2 : 4
    const rows = Math.ceil(shown.length / cols) || 1
    const cw = Math.min(w, (W - GAP * (cols - 1)) / cols)
    const ch = (H - GAP * (rows - 1)) / rows - TAG
    const x0 = (W - (cw * cols + GAP * (cols - 1))) / 2
    const zoom = this.zoomFor(cw, ch, w)
    this.zoomed = zoom.zoomed
    shown.forEach((f, i) => {
      this.place(f, {
        left: x0 + (i % cols) * (cw + GAP),
        top: Math.floor(i / cols) * (ch + TAG + GAP),
        width: cw,
        height: ch,
        scale: zoom.scale,
        x: zoom.x,
        tag: true
      })
      this.scrollTo(f, zoom.above)
    })
  }

  // ---- 枠の見出し（A、B…）----
  label(frame: Frame, letter: string, text = '', picked = false): void {
    frame.letter = letter
    frame.label = text
    frame.tag.replaceChildren(el('b', '', letter))
    if (text) frame.tag.append(el('span', '', text + (picked ? '（選んだ）' : '')))
    frame.cell.classList.toggle('picked', picked)
    frame.cell.setAttribute('aria-label', text ? `${letter}: ${text}` : `案 ${letter}`)
  }
  /** 案の枠を片づける（文字、覆い、当てた案を外す）。指した場所は残す */
  clear(): void {
    for (const f of this.frames) {
      if (f.index > 0) this.strip(f)
      f.letter = null
      f.pending = false
      f.cell.classList.remove('picked')
      this.veil(f, null)
    }
  }
  /** 並びを解いて、何も指していない状態に戻す */
  reset(): void {
    this.clear()
    if (this.frames[0]) this.strip(this.frames[0])
    this.path = null
    this.zoom = null
    this.pointing = true
    this.set('single')
  }
}
