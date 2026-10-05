import { useEffect, useEffectEvent, useRef } from 'react'
import { Stage, type StageEvents } from './stage'

interface Props {
  /** 写しの HTML。変わると、画面を開き直す */
  html: string
  events: StageEvents
  /** Stage を外から操作するための口（幅を変える、案を当てる、など） */
  onReady(stage: Stage): void
}

/** 左の画面を React の部品として包む。中身（iframe の扱い）は stage.ts が受け持つ */
export function StageView({ html, events, onReady }: Props): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  // 受け取った関数は描くたびに作り直される。画面を開き直さずに、いちばん新しいものを呼ぶ
  const point = useEffectEvent((el: HTMLElement) => events.point(el))
  const cell = useEffectEvent((letter: string) => events.cell(letter))
  const key = useEffectEvent((event: KeyboardEvent) => events.key(event))
  const ready = useEffectEvent((stage: Stage) => onReady(stage))

  useEffect(() => {
    if (!root.current || !html) return
    const stage = new Stage(root.current, { point, cell, key })
    void stage.open(html).then(() => ready(stage))
    return () => stage.dispose()
  }, [html])

  return <div id="stage" ref={root} />
}
