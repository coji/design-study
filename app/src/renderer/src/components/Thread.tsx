import { useLayoutEffect, useRef, useState } from 'react'
import { usePractice } from '../practice/usePractice'
import type { Item, Trace } from '../practice/types'
import { Result, Values } from './Result'

/** 進み具合を、決まった場所に 1 行ずつ出す。何をしているかが見えると、待ちやすい */
function TraceRows({ trace: t }: { trace: Trace }): React.JSX.Element {
  const stopped = !!t.stopped
  const row = (text: React.ReactNode, done: boolean, key: string): React.JSX.Element => (
    <p key={key} className={done || stopped ? 'step done' : 'step doing'}>
      <span className="dot" />
      <span>{text}</span>
    </p>
  )
  const rows: React.JSX.Element[] = []
  rows.push(
    row(
      t.saw == null
        ? '画面を AI に見せています'
        : t.saw
          ? '画面を AI に見せました'
          : '画像は渡せませんでした。値だけで進めます',
      t.saw != null,
      'saw'
    )
  )
  if (t.saw != null) {
    rows.push(
      row(
        t.reading ? (
          <>
            一言を、こう読みました。{t.reading}
            {!t.readingDone && !stopped && <span className="caret" />}
          </>
        ) : (
          '一言を読んでいます'
        ),
        t.readingDone,
        'reading'
      )
    )
  }
  if (t.readingDone)
    rows.push(
      row(
        t.directions >= 3
          ? '案の方向を 3 つ決めました'
          : `案の方向を決めています（${t.directions} / 3）`,
        t.directions >= 3 || !!t.finished,
        'plan'
      )
    )
  if (t.directions > 0)
    rows.push(
      row(t.finished ?? `案を作っています（${t.shown} / ${t.total} 枚）`, !!t.finished, 'build')
    )
  return (
    <div className="trace">
      {rows}
      {t.slow && (
        <p className="muted">
          いつもより時間がかかっています。やめて、もう一度送ることもできます。
        </p>
      )}
      {t.stopped && <p className="muted">{t.stopped}</p>}
    </div>
  )
}

function Instruction({ text, dir }: { text: string; dir: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <div>
      <div className="box">
        <h3>製品に渡す指示</h3>
        <p className="instruction">{text}</p>
        <button className="plain" onClick={copy}>
          {state === 'copied'
            ? 'コピーしました'
            : state === 'failed'
              ? 'コピーできません'
              : 'コピーする'}
        </button>
        {state === 'failed' && <span className="muted"> 上の文を選んでコピーしてください</span>}
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        記録の場所: {dir}
      </p>
    </div>
  )
}

function Row({ item }: { item: Item }): React.JSX.Element | null {
  switch (item.kind) {
    case 'intro':
      return (
        <p className="muted">
          気になるところをクリック → 一言 → 並んだ案を大きく見比べて選ぶ → 選んだ理由を残す
        </p>
      )
    case 'rule':
      return <hr className="rule" />
    case 'me':
      return <div className="me">{item.text}</div>
    case 'pointed':
      return (
        <div className="card">
          <h3>指したところ（{item.described.viewport}）</h3>
          <p className="quote">{item.described.text || `（${item.described.tag}）`}</p>
          <Values values={item.described.values} />
          {item.past && (
            <p className="muted" style={{ marginTop: 8 }}>
              ここは前にも指しています（{item.past.count} 回）。{item.past.day}は「
              {item.past.oneLiner}」と感じて、「{item.past.label}」を選びました。
            </p>
          )}
        </div>
      )
    case 'trace':
      return <TraceRows trace={item.trace} />
    case 'result':
      return <Result option={item.option} options={item.options} width={item.width} />
    case 'stacked':
      return (
        <div className="card">
          <h3>理論帳に積みました</h3>
          <p>
            {item.theory
              ? `「${item.theory}」の事例は、これで ${item.count} 件です。`
              : `理論帳に当てはまる項目がない事例は、これで ${item.count} 件です。理論帳に足す項目の候補になります。`}
          </p>
          {item.earlier.length > 0 && (
            <ul className="list">
              {item.earlier.map((e, i) => (
                <li key={i}>
                  {e.day}「{e.text}…」で「{e.label}」を選んだ（{e.verdict}）。
                  <br />
                  <span className="muted">{e.note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'instruction':
      return <Instruction text={item.text} dir={item.dir} />
    case 'error':
      return (
        <div className="alert" role="alert">
          {item.message}
          {item.raw && <pre>{item.raw}</pre>}
        </div>
      )
  }
}

/** 右の列のやりとり。上から順に積む */
export function Thread(): React.JSX.Element {
  const { thread, scrollTo } = usePractice()
  const root = useRef<HTMLDivElement>(null)
  // 下まで読んでいるときだけ、新しい文に合わせて下へ流す。上を読み返しているときは動かさない
  const stick = useRef(true)
  const scrolled = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    if (scrollTo != null && scrolled.current !== scrollTo) {
      // 選んだ直後は、判定がいちばん上に来るようにする
      scrolled.current = scrollTo
      const target = el.querySelector<HTMLElement>(`[data-item="${scrollTo}"]`)
      if (target) {
        el.scrollTop = target.offsetTop - el.offsetTop - 16
        stick.current = false
        return
      }
    }
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [thread, scrollTo])

  return (
    <div
      id="thread"
      ref={root}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
    >
      {thread.map((item) => (
        <div
          key={item.id}
          data-item={item.id}
          className={item.kind === 'me' ? 'me-row' : item.kind === 'result' ? 'stack' : undefined}
        >
          <Row item={item} />
        </div>
      ))}
    </div>
  )
}
