// 練習の流れを司る。画面の状態を 1 か所に持ち、左の画面（Stage）と main（AI、記録）を動かす。
//
// 状態は書き換えずに、毎回新しいものに差し替える。React は useSyncExternalStore で、差し替わったことを知る。
// 時計や、順に届く案、枠の操作のような「順番のある仕事」をここに集めて、描く側（React の部品）は状態を映すだけにする。
import type { Page, PracticeRecord, RecordInput, RoundEvent, Variant } from '@shared/schema'
import { changes, describe, pathOf } from '../stage/measure'
import { WIDTHS, type Frame, type Stage, type Width } from '../stage/stage'
import type { Item, NewItem, Option, PracticeState, Review, Step, Trace } from './types'

const LETTERS = ['A', 'B', 'C', 'D']

export const pickedOf = (r: PracticeRecord): PracticeRecord['options'][number] =>
  r.options.find((o) => o.letter === r.picked) ?? r.options[0]
/** 理論帳の項目の名前。記録を項目ごとに積むときの鍵にする */
export const theoryKey = (o: {
  theory?: { name?: string; claim: string } | null
}): string | null => (o.theory ? o.theory.name || o.theory.claim : null)
export const day = (at: string): string => new Date(at).toLocaleDateString('ja-JP')

function shuffled<T>(list: T[]): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 案を待っているあいだの持ちもの */
interface Run {
  started: number
  text: string
  more?: string
  letters: string[]
  arrived: number
  failed: string[]
  traceId: number
  clock: ReturnType<typeof setInterval>
  /** 元のままを出す順番。0 なら最初の案より前、1〜3 なら、その番目の案が届いた少しあと */
  order: number
  originalTimer?: ReturnType<typeof setTimeout>
  revealOriginal: () => void
  originalShown: Promise<void>
  model: string | null
}

export class PracticeController {
  private state: PracticeState = {
    pages: [],
    page: null,
    html: '',
    width: 'pc',
    step: 'point',
    view: 'single',
    looking: null,
    showing: 'variant',
    element: null,
    options: [],
    picked: null,
    thread: [{ id: 0, kind: 'intro' }],
    input: '',
    seconds: 0,
    zoomed: false,
    scrollTo: null,
    records: [],
    session: null,
    capturing: false,
    browserOpen: false,
    review: null
  }
  private listeners = new Set<() => void>()
  private stage: Stage | null = null
  private run: Run | null = null
  private nextId = 1
  private path: number[] | null = null
  private oneLiner = ''
  private more: string[] = []
  private rounds: { label: string; what_changed: string }[][] = []
  private reading = ''
  private model: string | null = null

  // ---- React とのつなぎ ----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  snapshot = (): PracticeState => this.state
  private set(patch: Partial<PracticeState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }
  private push(item: NewItem): number {
    const id = this.nextId++
    this.set({ thread: [...this.state.thread, { ...item, id } as Item] })
    return id
  }
  private update<K extends Item['kind']>(
    id: number,
    change: (item: Extract<Item, { kind: K }>) => Extract<Item, { kind: K }>
  ): void {
    this.set({
      thread: this.state.thread.map((item) =>
        item.id === id ? change(item as Extract<Item, { kind: K }>) : item
      )
    })
  }
  private option(letter: string | null): Option | undefined {
    return this.state.options.find((o) => o.letter === letter)
  }
  private setOption(letter: string, patch: Partial<Option>): void {
    this.set({
      options: this.state.options.map((o) => (o.letter === letter ? { ...o, ...patch } : o))
    })
  }

  // ---- はじめる ----
  async init(): Promise<void> {
    const [pages, records] = await Promise.all([window.api.pages.list(), window.api.records.list()])
    this.set({ pages, records })
    window.api.records.onImages(() => void this.loadRecords())
    void window.api.session.get().then((session) => this.set({ session }))
    let remembered: string | null = null
    try {
      remembered = localStorage.getItem('page')
    } catch {
      // 覚えていなくても困らない
    }
    const first = pages.find((p) => p.slug === remembered) ?? pages[0]
    if (first) await this.openPage(first.slug)
  }
  async loadRecords(): Promise<void> {
    this.set({ records: await window.api.records.list() })
  }

  /** 左の画面ができたら、ここに渡してもらう */
  attach(stage: Stage): void {
    this.stage = stage
    stage.setWidth(this.state.width)
  }

  // ---- 見る画面を選ぶ、取り込む ----
  async openPage(slug: string): Promise<void> {
    if (this.run) this.cancel()
    const page = this.state.pages.find((p) => p.slug === slug)
    if (!page) return
    const again = !!this.state.page
    const html = await window.api.pages.html(slug)
    this.resetRound()
    // 写しが変わると、左の画面は作り直される（attach が呼ばれる）。同じ写しなら、いまの画面を指す前の状態に戻す
    if (html === this.state.html) this.stage?.reset()
    else this.stage = null
    this.set({ page, html })
    if (again) this.push({ kind: 'rule' })
    try {
      localStorage.setItem('page', slug)
    } catch {
      // 覚えられなくても困らない
    }
  }
  /** URL を開いて取り込む */
  async capture(url: string): Promise<boolean> {
    return this.capturing(() => window.api.pages.capture(url))
  }
  /** ログインが要る画面のために、窓を開く */
  async openBrowser(url: string): Promise<void> {
    await window.api.pages.openBrowser(url)
    this.set({ browserOpen: true })
  }
  /** 開いた窓の、いまの画面を取り込む */
  async captureBrowser(): Promise<boolean> {
    const ok = await this.capturing(() => window.api.pages.captureBrowser())
    this.set({ browserOpen: false })
    return ok
  }
  private async capturing(take: () => Promise<Page>): Promise<boolean> {
    this.set({ capturing: true })
    try {
      const page = await take()
      this.set({ pages: await window.api.pages.list() })
      await this.openPage(page.slug)
      return true
    } catch (error) {
      this.push({
        kind: 'error',
        message: `画面を取り込めませんでした。${error instanceof Error ? error.message : String(error)}`
      })
      return false
    } finally {
      this.set({ capturing: false })
    }
  }

  // ---- 見方 ----
  private viewport(width = this.state.width): string {
    return `${width === 'pc' ? 'PC' : 'スマホ'}幅 ${WIDTHS[width]}px`
  }
  /** 見方を変える。枠は開いたままなので、切り替えは一瞬で済む */
  private setView(view: PracticeState['view'], letter: string | null = null): void {
    const stage = this.stage
    if (!stage) return
    // 元を出したまま別の案へ移らない。移る前に、案の表示に戻しておく
    const previous = stage.byLetter(this.state.looking)
    if (previous && this.state.showing === 'original') stage.show(previous, true)
    stage.set(view, letter ? (stage.byLetter(letter) ?? null) : null)
    this.set({ view, looking: letter, showing: 'variant', zoomed: view === 'grid' && stage.zoomed })
  }
  look = (letter: string): void => {
    if (!this.option(letter)?.pending) this.setView('look', letter)
  }
  grid = (): void => this.setView('grid')
  /** 選んだあと、同じ枠の中で元と案を切り替える。位置は動かない */
  setShowing = (which: 'variant' | 'original'): void => {
    const frame = this.stage?.byLetter(this.state.looking)
    if (!frame || this.option(this.state.looking)?.isOriginal) return
    this.stage?.show(frame, which === 'variant')
    this.set({ showing: which })
  }
  /** 幅を変える。写しは読み込み直さず、枠の幅だけを変える */
  setWidth = (width: Width): void => {
    if (width === this.state.width) return
    this.set({ width })
    const stage = this.stage
    if (!stage) return
    stage.setWidth(width)
    // 並び直しが済んでから、その幅の値に取り直す
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        stage.layout()
        this.set({ zoomed: this.state.view === 'grid' && stage.zoomed })
        const el = stage.pointed()
        if (this.state.step === 'say' && el) {
          stage.mark(null)
          this.showPointed(el)
          stage.mark(el)
        }
      })
    )
  }

  // ---- 入力欄 ----
  setInput = (input: string): void => this.set({ input })
  private setStep(step: Step): void {
    this.set({ step })
  }
  /** 黒いボタン。段階ごとに、いちばん押してほしいことをする */
  primary = (): void => {
    const { step, view, looking } = this.state
    const text = this.state.input.trim()
    if (step === 'say' && text) {
      this.set({ input: '' })
      void this.startRound(text)
    } else if (step === 'pick' && view === 'look' && looking) this.choose(looking)
    else if (step === 'note' && text) {
      this.set({ input: '' })
      void this.noted(text)
    } else if (step === 'done') this.again()
  }
  /** 控えめなボタン。待っているあいだは「やめる」、選ぶ段階は「作り直す」 */
  secondary = (): void => {
    const text = this.state.input.trim()
    if (this.state.step === 'wait') this.cancel()
    else if (this.state.step === 'pick' && text) {
      this.set({ input: '' })
      void this.startRound(this.oneLiner, text)
    }
  }

  // ---- 指す ----
  private pointedId: number | null = null
  private showPointed(el: HTMLElement): void {
    const described = describe(el, this.viewport())
    const page = this.state.page
    const past = this.state.records.filter(
      (r) => r.page === page?.title && r.element.text === described.text
    )
    const last = past.at(-1)
    const item: NewItem = {
      kind: 'pointed',
      described,
      past: last
        ? {
            count: past.length,
            day: day(last.at),
            oneLiner: last.oneLiner,
            label: pickedOf(last).label
          }
        : undefined
    }
    this.set({ element: described })
    // 一言を書く前に指し直したら、カードを差し替える
    const id = this.pointedId
    if (id != null && this.state.thread.some((x) => x.id === id)) {
      this.set({
        thread: this.state.thread.map((x) => (x.id === id ? ({ ...item, id } as Item) : x))
      })
    } else this.pointedId = this.push(item)
  }
  /** 左の画面で要素が指された */
  pointed = (el: HTMLElement): void => {
    if (this.state.step !== 'point' && this.state.step !== 'say') return
    this.showPointed(el)
    this.path = pathOf(el)
    this.stage?.setPath(this.path)
    this.setStep('say')
  }

  // ---- 案を待つ ----
  private trace(change: (trace: Trace) => Trace): void {
    const id = this.run?.traceId
    if (id != null) this.update<'trace'>(id, (item) => ({ ...item, trace: change(item.trace) }))
  }
  async startRound(text: string, more?: string): Promise<void> {
    const stage = this.stage
    const { page, element } = this.state
    if (!stage || !page || !element || !this.path) return
    const arrived = this.state.options.filter((o) => !o.isOriginal && !o.pending)
    const previous = arrived.map((o) => o.label)
    if (more) {
      this.more.push(more)
      this.rounds.push(arrived.map(({ label, what_changed }) => ({ label, what_changed })))
    } else this.oneLiner = text
    this.push({ kind: 'me', text: more || text })

    // 枠を 4 つ用意して、文字（A〜D）を割り当てる。どれが元かは伏せる
    stage.pointing = false
    stage.prepare()
    const letters = shuffled(LETTERS)
    stage.frames.forEach((frame, i) => {
      if (i > 0) stage.strip(frame)
      stage.label(frame, letters[i])
      frame.pending = true
      stage.veil(frame, '作っています')
    })
    this.reading = ''
    this.set({
      picked: null,
      options: LETTERS.map((letter) =>
        letter === letters[0]
          ? {
              letter,
              pending: true,
              isOriginal: true,
              label: '元のまま',
              what_changed: '何も変えていません。',
              css: '',
              html: null,
              edits: null
            }
          : { letter, pending: true, isOriginal: false, label: '', what_changed: '' }
      )
    })

    const traceId = this.push({
      kind: 'trace',
      trace: {
        saw: null,
        reading: '',
        readingDone: false,
        directions: 0,
        shown: 0,
        total: 4,
        slow: false
      }
    })
    let revealOriginal = (): void => {}
    const run: Run = {
      started: Date.now(),
      text,
      more,
      letters,
      arrived: 0,
      failed: [],
      traceId,
      model: null,
      order: Math.floor(Math.random() * 4),
      clock: setInterval(() => {
        const seconds = Math.round((Date.now() - run.started) / 1000)
        this.set({ seconds })
        if (seconds > 45) this.trace((t) => (t.slow ? t : { ...t, slow: true }))
      }, 1000),
      revealOriginal: () => revealOriginal(),
      originalShown: Promise.resolve()
    }
    // 元のままを出す順番は、毎回ばらつかせる。いつも最初（または最後）に出ると、どれが元かを届く順から推測できてしまう
    run.originalShown = new Promise((done) => {
      revealOriginal = () => {
        clearTimeout(run.originalTimer)
        this.reveal(stage.frames[0])
        done()
      }
    })
    if (run.order === 0) run.originalTimer = setTimeout(revealOriginal, 6000 + Math.random() * 6000)
    this.run = run
    this.set({ seconds: 0 })
    this.setStep('wait')
    this.setView('grid')

    const waiting: Promise<void>[] = []
    let failure: string | null = null
    const onEvent = (event: RoundEvent): void => {
      if (this.run !== run) return
      if (event.type === 'saw') this.trace((t) => ({ ...t, saw: event.ok }))
      else if (event.type === 'partial') this.trace((t) => ({ ...t, reading: event.text }))
      else if (event.type === 'reading') {
        this.reading = event.text
        this.trace((t) => ({ ...t, reading: event.text, readingDone: true }))
      } else if (event.type === 'direction') this.trace((t) => ({ ...t, directions: event.count }))
      else if (event.type === 'original') this.setOption(letters[0], event.original)
      else if (event.type === 'failed') run.failed.push(event.message)
      else if (event.type === 'done') run.model = event.model
      else if (event.type === 'error') failure = event.message
      else if (event.type === 'variant' && run.arrived < 3)
        waiting.push(this.arrive(run, stage, event.variant))
    }
    try {
      await window.api.round.start(
        {
          slug: page.slug,
          path: this.path,
          width: this.state.width,
          element,
          oneLiner: text,
          more,
          previous
        },
        onEvent
      )
      await Promise.all(waiting)
      if (this.run !== run) return
      if (failure) throw new Error(failure)
      if (!run.arrived) throw new Error(run.failed[0] || '案が 1 つも届きませんでした')
      // 作れなかった案の枠は片づける
      for (const frame of stage.frames) {
        if (!frame.pending || frame.index === 0) continue
        const letter = frame.letter
        this.set({ options: this.state.options.filter((o) => o.letter !== letter) })
        frame.letter = null
        frame.pending = false
        stage.veil(frame, null)
      }
      // 元のままがまだ出ていなければ、少し置いてから出す（案が足りなかったときなど）
      if (stage.frames[0].pending && run.order !== run.arrived) {
        clearTimeout(run.originalTimer)
        run.originalTimer = setTimeout(revealOriginal, 1500)
      }
      await run.originalShown
      if (this.run !== run) return
      const seconds = Math.round((Date.now() - run.started) / 1000)
      const count = this.state.options.length
      const missing = 4 - count
      this.trace((t) => ({
        ...t,
        slow: false,
        finished: `${count} 枚そろいました（1 つは元のまま）。${seconds} 秒${missing ? `。${missing} つは作れませんでした` : ''}`
      }))
      this.model = run.model
      this.endRun()
      stage.layout()
      this.setStep('pick')
    } catch (error) {
      if (this.run !== run) return
      this.trace((t) => ({ ...t, slow: false, stopped: '止まりました。' }))
      this.endRun()
      this.backToSay(more || text)
      this.push({
        kind: 'error',
        message: `案を作れませんでした。${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  /** 案が 1 つ届いた。枠に当てて、覆いを外す */
  private async arrive(run: Run, stage: Stage, variant: Variant): Promise<void> {
    const frame = stage.frames[++run.arrived]
    const letter = frame.letter
    if (!letter) return
    this.setOption(letter, variant)
    await frame.ready
    if (this.run !== run) return
    stage.apply(frame, variant)
    this.reveal(frame)
    if (frame.index === run.order && stage.frames[0].pending) {
      run.originalTimer = setTimeout(run.revealOriginal, 500 + Math.random() * 2500)
    }
  }
  /** 1 枚を見せる（覆いを外す） */
  private reveal(frame: Frame): void {
    const stage = this.stage
    if (!stage || !frame.pending || !frame.letter) return
    frame.pending = false
    stage.veil(frame, null)
    this.setOption(frame.letter, { pending: false })
    stage.layout()
    const shown = this.state.options.filter((o) => !o.pending).length
    this.trace((t) => ({ ...t, shown, total: this.state.options.length }))
  }
  private endRun(): void {
    const run = this.run
    if (!run) return
    clearInterval(run.clock)
    clearTimeout(run.originalTimer)
    this.run = null
  }
  /** 案の枠を片づけて、一言を書く段階に戻す。書いた一言は入力欄に戻す */
  private backToSay(text: string): void {
    const stage = this.stage
    if (stage) {
      stage.clear()
      stage.pointing = true
    }
    this.set({ options: [], picked: null, input: text })
    this.setView('single')
    this.setStep('say')
  }
  cancel = (): void => {
    const run = this.run
    if (!run) return
    void window.api.round.cancel()
    this.trace((t) => ({
      ...t,
      slow: false,
      stopped: 'やめました。一言を直して、もう一度送れます。'
    }))
    this.endRun()
    this.backToSay(run.more || run.text)
  }

  // ---- 選ぶ ----
  choose = (letter: string): void => {
    const stage = this.stage
    if (!stage || this.state.step !== 'pick' || !this.option(letter)) return
    // 案を当てたあとの実際の値を測って、元と比べる
    const base = stage.measure(stage.frames[0])
    const before = stage.frames[0].target?.innerText.trim() ?? ''
    const options = this.state.options.map((o): Option => {
      const frame = stage.byLetter(o.letter)
      if (!frame) return o
      stage.label(frame, o.letter, o.label, o.letter === letter)
      if (o.isOriginal) return { ...o, changes: null }
      const measured = stage.measure(frame)
      const list = base && measured ? changes(base, measured) : []
      // 字数が同じまま言葉を入れ替えた案は、値には出ない。文章が変わったことだけは書いておく
      const after = frame.target?.innerText.trim() ?? ''
      if (
        before !== after &&
        !list.some((c) => c.startsWith('文字数') || c.startsWith('文字のかたまり'))
      ) {
        list.push(`文章: 「${before.slice(0, 12)}…」 → 「${after.slice(0, 12)}…」`)
      }
      return { ...o, changes: list }
    })
    this.set({ options, picked: letter })
    const bubble = this.push({ kind: 'me', text: `${letter} を選んだ` })
    const chosen = options.find((o) => o.letter === letter)
    if (chosen)
      this.push({
        kind: 'result',
        option: chosen,
        options,
        width: this.state.width === 'pc' ? 'PC' : 'スマホ'
      })
    // 選んだ直後は、判定がいちばん上に来るようにする
    this.set({ scrollTo: bubble })
    this.setStep('note')
    this.setView('look', letter)
  }

  // ---- 残す ----
  private async noted(note: string): Promise<void> {
    const { page, element, options, picked } = this.state
    if (!page || !element || !picked || !this.path) return
    this.push({ kind: 'me', text: note })
    this.setStep('done')
    const record: RecordInput = {
      page: page.title,
      url: page.url,
      slug: page.slug,
      element: {
        tag: element.tag,
        text: element.text,
        values: element.values,
        viewport: element.viewport,
        path: this.path
      },
      oneLiner: this.oneLiner,
      more: this.more,
      rounds: this.rounds,
      reading: this.reading,
      model: this.model,
      picked,
      note,
      options: options.map((o) => ({
        letter: o.letter,
        label: o.label,
        what_changed: o.what_changed,
        responds: o.responds,
        css: o.css ?? null,
        html: o.html ?? null,
        edits: o.edits ?? null,
        theory: o.theory ?? null,
        verdict: o.verdict ?? '該当なし',
        verdict_text: o.verdict_text ?? '',
        isOriginal: o.isOriginal,
        changes: o.changes ?? null
      }))
    }
    try {
      const saved = await window.api.records.save(record)
      await this.loadRecords()
      const chosen = options.find((o) => o.letter === picked)
      const key = chosen ? theoryKey(chosen) : null
      const same = this.state.records.filter((r) => theoryKey(pickedOf(r)) === key)
      this.push({
        kind: 'stacked',
        theory: key,
        count: same.length,
        earlier: same
          .slice(0, -1)
          .slice(-3)
          .map((r) => ({
            day: day(r.at),
            text: r.element.text.slice(0, 16),
            label: pickedOf(r).label,
            verdict: pickedOf(r).verdict,
            note: r.note
          }))
      })
      this.push({ kind: 'instruction', text: saved.instruction, dir: saved.dir })
    } catch (error) {
      this.push({
        kind: 'error',
        message: `記録できませんでした。${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  private resetRound(): void {
    this.path = null
    this.oneLiner = ''
    this.more = []
    this.rounds = []
    this.reading = ''
    this.pointedId = null
    this.set({
      step: 'point',
      view: 'single',
      looking: null,
      showing: 'variant',
      element: null,
      options: [],
      picked: null,
      input: '',
      zoomed: false
    })
  }
  /** 別のところを指す */
  again = (): void => {
    this.push({ kind: 'rule' })
    this.resetRound()
    this.stage?.reset()
  }

  // ---- 記録を見直す ----
  openReview = (record: PracticeRecord): void => {
    this.set({ review: { record, view: 'look', looking: record.picked, showing: 'variant' } })
  }
  closeReview = (): void => {
    if (!this.state.review) return
    this.set({ review: null })
    requestAnimationFrame(() => this.stage?.layout())
  }
  reviewGo = (change: Partial<Review>): void => {
    if (this.state.review) this.set({ review: { ...this.state.review, ...change } })
  }

  // ---- サインイン ----
  signIn = async (): Promise<void> => this.set({ session: await window.api.session.signIn() })
  signOut = async (): Promise<void> => this.set({ session: await window.api.session.signOut() })

  // ---- キー ----
  /** 矢印キーで案を順に切り替える。同じ位置のまま切り替わるので、違いが見つけやすい */
  private cycle(step: number): void {
    const review = this.state.review
    if (review) {
      const letters = review.record.options.map((o) => o.letter)
      const at = review.view === 'look' ? letters.indexOf(review.looking) : -1
      const next =
        at < 0 ? review.record.picked : letters[(at + step + letters.length) % letters.length]
      this.reviewGo({ view: 'look', looking: next, showing: 'variant' })
      return
    }
    const letters = this.state.options.filter((o) => !o.pending).map((o) => o.letter)
    if (!letters.length) return
    const at =
      this.state.view === 'look' && this.state.looking ? letters.indexOf(this.state.looking) : -1
    this.look(
      at < 0
        ? this.state.picked || letters[0]
        : letters[(at + step + letters.length) % letters.length]
    )
  }
  onKey = (event: KeyboardEvent): void => {
    const target = event.target as Element | null
    if (
      target?.matches?.('textarea, input, select') ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return
    // ボタンの上で Enter を押したときは、そのボタンを押すだけにする（選ぶ操作と重ねない）。
    // ただし、見方の切り替え（A〜D）を押した直後は、そのまま Enter で選べるようにする
    if (
      event.key === 'Enter' &&
      target?.matches?.('button, a, [role=button]') &&
      !target.closest('#tools')
    )
      return
    const { review, step, view, looking, showing, picked, options } = this.state
    if (!review && (!options.length || step === 'point' || step === 'say')) return
    const handled = (): void => event.preventDefault()
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      handled()
      this.cycle(event.key === 'ArrowRight' ? 1 : -1)
    } else if (event.key === 'Escape') {
      handled()
      if (review) this.reviewGo({ view: 'grid' })
      else if (view === 'look') this.grid()
    } else if (event.key === 'Enter' && !review && step === 'pick' && view === 'look' && looking) {
      handled()
      this.choose(looking)
    } else if (event.key === 'o' || event.key === 'O') {
      if (review && review.view === 'look') {
        handled()
        this.reviewGo({ showing: review.showing === 'variant' ? 'original' : 'variant' })
      } else if (!review && picked && view === 'look') {
        handled()
        this.setShowing(showing === 'variant' ? 'original' : 'variant')
      }
    }
  }
}

export const practice = new PracticeController()
