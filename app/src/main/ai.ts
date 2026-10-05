// 指した要素と一言から、そこを変えた案を AI に作らせる。
//
// 流れ: まず短い呼び出しで、読みと 3 つの方向（名前だけ）を決める。方向が 1 つ決まるたびに、その案を作る呼び出しを始める。
// 元の画面の判定も、別の呼び出しで同時に作る。合わせて 5 つの呼び出しになる。
// 順に書かせると最後の案まで 35 秒かかる。同時に作ると 28〜36 秒で、案が一言に合う（試作 2 で測った）。
import { Direction, Original, Variant, type RoundEvent, type RoundRequest } from '@shared/schema'
import { chatgpt, currentModel } from './auth'
import { ORIGINAL_SHAPE, REGION, RULES, VARIANT_SHAPE } from './prompts'
import { theory } from './store'

/** 指したあたりを撮った画像。AI に画面を見せるために渡す */
export interface Shot {
  url: string
  size: { width: number; height: number }
  rect: { x: number; y: number; w: number; h: number }
}

// 考える深さは浅くする。既定のままだと、最初の文字が出るまで 15 秒ほどかかる（浅くすると 7 秒ほど）
const EXTRA = { reasoning: { effort: process.env['DESIGN_STUDY_EFFORT'] || 'low' } }
const PLAIN =
  'JSON を 1 つだけ返す。前後に文章やコードブロックの記号を付けない。値はすべて日本語で、です・ます調の短い文にする。'

/** AI の返事から JSON を取り出す。閉じ括弧を 1 つ余分に付けて返すことがあるので、だめなら 1 つ削って読み直す */
function read(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    try {
      return JSON.parse(text.slice(start, end))
    } catch {
      return null
    }
  }
}

function describe(request: RoundRequest, image: Shot | null): string {
  const { element, oneLiner, more, previous } = request
  const picture = image
    ? `# 画像\nいまの画面（${element.viewport}）の、指された要素のあたりを撮ったもの。画像の大きさは ${image.size.width}×${image.size.height}px。指された要素は、左から ${image.rect.x}px、上から ${image.rect.y}px の位置にあり、幅 ${image.rect.w}px、高さ ${image.rect.h}px。\n\n`
    : ''
  const redo = more
    ? `\n# 作り直しの依頼\n前に出した案（${(previous ?? []).join('、')}）は、どれも選ばれなかった。使う人は、こう言い足した。\n${more}\n前の案とは違う方向の案を出す。\n`
    : ''
  return `${picture}# 指された要素
\`\`\`html
${element.html}
\`\`\`

文字数: ${element.text.length} 字

いまの値（${element.viewport}）:
${JSON.stringify(element.values, null, 1)}

親の要素（開きタグと、いまの値）:
\`\`\`html
${element.parentHtml}
\`\`\`
${JSON.stringify(element.parentValues, null, 1)}

# 使う人の一言
${oneLiner}
${redo}`
}

/** 案を作る。できたものから順に emit に渡す。signal で途中でやめられる */
export async function makeVariants(
  request: RoundRequest,
  image: Shot | null,
  emit: (event: RoundEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const model = await currentModel()
  const started = Date.now()
  const base = describe(request, image)
  const full = `${base}\n# 理論帳\n${await theory()}`
  const rules = RULES + (request.element.region ? REGION : '')
  const ask = (
    instructions: string,
    text: string,
    onDelta?: (delta: string) => void
  ): Promise<{ text: string }> =>
    chatgpt().streamResponse({
      model,
      instructions,
      signal,
      extra: EXTRA,
      onDelta,
      input: image
        ? [
            {
              role: 'user',
              content: [
                { type: 'input_text', text },
                { type: 'input_image', image_url: image.url }
              ]
            }
          ]
        : text
    })

  const jobs: Promise<void>[] = []
  const directions: Direction[] = []
  let built = 0
  const fail = (what: string) => (error: unknown) => {
    if (!signal.aborted)
      emit({
        type: 'failed',
        message: `${what}: ${error instanceof Error ? error.message : String(error)}`
      })
  }

  // 元の画面の判定
  jobs.push(
    (async () => {
      const result = await ask(
        `${rules}\n\n# 今回の仕事\n案は作らない。元の画面（何も変えない）の判定だけを返す。\n\n# 出力\n${PLAIN}\n{"original": ${ORIGINAL_SHAPE}}`,
        full
      )
      const parsed = Original.safeParse(
        (read(result.text) as { original?: unknown } | null)?.original
      )
      if (!parsed.success) throw new Error('返事を読めませんでした')
      emit({ type: 'original', original: parsed.data })
    })().catch(fail('元の画面の判定'))
  )

  // 方向が決まったら、すぐその案を作り始める
  const build = (direction: Direction, index: number): void => {
    jobs.push(
      (async () => {
        const others =
          directions
            .filter((d) => d !== direction)
            .map((d) => d.label)
            .join('／') || '未定'
        const result = await ask(
          `${rules}\n\n# 今回の仕事\n案を 1 つだけ作る。残りの案は、別の担当が同時に作っている。重ならないよう、次の方向だけで作る。\n\n方向: ${direction.label}（原因の仮説: ${direction.cause}）\n\nほかの担当の方向（これらには踏み込まない）: ${others}\n\nlabel は、上の方向の名前をもとに付ける。\n\n# 出力\n${PLAIN}\n${VARIANT_SHAPE}`,
          full
        )
        const parsed = Variant.safeParse(read(result.text))
        if (!parsed.success) throw new Error('返事を読めませんでした')
        built++
        emit({ type: 'variant', variant: parsed.data })
      })().catch(fail(`案 ${index + 1}`))
    )
  }

  // 読みと方向を決める。速く返すため、理論帳は渡さず、方向は名前と原因の一言だけを書かせる
  let pending = ''
  let seen = 0
  let read1 = false
  const line = (text: string): void => {
    const part = read(text) as { reading?: unknown } | null
    if (!part) return
    if (typeof part.reading === 'string' && !read1) {
      read1 = true
      emit({ type: 'reading', text: part.reading })
      return
    }
    const direction = Direction.safeParse(part)
    if (direction.success && directions.length < 3) {
      directions.push(direction.data)
      emit({ type: 'direction', count: directions.length })
      build(direction.data, directions.length - 1)
    }
  }
  try {
    await ask(
      `${rules}\n\n# 今回の仕事\n案そのものは作らない。一言の読みと、案の方向を 3 つ決める。案は、このあと別の担当が方向ごとに作る。\n- 方向は、上の「案の作り方」に従って、別々の原因の仮説に当てる\n- 一言が変える内容を値で言い切っているときは、1 つ目の方向を「言われたとおり」にする\n- 短く書く。label は 10 字以内、cause は 20 字以内\n- reading は、です・ます調の 1 文にする\n\n# 出力\nJSON Lines で返す。1 行に 1 つの JSON を書き、行の途中で改行しない。前後に文章やコードブロックの記号を付けない。1 行書くたびに、すぐ次の行へ進む。\n1 行目: {"reading": "一言が何を指していると読んだか。1 文"}\n2〜4 行目（方向を 1 行に 1 つ）: {"label": "方向の名前", "cause": "原因の仮説"}`,
      base,
      (delta) => {
        pending += delta
        // 読みは、書かれている途中の文も渡す。待っている人に、早く文字を見せるため
        if (!read1) {
          const m = pending.match(/"reading"\s*:\s*"((?:[^"\\]|\\.)*)/)
          if (m && m[1].length > seen) {
            seen = m[1].length
            emit({ type: 'partial', text: m[1] })
          }
        }
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        lines.forEach(line)
      }
    )
    line(pending)
  } catch (error) {
    if (!directions.length) throw error
  }
  if (!directions.length) throw new Error('案の方向を決められませんでした')
  // 途中で増えた仕事も待つ
  for (let done = 0; done < jobs.length;) {
    const count = jobs.length
    await Promise.all(jobs.slice(done))
    done = count
  }
  if (signal.aborted) throw new Error('やめました')
  if (!built) throw new Error('案を 1 つも作れませんでした')
  emit({ type: 'done', model, seconds: (Date.now() - started) / 1000 })
}
