import { useEffect, useRef } from 'react'
import { practice } from '../practice/controller'
import { usePractice } from '../practice/usePractice'

interface Shape {
  prompt: string
  placeholder?: string
  typing?: boolean
  hideInput?: boolean
  hint?: string
  /** 黒いボタン。その場面でいちばん押してほしいものにだけ使う */
  primary?: [label: string, enabled: boolean]
  /** 控えめなボタン */
  secondary?: [label: string, enabled: boolean]
}

/** 下の入力欄。段階ごとに、上の文、入力できるか、ボタンを決める。場所はいつも同じ */
export function Composer(): React.JSX.Element {
  const { step, view, looking, input, options, seconds } = usePractice()
  const field = useRef<HTMLTextAreaElement>(null)
  const text = input.trim()
  const shown = options.filter((o) => !o.pending).length
  const redo = 'どれも違うときは、もう一言（例: もっと大胆に）'

  const shapes: Record<typeof step, Shape> = {
    point: { prompt: '気になるところを、左の画面でクリックしてください', primary: ['送る', false] },
    say: {
      prompt: 'どう感じましたか。一言で書いてください',
      placeholder: '例: 文字が多い / なんか弱い',
      typing: true,
      primary: ['送る', !!text],
      hint: '⌘ + Enter でも送れます'
    },
    wait: {
      prompt: `案を作っています（${shown} / ${options.length || 4} 枚）`,
      secondary: ['やめる', true],
      hint: `${seconds} 秒`
    },
    pick:
      view === 'look'
        ? {
            prompt: '良いと思ったら、この案を選んでください',
            placeholder: redo,
            typing: true,
            secondary: ['作り直す', !!text],
            primary: [`${looking} を選ぶ`, true],
            hint: '← → で切り替え、Enter で選ぶ'
          }
        : {
            prompt: '案をクリックして、大きく見比べてください',
            placeholder: redo,
            typing: true,
            secondary: ['作り直す', !!text],
            primary: ['選ぶ', false],
            hint: '大きく見てから選びます'
          },
    note: {
      prompt: 'なぜそれを選んだか、自分の言葉で一言残してください',
      typing: true,
      primary: ['残す', !!text],
      hint: '⌘ + Enter でも送れます'
    },
    done: { prompt: '記録しました', hideInput: true, primary: ['別のところを指す', true] }
  }
  const shape = shapes[step]

  // 選ぶ段階では入力欄に入らない。矢印キーで案を切り替えられるようにするため
  useEffect(() => {
    if (step === 'say' || step === 'note') field.current?.focus()
  }, [step])

  return (
    <form
      className="composer"
      id="composer"
      onSubmit={(e) => {
        e.preventDefault()
        practice.primary()
      }}
    >
      <label htmlFor="input" id="prompt">
        {shape.prompt}
      </label>
      <textarea
        id="input"
        ref={field}
        aria-describedby="hint"
        value={input}
        placeholder={shape.placeholder ?? ''}
        disabled={!shape.typing}
        hidden={shape.hideInput}
        onChange={(e) => practice.setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing) return
          e.preventDefault()
          if (step === 'pick') practice.secondary()
          else practice.primary()
        }}
      />
      <div className="row">
        <span className="muted" id="hint">
          {shape.hint ?? ''}
        </span>
        <span className="spacer" />
        {shape.secondary && (
          <button
            className="plain"
            type="button"
            id="alt"
            disabled={!shape.secondary[1]}
            onClick={practice.secondary}
          >
            {shape.secondary[0]}
          </button>
        )}
        {shape.primary && (
          <button className="primary" id="send" disabled={!shape.primary[1]}>
            {shape.primary[0]}
          </button>
        )}
      </div>
    </form>
  )
}
