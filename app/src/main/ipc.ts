// 画面（renderer）からの呼び出しを受ける。ここに並べたものが、main のできることの全部。
import {
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RecordInput, RoundRequest, type RoundEvent } from '@shared/schema'
import { makeVariants } from './ai'
import { session, signIn, signOut } from './auth'
import * as pages from './pages'
import * as records from './records'
import { shot, shotAll } from './shots'
import {
  copiesDir,
  dataDir,
  lastRoundFile,
  recordsDir,
  setDataDir,
  settings,
  theory
} from './store'

/** 準備ができる前に呼ぶ必要がある */
export function registerSchemes(): void {
  const privileges = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  protocol.registerSchemesAsPrivileged([
    { scheme: 'copy', privileges },
    { scheme: 'record', privileges }
  ])
}

/** copy://<名前>/<ファイル> と record://<id>/<ファイル> を、保存先のフォルダの中のファイルに対応させる */
function serve(scheme: string, root: () => string): void {
  protocol.handle(scheme, async (request) => {
    const url = new URL(request.url)
    const base = join(root(), url.hostname)
    const file = normalize(join(base, decodeURIComponent(url.pathname)))
    if (!file.startsWith(base + sep)) return new Response(null, { status: 403 })
    try {
      const response = await net.fetch(pathToFileURL(file).href)
      // srcdoc の中から読むフォントは別の出どころ扱いになるので、読めるように許可を付ける
      const headers = new Headers(response.headers)
      headers.set('access-control-allow-origin', '*')
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

// 案を待っているあいだの、やめるための口
const running = new Map<string, AbortController>()

interface Recorded {
  t: number
  event: RoundEvent
}

/** 案を作る。できたものから順に、画面へ送る */
async function round(event: IpcMainInvokeEvent, id: string, input: unknown): Promise<void> {
  const request = RoundRequest.parse(input)
  const controller = new AbortController()
  running.set(id, controller)
  const started = Date.now()
  const log: Recorded[] = []
  const send = (e: RoundEvent): void => {
    if (!event.sender.isDestroyed()) event.sender.send('round:event', id, e)
  }
  const emit = (e: RoundEvent): void => {
    log.push({ t: Date.now() - started, event: e })
    send(e)
  }
  try {
    if (process.env['DESIGN_STUDY_MOCK']) {
      // AI を呼ばずに、前回の 1 回分を、届いた間合いのまま再生する。待っている間の見え方を、枠を使わずに確かめるため
      const speed = Number(process.env['DESIGN_STUDY_MOCK_SPEED'] || 1)
      const recorded = JSON.parse(
        await readFile(process.env['DESIGN_STUDY_MOCK'], 'utf8')
      ) as Recorded[]
      for (const { t, event: e } of recorded) {
        await new Promise((done) =>
          setTimeout(done, Math.max(0, t / speed - (Date.now() - started)))
        )
        if (controller.signal.aborted) return
        send(e)
      }
      return
    }
    // AI に画面を見せる。撮れなければ、値だけで続ける
    const image = await shot(request.slug, request.path, request.width).catch((error) => {
      console.error('撮影に失敗', error)
      return null
    })
    emit({ type: 'saw', ok: !!image })
    await makeVariants(request, image, emit, controller.signal)
    await mkdir(dataDir(), { recursive: true })
    await writeFile(lastRoundFile(), JSON.stringify(log))
  } catch (error) {
    if (!controller.signal.aborted)
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    running.delete(id)
  }
}

export function registerIpc(): void {
  // 理論帳を、置き場所に用意しておく（初めて開いたときから、中を読んだり書き足したりできるように）
  void theory().catch((error) => console.error('理論帳を用意できませんでした', error))

  serve('copy', copiesDir)
  serve('record', recordsDir)

  ipcMain.handle('pages:list', () => pages.list())
  ipcMain.handle('pages:html', (_e, slug: string) => pages.html(slug))
  ipcMain.handle('pages:capture', (_e, url: string) => pages.capture(url))
  ipcMain.handle('pages:remove', (_e, slug: string) => pages.remove(slug))
  ipcMain.handle('pages:openBrowser', (_e, url: string) => pages.openBrowser(url))
  ipcMain.handle('pages:captureBrowser', () => pages.captureBrowser())
  ipcMain.handle('pages:clearLogins', () => pages.clearLogins())

  ipcMain.handle('round:start', round)
  ipcMain.handle('round:cancel', (_e, id: string) => running.get(id)?.abort())

  ipcMain.handle('records:list', () => records.list())
  ipcMain.handle('records:save', async (event, input: unknown) => {
    const saved = await records.save(RecordInput.parse(input))
    // 画像は時間がかかるので、返事を待たせずに裏で撮る。撮り終わったら画面に知らせる
    const { slug, element, options } = saved.record
    if (slug) {
      void shotAll(slug, element.path, options)
        .then(async (images) => {
          for (const { name, image } of images) await writeFile(join(saved.dir, name), image)
          if (!event.sender.isDestroyed()) event.sender.send('records:images', saved.id)
        })
        .catch((error) => console.error('画像を残せませんでした', error))
    }
    return { id: saved.id, dir: saved.dir, instruction: saved.instruction }
  })

  ipcMain.handle('session:get', () => session())
  ipcMain.handle('session:signIn', () => signIn())
  ipcMain.handle('session:signOut', () => signOut())

  ipcMain.handle('settings:get', () => settings())
  ipcMain.handle('settings:chooseDataDir', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '写しと記録を置くフォルダ',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? settings() : setDataDir(result.filePaths[0])
  })
  ipcMain.handle('settings:resetDataDir', () => setDataDir(null))
  ipcMain.handle('settings:openDataDir', async () => {
    await mkdir(dataDir(), { recursive: true })
    await shell.openPath(dataDir())
  })
}
