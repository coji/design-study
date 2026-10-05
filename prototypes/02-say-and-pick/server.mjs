// 試作 2 のサーバー: 画面と写しを配り、AI への取り次ぎと記録の保存をする
// 起動: node server.mjs → http://127.0.0.1:4302
// MOCK=1 を付けると、AI を呼ばずに前回の案（out/last-variants.json）を返す
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { connect, makeVariants } from './ai.mjs'
import { shot, shotAll, warm, close } from './shot.mjs'

// 起動し直すときに、撮影用のブラウザを残さない
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await close(); process.exit(0) })

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT || 4302)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.jpg': 'image/jpeg' }

const json = (r, status, body) => r.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
const body = async (q) => { const chunks = []; for await (const c of q) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` }

// 画面を写しとして取り込む。lab の capture.mjs をそのまま使う（写し、2 つの幅の画像、要素の値ができる）
const pages = async () => {
  const list = []
  for (const d of await readdir(join(ROOT, 'copy')).catch(() => [])) { try { list.push(JSON.parse(await readFile(join(ROOT, 'copy', d, 'meta.json'), 'utf8'))) } catch {} }
  return list.sort((a, b) => a.at.localeCompare(b.at))
}
async function capture(input) {
  const url = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`)
  const slug = (url.host + url.pathname).replace(/^www\./, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60)
  const dir = join(ROOT, 'copy', slug)
  await mkdir(join(dir, 'assets'), { recursive: true })
  await new Promise((done, fail) => execFile(process.execPath, [join(ROOT, '../../lab/capture.mjs'), url.href, dir], { timeout: 120_000 }, (error, out, err) => error ? fail(new Error(err.trim().split('\n').pop() || error.message)) : done()))
  const html = await readFile(join(dir, 'snapshot.html'), 'utf8')
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim().slice(0, 40) || url.host
  const meta = { slug, url: url.href, title, at: new Date().toISOString() }
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 1))
  return meta
}

// 記録の行き先は製品。選んだ案を、製品のコーディングエージェントにそのまま渡せる指示にする
function instruction(r) {
  const o = r.options.find(x => x.letter === r.picked), where = `${r.page} の「${r.element.text.slice(0, 30)}${r.element.text.length > 30 ? '…' : ''}」（${r.element.tag}）`
  if (o.isOriginal) return `${where}は、変えない。\n理由: ${r.note}`
  return `${where}を直す。\n変えること: ${o.what_changed}\n${o.html ? `新しい文章: 「${o.html}」\n` : ''}${o.edits?.length ? `変える文章: ${o.edits.map(e => `「${e.html}」`).join('、')}\n` : ''}${o.css ? `見た目の値（写しに当てた CSS。値を参考にする）: ${o.css}\n` : ''}理由: ${r.note}`
}

// 記録に、元と各案の画像を残す。写しはあとで取り込み直されるかもしれないので、そのときの画面を画像で持つ
async function keepImages(dir, record) {
  if (process.env.MOCK || !record.slug) return
  const images = await shotAll({ base: `http://127.0.0.1:${PORT}`, slug: record.slug, path: record.element.path, dark: record.dark, options: record.options })
  for (const { name, image } of images) await writeFile(join(ROOT, dir, name), image)
}

// 記録は 1 回 1 フォルダ。人が読む Markdown と、機械が読む JSON を置く
function markdown(r) {
  const theory = (t) => t ? `${t.claim}（${t.level}。出どころ: ${t.source}）` : '理論帳に当てはまる項目なし'
  const picked = r.options.find(o => o.letter === r.picked)
  return `# ${r.page} の「${r.element.text.slice(0, 20)}…」

- 日時: ${new Date(r.at).toLocaleString('ja-JP')}
- 画面: ${r.page}${r.url ? `（${r.url}）` : ''}
- 指したところ: ${r.element.tag} 「${r.element.text}」
- いまの値: ${Object.entries(r.element.values).map(([k, v]) => `${k} ${v}`).join('、')}

## 感じたこと

> ${r.oneLiner}
${(r.more || []).map(m => `>\n> （案を見て言い足した）${m}\n`).join('')}
AI の読み: ${r.reading}

${(r.rounds || []).map((round, i) => `## 作り直す前の案（${i + 1} 回目）\n\n${round.map(o => `- ${o.label}。${o.what_changed}`).join('\n')}\n\n`).join('')}## 並んだ案

${r.options.map(o => `- ${o.letter}${o.letter === r.picked ? '（選んだ）' : ''}: ${o.label}。${o.what_changed}${o.changes?.length ? `\n  - 測った変化: ${o.changes.join('／')}` : ''}\n  - 理論: ${theory(o.theory)}\n  - 判定: ${o.verdict}。${o.verdict_text}`).join('\n')}

## 選んだ案

${picked.letter}: ${picked.label}。理論との関係は「${picked.verdict}」。

${picked.html ? `変えた文章:\n\n> ${picked.html}\n\n` : ''}${picked.css ? `変えた CSS:\n\n\`\`\`css\n${picked.css}\n\`\`\`\n\n` : ''}## 自分の言葉

> ${r.note}

## 元と、選んだ案

| | PC 幅 | スマホ幅 |
|---|---|---|
| 元 | ![](pc-${r.options.find(o => o.isOriginal)?.letter}.jpg) | ![](sp-${r.options.find(o => o.isOriginal)?.letter}.jpg) |
| 選んだ案 | ![](pc-${r.picked}.jpg) | ![](sp-${r.picked}.jpg) |

## 製品に渡す指示

${instruction(r)}
`
}

createServer(async (q, r) => {
  try {
    const url = new URL(q.url, 'http://x')
    if (url.pathname === '/api/session') return json(r, 200, process.env.MOCK ? { name: 'MOCK', model: 'mock' } : await connect())
    if (url.pathname === '/api/pages') return json(r, 200, await pages())
    if (url.pathname === '/api/capture' && q.method === 'POST') return json(r, 200, await capture((await body(q)).url.trim()))
    if (url.pathname === '/api/records') {
      const dirs = (await readdir(join(ROOT, 'out')).catch(() => [])).sort(), records = []
      for (const d of dirs) { try { const record = JSON.parse(await readFile(join(ROOT, 'out', d, 'record.json'), 'utf8')); records.push({ ...record, id: d, instruction: instruction(record) }) } catch {} }
      return json(r, 200, records)
    }
    if (url.pathname === '/api/variants' && q.method === 'POST') {
      // できたものから順に、JSON Lines で流す
      // 届いた時刻も一緒に out/last-round.json に残す。MOCK=1 のときは、それを同じ間合いで再生する（MOCK_SPEED=4 で 4 倍速）
      const last = join(ROOT, 'out/last-round.json'), events = [], t0 = Date.now()
      r.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' })
      const send = (part) => { if (!r.writableEnded) r.write(JSON.stringify(part) + '\n') }
      const emit = (part) => { events.push({ t: Date.now() - t0, part }); send(part) }
      // 画面を閉じたり「やめる」を押したりしたら、AI の呼び出しも止める
      const stop = new AbortController(); r.on('close', () => { if (!r.writableEnded) stop.abort() })
      try {
        const request = await body(q)
        if (process.env.MOCK) {
          const speed = Number(process.env.MOCK_SPEED || 1)
          for (const { t, part } of JSON.parse(await readFile(last, 'utf8'))) { await new Promise(done => setTimeout(done, Math.max(0, t / speed - (Date.now() - t0)))); if (stop.signal.aborted) break; send(part) }
        } else {
          // AI に画面を見せる。撮れなければ、値だけで続ける
          const image = await shot({ base: `http://127.0.0.1:${PORT}`, slug: request.slug, path: request.path, width: request.width, dark: request.dark }).catch((error) => { console.error('撮影に失敗', error.message); return null })
          emit({ saw: !!image })
          const done = await makeVariants({ ...request, image, signal: stop.signal }, emit)
          emit({ done: true, ...done })
          await mkdir(join(ROOT, 'out'), { recursive: true }); await writeFile(last, JSON.stringify(events))
        }
      } catch (error) { if (!stop.signal.aborted) { console.error(error); send({ error: error.message, raw: error.raw }) } }
      return r.end()
    }
    if (url.pathname === '/api/save' && q.method === 'POST') {
      const record = { at: new Date().toISOString(), ...await body(q) }
      const dir = join('out', stamp())
      await mkdir(join(ROOT, dir), { recursive: true })
      await writeFile(join(ROOT, dir, 'record.json'), JSON.stringify(record, null, 1))
      await writeFile(join(ROOT, dir, 'record.md'), markdown(record))
      keepImages(dir, record).catch((error) => console.error('画像を残せませんでした', error.message))
      return json(r, 200, { dir: `prototypes/02-say-and-pick/${dir}`, instruction: instruction(record) })
    }
    const path = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    if (path.includes('..') || !(path === '/index.html' || path.startsWith('/copy/') || /^\/app\/[\w-]+\.js$/.test(path) || /^\/out\/[\w-]+\/[\w-]+\.jpg$/.test(path))) return r.writeHead(404).end()
    r.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(join(ROOT, path)))
  } catch (error) {
    if (error.code === 'ENOENT') return r.writeHead(404).end()
    console.error(error)
    json(r, 500, { error: error.message, raw: error.raw })
  }
}).on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `もう動いています: http://127.0.0.1:${PORT}` : error); process.exit(1) }).listen(PORT, '127.0.0.1', () => { console.log(`http://127.0.0.1:${PORT}`); if (!process.env.MOCK) warm().catch(() => {}) })
