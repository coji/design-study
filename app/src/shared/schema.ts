// main と画面のあいだでやりとりするものの形。AI の返事と、記録のファイルも、ここの形で検証する。
// AI は形の崩れた返事をすることがあり、記録は古い版のアプリが書いたものかもしれない。読むところで確かめる。
import { z } from 'zod'

/** 理論帳の項目。段階と出どころを必ず添える（AI がその場で原則を作らないように） */
export const Theory = z.object({
  name: z.string().optional(),
  claim: z.string(),
  level: z.string(),
  source: z.string()
})
export type Theory = z.infer<typeof Theory>

/** 理論帳との関係 */
export const Verdict = z.enum(['合う', '食い違う', '該当なし']).catch('該当なし')
export type Verdict = z.infer<typeof Verdict>

const Judgement = z.object({
  theory: Theory.nullable().catch(null),
  verdict: Verdict,
  verdict_text: z.string().catch('')
})

/** 案が写しに加える変更と、その説明 */
export const Variant = Judgement.extend({
  label: z.string(),
  what_changed: z.string().catch(''),
  responds: z.string().optional().catch(undefined),
  css: z.string().nullable().catch(null),
  html: z.string().nullable().catch(null),
  edits: z
    .array(z.object({ id: z.coerce.number(), html: z.string() }))
    .nullable()
    .catch(null)
})
export type Variant = z.infer<typeof Variant>

/** 元の画面（何も変えない）の判定 */
export const Original = Judgement
export type Original = z.infer<typeof Original>

/** 案の方向。名前は、選ぶ前には画面に出さない */
export const Direction = z.object({ label: z.string(), cause: z.string().catch('') })
export type Direction = z.infer<typeof Direction>

/** 案を待つあいだに、main から画面へ順に届くもの */
export type RoundEvent =
  | { type: 'saw'; ok: boolean }
  | { type: 'partial'; text: string }
  | { type: 'reading'; text: string }
  | { type: 'direction'; count: number }
  | { type: 'variant'; variant: Variant }
  | { type: 'original'; original: Original }
  | { type: 'failed'; message: string }
  | { type: 'done'; model: string; seconds: number }
  | { type: 'error'; message: string }

/** 取り込んだ画面 */
export const Page = z.object({
  slug: z.string(),
  url: z.string(),
  title: z.string(),
  at: z.string()
})
export type Page = z.infer<typeof Page>

const Values = z.record(z.string(), z.string())

/** 指した要素。AI に渡し、記録にも残す */
export const Described = z.object({
  region: z.boolean().catch(false),
  tag: z.string(),
  text: z.string(),
  values: Values,
  viewport: z.string().catch(''),
  html: z.string().catch(''),
  parentHtml: z.string().catch(''),
  parentValues: Values.catch({})
})
export type Described = z.infer<typeof Described>

export const WidthKey = z.enum(['pc', 'sp'])
export type WidthKey = z.infer<typeof WidthKey>

/** 案を作ってもらうときに、画面から main へ渡すもの */
export const RoundRequest = z.object({
  slug: z.string(),
  path: z.array(z.number()),
  width: WidthKey,
  element: Described,
  oneLiner: z.string(),
  more: z.string().optional(),
  previous: z.array(z.string()).optional()
})
export type RoundRequest = z.infer<typeof RoundRequest>

/** 記録に残す 1 つの案（A〜D） */
export const RecordOption = Variant.partial({ label: true }).extend({
  letter: z.string(),
  label: z.string().catch(''),
  isOriginal: z.boolean().catch(false),
  /** アプリが画面から測った変化 */
  changes: z.array(z.string()).nullable().catch(null)
})
export type RecordOption = z.infer<typeof RecordOption>

/** 1 回の練習の記録。record.json の中身 */
export const RecordInput = z.object({
  page: z.string(),
  url: z.string().optional(),
  slug: z.string().optional(),
  element: z.object({
    tag: z.string(),
    text: z.string(),
    values: Values,
    viewport: z.string().optional(),
    path: z.array(z.number()).catch([])
  }),
  oneLiner: z.string(),
  more: z.array(z.string()).catch([]),
  rounds: z
    .array(z.array(z.object({ label: z.string(), what_changed: z.string().catch('') })))
    .catch([]),
  reading: z.string().optional().catch(undefined),
  model: z.string().nullable().optional().catch(undefined),
  options: z.array(RecordOption),
  picked: z.string(),
  note: z.string()
})
export type RecordInput = z.infer<typeof RecordInput>

export const StoredRecord = RecordInput.extend({ at: z.string() })
/** 一覧で返す記録。id はフォルダの名前、instruction は製品に渡す指示文 */
export type PracticeRecord = z.infer<typeof StoredRecord> & { id: string; instruction: string }

/** ChatGPT とのつながり */
export interface Session {
  connected: boolean
  name?: string
  model?: string
  error?: string
}

export interface Settings {
  /** 写しと記録を置く場所 */
  dataDir: string
  /** 既定の場所かどうか */
  isDefault: boolean
}
