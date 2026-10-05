// 写しを 2 つの幅で撮る
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, basename, join, extname } from 'node:path'
const [file, out] = process.argv.slice(2)
// フォントが読めるよう、写しは手元の HTTP サーバーから配る
const TYPES = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.css': 'text/css' }
const server = createServer(async (q, r) => { try { const f = join(dirname(file), decodeURIComponent(new URL(q.url, 'http://x').pathname)); r.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(await readFile(f)) } catch { r.writeHead(404).end() } }).listen(0)
const base = `http://127.0.0.1:${server.address().port}/${basename(file)}`
const b = await chromium.launch({ channel: 'chrome' })
for (const [n, v] of [['pc', { width: 1280, height: 800 }], ['sp', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: v }); await p.goto(base, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
  await p.evaluate(async () => { for (const i of document.images) { if (!i.complete) await new Promise(r => { i.onload = i.onerror = r }); await i.decode?.().catch(() => {}) } })
  await p.screenshot({ path: `${out}/${n}.png`, fullPage: true }); await p.close()
}
await b.close(); server.close()
