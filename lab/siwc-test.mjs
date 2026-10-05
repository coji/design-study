// Sign in with ChatGPT の実験: サインイン → モデル一覧 → 画像つきの診断
import { createChatGPT } from '../vendor/sign-in-with-chatgpt-devkit/packages/local/dist/index.js'
import { execFileSync } from 'node:child_process'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'

// トークンは AES-256-GCM で暗号化し、鍵は macOS のキーチェーンに置く
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
  openBrowser: (url) => { console.log('ブラウザを開きます'); execFileSync('open', [url]) } })

let session = await chatgpt.getSession()
if (session.status !== 'connected') session = await chatgpt.signIn()
console.log('session', JSON.stringify({ status: session.status, sharing: session.sharing, name: session.identity?.name, error: session.error }))
if (!session.sharing) { console.log('プランの利用が許可されていません'); process.exit(2) }
const models = await chatgpt.listModels()
console.log('models', models.map(m => `${m.slug} (${m.displayName})`).join(', '))
const model = process.env.MODEL || models[0].slug
const img = (f) => ({ type: 'input_image', image_url: `data:image/png;base64,${readFileSync(f).toString('base64')}` })
const t0 = Date.now()
const result = await chatgpt.streamResponse({ model,
  instructions: 'あなたはウェブデザインの講評者です。日本語で、具体的な数値や要素名を挙げて簡潔に答えます。',
  input: [{ role: 'user', content: [
    { type: 'input_text', text: '同じページのファーストビュー付近を、PC 幅（1 枚目、1280px）とスマホ幅（2 枚目、390px）で撮った画像です。デザインの問題を、効き目の大きい順に 3 つだけ挙げてください。各項目は「どこが / 何が問題か / どの原則か / どう直すか（値つき）」の 4 点で、合計 400 字以内。' },
    img(process.argv[2] || 'out/ref/pc.png'), img(process.argv[3] || 'out/ref/sp.png') ] }] })
console.log(`--- ${model} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(result.text)
