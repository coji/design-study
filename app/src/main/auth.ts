// Sign in with ChatGPT。使う人が自分の ChatGPT のプランの枠で AI を動かすので、API キーが要らない。
// サインインとトークンの管理は OpenAI の DevKit に任せる。トークンは、OS の仕組み（safeStorage）で暗号化して保存する。
import { app, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { createChatGPT, type ChatGPTClient } from '@siwc/local'
import type { Session } from '@shared/schema'

let client: ChatGPTClient | null = null
let model: string | null = null

export function chatgpt(): ChatGPTClient {
  client ??= createChatGPT({
    appName: 'Design Study',
    appId: 'design-study',
    redirectPort: 0,
    storageDir: join(app.getPath('userData'), 'auth'),
    sendHostId: true,
    credentialEncryption: {
      id: 'electron-safe-storage',
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (text) => new Uint8Array(safeStorage.encryptString(text)),
      decrypt: (bytes) => safeStorage.decryptString(Buffer.from(bytes))
    },
    openBrowser: (url) => shell.openExternal(url)
  })
  return client
}

/** 使うモデル。一覧の先頭（いちばん新しいもの）を使う。DESIGN_STUDY_MODEL で変えられる */
export async function currentModel(): Promise<string> {
  if (!model) {
    const models = await chatgpt().listModels()
    model = process.env['DESIGN_STUDY_MODEL'] || models[0]?.slug || ''
    if (!model) throw new Error('使えるモデルがありません')
  }
  return model
}

async function describe(): Promise<Session> {
  const state = await chatgpt().getSession()
  if (state.status !== 'connected') return { connected: false, error: state.error?.message }
  if (!state.sharing)
    return {
      connected: false,
      error: 'ChatGPT のプランの利用が許可されていません。サインインし直して、許可してください'
    }
  return {
    connected: true,
    name: state.identity?.name,
    model: await currentModel().catch(() => undefined)
  }
}
export async function session(): Promise<Session> {
  try {
    return await describe()
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : String(error) }
  }
}
/** ブラウザを開いて、ChatGPT でサインインしてもらう */
export async function signIn(): Promise<Session> {
  try {
    await chatgpt().signIn()
    return await describe()
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : String(error) }
  }
}
export async function signOut(): Promise<Session> {
  await chatgpt().disconnect()
  model = null
  return { connected: false }
}
