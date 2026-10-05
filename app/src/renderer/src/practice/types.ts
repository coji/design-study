import type { Described, Page, PracticeRecord, Session, Variant } from '@shared/schema'
import type { Mode, Width } from '../stage/stage'

/**
 * 1 回の流れの段階。
 * point 指す → say 一言書く → wait 案を待つ → pick 見比べて選ぶ → note 理由を残す → done 記録した
 */
export type Step = 'point' | 'say' | 'wait' | 'pick' | 'note' | 'done'

/** 並んだ案（A〜D）。元のままも、1 つの案として持つ */
export interface Option extends Partial<Variant> {
  letter: string
  /** まだ届いていない（覆いがかかっている） */
  pending: boolean
  isOriginal: boolean
  label: string
  what_changed: string
  /** アプリが画面から測った変化。選んだあとに入る */
  changes?: string[] | null
}

/** 案を待っているあいだの進み具合 */
export interface Trace {
  /** 画面を AI に見せられたか。まだなら null */
  saw: boolean | null
  reading: string
  readingDone: boolean
  /** 決まった方向の数 */
  directions: number
  /** 見せられる枚数と、全部の枚数 */
  shown: number
  total: number
  slow: boolean
  /** そろったときの文 */
  finished?: string
  /** 途中で止まったときの文 */
  stopped?: string
}

/** 右の列に、上から順に積むもの */
export type Item = { id: number } & (
  | { kind: 'intro' }
  | { kind: 'rule' }
  | { kind: 'me'; text: string }
  | {
      kind: 'pointed'
      described: Described
      past?: { count: number; day: string; oneLiner: string; label: string }
    }
  | { kind: 'trace'; trace: Trace }
  | { kind: 'result'; option: Option; options: Option[]; width: string }
  | {
      kind: 'stacked'
      theory: string | null
      count: number
      earlier: { day: string; text: string; label: string; verdict: string; note: string }[]
    }
  | { kind: 'instruction'; text: string; dir: string }
  | { kind: 'error'; message: string; raw?: string }
)
/** id を除いた中身。積むときに使う（合併型のまま id だけを外す） */
export type NewItem = Item extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never

/** 記録を見直しているときの、左の画面の状態 */
export interface Review {
  record: PracticeRecord
  view: 'grid' | 'look'
  looking: string
  showing: 'variant' | 'original'
}

export interface PracticeState {
  pages: Page[]
  page: Page | null
  /** いま開いている写しの HTML */
  html: string
  width: Width
  step: Step
  view: Mode
  /** 大きく見ている案の文字 */
  looking: string | null
  /** 選んだあと、大きく見ている枠に出すもの */
  showing: 'variant' | 'original'
  element: Described | null
  options: Option[]
  picked: string | null
  thread: Item[]
  /** 入力欄の文字 */
  input: string
  /** 待ち始めてからの秒数 */
  seconds: number
  /** 並べたときに、指したところを拡大しているか */
  zoomed: boolean
  /** いちばん上に持ってくる項目（選んだ直後に、判定を上に出すため） */
  scrollTo: number | null
  records: PracticeRecord[]
  session: Session | null
  /** 取り込みの最中か */
  capturing: boolean
  /** ログインが要る画面のための窓が開いているか */
  browserOpen: boolean
  review: Review | null
}
