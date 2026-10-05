import { useEffect, useRef, useState } from 'react'
import { StageView } from './stage/StageView'
import { describe, pathOf, type Described } from './stage/measure'
import { WIDTHS, type Stage, type Width } from './stage/stage'

// いまは骨組み。左の画面で指すと、右に値が出るところまで。試作 2 の流れ（一言、案、選ぶ、残す）は、これから移す
function App(): React.JSX.Element {
  const [html, setHtml] = useState('')
  const [width, setWidth] = useState<Width>('pc')
  const [pointed, setPointed] = useState<Described | null>(null)
  const stage = useRef<Stage | null>(null)

  useEffect(() => {
    void window.api.copyHtml('techtalk-jp').then(setHtml)
  }, [])

  const viewport = (w: Width): string => `${w === 'pc' ? 'PC' : 'スマホ'}幅 ${WIDTHS[w]}px`

  function point(el: HTMLElement): void {
    setPointed(describe(el, viewport(width)))
    stage.current?.setPath(pathOf(el))
  }
  function changeWidth(next: Width): void {
    setWidth(next)
    const s = stage.current
    if (!s) return
    s.setWidth(next)
    // 並び直しが済んでから、その幅の値に取り直す
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = s.pointed()
        if (!el) return
        s.mark(null)
        setPointed(describe(el, viewport(next)))
        s.mark(el)
      })
    )
  }

  return (
    <div className="app">
      <main className="left" aria-label="画面">
        <div className="bar">
          <span className="seg" role="group" aria-label="画面の幅">
            {(['pc', 'sp'] as const).map((w) => (
              <button key={w} aria-pressed={width === w} onClick={() => changeWidth(w)}>
                {w === 'pc' ? 'PC 幅' : 'スマホ幅'}
              </button>
            ))}
          </span>
        </div>
        <div className="stagewrap">
          <StageView
            html={html}
            events={{ point, cell: () => {}, key: () => {} }}
            onReady={(s) => (stage.current = s)}
          />
        </div>
      </main>
      <aside className="right" aria-label="言葉のやりとりと記録">
        <div className="bar" />
        <div id="thread">
          {pointed ? (
            <div className="card">
              <h3>指したところ（{pointed.viewport}）</h3>
              <p className="quote">{pointed.text || `（${pointed.tag}）`}</p>
              <dl className="values">
                {Object.entries(pointed.values).map(([name, value]) => (
                  <div key={name} style={{ display: 'contents' }}>
                    <dt>{name}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p className="muted">気になるところを、左の画面でクリックしてください</p>
          )}
        </div>
      </aside>
    </div>
  )
}

export default App
