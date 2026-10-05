import { describe, expect, it } from 'vitest'
import { StoredRecord, Variant } from '@shared/schema'

describe('Variant', () => {
  it('AI の返事の足りないところを、決まった値で埋める', () => {
    const v = Variant.parse({
      label: '字間を詰める',
      verdict: 'よくわからない',
      edits: [{ id: '3', html: 'x' }]
    })
    expect(v.verdict).toBe('該当なし')
    expect(v.css).toBeNull()
    expect(v.theory).toBeNull()
    expect(v.edits).toEqual([{ id: 3, html: 'x' }])
  })
  it('名前のない案は通さない', () => {
    expect(Variant.safeParse({ css: 'a{}' }).success).toBe(false)
  })
})

describe('StoredRecord', () => {
  it('試作 2 のころの記録（項目が少ない）も読める', () => {
    const r = StoredRecord.parse({
      at: '2026-10-05T04:57:50.968Z',
      page: 'techtalk.jp トップ',
      element: { tag: 'p', text: '事業の話を…', values: { 幅: '640px' } },
      oneLiner: '文字が多すぎる気がするな',
      options: [
        {
          letter: 'A',
          label: '担当と支援範囲に絞る',
          what_changed: '文章を削ります。',
          css: '',
          html: '短い文',
          verdict: '合う',
          verdict_text: ''
        }
      ],
      picked: 'A',
      note: '文章すくなくて読みやすい'
    })
    expect(r.more).toEqual([])
    expect(r.rounds).toEqual([])
    expect(r.options[0].isOriginal).toBe(false)
    expect(r.options[0].changes).toBeNull()
  })
})
