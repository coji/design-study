import { useState } from 'react'
import { practice } from '../practice/controller'
import { usePractice } from '../practice/usePractice'

/** 見る画面を選ぶ。一覧の最後から、別の画面を取り込める */
function PagePicker(): React.JSX.Element {
  const { pages, page, step, capturing, browserOpen } = usePractice()
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const empty = pages.length === 0

  async function take(run: () => Promise<boolean>): Promise<void> {
    if (await run()) {
      setUrl('')
      setAdding(false)
    }
  }
  return (
    <>
      {!empty && (
        <select
          id="page"
          aria-label="見る画面"
          value={adding ? '+' : (page?.slug ?? '')}
          disabled={step === 'wait'}
          onChange={(e) => {
            if (e.target.value === '+') setAdding(true)
            else {
              setAdding(false)
              void practice.openPage(e.target.value)
            }
          }}
        >
          {pages.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.title}
            </option>
          ))}
          <option value="+">＋ 別の画面を取り込む…</option>
        </select>
      )}
      {(adding || empty) && (
        <form
          id="capture"
          className="group"
          onSubmit={(e) => {
            e.preventDefault()
            if (url.trim()) void take(() => practice.capture(url.trim()))
          }}
        >
          <input
            id="url"
            autoFocus
            placeholder="取り込む画面の URL"
            aria-label="取り込む画面の URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="primary" id="go" disabled={capturing || !url.trim()}>
            {capturing ? '取り込み中' : '取り込む'}
          </button>
          {browserOpen ? (
            <button
              className="plain"
              type="button"
              disabled={capturing}
              onClick={() => void take(() => practice.captureBrowser())}
            >
              開いた窓の画面を取り込む
            </button>
          ) : (
            <button
              className="plain"
              type="button"
              disabled={capturing || !url.trim()}
              title="ログインが要る画面は、窓を開いてログインしてから取り込みます"
              onClick={() => void practice.openBrowser(url.trim())}
            >
              窓を開いてログインする
            </button>
          )}
          {!empty && (
            <button className="text" type="button" id="cancel" onClick={() => setAdding(false)}>
              やめる
            </button>
          )}
        </form>
      )}
    </>
  )
}

/** 帯の右側: 見方の切り替え。いつも同じ場所（右端）に出す */
function Tools(): React.JSX.Element | null {
  const { options, picked, view, looking, showing, review } = usePractice()
  if (review) {
    const r = review.record
    const o = r.options.find((x) => x.letter === review.looking)
    const hasOriginal = r.options.some((x) => x.isOriginal)
    return (
      <>
        {review.view === 'look' && o && !o.isOriginal && hasOriginal && (
          <span className="seg" role="group" aria-label="元と案の切り替え">
            <button
              aria-pressed={review.showing === 'original'}
              onClick={() => practice.reviewGo({ showing: 'original' })}
            >
              元
            </button>
            <button
              aria-pressed={review.showing === 'variant'}
              title={o.label}
              onClick={() => practice.reviewGo({ showing: 'variant' })}
            >
              案 {o.letter}
            </button>
          </span>
        )}
        <span className="seg" role="group" aria-label="見方">
          <button
            aria-pressed={review.view === 'grid'}
            onClick={() => practice.reviewGo({ view: 'grid' })}
          >
            並べる
          </button>
          {r.options.map((x) => (
            <button
              key={x.letter}
              aria-pressed={review.view === 'look' && review.looking === x.letter}
              aria-label={x.letter === r.picked ? `${x.letter}（選んだ案）` : x.letter}
              title={x.label}
              onClick={() =>
                practice.reviewGo({ view: 'look', looking: x.letter, showing: 'variant' })
              }
            >
              {x.letter === r.picked ? `${x.letter} ✓` : x.letter}
            </button>
          ))}
        </span>
      </>
    )
  }
  if (!options.length) return null
  const o = options.find((x) => x.letter === looking)
  return (
    <>
      {picked && view === 'look' && o && !o.isOriginal && (
        <span className="seg" role="group" aria-label="元と案の切り替え">
          <button
            aria-pressed={showing === 'original'}
            onClick={() => practice.setShowing('original')}
          >
            元
          </button>
          <button
            aria-pressed={showing === 'variant'}
            title={o.label}
            onClick={() => practice.setShowing('variant')}
          >
            案 {o.letter}
          </button>
        </span>
      )}
      <span className="seg" role="group" aria-label="見方">
        <button aria-pressed={view === 'grid'} onClick={practice.grid}>
          並べる
        </button>
        {options.map((x) => (
          <button
            key={x.letter}
            aria-pressed={view === 'look' && looking === x.letter}
            aria-label={x.letter === picked ? `${x.letter}（選んだ案）` : x.letter}
            // 案の名前は、選ぶ前には出さない
            title={picked ? x.label : undefined}
            disabled={x.pending}
            onClick={() => practice.look(x.letter)}
          >
            {x.letter === picked ? `${x.letter} ✓` : x.letter}
          </button>
        ))}
      </span>
    </>
  )
}

/** 左の帯。画面をどう見るかを決めるものを並べる */
export function LeftBar(): React.JSX.Element {
  const { width, zoomed, review } = usePractice()
  return (
    <div className="bar">
      <div className="group">
        <PagePicker />
        <span className="seg" id="width" role="group" aria-label="画面の幅">
          {(['pc', 'sp'] as const).map((w) => (
            <button key={w} aria-pressed={width === w} onClick={() => practice.setWidth(w)}>
              {w === 'pc' ? 'PC 幅' : 'スマホ幅'}
            </button>
          ))}
        </span>
      </div>
      <div className="group end">
        {zoomed && !review && (
          <span className="muted" id="zoomed">
            指したところを拡大して表示
          </span>
        )}
        <div className="group" id="tools">
          <Tools />
        </div>
      </div>
    </div>
  )
}
