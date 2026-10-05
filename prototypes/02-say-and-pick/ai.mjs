// 指した要素と一言から、そこを変えた案を AI に作らせる
// 単体で試す: node ai.mjs "文字が多すぎる気がする"
import { createChatGPT } from '../../vendor/sign-in-with-chatgpt-devkit/packages/local/dist/index.js'
import { execFileSync } from 'node:child_process'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// トークンは AES-256-GCM で暗号化し、鍵は macOS のキーチェーンに置く（lab/siwc-test.mjs と同じ）
const SERVICE = 'design-practice-lab'
function key() {
  try { return Buffer.from(execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', 'credentials', '-w'], { encoding: 'utf8' }).trim(), 'base64') }
  catch { const k = randomBytes(32); execFileSync('security', ['add-generic-password', '-s', SERVICE, '-a', 'credentials', '-w', k.toString('base64')]); return k }
}
const credentialEncryption = {
  id: 'macos-keychain-aes256gcm',
  isAvailable: () => process.platform === 'darwin',
  encrypt(text) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv); const body = Buffer.concat([c.update(text, 'utf8'), c.final()]); return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), body])) },
  decrypt(bytes) { const b = Buffer.from(bytes), d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8') },
}
const chatgpt = createChatGPT({ appName: 'Design Practice Lab', appId: 'design-practice-lab', redirectPort: 0, credentialEncryption, sendHostId: true,
  openBrowser: (url) => { execFileSync('open', [url]) } })

let model
export async function connect() {
  let session = await chatgpt.getSession()
  if (session.status !== 'connected') session = await chatgpt.signIn()
  if (!session.sharing) throw new Error('ChatGPT のプランの利用が許可されていません')
  if (!model) { const models = await chatgpt.listModels(); model = process.env.MODEL || models[0].slug }
  return { name: session.identity?.name, model }
}

// 考える深さは浅くする。既定のままだと、最初の文字が出るまで 15 秒ほどかかる（浅くすると 7 秒ほど）。EFFORT=medium などで変えられる
const EXTRA = { reasoning: { effort: process.env.EFFORT || 'low' } }

const THEORY = readFileSync(fileURLToPath(new URL('../../docs/theory-v0.md', import.meta.url)), 'utf8')

const INSTRUCTIONS = `あなたはウェブデザインの講評の相手です。正解を決める役ではありません。
使う人は、自分のサイトの画面の一部を指して、感じたことを一言いいました。その一言に応える案を 3 つ作ります。使う人は、元の画面と 3 つの案を見比べて、良いと思うものを選びます。

# 案の作り方
- 3 つの案は、それぞれ違う方向から一言に応える。同じ方向の強弱違いにしない
- 一言が指している原因を考える。「文字が多い」「長い」「くどい」は文章の量の話なので、文章を削った案を必ず入れる。見た目の変更だけで済ませない
- 文章を削る案は、半分以下の字数まで思い切って削る。少し縮めただけでは、見比べても違いが分からない
- 文章を変えるときは、元の文章の事実を保ち、元にない主張を足さない
- 1 つの案で変えるのは 1 つのことだけにする。何が効いたかを、あとで言えるようにするため
- ただし、一言が変える内容を値で言い切っているとき（例:「太さ 500、字間 -0.04em に」）は、1 つ目の案を、言われたとおりの案にする。この案だけは、言われたことを全部同時に変える。残りの 2 つは、違う方向の案にする
- 画像があるときは、まず画像で、地の色、隣の要素、周りとの強さの順位を確かめる。値だけで決めない。暗い地なのに暗い色を足す、のような案を出さない
- 見比べて違いが分かる大きさで変える。ただし、ページの流儀（色、フォント）は壊さない
- 画面は PC 幅（1280px）とスマホ幅（390px）の両方で見られる。両方で崩れない案にする

# 案の書き方
- 指された要素には data-ds-target 属性、その親には data-ds-parent 属性が付いている。css では [data-ds-target] と [data-ds-parent] だけをセレクタに使う
- css は、足す CSS の規則をそのまま書く。見た目を変えない案では空文字にする
- css の値は、そのまま読める単純な値で書く（48px、500、-0.04em）。min()、max()、clamp()、var() は使わない。幅で変えたいときは @media を使う
- 指された要素の HTML が「（省略）」で切れているときは、中身が長い入れ物なので、html は必ず null にして、css だけで変える
- html は、指された要素の中身（innerHTML）を置き換えるときだけ書く。変えないときは null にする。元の中身にあるタグや class は、残せるものは残す

# 理論との突き合わせ
- 下の「理論帳」に書いてあることだけを根拠にする。理論帳にない原則を、その場で作らない
- 案ごとに、いちばん関係の深い理論帳の項目を 1 つ選び、その案が項目に「合う」か「食い違う」かを判定する。関係する項目がなければ「該当なし」にする
- 段階は、理論帳の章に従って「知覚の原理」「デザインの原則」「経験則と指針」「流儀」のどれかを書く。出どころは、理論帳に書いてある著者や本の名前をそのまま写す。「要確認」とあれば、それも写す
- 一言に応える案が、理論と食い違うことはある。そのときは案を引っ込めず、食い違うと書く。合うと言うために、関係の薄い項目を選ばない
- 判定は、画像で見えることも踏まえる
- 元の画面（何も変えない）についても、同じ判定を書く

# 出力
JSON Lines で返す。1 行に 1 つの JSON を書き、行の途中で改行しない。前後に文章やコードブロックの記号を付けない。値はすべて日本語で、です・ます調の短い文にする。
使う人は、できた案から順に見る。1 行目を書いたら、案を 1 つ考えるたびに、すぐその行を書く。

1 行目（読みと、元の画面の判定）:
{"reading": "一言が何を指していると読んだか。1 文", "original": {"theory": {"name": "理論帳の項目名。太字の見出しをそのまま写す（例: 行の長さ）", "claim": "理論帳の項目の内容", "level": "段階", "source": "出どころ"} または null, "verdict": "合う" | "食い違う" | "該当なし", "verdict_text": "元の画面が、その理論とどう合うか、どう食い違うか。値を挙げて 1〜2 文"}}

2〜4 行目（案を 1 行に 1 つ）:
{"label": "何を変えた案か。10 字ほど", "what_changed": "変えたことを、デザインの言葉と値で。例:「1 行の字数 32 字 → 53 字」「文章 118 字 → 61 字」", "responds": "この案が一言にどう応えているか。1 文", "css": "...", "html": null, "edits": null, "theory": {"name": "...", "claim": "...", "level": "...", "source": "..."} または null, "verdict": "合う" | "食い違う" | "該当なし", "verdict_text": "この案が、その理論とどう合うか、どう食い違うか。値を挙げて 1〜2 文"}`

// 指示のうち、案の作り方と判定の決まり（出力の形より前）と、出力の形（読みの 1 行、案の 1 行）を分けて使う
const RULES = INSTRUCTIONS.split('# 出力')[0].trim()
const HEAD_SHAPE = INSTRUCTIONS.match(/1 行目（[^\n]*\n(.*)\n/)[1]
const VARIANT_SHAPE = INSTRUCTIONS.match(/2〜4 行目（[^\n]*\n(.*)/)[1]

// 範囲（入れ物）を指されたときだけ足す指示。案の単位を「1 つの値」から「1 つの原因」に変える
const REGION = `

# 範囲を指されたとき（今回はこれに当たる）
指されたのは、いくつもの要素が入った範囲です。「ごちゃごちゃ」「まとまりがない」「うるさい」のような一言は、1 つの要素の値ではなく、要素どうしの関係（数、強さの順位、まとまり、そろい）を指しています。上の「1 つの案で変えるのは 1 つのことだけ」は、今回は次のように読み替えます。

- 1 つの案は、1 つの原因の仮説に当てる。その仮説のために、範囲の中の複数の要素を同時に変えてよい
- 3 つの案は、別々の原因の仮説にする。原因の例: 要素が多すぎる（絞る）／全部が同じ強さで主役がない（強さを一点に集める）／文字サイズや色や左端の種類が多い（そろえる）／関係のあるものが離れ、ないものが近い（まとめる）／囲みや地が多い（箱を外す）
- label は、原因に対する動きを短く書く（例:「絞る」「強さを一点に集める」「そろえる」「まとめる」「箱を外す」）
- 見比べてはっきり違いが分かるまで変える。遠慮して少しだけ変えた案は、選べない
- 要素を消すのは display: none で行う。消すのは、なくても範囲の目的が伝わるものに限る。主な行動のボタンと見出しは消さない
- what_changed には、何をいくつ変えたかを書く（例:「バッジと下のボタン 3 つを外し、説明を 1 文にします」）。数えた値（要素の数、文字サイズの種類）は、アプリがあとで測るので、推測で書かない

範囲の中の要素には、data-ds="番号" が付いている。data-v は、その要素のいまの値（文字サイズ、太さ、色、幅×高さ）。
- css では [data-ds="番号"] と [data-ds-target]（範囲そのもの）と [data-ds-parent] をセレクタに使う
- 文章を変えるときは、html ではなく edits を使う。edits は [{"id": 番号, "html": "その要素の新しい中身"}] の並び。変えないときは null
- html は必ず null にする（範囲の中身を丸ごと書き換えない）`

// element: { html, parentHtml, text, values: {…}, parentValues: {…} }
// onPart には、できた行から順に { reading, original } か、案 1 つが渡る
// 流れ: まず短い呼び出しで、読みと 3 つの方向（名前だけ）を決める。方向が 1 つ決まるたびに、その案を作る呼び出しを始める。
// 元の画面の判定も、別の呼び出しで同時に作る。合わせて 5 つの呼び出しになる
// onPart に渡るもの: { partial }（読みの書きかけ）、{ reading }、{ direction: 番号 }（方向が決まった。名前は渡さない）、案（label を持つ）、{ original }、{ failed: 文 }
export async function makeVariants({ element, oneLiner, more, previous, image, extra, signal }, onPart = () => {}, onFirst = () => {}) {
  await connect()
  const base = `${image ? `# 画像\nいまの画面（${element.viewport}）の、指された要素のあたりを撮ったもの。画像の大きさは ${image.size.width}×${image.size.height}px。指された要素は、左から ${image.rect.x}px、上から ${image.rect.y}px の位置にあり、幅 ${image.rect.w}px、高さ ${image.rect.h}px。\n\n` : ''}# 指された要素
\`\`\`html
${element.html}
\`\`\`

文字数: ${element.text.length} 字

いまの値（${element.viewport || 'PC 幅 1280px'}）:
${JSON.stringify(element.values, null, 1)}

親の要素（開きタグと、いまの値）:
\`\`\`html
${element.parentHtml}
\`\`\`
${JSON.stringify(element.parentValues, null, 1)}

# 使う人の一言
${oneLiner}
${more ? `\n# 作り直しの依頼\n前に出した案（${(previous || []).join('、')}）は、どれも選ばれなかった。使う人は、こう言い足した。\n${more}\n前の案とは違う方向の案を出す。\n` : ''}`
  const text = `${base}\n# 理論帳\n${THEORY}`
  const content = (t) => image ? [{ role: 'user', content: [{ type: 'input_text', text: t }, { type: 'input_image', image_url: image.url }] }] : t
  const t0 = Date.now(), seconds = () => (Date.now() - t0) / 1000
  const rules = RULES + (element.region ? REGION : '')
  const ask = (instructions, input, onDelta) => chatgpt.streamResponse({ model, instructions, input: content(input), signal, extra: extra ?? EXTRA, onDelta: (d) => { onFirst(seconds()); onDelta?.(d) } })
  // 閉じ括弧を 1 つ余分に付けて返すことがあるので、だめなら 1 つ削って読み直す
  const read = (text) => { const s = text.indexOf('{'), e = text.lastIndexOf('}'); if (s < 0 || e < s) return null; try { return JSON.parse(text.slice(s, e + 1)) } catch { try { return JSON.parse(text.slice(s, e)) } catch { return null } } }
  const jobs = [], directions = []; let count = 0
  const fail = (what) => (error) => { if (!signal?.aborted) onPart({ failed: `${what}: ${error?.message || error}` }, seconds()) }

  // 元の画面の判定
  jobs.push((async () => {
    const result = await ask(`${rules}\n\n# 今回の仕事\n案は作らない。元の画面（何も変えない）の判定だけを返す。\n\n# 出力\nJSON を 1 つだけ返す。前後に文章やコードブロックの記号を付けない。値はすべて日本語で、です・ます調の短い文にする。\n{"original": ${HEAD_SHAPE.match(/"original": (.*)}$/)[1]}}`, text)
    const part = read(result.text); if (part?.original) onPart({ original: part.original }, seconds()); else throw new Error('返事を読めませんでした')
  })().catch(fail('元の画面の判定')))

  // 方向が決まったら、すぐその案を作り始める
  const build = (direction, index) => jobs.push((async () => {
    const result = await ask(`${rules}\n\n# 今回の仕事\n案を 1 つだけ作る。残りの案は、別の担当が同時に作っている。重ならないよう、次の方向だけで作る。\n\n方向: ${direction.label}（原因の仮説: ${direction.cause}）\n\nほかの担当の方向（これらには踏み込まない）: ${directions.filter(d => d !== direction).map(d => d.label).join('／') || '未定'}\n\nlabel は、上の方向の名前をもとに付ける。\n\n# 出力\nJSON を 1 つだけ返す。前後に文章やコードブロックの記号を付けない。値はすべて日本語で、です・ます調の短い文にする。\n${VARIANT_SHAPE}`, text)
    const part = read(result.text); if (part?.label) { count++; onPart(part, seconds()) } else throw new Error('返事を読めませんでした')
  })().catch(fail(`案 ${index + 1}`)))

  // 読みと方向を決める。速く返すため、理論帳は渡さず、方向は名前と原因の一言だけを書かせる
  let pending = '', seen = 0, readingDone = false
  const line = (text) => {
    const part = read(text); if (!part) return
    if (part.reading && !readingDone) { readingDone = true; onPart({ reading: part.reading }, seconds()) }
    else if (part.label && directions.length < 3) { directions.push(part); onPart({ direction: directions.length }, seconds()); build(part, directions.length - 1) }
  }
  try {
    await ask(`${rules}\n\n# 今回の仕事\n案そのものは作らない。一言の読みと、案の方向を 3 つ決める。案は、このあと別の担当が方向ごとに作る。\n- 方向は、上の「案の作り方」に従って、別々の原因の仮説に当てる\n- 一言が変える内容を値で言い切っているときは、1 つ目の方向を「言われたとおり」にする\n- 短く書く。label は 10 字以内、cause は 20 字以内\n- reading は、です・ます調の 1 文にする\n\n# 出力\nJSON Lines で返す。1 行に 1 つの JSON を書き、行の途中で改行しない。前後に文章やコードブロックの記号を付けない。1 行書くたびに、すぐ次の行へ進む。\n1 行目: {"reading": "一言が何を指していると読んだか。1 文"}\n2〜4 行目（方向を 1 行に 1 つ）: {"label": "方向の名前", "cause": "原因の仮説"}`, base,
      (d) => {
        pending += d
        // 読みは、書かれている途中の文も渡す。待っている人に、早く文字を見せるため
        if (!readingDone) { const m = pending.match(/"reading"\s*:\s*"((?:[^"\\]|\\.)*)/); if (m && m[1].length > seen) { seen = m[1].length; onPart({ partial: m[1] }, seconds()) } }
        const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(line)
      })
    line(pending)
  } catch (error) { if (!directions.length) throw error }
  if (!directions.length) throw new Error('案の方向を決められませんでした')
  // 途中で増えた仕事も待つ
  for (let done = 0; done < jobs.length; done = jobs.length) await Promise.all(jobs.slice(done))
  await Promise.all(jobs)
  if (signal?.aborted) throw new Error('やめました')
  if (!count) throw new Error('案を 1 つも作れませんでした')
  return { model, seconds: seconds() }
}

// 単体で試すとき
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const element = {
    html: '<p class="rmxc-9x2atwzczvbf" data-ds-target="">事業の話を、技術の言葉に直さずにそのまま聞かせてください。技術の話は、経営と開発の両方を経験した代表がします。何ができるか、どんな価値をつくれるか、事業として立ち上げられるかを構想の段階から一緒に考え、動く最初のバージョンまで自分で作ります。</p>',
    text: '事業の話を、技術の言葉に直さずにそのまま聞かせてください。技術の話は、経営と開発の両方を経験した代表がします。何ができるか、どんな価値をつくれるか、事業として立ち上げられるかを構想の段階から一緒に考え、動く最初のバージョンまで自分で作ります。',
    values: { 幅: '576px', 高さ: '144px', 文字: '400 18px / 36px', 字間: '0.36px', 色: 'rgb(74, 72, 67)', '1 行の字数': '約 32 字', 行数: 4 },
    parentHtml: '<div class="rmxc-1yhdtacc6mcon" data-ds-parent="">',
    parentValues: { 幅: '1072px' },
  }
  console.log(await connect())
  try { console.log(await makeVariants({ element, oneLiner: process.argv[2] || '文字が多すぎる気がするな。もっと端的にしないと読んでもらえなそう。' }, (part, t) => console.log(t.toFixed(1), JSON.stringify(part).slice(0, 110)))) }
  catch (error) { console.error(error.message, '\n', error.raw) }
  process.exit(0)
}
