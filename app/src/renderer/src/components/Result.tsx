import type { Theory } from '@shared/schema'
import { theoryKey } from '../practice/controller'

/** 判定や説明に使う、案の中身。練習中の案でも、記録に残った案でも、同じ形で受ける */
export interface ResultOption {
  letter: string
  label: string
  isOriginal: boolean
  what_changed?: string
  responds?: string
  css?: string | null
  theory?: Theory | null
  verdict?: string
  verdict_text?: string
  changes?: string[] | null
}

function head(o: ResultOption): string {
  if (o.verdict === '合う')
    return o.isOriginal
      ? '元の画面は、理論帳と合っています。'
      : 'あなたが選んだ案は、理論帳と合っています。'
  if (o.verdict === '食い違う')
    return o.isOriginal
      ? '元の画面は、理論帳と食い違っています。'
      : 'あなたが選んだ案は、理論帳と食い違っています。'
  return '理論帳に、この案に当てはまる項目がありません。'
}

/** 値を、名前の列と値の列にそろえて並べる */
export function Values({
  values,
  note
}: {
  values: Record<string, string>
  note?: boolean
}): React.JSX.Element {
  return (
    <dl className={note ? 'values note' : 'values'}>
      {Object.entries(values).map(([name, value]) => (
        <div key={name} style={{ display: 'contents' }}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * 選んだあとに出すもの。判定を先に、案の説明とアプリが測った変化をそのあとに、ほかの案を最後に出す。
 * 練習のやりとりでも、記録の見直しでも、同じものを出す。
 */
export function Result({
  option: o,
  options,
  width
}: {
  option: ResultOption
  options: ResultOption[]
  width: string
}): React.JSX.Element {
  const clash = o.verdict === '食い違う'
  const measured = Object.fromEntries(
    (o.changes ?? []).map((c) => c.split(/: (.*)/s).slice(0, 2) as [string, string])
  )
  return (
    <>
      <div className={clash ? 'verdict clash' : 'verdict'}>
        <p className="head">{head(o)}</p>
        {o.theory && (
          <div className="claim">
            <p>理論帳: {o.theory.claim}</p>
            <p className="muted">
              段階: {o.theory.level} ／ 出どころ: {o.theory.source}
            </p>
          </div>
        )}
        {o.verdict_text && <p className="why">{o.verdict_text}</p>}
        {clash && (
          <p className="muted" style={{ marginTop: 8 }}>
            食い違いは、間違いという意味ではありません。理論帳のほうを疑う材料か、別の原因がある合図です。
          </p>
        )}
      </div>
      <div className="card">
        <h3>{o.letter} は、こういう案でした</h3>
        <p>
          {o.isOriginal
            ? '元のままの画面です。何も変えていません。'
            : `${o.label}。${o.what_changed ?? ''}`}
        </p>
        {o.responds && <p className="muted">{o.responds}</p>}
        {!o.isOriginal && o.changes && (
          <>
            <h3>アプリが画面から測った変化（{width}幅）</h3>
            {o.changes.length ? (
              <Values values={measured} />
            ) : (
              <p>
                {o.css
                  ? `測っている値には、変化が出ていません。当てた CSS は「${o.css}」です。`
                  : '測っている値には、変化が出ていません。'}
              </p>
            )}
            <p className="muted">
              上の説明は AI が書いたものです。食い違うときは、測ったほうが実際です。
            </p>
          </>
        )}
      </div>
      <div className="card">
        <h3>ほかの {options.length - 1} つ</h3>
        <ul className="list">
          {options
            .filter((x) => x.letter !== o.letter)
            .map((x) => (
              <li key={x.letter}>
                <b>
                  {x.letter}: {x.label}
                </b>
                <br />
                {x.what_changed}
                <br />
                <span className="muted">
                  {x.theory
                    ? `理論帳の「${theoryKey(x)}」と${x.verdict}`
                    : '理論帳に当てはまる項目なし'}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </>
  )
}
