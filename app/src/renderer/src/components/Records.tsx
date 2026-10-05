import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { PracticeRecord } from '@shared/schema'
import { day, pickedOf, practice, theoryKey } from '../practice/controller'
import { usePractice } from '../practice/usePractice'
import { Result, Values } from './Result'

function Case({ record: r }: { record: PracticeRecord }): React.JSX.Element {
  const o = pickedOf(r)
  return (
    <div className="card">
      <h3>
        {day(r.at)} {r.page}「{r.element.text.slice(0, 16)}…」
      </h3>
      <Values
        note
        values={{
          感じたこと: r.oneLiner,
          選んだ案: `${o.label}（理論帳と${o.verdict}）`,
          自分の言葉: r.note
        }}
      />
      <Link className="plain link" style={{ marginTop: 8 }} to={`/records/${r.id}`}>
        見直す
      </Link>
    </div>
  )
}

/** 記録の一覧。選んだ案が当てはまった理論帳の項目ごとに、事例を積んで見せる */
export function RecordList(): React.JSX.Element {
  const { records } = usePractice()
  useEffect(() => {
    void practice.loadRecords()
  }, [])
  const groups = new Map<string, PracticeRecord[]>()
  for (const r of records) {
    const key = theoryKey(pickedOf(r)) ?? '理論帳に当てはまる項目なし'
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return (
    <div id="records">
      <p className="muted">
        {records.length
          ? '選んだ案が当てはまった、理論帳の項目ごとに並べています。「見直す」で、そのときの画面とやりとりを見られます。'
          : 'まだ記録がありません。'}
      </p>
      {[...groups].map(([key, items]) => {
        const theory = pickedOf(items[0]).theory
        return (
          <section key={key}>
            <div>
              <h2>
                {key}（{items.length} 件）
              </h2>
              {theory && (
                <p className="muted">
                  {theory.level}。{theory.claim}
                </p>
              )}
            </div>
            {items.map((r) => (
              <Case key={r.id} record={r} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

/** 記録を見直す。左に、そのとき残した元と案の画像。右に、そのときのやりとり */
export function RecordDetail(): React.JSX.Element {
  const { id } = useParams()
  const navigate = useNavigate()
  const { records } = usePractice()
  const r = records.find((x) => x.id === id)

  useEffect(() => {
    if (r) practice.openReview(r)
    return () => practice.closeReview()
    // 記録が変わったときだけ開き直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id])

  if (!r) {
    return (
      <div id="records">
        <p className="muted">この記録は見つかりません。</p>
      </div>
    )
  }
  const o = pickedOf(r)
  return (
    <div id="records">
      <div>
        <button className="text" style={{ padding: 0 }} onClick={() => navigate('/records')}>
          ← 記録の一覧
        </button>
      </div>
      <p className="muted">
        {new Date(r.at).toLocaleString('ja-JP')} ・ {r.page}
      </p>
      <div className="card">
        <h3>指したところ{r.element.viewport ? `（${r.element.viewport}）` : ''}</h3>
        <p className="quote">{r.element.text}</p>
        <Values values={r.element.values} />
      </div>
      <div className="me">{r.oneLiner}</div>
      {r.reading && <p>一言を、こう読みました。{r.reading}</p>}
      {r.rounds.map((round, i) => (
        <div key={i} className="stack">
          <div className="card">
            <h3>先に出た案（選ばなかった）</h3>
            <ul className="list">
              {round.map((x, j) => (
                <li key={j}>
                  <b>{x.label}</b>
                  <br />
                  {x.what_changed}
                </li>
              ))}
            </ul>
          </div>
          {r.more[i] && <div className="me">{r.more[i]}</div>}
        </div>
      ))}
      <div className="me">{r.picked} を選んだ</div>
      <Result
        option={o}
        options={r.options}
        width={/スマホ/.test(r.element.viewport ?? '') ? 'スマホ' : 'PC'}
      />
      <div className="me">{r.note}</div>
      <div className="box">
        <h3>製品に渡す指示</h3>
        <p className="instruction">{r.instruction}</p>
      </div>
    </div>
  )
}
