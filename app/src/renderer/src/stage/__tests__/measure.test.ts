import { describe, expect, it } from 'vitest'
import { changes, clean, hex } from '../measure'

describe('hex', () => {
  it('色を #rrggbb で出す', () => {
    expect(hex('rgb(28, 27, 24)')).toBe('#1c1b18')
  })
  it('半透明のときは、濃さを添える', () => {
    expect(hex('rgba(231, 226, 216, 0.56)')).toBe('#e7e2d8（濃さ 56%）')
  })
  it('読めない値は、そのまま返す', () => {
    expect(hex('transparent')).toBe('transparent')
  })
})

describe('changes', () => {
  it('変わった値だけを「名前: 元 → 案」で返す', () => {
    expect(changes({ 字間: '-1.7px', 幅: '1072px' }, { 字間: '-2.72px', 幅: '1072px' })).toEqual([
      '字間: -1.7px → -2.72px'
    ])
  })
  it('片方にしかない値は「なし」と書く', () => {
    expect(changes({}, { 字体: '斜体' })).toEqual(['字体: なし → 斜体'])
  })
})

describe('clean', () => {
  it('AI が返した HTML から、スクリプトとイベントの属性を取り除く', () => {
    expect(clean('<b onclick="x()">a</b><script>alert(1)</script>')).toBe('<b>a</b>')
  })
})
