// 試作 2 の画面の動き。左が画面（stage.js）、右が言葉（この下の「右の列」）。
//
// 1 回の流れは、次の段階を順に進む。いまの段階は S.step に持ち、段階ごとに「何が見えて、何が押せるか」を 1 か所（composer）で決める。
//   point  気になるところを指す
//   say    一言書く
//   wait   案ができるのを待つ（できた案は見られる。途中でやめられる）
//   pick   大きく見比べて、選ぶ（言い足して作り直すこともできる）
//   note   選んだ理由を一言残す
//   done   記録した
import { $, h } from './dom.js'
import { Stage, WIDTHS } from './stage.js'
import { pathOf, describe, changes } from './measure.js'

const LETTERS = ['A', 'B', 'C', 'D']
const S = {
  page: null, width: 'pc',
  step: 'point',
  view: 'single',        // single（指す）/ grid（並べる）/ look（1 つを大きく見る）
  looking: null,         // 大きく見ている案の文字
  showing: 'variant',    // 選んだあと、大きく見ている枠に出すもの: variant（案）/ original（元）
  path: null, element: null,
  oneLiner: '', more: [], rounds: [],
  options: [],           // A〜D。{ letter, pending, isOriginal, label, what_changed, css, html, edits, theory, verdict, … }
  reading: '', model: null, picked: null,
  run: null,             // 案を待っているあいだの持ちもの（やめるための口、時計、進み具合の表示）
  review: null,          // 記録を見直しているときの持ちもの
}
let RECORDS = [], PAGES = []

const widthLabel = () => (S.width === 'pc' ? 'PC' : 'スマホ')
const viewport = () => `${widthLabel()}幅 ${WIDTHS[S.width]}px`
const option = (letter) => S.options.find(o => o.letter === letter)
const pickedOf = (r) => r.options.find(o => o.letter === r.picked)
const theoryKey = (o) => (o.theory ? o.theory.name || o.theory.claim : '理論帳に当てはまる項目なし')
const day = (r) => new Date(r.at).toLocaleDateString('ja-JP')
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches
const shuffled = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

// =====================================================================
// 左の画面
// =====================================================================
const stage = new Stage($('#stage'), {
  point: (el) => pointed(el),
  cell: (letter) => { if (!option(letter)?.pending) look(letter) },
  key: (e) => onKey(e),
  loaded: () => {},
})

// 見方を変える。枠は開いたままなので、切り替えは一瞬で済む
function setView(view, letter = null) {
  // 元を出したまま別の案へ移らない。移る前に、案の表示に戻しておく
  if (S.looking && S.showing === 'original') { const f = stage.byLetter(S.looking); if (f) stage.show(f, true) }
  S.view = view; S.looking = letter; S.showing = 'variant'
  stage.set(view, letter ? stage.byLetter(letter) : null)
  renderTools(); composer()
}
const look = (letter) => setView('look', letter)
const grid = () => setView('grid')

// 選んだあと、同じ枠の中で元と案を切り替える。位置は動かない
function setShowing(which) {
  const frame = stage.byLetter(S.looking); if (!frame || option(S.looking)?.isOriginal) return
  S.showing = which; stage.show(frame, which === 'variant'); renderTools()
}

// 帯の右側: 見方の切り替え。いつも同じ場所に出す
function renderTools() {
  const tools = $('#tools')
  const focused = tools.contains(document.activeElement) ? document.activeElement.dataset.key : null
  tools.replaceChildren()
  $('#zoomed').hidden = !(S.view === 'grid' && stage.zoomed) || !!S.review
  if (S.review) return renderReviewTools()
  if (!S.options.length) return
  const o = option(S.looking)
  if (S.picked && S.view === 'look' && o && !o.isOriginal) {
    tools.append(h('span', { class: 'seg', role: 'group', 'aria-label': '元と案の切り替え' },
      h('button', { 'data-key': 'original', 'aria-pressed': String(S.showing === 'original'), onclick: () => setShowing('original') }, '元'),
      h('button', { 'data-key': 'variant', 'aria-pressed': String(S.showing === 'variant'), title: o.label, onclick: () => setShowing('variant') }, `案 ${o.letter}`)))
  }
  tools.append(h('span', { class: 'seg', role: 'group', 'aria-label': '見方' },
    h('button', { 'data-key': 'grid', 'aria-pressed': String(S.view === 'grid'), onclick: grid }, '並べる'),
    ...S.options.map(x => {
      const picked = x.letter === S.picked
      const button = h('button', { 'data-key': x.letter, 'aria-pressed': String(S.view === 'look' && S.looking === x.letter), 'aria-label': picked ? `${x.letter}（選んだ案）` : x.letter, onclick: () => look(x.letter) }, picked ? `${x.letter} ✓` : x.letter)
      if (S.picked && x.label) button.title = x.label
      button.disabled = !!x.pending
      return button
    })))
  if (focused) tools.querySelector(`[data-key="${focused}"]`)?.focus()
}

// 矢印キーで案を順に切り替える。同じ位置のまま切り替わるので、違いが見つけやすい
function cycle(step) {
  const letters = (S.review ? S.review.r.options : S.options.filter(o => !o.pending)).map(o => o.letter); if (!letters.length) return
  const current = S.review ? (S.review.view === 'look' ? S.review.looking : null) : (S.view === 'look' ? S.looking : null)
  const next = current == null ? (S.review ? S.review.r.picked : S.picked) || letters[0] : letters[(letters.indexOf(current) + step + letters.length) % letters.length]
  if (S.review) reviewGo({ view: 'look', looking: next, showing: 'variant' }); else look(next)
}
function onKey(e) {
  const typing = e.target?.matches?.('textarea, input, select')
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return
  // ボタンの上で Enter を押したときは、そのボタンを押すだけにする（選ぶ操作と重ねない）
  if (e.key === 'Enter' && e.target?.matches?.('button, a, [role=button]')) return
  const reviewing = !!S.review, has = reviewing || (S.options.length && S.step !== 'point' && S.step !== 'say')
  if (!has) return
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); cycle(e.key === 'ArrowRight' ? 1 : -1) }
  else if (e.key === 'Escape') { e.preventDefault(); if (reviewing) reviewGo({ view: 'grid' }); else if (S.view === 'look') grid() }
  else if (e.key === 'Enter' && !reviewing && S.step === 'pick' && S.view === 'look') { e.preventDefault(); choose(S.looking) }
  else if ((e.key === 'o' || e.key === 'O') && !reviewing && S.picked && S.view === 'look') { e.preventDefault(); setShowing(S.showing === 'variant' ? 'original' : 'variant') }
  else if ((e.key === 'o' || e.key === 'O') && reviewing && S.review.view === 'look') { e.preventDefault(); reviewGo({ showing: S.review.showing === 'variant' ? 'original' : 'variant' }) }
}
document.addEventListener('keydown', onKey)

// 幅を変える。写しは読み込み直さず、枠の幅だけを変える
$('#width').addEventListener('click', (e) => {
  const width = e.target.dataset.w; if (!width || width === S.width) return
  S.width = width
  for (const b of $('#width').children) b.setAttribute('aria-pressed', String(b.dataset.w === width))
  stage.setWidth(width)
  // 並び直しが済んでから、その幅の値に取り直す
  requestAnimationFrame(() => requestAnimationFrame(() => {
    stage.layout(); renderTools()
    if (S.step === 'say') { const el = stage.pointed(); if (el) { stage.mark(null); showPointed(el); stage.mark(el) } }
    if (S.review) renderReview()
  }))
})
let resizing
addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(() => { stage.layout(); renderTools(); if (S.review) renderReview() }, 100) })

// =====================================================================
// 右の列: やりとり
// =====================================================================
const thread = $('#thread')
const announce = (text) => { $('#status').textContent = text }
// 下まで読んでいるときだけ、新しい文に合わせて下へ流す。上を読み返しているときは動かさない
const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48
function add(node, force = false) { const stick = force || nearBottom(); thread.append(node); if (stick) thread.scrollTop = thread.scrollHeight; return node }
const say = (...nodes) => add(h('div', {}, ...nodes))
const me = (text) => add(h('div', { class: 'me' }, text), true)
const alertBox = (...nodes) => h('div', { class: 'alert', role: 'alert' }, ...nodes)
const valuesList = (values, extra = '') => h('dl', { class: `values ${extra}` }, ...Object.entries(values).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))

// ---- 下の入力欄。段階ごとに、上の文、入力できるか、ボタンを決める ----
const input = $('#input'), send = $('#send'), alt = $('#alt')
function composer() {
  const text = input.value.trim(), n = S.options.filter(o => !o.pending).length
  const steps = {
    point: { prompt: '気になるところを、左の画面でクリックしてください', primary: ['送る', false] },
    say: { prompt: 'どう感じましたか。一言で書いてください', placeholder: '例: 文字が多い / なんか弱い', typing: true, primary: ['送る', !!text], hint: '⌘ + Enter でも送れます' },
    wait: { prompt: `案を作っています（${n} / ${S.options.length || 4} 枚）`, secondary: ['やめる', true], hint: S.run ? `${Math.round((Date.now() - S.run.t0) / 1000)} 秒` : '' },
    pick: S.view === 'look'
      ? { prompt: '良いと思ったら、この案を選んでください', placeholder: 'どれも違うときは、もう一言（例: もっと大胆に）', typing: true, secondary: ['作り直す', !!text], primary: [`${S.looking} を選ぶ`, true], hint: '← → で切り替え、Enter で選ぶ' }
      : { prompt: '案をクリックして、大きく見比べてください', placeholder: 'どれも違うときは、もう一言（例: もっと大胆に）', typing: true, secondary: ['作り直す', !!text], primary: ['選ぶ', false], hint: '大きく見てから選びます' },
    note: { prompt: 'なぜそれを選んだか、自分の言葉で一言残してください', typing: true, primary: ['残す', !!text], hint: '⌘ + Enter でも送れます' },
    done: { prompt: '記録しました', hideInput: true, primary: ['別のところを指す', true] },
  }
  const c = steps[S.step]
  $('#prompt').textContent = c.prompt
  input.placeholder = c.placeholder || ''; input.disabled = !c.typing; input.hidden = !!c.hideInput
  $('#hint').textContent = c.hint || ''
  send.hidden = !c.primary; if (c.primary) { send.textContent = c.primary[0]; send.disabled = !c.primary[1] }
  alt.hidden = !c.secondary; if (c.secondary) { alt.textContent = c.secondary[0]; alt.disabled = !c.secondary[1] }
  $('#page').disabled = S.step === 'wait'
}
function setStep(step, { focus = true } = {}) {
  S.step = step; composer()
  // 選ぶ段階では入力欄に入らない。矢印キーで案を切り替えられるようにするため
  if (focus && (step === 'say' || step === 'note')) input.focus()
}
function primary() {
  const text = input.value.trim()
  if (S.step === 'say' && text) { input.value = ''; startRound(text) }
  else if (S.step === 'pick' && S.view === 'look') choose(S.looking)
  else if (S.step === 'note' && text) { input.value = ''; noted(text) }
  else if (S.step === 'done') again()
}
function secondary() {
  const text = input.value.trim()
  if (S.step === 'wait') cancelRound()
  else if (S.step === 'pick' && text) { input.value = ''; startRound(S.oneLiner, text) }
}
input.addEventListener('input', composer)
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing) return
  e.preventDefault(); if (S.step === 'pick') secondary(); else primary()
})
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); primary() })
alt.addEventListener('click', secondary)

// ---- 指す ----
let pointedCard
function showPointed(el) {
  S.element = describe(el, viewport())
  const card = h('div', { class: 'card' },
    h('h3', {}, `指したところ（${S.element.viewport}）`),
    h('p', { class: 'quote' }, S.element.text || `（${S.element.tag}）`),
    valuesList(S.element.values))
  const past = RECORDS.filter(r => r.page === S.page.title && r.element.text === S.element.text)
  if (past.length) {
    const r = past.at(-1)
    card.append(h('p', { class: 'muted', style: 'margin-top:8px' }, `ここは前にも指しています（${past.length} 回）。${day(r)}は「${r.oneLiner}」と感じて、「${pickedOf(r).label}」を選びました。`))
  }
  // 一言を書く前に指し直したら、カードを差し替える
  if (pointedCard?.isConnected) pointedCard.replaceChildren(card); else pointedCard = add(h('div', {}, card), true)
}
function pointed(el) {
  if (S.step !== 'point' && S.step !== 'say') return
  showPointed(el)
  S.path = pathOf(el); stage.setPath(S.path)
  setStep('say')
}

// ---- 案を待つ ----
// 進み具合を、決まった場所に 1 行ずつ出す。何をしているかが見えると、待ちやすい
function makeTrace() {
  const row = (text) => h('p', { class: 'step doing' }, h('span', { class: 'dot' }), h('span', {}, text))
  const see = row('画面を AI に見せています'), read = row('一言を読んでいます'), plan = row('案の方向を決めています'), build = row('案を作っています')
  const caret = h('span', { class: 'caret' })
  const el = h('div', { class: 'trace' }, see)
  const set = (r, text, done) => { const stick = nearBottom(); r.lastChild.replaceChildren(text); r.classList.toggle('doing', !done); r.classList.toggle('done', !!done); if (!r.isConnected) el.append(r); if (stick) thread.scrollTop = thread.scrollHeight }
  return {
    el,
    saw: (ok) => { set(see, ok ? '画面を AI に見せました' : '画像は渡せませんでした。値だけで進めます', true); set(read, '一言を読んでいます', false) },
    reading: (text, done) => { set(read, `一言を、こう読みました。${text}`, done); if (!done) read.lastChild.append(caret); if (done && !plan.isConnected) set(plan, '案の方向を決めています', false) },
    direction: (n) => { set(plan, n >= 3 ? '案の方向を 3 つ決めました' : `案の方向を決めています（${n} / 3）`, n >= 3); if (!build.isConnected) set(build, '案を作っています', false) },
    building: (n, total) => set(build, `案を作っています（${n} / ${total} 枚）`, false),
    slow: () => { if (!el.querySelector('.slow')) el.append(h('p', { class: 'muted slow' }, 'いつもより時間がかかっています。やめて、もう一度送ることもできます。')) },
    finish: (text) => { for (const r of [see, read, plan]) if (r.isConnected) { r.classList.remove('doing'); r.classList.add('done') } el.querySelector('.slow')?.remove(); caret.remove(); set(build, text, true) },
    stop: (text) => { for (const r of [see, read, plan, build]) r.classList.remove('doing'); caret.remove(); el.querySelector('.slow')?.remove(); el.append(h('p', { class: 'muted' }, text)) },
  }
}

async function startRound(text, more) {
  const previous = S.options.filter(o => !o.isOriginal && !o.pending).map(o => o.label)
  if (more) { S.more.push(more); S.rounds.push(S.options.filter(o => !o.isOriginal && !o.pending).map(({ label, what_changed }) => ({ label, what_changed }))) }
  else S.oneLiner = text
  me(more || text)

  // 枠を 4 つ用意して、文字（A〜D）を割り当てる。どれが元かは伏せる
  stage.pointing = false; stage.prepare()
  const letters = shuffled(LETTERS)
  S.options = LETTERS.map(letter => ({ letter, pending: true })); S.picked = null; S.reading = ''
  stage.frames.forEach((f, i) => {
    if (i > 0) stage.strip(f)
    stage.label(f, { letter: letters[i] }); f.pending = true; stage.veil(f, '作っています')
  })
  Object.assign(option(letters[0]), { isOriginal: true, label: '元のまま', what_changed: '何も変えていません。', css: '', html: null, edits: null })

  const trace = makeTrace(), controller = new AbortController()
  const run = S.run = { t0: Date.now(), controller, trace, arrived: 0, failed: [], text, more, letters }
  add(trace.el, true)
  setStep('wait'); setView('grid')
  run.clock = setInterval(() => { composer(); if (Date.now() - run.t0 > 45000) trace.slow() }, 1000)

  // 元のままを出す順番は、毎回ばらつかせる。いつも最初（または最後）に出ると、どれが元かを届く順から推測できてしまう
  // order が 0 なら最初の案より前に、1〜3 なら、その番目の案が届いた少しあとに出す
  let revealOriginal
  run.originalShown = new Promise(done => { revealOriginal = () => { clearTimeout(run.originalTimer); reveal(stage.frames[0], option(letters[0])); done() } })
  run.order = Math.floor(Math.random() * 4)
  if (run.order === 0) run.originalTimer = setTimeout(revealOriginal, 6000 + Math.random() * 6000)
  run.arrivedVariant = (n) => { if (n === run.order && stage.frames[0].pending) run.originalTimer = setTimeout(revealOriginal, 500 + Math.random() * 2500) }

  const onPart = async (part) => {
    if (part.error) throw Object.assign(new Error(part.error), { raw: part.raw })
    if ('saw' in part) trace.saw(part.saw)
    else if (part.partial != null) trace.reading(part.partial, false)
    else if (part.reading) { S.reading = part.reading; trace.reading(part.reading, true) }
    else if (part.direction) trace.direction(part.direction)
    else if (part.original) Object.assign(option(letters[0]), part.original)
    else if (part.failed) run.failed.push(part.failed)
    else if (part.done) S.model = part.model
    else if (part.label && run.arrived < 3) {
      const frame = stage.frames[++run.arrived], o = option(frame.letter)
      Object.assign(o, part)
      await frame.ready
      if (S.run !== run) return
      stage.apply(frame, o); reveal(frame, o); run.arrivedVariant(frame.index)
    }
  }
  try {
    const res = await fetch('/api/variants', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ element: S.element, oneLiner: text, more, previous, slug: S.page.slug, path: S.path, width: S.width, dark: dark() }) })
    if (!res.ok) throw new Error((await res.json()).error)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader(), pending = []
    for (let buffer = ''; ;) {
      const { value, done } = await reader.read(); if (done) break
      buffer += value; const lines = buffer.split('\n'); buffer = lines.pop()
      for (const line of lines) if (line) pending.push(onPart(JSON.parse(line)))
    }
    await Promise.all(pending)
    if (S.run !== run) return
    if (!run.arrived) throw new Error(run.failed[0] || '案が 1 つも届きませんでした')
    // 作れなかった案の枠は片づける
    for (const f of stage.frames) if (f.pending && f.index > 0) { S.options = S.options.filter(o => o.letter !== f.letter); f.letter = null; f.pending = false; stage.veil(f, null) }
    // 元のままがまだ出ていなければ、少し置いてから出す（案が足りなかったときなど）
    if (stage.frames[0].pending && run.order !== run.arrived) { clearTimeout(run.originalTimer); run.originalTimer = setTimeout(revealOriginal, 1500) }
    await run.originalShown
    if (S.run !== run) return
    endRun()
    const seconds = Math.round((Date.now() - run.t0) / 1000), missing = 4 - S.options.length
    trace.finish(`${S.options.length} 枚そろいました（1 つは元のまま）。${seconds} 秒${missing ? `。${missing} つは作れませんでした` : ''}`)
    stage.layout(); setStep('pick'); renderTools()
    announce(`案が ${S.options.length} 枚そろいました`)
  } catch (error) {
    if (S.run !== run) return
    endRun(); backToSay(text)
    trace.stop('止まりました。')
    add(h('div', {}, alertBox(`案を作れませんでした。${error.message}`, error.raw ? h('pre', {}, error.raw) : null)), true)
  }
}
// 1 枚を見せる（覆いを外す）
function reveal(frame, o) {
  if (!frame.pending) return
  frame.pending = false; o.pending = false; stage.veil(frame, null)
  stage.layout(); renderTools(); composer()
  S.run?.trace.building(S.options.filter(x => !x.pending).length, S.options.length)
}
function endRun() { const run = S.run; if (!run) return; clearInterval(run.clock); clearTimeout(run.originalTimer); S.run = null }
// 案の枠を片づけて、一言を書く段階に戻す。書いた一言は入力欄に戻す
function backToSay(text) {
  for (const f of stage.frames) { if (f.index > 0) stage.strip(f); f.letter = null; f.pending = false; stage.veil(f, null) }
  S.options = []; S.picked = null; stage.pointing = true
  setView('single'); input.value = text || ''; setStep('say')
}
function cancelRound() {
  const run = S.run; if (!run) return
  run.controller.abort(); endRun()
  run.trace.stop('やめました。一言を直して、もう一度送れます。')
  backToSay(run.more || run.text)
}

// ---- 選ぶ ----
const HEADS = {
  合う: (o) => (o.isOriginal ? '元の画面は、理論帳と合っています。' : 'あなたが選んだ案は、理論帳と合っています。'),
  食い違う: (o) => (o.isOriginal ? '元の画面は、理論帳と食い違っています。' : 'あなたが選んだ案は、理論帳と食い違っています。'),
  該当なし: () => '理論帳に、この案に当てはまる項目がありません。',
}
const head = (o) => (HEADS[o.verdict] || HEADS.該当なし)(o)
// 選んだあとに出すもの（判定、案の説明と測った変化、ほかの案）。やりとりでも、記録の見直しでも同じものを出す
function resultNodes(o, options, width) {
  const clash = o.verdict === '食い違う'
  return [
    h('div', { class: `verdict${clash ? ' clash' : ''}` },
      h('p', { class: 'head' }, head(o)),
      o.theory ? h('div', { class: 'claim' }, h('p', {}, `理論帳: ${o.theory.claim}`), h('p', { class: 'muted' }, `段階: ${o.theory.level} ／ 出どころ: ${o.theory.source}`)) : null,
      o.verdict_text ? h('p', { class: 'why' }, o.verdict_text) : null,
      clash ? h('p', { class: 'muted', style: 'margin-top:8px' }, '食い違いは、間違いという意味ではありません。理論帳のほうを疑う材料か、別の原因がある合図です。') : null),
    h('div', { class: 'card' },
      h('h3', {}, `${o.letter} は、こういう案でした`),
      h('p', {}, o.isOriginal ? '元のままの画面です。何も変えていません。' : `${o.label}。${o.what_changed}`),
      o.responds ? h('p', { class: 'muted' }, o.responds) : null,
      ...(o.isOriginal || !o.changes ? [] : [
        h('h3', {}, `アプリが画面から測った変化（${width}幅）`),
        o.changes.length
          ? h('dl', { class: 'values', style: 'margin-top:4px' }, ...o.changes.flatMap(c => { const [k, v] = c.split(/: (.*)/s); return [h('dt', {}, k), h('dd', {}, v)] }))
          : h('p', {}, o.css ? `測っている値には、変化が出ていません。当てた CSS は「${o.css}」です。` : '測っている値には、変化が出ていません。'),
        h('p', { class: 'muted' }, '上の説明は AI が書いたものです。食い違うときは、測ったほうが実際です。')])),
    h('div', { class: 'card' },
      h('h3', {}, `ほかの ${options.length - 1} つ`),
      h('ul', { class: 'list' }, ...options.filter(x => x.letter !== o.letter).map(x =>
        h('li', {}, h('b', {}, `${x.letter}: ${x.label}`), h('br'), x.what_changed, h('br'),
          h('span', { class: 'muted' }, x.theory ? `理論帳の「${theoryKey(x)}」と${x.verdict}` : '理論帳に当てはまる項目なし'))))),
  ]
}
function choose(letter) {
  const o = option(letter); if (!o || S.step !== 'pick') return
  S.picked = letter
  // 案を当てたあとの実際の値を測って、元と比べる
  const base = stage.measure(stage.frames[0])
  for (const x of S.options) {
    const frame = stage.byLetter(x.letter)
    stage.label(frame, { letter: x.letter, text: x.label, picked: x.letter === letter })
    const measured = x.isOriginal ? null : stage.measure(frame)
    x.changes = base && measured ? changes(base, measured) : x.isOriginal ? null : []
    // 字数が同じまま言葉を入れ替えた案は、値には出ない。文章が変わったことだけは書いておく
    const before = stage.frames[0].target?.innerText.trim(), after = frame.target?.innerText.trim()
    if (x.changes && before !== after && !x.changes.some(c => c.startsWith('文字数') || c.startsWith('文字のかたまり'))) x.changes.push(`文章: 「${before.slice(0, 12)}…」 → 「${after.slice(0, 12)}…」`)
  }
  const bubble = me(`${letter} を選んだ`)
  for (const node of resultNodes(o, S.options, widthLabel())) add(node, true)
  // 選んだ直後は、判定がいちばん上に来るようにする
  thread.scrollTop = bubble.offsetTop - thread.offsetTop - 16
  setStep('note'); setView('look', letter)
  announce(`${letter} を選びました。${head(o)}`)
}

// ---- 残す ----
async function noted(text) {
  me(text); setStep('done')
  const options = S.options.map(({ letter, label, what_changed, responds, css, html, edits, theory, verdict, verdict_text, isOriginal, changes }) =>
    ({ letter, label, what_changed, responds, css, html, edits: edits || null, theory, verdict, verdict_text, isOriginal: !!isOriginal, changes }))
  try {
    const res = await fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      page: S.page.title, url: S.page.url, slug: S.page.slug, dark: dark(),
      element: { tag: S.element.tag, text: S.element.text, values: S.element.values, viewport: S.element.viewport, path: S.path },
      oneLiner: S.oneLiner, more: S.more, rounds: S.rounds, reading: S.reading, model: S.model, options, picked: S.picked, note: text }) })
    const data = await res.json(); if (!res.ok) throw new Error(data.error)
    await loadRecords()
    const o = option(S.picked), same = RECORDS.filter(r => theoryKey(pickedOf(r)) === theoryKey(o)), earlier = same.slice(0, -1)
    say(h('div', { class: 'card' },
      h('h3', {}, '理論帳に積みました'),
      h('p', {}, o.theory ? `「${theoryKey(o)}」の事例は、これで ${same.length} 件です。` : `理論帳に当てはまる項目がない事例は、これで ${same.length} 件です。理論帳に足す項目の候補になります。`),
      earlier.length ? h('ul', { class: 'list' }, ...earlier.slice(-3).map(r => h('li', {}, `${day(r)}「${r.element.text.slice(0, 16)}…」で「${pickedOf(r).label}」を選んだ（${pickedOf(r).verdict}）。`, h('br'), h('span', { class: 'muted' }, r.note)))) : null))
    const failed = h('span', { class: 'muted', hidden: '' }, ' 上の文を選んでコピーしてください')
    const copy = h('button', { class: 'plain', onclick: async () => { try { await navigator.clipboard.writeText(data.instruction); copy.textContent = 'コピーしました' } catch { copy.textContent = 'コピーできません'; failed.hidden = false } } }, 'コピーする')
    say(h('div', { class: 'box' }, h('h3', {}, '製品に渡す指示'), h('p', { class: 'instruction' }, data.instruction), copy, failed),
      h('p', { class: 'muted', style: 'margin-top:8px' }, `記録の場所: ${data.dir}`))
    thread.scrollTop = thread.scrollHeight
  } catch (error) { add(alertBox(`記録できませんでした。${error.message}`), true) }
}
function resetRound() {
  Object.assign(S, { view: 'single', looking: null, showing: 'variant', path: null, element: null, oneLiner: '', more: [], rounds: [], options: [], reading: '', picked: null })
  pointedCard = null
}
function again() {
  add(h('hr', { class: 'rule' }), true)
  resetRound(); stage.reset(); renderTools(); setStep('point')
}

// =====================================================================
// 右の列: 記録
// =====================================================================
async function loadRecords() {
  RECORDS = await fetch('/api/records').then(r => r.json()).catch(() => [])
  $('#tabs [data-t=records]').textContent = `記録（${RECORDS.length}）`
  if (!$('#records').hidden && !S.review) renderRecords()
}
// 選んだ案が当てはまった理論帳の項目ごとに、事例を積んで見せる
function renderRecords() {
  const groups = new Map()
  for (const r of RECORDS) { const o = pickedOf(r), k = theoryKey(o); if (!groups.has(k)) groups.set(k, { theory: o.theory, items: [] }); groups.get(k).items.push(r) }
  $('#records').replaceChildren(
    h('p', { class: 'muted' }, RECORDS.length ? '選んだ案が当てはまった、理論帳の項目ごとに並べています。「見直す」で、そのときの画面とやりとりを見られます。' : 'まだ記録がありません。'),
    ...[...groups].map(([k, g]) => h('section', {},
      h('div', {}, h('h2', {}, `${k}（${g.items.length} 件）`), g.theory ? h('p', { class: 'muted' }, `${g.theory.level}。${g.theory.claim}`) : null),
      ...g.items.map(caseCard))))
}
function caseCard(r) {
  const o = pickedOf(r)
  return h('div', { class: 'card' },
    h('h3', {}, `${day(r)} ${r.page}「${r.element.text.slice(0, 16)}…」`),
    h('dl', { class: 'values note' }, h('dt', {}, '感じたこと'), h('dd', {}, r.oneLiner), h('dt', {}, '選んだ案'), h('dd', {}, `${o.label}（理論帳と${o.verdict}）`), h('dt', {}, '自分の言葉'), h('dd', {}, r.note)),
    h('button', { class: 'plain', style: 'margin-top:8px', onclick: () => openRecord(r) }, '見直す'))
}
// 記録を見直す: 左に、そのとき残した元と案の画像。右に、そのときのやりとり
function openRecord(r) {
  S.review = { r, view: 'look', looking: r.picked, showing: 'variant' }
  const o = pickedOf(r), bubble = (text) => h('div', { class: 'me' }, text)
  $('#records').replaceChildren(...[
    h('div', {}, h('button', { class: 'text', style: 'padding:0', onclick: closeRecord }, '← 記録の一覧')),
    h('p', { class: 'muted' }, `${new Date(r.at).toLocaleString('ja-JP')}　${r.page}`),
    h('div', { class: 'card' }, h('h3', {}, `指したところ${r.element.viewport ? `（${r.element.viewport}）` : ''}`), h('p', { class: 'quote' }, r.element.text), valuesList(r.element.values)),
    bubble(r.oneLiner),
    r.reading ? h('p', {}, `一言を、こう読みました。${r.reading}`) : null,
    ...(r.rounds || []).flatMap((round, i) => [
      h('div', { class: 'card' }, h('h3', {}, '先に出た案（選ばなかった）'), h('ul', { class: 'list' }, ...round.map(x => h('li', {}, h('b', {}, x.label), h('br'), x.what_changed)))),
      r.more?.[i] ? bubble(r.more[i]) : null]),
    bubble(`${r.picked} を選んだ`),
    ...resultNodes(o, r.options, /スマホ/.test(r.element.viewport || '') ? 'スマホ' : 'PC'),
    bubble(r.note),
    h('div', { class: 'box' }, h('h3', {}, '製品に渡す指示'), h('p', { class: 'instruction' }, r.instruction)),
  ].filter(Boolean))
  $('#records').scrollTop = 0
  $('#stage').classList.add('away'); $('#review').hidden = false
  renderReview()
}
function closeRecord() {
  S.review = null
  $('#stage').classList.remove('away'); $('#review').hidden = true; $('#review').replaceChildren()
  renderRecords(); stage.layout(); renderTools()
}
function reviewGo(change) { Object.assign(S.review, change); renderReview() }
function renderReview() {
  const v = S.review, r = v.r, root = $('#review'), W = root.clientWidth, H = root.clientHeight, w = WIDTHS[S.width], vh = S.width === 'pc' ? 900 : 844
  const src = (letter) => `/out/${r.id}/${S.width}-${letter}.jpg`
  const picture = (letter) => h('img', { src: src(letter), alt: '', onerror: (e) => e.target.replaceWith(h('p', { class: 'muted', style: 'padding:16px' }, 'この記録には画像がありません')) })
  root.replaceChildren()
  if (v.view === 'grid') {
    const gap = 16, cols = S.width === 'pc' ? 2 : 4, rows = S.width === 'pc' ? 2 : 1
    const cw = Math.min(w, (W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows - 28) * w / vh), ch = cw * vh / w, x0 = (W - (cw * cols + gap * (cols - 1))) / 2
    r.options.forEach((o, i) => root.append(h('button', { class: `cell pickable${o.letter === r.picked ? ' picked' : ''}`, style: `left:${x0 + (i % cols) * (cw + gap)}px;top:${Math.floor(i / cols) * (ch + 28 + gap)}px;width:${cw}px`, onclick: () => reviewGo({ view: 'look', looking: o.letter, showing: 'variant' }) },
      h('div', { class: 'tag' }, h('b', {}, o.letter), h('span', {}, o.label + (o.letter === r.picked ? '（選んだ）' : ''))),
      h('div', { class: 'frame', style: `width:${cw}px;height:${ch}px` }, picture(o.letter)))))
  } else {
    const o = r.options.find(x => x.letter === v.looking), original = r.options.find(x => x.isOriginal)
    const fw = Math.min(W, w, H * w / vh)
    root.append(h('div', { class: 'frame', style: `position:absolute;left:${(W - fw) / 2}px;top:0;width:${fw}px;height:${fw * vh / w}px` }, picture(v.showing === 'variant' || !original ? o.letter : original.letter)))
  }
  renderTools()
}
function renderReviewTools() {
  const v = S.review, r = v.r, tools = $('#tools'), o = r.options.find(x => x.letter === v.looking), original = r.options.find(x => x.isOriginal)
  if (v.view === 'look' && o && !o.isOriginal && original) {
    tools.append(h('span', { class: 'seg', role: 'group', 'aria-label': '元と案の切り替え' },
      h('button', { 'data-key': 'original', 'aria-pressed': String(v.showing === 'original'), onclick: () => reviewGo({ showing: 'original' }) }, '元'),
      h('button', { 'data-key': 'variant', 'aria-pressed': String(v.showing === 'variant'), title: o.label, onclick: () => reviewGo({ showing: 'variant' }) }, `案 ${o.letter}`)))
  }
  tools.append(h('span', { class: 'seg', role: 'group', 'aria-label': '見方' },
    h('button', { 'data-key': 'grid', 'aria-pressed': String(v.view === 'grid'), onclick: () => reviewGo({ view: 'grid' }) }, '並べる'),
    ...r.options.map(x => h('button', { 'data-key': x.letter, 'aria-pressed': String(v.view === 'look' && v.looking === x.letter), title: x.label, 'aria-label': x.letter === r.picked ? `${x.letter}（選んだ案）` : x.letter, onclick: () => reviewGo({ view: 'look', looking: x.letter, showing: 'variant' }) }, x.letter === r.picked ? `${x.letter} ✓` : x.letter))))
}
$('#tabs').addEventListener('click', (e) => {
  const t = e.target.dataset.t; if (!t) return
  for (const b of $('#tabs').children) b.setAttribute('aria-pressed', String(b.dataset.t === t))
  $('#thread').hidden = $('#composer').hidden = t !== 'thread'; $('#records').hidden = t !== 'records'
  // やりとりに戻ったら、見直しを閉じて、いまの画面に戻す
  if (S.review) closeRecord()
  if (t === 'records') loadRecords()
})

// =====================================================================
// 見る画面を選ぶ、取り込む
// =====================================================================
const remember = (slug) => { try { localStorage.setItem('page', slug) } catch {} }
const recalled = () => { try { return localStorage.getItem('page') } catch { return null } }
function listPages() {
  $('#page').replaceChildren(...PAGES.map(p => h('option', { value: p.slug }, p.title)), h('option', { value: '+' }, '＋ 別の画面を取り込む…'))
  if (S.page) $('#page').value = S.page.slug
}
async function openPage(slug) {
  if (S.run) cancelRound()
  const first = !S.page
  S.page = PAGES.find(p => p.slug === slug) || PAGES[0]; remember(S.page.slug); listPages()
  if (!first) add(h('hr', { class: 'rule' }), true)
  resetRound(); renderTools(); setStep('point', { focus: false })
  await stage.open(S.page.slug)
}
const capturing = (on) => { $('#capture').hidden = !on; if (on) $('#url').focus(); else $('#page').value = S.page.slug }
$('#page').addEventListener('change', (e) => { if (e.target.value === '+') capturing(true); else openPage(e.target.value) })
$('#cancel').addEventListener('click', () => { capturing(false); $('#page').focus() })
$('#capture').addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = $('#url').value.trim(); if (!url) return
  $('#go').disabled = true; $('#go').textContent = '取り込み中'
  try {
    const res = await fetch('/api/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
    const page = await res.json(); if (!res.ok) throw new Error(page.error)
    PAGES = await fetch('/api/pages').then(r => r.json()); $('#url').value = ''; capturing(false); openPage(page.slug)
  } catch (error) { add(alertBox(`画面を取り込めませんでした。${error.message}`), true) }
  finally { $('#go').disabled = false; $('#go').textContent = '取り込む' }
})

// =====================================================================
// はじめる
// =====================================================================
composer()
add(h('p', { class: 'muted' }, '気になるところをクリック → 一言 → 並んだ案を大きく見比べて選ぶ → 選んだ理由を残す'))
PAGES = await fetch('/api/pages').then(r => r.json())
openPage(recalled())
loadRecords()
fetch('/api/session').then(r => r.json()).then(s => { if (s.error) thread.prepend(alertBox(`ChatGPT につながっていません。${s.error}`)) })
