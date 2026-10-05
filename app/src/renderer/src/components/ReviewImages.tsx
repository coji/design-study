import { useLayoutEffect, useRef, useState } from 'react'
import { practice } from '../practice/controller'
import { usePractice } from '../practice/usePractice'
import { WIDTHS } from '../stage/stage'

const HEIGHTS = { pc: 900, sp: 844 }

function Picture({ src }: { src: string }): React.JSX.Element {
  const [missing, setMissing] = useState(false)
  if (missing) {
    return (
      <p className="muted" style={{ padding: 16 }}>
        この記録には画像がありません
      </p>
    )
  }
  return <img src={src} alt="" onError={() => setMissing(true)} />
}

/** 記録を見直すときの左の画面。そのとき残した、元と案の画像を出す。並べ方は、練習のときと同じ */
export function ReviewImages(): React.JSX.Element | null {
  const { review, width, records } = usePractice()
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ W: 0, H: 0 })

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const measure = (): void => setSize({ W: el.clientWidth, H: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [review?.record.id])

  if (!review) return null
  const r = review.record
  const { W, H } = size
  const w = WIDTHS[width]
  const vh = HEIGHTS[width]
  // 画像が撮り終わったら読み直すよう、記録の数をアドレスに混ぜる
  const src = (letter: string): string =>
    `record://${r.id}/${width}-${letter}.jpg?${records.length}`

  let content: React.ReactNode = null
  if (W && H && review.view === 'grid') {
    const gap = 16
    const cols = width === 'pc' ? 2 : 4
    const rows = width === 'pc' ? 2 : 1
    const cw = Math.min(
      w,
      (W - gap * (cols - 1)) / cols,
      (((H - gap * (rows - 1)) / rows - 28) * w) / vh
    )
    const ch = (cw * vh) / w
    const x0 = (W - (cw * cols + gap * (cols - 1))) / 2
    content = r.options.map((o, i) => (
      <button
        key={o.letter}
        className={o.letter === r.picked ? 'cell pickable picked' : 'cell pickable'}
        style={{
          left: x0 + (i % cols) * (cw + gap),
          top: Math.floor(i / cols) * (ch + 28 + gap),
          width: cw
        }}
        onClick={() => practice.reviewGo({ view: 'look', looking: o.letter, showing: 'variant' })}
      >
        <div className="tag">
          <b>{o.letter}</b>
          <span>
            {o.label}
            {o.letter === r.picked ? '（選んだ）' : ''}
          </span>
        </div>
        <div className="frame" style={{ width: cw, height: ch }}>
          <Picture src={src(o.letter)} />
        </div>
      </button>
    ))
  } else if (W && H) {
    const original = r.options.find((x) => x.isOriginal)
    const letter = review.showing === 'variant' || !original ? review.looking : original.letter
    const fw = Math.min(W, w, (H * w) / vh)
    content = (
      <div
        className="frame"
        style={{
          position: 'absolute',
          left: (W - fw) / 2,
          top: 0,
          width: fw,
          height: (fw * vh) / w
        }}
      >
        <Picture key={letter} src={src(letter)} />
      </div>
    )
  }
  return (
    <div id="review" ref={root}>
      {content}
    </div>
  )
}
